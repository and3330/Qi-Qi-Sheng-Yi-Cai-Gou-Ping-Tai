import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, itemsTable, stockEntriesTable, warehousesTable } from "@workspace/erp-db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
const financeRoles = requireRole("owner", "admin", "finance_admin", "accountant");

type Query = {
  search?: string;
  group?: string;
  warehouseId?: string;
  lowStockOnly?: string;
  page?: string;
  pageSize?: string;
};

function parseQuery(query: Query) {
  const search = (query.search || "").trim();
  const group = (query.group || "").trim();
  const warehouseId = Number(query.warehouseId);
  const page = Math.max(1, Number.parseInt(query.page || "1", 10) || 1);
  const pageSize = Math.min(5000, Math.max(1, Number.parseInt(query.pageSize || "50", 10) || 50));
  return {
    search,
    group,
    warehouseId: Number.isInteger(warehouseId) && warehouseId > 0 ? warehouseId : null,
    lowStockOnly: query.lowStockOnly === "true" || query.lowStockOnly === "1",
    page,
    pageSize,
  };
}

function itemFilters(search: string, group: string) {
  return sql`
    (${search} = '' OR i.item_code ILIKE ${`%${search}%`} OR i.item_name ILIKE ${`%${search}%`})
    AND (${group} = '' OR i.item_group = ${group})
  `;
}

/** 員工自助帳號只能用自己的打卡、請假，不開放查庫存 */
function notEmployee(req: Request, res: Response, next: NextFunction): void {
  if ((req as any).session?.user?.role === "employee") { res.status(403).json({ error: "權限不足" }); return; }
  next();
}

const COST_FIELDS = ["buyingPrice", "movingAvgCost", "stockValue"];

/**
 * 庫存清單。兩種用途共用同一段查詢：
 * - report：庫存報表，含成本與庫存金額，只給財務角色
 * - lookup：查庫存，只回數量與售價，不含成本，給現場人員用
 */
