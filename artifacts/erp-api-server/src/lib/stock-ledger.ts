import { eq, sql } from "drizzle-orm";
import { itemsTable, stockEntriesTable, warehousesTable } from "@workspace/erp-db";
import { itemUnitCost, round2 } from "./inventory-journal";

/**
 * 庫存異動紀錄（各倉庫的數量來源）。
 * 品項主檔的 currentStock 是全公司合計；每一間倉庫各有多少，是把這張表的入庫、出庫加總出來的。
 * 原本只有手動異動和工單會寫這張表，進貨、出貨、退貨都沒寫，所以分倉數量一直是不完整的。
 */

export type StockSource = "manual" | "transfer" | "count" | "receipt" | "delivery" | "return" | "work-order" | "subcontract";

/** 入庫是正、出庫是負；看不懂的類型不計 */
export function stockSign(entryType: string): number {
  if (entryType === "Receipt") return 1;
  if (entryType === "Issue" || entryType === "Transfer") return -1;
  return 0;
}

export async function defaultWarehouseId(tx: any): Promise<number | null> {
  const [wh] = await tx.select({ id: warehousesTable.id }).from(warehousesTable).orderBy(warehousesTable.id).limit(1);
  return wh?.id ?? null;
}

/**
 * 記一筆倉庫進出。只寫紀錄，不動品項主檔的庫存與成本（那是呼叫端的事）。
 * 沒指定倉庫就記到第一間倉庫；公司連一間倉庫都沒有時不記。
 */
export async function logStockMovement(tx: any, input: {
  direction: 1 | -1; itemId: number; warehouseId?: number | null; quantity: number;
  rate?: number; remarks: string; source: StockSource; projectId?: number | null;
}): Promise<void> {
  if (!(input.quantity > 0)) return;
  const warehouseId = input.warehouseId ?? await defaultWarehouseId(tx);
  if (!warehouseId) return;
  let rate = input.rate;
  if (rate === undefined) {
    const [item] = await tx.select({ movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice }).from(itemsTable).where(eq(itemsTable.id, input.itemId));
    rate = itemUnitCost(item);
  }
  await tx.insert(stockEntriesTable).values({
    entryType: input.direction === 1 ? "Receipt" : "Issue",
    itemId: input.itemId, warehouseId,
    quantity: String(input.quantity), rate: (rate || 0).toFixed(2), amount: String(round2(input.quantity * (rate || 0))),
    remarks: input.remarks.slice(0, 300), source: input.source, projectId: input.projectId ?? null,
  });
}

/** 一間倉庫裡每個品項目前的數量（由異動紀錄加總） */
export async function warehouseStock(tx: any, warehouseId: number): Promise<Map<number, number>> {
  const result = await tx.execute(sql`
    SELECT item_id AS "itemId", SUM(CASE
      WHEN entry_type = 'Receipt' THEN quantity
      WHEN entry_type IN ('Issue', 'Transfer') THEN -quantity
      ELSE 0 END)::float AS qty
    FROM stock_entries WHERE warehouse_id = ${warehouseId} GROUP BY item_id`);
  const rows = (result.rows ?? result) as Array<{ itemId: number; qty: number }>;
  return new Map(rows.map(r => [Number(r.itemId), Number(r.qty) || 0]));
}

export interface CountLine { itemId: number; itemCode: string; itemName: string; systemQty: number; countedQty: number | null; unitCost: number }

/** 盤點差異（純計算）：只算有填實盤數量、而且和帳上不一樣的品項 */
export function countDifferences(lines: CountLine[]) {
  const rows = lines
    .filter(l => l.countedQty !== null && l.countedQty !== undefined && Number.isFinite(Number(l.countedQty)))
    .map(l => {
      const diff = round2(Number(l.countedQty) - l.systemQty);
      return { ...l, countedQty: Number(l.countedQty), diff, diffAmount: round2(diff * l.unitCost) };
    })
    .filter(l => Math.abs(l.diff) > 0.0001);
  const gain = round2(rows.filter(r => r.diff > 0).reduce((s, r) => s + r.diffAmount, 0));
  const loss = round2(rows.filter(r => r.diff < 0).reduce((s, r) => s - r.diffAmount, 0));
  return { rows, gain, loss, countedLines: lines.filter(l => l.countedQty !== null && l.countedQty !== undefined).length };
}
