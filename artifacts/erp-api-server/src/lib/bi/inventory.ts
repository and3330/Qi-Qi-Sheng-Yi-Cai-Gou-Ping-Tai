import { tenantPool } from "../tenant-db";
import { AGING_BUCKETS, agingBucket, classifyStock, unitCost } from "./compute";
import { metric, num, period } from "./range";
import type { InventoryResponse } from "./types";

type Range = { startDate: string; endDate: string; days: number };

async function loadInventoryFacts(r: Range) {
  const p = [r.startDate, r.endDate];
  const [items, moves, suppliers] = await Promise.all([
    tenantPool.query(`SELECT id, item_code AS code, item_name AS name, current_stock AS stock, moving_avg_cost AS mac,
                             buying_price AS bp, reorder_level AS "reorderLevel"
                        FROM items WHERE COALESCE(is_virtual,false) = false`),
    tenantPool.query(`SELECT item_id AS "itemId",
                             MAX(CASE WHEN entry_type = 'Receipt' AND created_at::date <= $2::date THEN created_at::date END)::text AS "lastReceipt",
                             SUM(CASE WHEN entry_type = 'Issue' AND created_at::date BETWEEN $1::date AND $2::date THEN ABS(quantity) ELSE 0 END)::float AS outbound
                        FROM stock_entries GROUP BY item_id`, p),
    tenantPool.query(`WITH rc AS (
                         SELECT pr.supplier_id, COUNT(*)::int AS receipts, SUM(pr.total_amount)::float AS spend,
                                COUNT(po.expected_date)::int AS with_due,
                                COUNT(*) FILTER (WHERE po.expected_date IS NOT NULL AND pr.receipt_date <= po.expected_date)::int AS on_time
                           FROM purchase_receipts pr LEFT JOIN purchase_orders po ON po.id = pr.purchase_order_id
                          WHERE pr.status NOT IN ('Cancelled','Draft') AND pr.receipt_date >= $1 AND pr.receipt_date <= $2
                          GROUP BY 1),
                       rt AS (
                         SELECT supplier_id, COUNT(*)::int AS returns, SUM(total_amount)::float AS amount FROM purchase_returns
                          WHERE status NOT IN ('Cancelled','Draft') AND return_date >= $1 AND return_date <= $2 GROUP BY 1)
                     SELECT s.id AS "supplierId", s.name, COALESCE(rc.spend,0)::float AS spend, COALESCE(rc.receipts,0) AS receipts,
                            COALESCE(rc.with_due,0) AS "withDue", COALESCE(rc.on_time,0) AS "onTime",
                            COALESCE(rt.returns,0) AS returns, COALESCE(rt.amount,0)::float AS "returnAmount"
                       FROM suppliers s LEFT JOIN rc ON rc.supplier_id = s.id LEFT JOIN rt ON rt.supplier_id = s.id
                      WHERE rc.supplier_id IS NOT NULL OR rt.supplier_id IS NOT NULL
                      ORDER BY spend DESC LIMIT 20`, p),
  ]);
  return { items: items.rows, moves: new Map(moves.rows.map((m: any) => [m.itemId as number, m])), suppliers: suppliers.rows };
}

export async function buildInventory(r: Range): Promise<InventoryResponse> {
  const f = await loadInventoryFacts(r);
  const aging = new Map<string, { value: number; items: number }>(AGING_BUCKETS.map((b) => [b, { value: 0, items: 0 }]));
  let value = 0;
  let below = 0;
  let negative = 0;
  let zeroCost = 0;
  const health: InventoryResponse["health"] = [];
  for (const it of f.items) {
    const stock = num(it.stock);
    const cost = unitCost(it.mac, it.bp);
    const reorder = it.reorderLevel == null ? null : num(it.reorderLevel);
    const mv = f.moves.get(it.id);
    const outbound = num(mv?.outbound);
    if (stock < 0) negative += 1;
    if (stock > 0 && cost == null) zeroCost += 1;
    if (reorder != null && reorder > 0 && stock <= reorder) below += 1;
    const v = stock > 0 && cost != null ? stock * cost : 0;
    value += v;
    if (stock > 0) {
      const b = aging.get(agingBucket(mv?.lastReceipt ?? null, r.endDate))!;
      b.value += v; b.items += 1;
    }
    if (stock !== 0 || outbound > 0) {
      const c = classifyStock(stock, reorder, outbound, r.days);
      health.push({ itemId: it.id, code: it.code ?? "", name: it.name, stock, value: v, outboundQty: outbound, daysOfSupply: c.daysOfSupply, reorderLevel: reorder, status: c.status });
    }
  }
  health.sort((a, b) => b.value - a.value);
  const withDue = f.suppliers.reduce((s: number, x: any) => s + x.withDue, 0);
  const onTime = f.suppliers.reduce((s: number, x: any) => s + x.onTime, 0);
  const noItems = "尚未建立任何實體料件";
  const has = f.items.length > 0;

  return {
    period: period(r),
    summary: {
      inventoryValue: metric(has ? value : null, noItems),
      itemCount: { value: f.items.length },
      belowReorder: metric(has ? below : null, noItems),
      negativeStock: metric(has ? negative : null, noItems),
      zeroCostWithStock: metric(has ? zeroCost : null, noItems),
      supplierOnTimeRate: metric(withDue > 0 ? onTime / withDue : null, "期間內沒有對應有預計到貨日採購單的進貨單"),
    },
    aging: AGING_BUCKETS.map((b) => ({ bucket: b, ...aging.get(b)! })),
    health: health.slice(0, 60),
    suppliers: f.suppliers.map((s: any) => ({
      supplierId: s.supplierId, name: s.name, spend: num(s.spend), receipts: s.receipts,
      onTimeRate: s.withDue > 0 ? s.onTime / s.withDue : null, returns: s.returns, returnAmount: num(s.returnAmount),
    })),
    notes: [
      { text: "存貨價值沿用庫存報表規則：目前庫存 × 移動平均成本（為 0 時用進價）；無成本料件不計入並另列數量。" },
      { text: "庫齡以最後一次入庫（Receipt）至結束日的天數分組；出庫量為期間內 Issue 異動合計（依異動建立日）。" },
      { text: "供應商準時率 = 進貨日不晚於採購單預計到貨日的進貨單比例；系統未記錄逐項到貨數量差異，故不計算足量（In-Full）。" },
    ],
  };
}