const inventoryList = (mode: "report" | "lookup") =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      const opts = parseQuery(req.query as Query);
      const filters = itemFilters(opts.search, opts.group);
      const warehouseJoin = opts.warehouseId
        ? sql`LEFT JOIN (
            SELECT item_id, SUM(CASE
              WHEN entry_type = 'Receipt' THEN quantity
              WHEN entry_type IN ('Issue', 'Transfer') THEN -quantity
              ELSE 0
            END) AS qty
            FROM stock_entries
            WHERE warehouse_id = ${opts.warehouseId}
            GROUP BY item_id
          ) selected_stock ON selected_stock.item_id = i.id`
        : sql``;
      const warehouseFilter = opts.warehouseId
        ? sql`AND selected_stock.item_id IS NOT NULL`
        : sql``;
      const warehouseQuantity = opts.warehouseId
        ? sql`COALESCE(selected_stock.qty, 0)`
        : sql`i.current_stock`;
      const lowStock = opts.lowStockOnly
        ? sql`AND i.reorder_level > 0 AND ${warehouseQuantity} < i.reorder_level`
        : sql``;

      const [pageRows, summaryRows, groupRows, warehouseRows] = await Promise.all([
        db.execute(sql`
          SELECT i.id AS "itemId", i.item_code AS "itemCode", i.item_name AS "itemName",
            i.item_group AS "itemGroup", i.unit,
            (${warehouseQuantity})::float AS "currentStock",
            i.reorder_level::float AS "reorderLevel",
            i.selling_price::float AS "sellingPrice",
            i.buying_price::float AS "buyingPrice",
            COALESCE(NULLIF(i.moving_avg_cost, 0), i.buying_price, 0)::float AS "movingAvgCost",
            ((${warehouseQuantity}) * COALESCE(NULLIF(i.moving_avg_cost, 0), i.buying_price, 0))::float AS "stockValue",
            (i.reorder_level > 0 AND (${warehouseQuantity}) < i.reorder_level) AS "belowReorder"
          FROM items i
          ${warehouseJoin}
          WHERE ${filters} ${warehouseFilter} ${lowStock}
          ORDER BY i.item_code
          LIMIT ${opts.pageSize} OFFSET ${(opts.page - 1) * opts.pageSize}
        `),
        db.execute(sql`
          SELECT COUNT(*)::int AS "totalItems",
            COALESCE(SUM((${warehouseQuantity}) * COALESCE(NULLIF(i.moving_avg_cost, 0), i.buying_price, 0)), 0)::float AS "totalStockValue",
            COUNT(*) FILTER (WHERE i.reorder_level > 0 AND (${warehouseQuantity}) < i.reorder_level)::int AS "lowStockCount"
          FROM items i
          ${warehouseJoin}
          WHERE ${filters} ${warehouseFilter} ${lowStock}
        `),
        db.execute(sql`
          SELECT DISTINCT item_group AS "itemGroup"
          FROM items
          WHERE item_group IS NOT NULL AND item_group <> ''
          ORDER BY item_group
        `),
        db.select({ id: warehousesTable.id, name: warehousesTable.name })
          .from(warehousesTable)
          .orderBy(warehousesTable.name),
      ]);

      const rows = pageRows.rows as Array<Record<string, unknown>>;
      const itemIds = rows.map(row => Number(row.itemId));
      const breakdown = itemIds.length
        ? await db.select({
            itemId: stockEntriesTable.itemId,
            warehouseId: warehousesTable.id,
            warehouseName: warehousesTable.name,
            qty: sql<number>`SUM(CASE
              WHEN ${stockEntriesTable.entryType} = 'Receipt' THEN ${stockEntriesTable.quantity}
              WHEN ${stockEntriesTable.entryType} IN ('Issue', 'Transfer') THEN -${stockEntriesTable.quantity}
              ELSE 0 END)::float`,
          })
            .from(stockEntriesTable)
            .innerJoin(warehousesTable, eq(stockEntriesTable.warehouseId, warehousesTable.id))
            .where(and(
              inArray(stockEntriesTable.itemId, itemIds),
              opts.warehouseId ? eq(stockEntriesTable.warehouseId, opts.warehouseId) : undefined,
            ))
            .groupBy(stockEntriesTable.itemId, warehousesTable.id, warehousesTable.name)
        : [];

      const byItem = new Map<number, typeof breakdown>();
      for (const entry of breakdown) {
        if (Number(entry.qty) === 0) continue;
        const values = byItem.get(entry.itemId) || [];
        values.push({ ...entry, qty: Number(entry.qty) });
        byItem.set(entry.itemId, values);
      }
      const summary = (summaryRows.rows[0] || {
        totalItems: 0,
        totalStockValue: 0,
        lowStockCount: 0,
      }) as Record<string, unknown>;

      res.json({
        rows: rows.map(row => {
          const visible: Record<string, unknown> = { ...row };
          if (mode === "lookup") for (const field of COST_FIELDS) delete visible[field];
          return { ...visible, warehouseBreakdown: byItem.get(Number(row.itemId)) || [] };
        }),
        summary: {
          totalItems: Number(summary.totalItems),
          totalStockValue: mode === "lookup" ? 0 : Number(summary.totalStockValue),
          lowStockCount: Number(summary.lowStockCount),
        },
        groups: (groupRows.rows as Array<{ itemGroup: string }>).map(row => String(row.itemGroup)),
        warehouses: warehouseRows,
        pagination: {
          page: opts.page,
          pageSize: opts.pageSize,
          totalPages: Math.max(1, Math.ceil(Number(summary.totalItems) / opts.pageSize)),
        },
      });
    } catch (error) {
      console.error("Inventory report failed:", error);
      res.status(500).json({ error: "庫存報表載入失敗" });
    }
  };

router.get("/reports/inventory", requireAuth, financeRoles, inventoryList("report"));
router.get("/inventory-lookup", requireAuth, notEmployee, inventoryList("lookup"));

router.get(
  "/reports/inventory/warehouse-summary",
  requireAuth,
  financeRoles,
  async (req, res): Promise<void> => {
    try {
      const opts = parseQuery(req.query as Query);
      const filters = itemFilters(opts.search, opts.group);
      const rows = await db.execute(sql`
        SELECT w.id AS "warehouseId", w.name AS "warehouseName",
          COALESCE(SUM(CASE
            WHEN i.id IS NOT NULL AND se.entry_type = 'Receipt' THEN se.quantity
            WHEN i.id IS NOT NULL AND se.entry_type IN ('Issue', 'Transfer') THEN -se.quantity
            ELSE 0 END), 0)::float AS "totalQuantity",
          COALESCE(SUM((CASE
            WHEN i.id IS NOT NULL AND se.entry_type = 'Receipt' THEN se.quantity
            WHEN i.id IS NOT NULL AND se.entry_type IN ('Issue', 'Transfer') THEN -se.quantity
            ELSE 0 END) * COALESCE(NULLIF(i.moving_avg_cost, 0), i.buying_price, 0)), 0)::float AS "totalValue"
        FROM warehouses w
        LEFT JOIN stock_entries se ON se.warehouse_id = w.id
        LEFT JOIN items i ON i.id = se.item_id AND ${filters}
          ${opts.lowStockOnly ? sql`AND i.reorder_level > 0 AND i.current_stock < i.reorder_level` : sql``}
        GROUP BY w.id, w.name
        ORDER BY w.name
      `);
      res.json({ rows: rows.rows });
    } catch (error) {
      console.error("Warehouse inventory summary failed:", error);
      res.status(500).json({ error: "倉庫庫存摘要載入失敗" });
    }
  },
);

export default router;