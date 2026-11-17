import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, itemsTable, legacyDocumentsTable, stockEntriesTable, warehousesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

/**
 * 舊系統（Ecount）的庫存單據：倉庫調撥、內部使用（領用）、庫存盤點。
 *
 * 這些紀錄不能放進庫存異動表：各倉庫現在有多少，是把那張表的入庫、出庫加總出來的，
 * 把好幾年前的調撥和領用放進去，現在的分倉數量就會整個算錯。
 * 所以它們存在歷史單據裡，由庫存異動頁、盤點頁一起列出來：可以點開看整張單、連到品項、補備註，但不影響現在的庫存與帳。
 *
 * 這個檔案要掛在 stock-counts 的路由前面（否則 /stock-counts/legacy 會被當成 /stock-counts/:id）。
 */
const router: IRouter = Router();
router.use("/stock-entries", requireAuth);
router.use("/stock-counts", requireAuth);

const MOVEMENT_TYPES = ["倉庫調撥", "內部使用"];
const COUNT_TYPE = "庫存盤點";
const num = (value: unknown): number => { const n = Number(String(value ?? "").replace(/,/g, "").trim()); return Number.isFinite(n) ? n : 0; };
const text = (value: unknown): string => String(value ?? "").trim();
const parseId = (value: unknown): number | null => { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; };

/** 品名（或「品名 [規格]」、品項編碼）→ 品項；同名不只一個品項的不對應，免得連錯 */
async function itemIndex(): Promise<{ byName: Map<string, number | null>; byCode: Map<string, number> }> {
  const items = await db.select({ id: itemsTable.id, itemCode: itemsTable.itemCode, itemName: itemsTable.itemName, specification: itemsTable.specification }).from(itemsTable);
  const byName = new Map<string, number | null>(), byCode = new Map<string, number>();
  const add = (key: string, id: number) => { if (key) byName.set(key, byName.has(key) && byName.get(key) !== id ? null : id); };
  for (const item of items) {
    if (item.itemCode) byCode.set(item.itemCode, item.id);
    if (item.specification) add(`${item.itemName} [${item.specification}]`, item.id);
    else add(item.itemName, item.id);
  }
  // 有規格的品項，單用品名也對得到（只有一個品項叫這個名字時）
  for (const item of items) if (item.specification) add(item.itemName, item.id);
  return { byName, byCode };
}
const resolveItem = (index: Awaited<ReturnType<typeof itemIndex>>, line: Record<string, string>): number | null =>
  index.byCode.get(text(line["品項編碼"])) ?? index.byName.get(text(line["品項名稱[規格]"])) ?? null;

async function warehouseIndex(): Promise<Map<string, number>> {
  const rows = await db.select({ id: warehousesTable.id, name: warehousesTable.name }).from(warehousesTable);
  return new Map(rows.map(row => [row.name, row.id]));
}

const kindOf = (docType: string): string => (docType === "倉庫調撥" ? "調撥" : docType === "內部使用" ? "領用" : "盤點");

function movementLine(docType: string, line: Record<string, string>) {
  const transfer = docType === "倉庫調撥";
  return {
    itemName: text(line["品項名稱[規格]"]), quantity: num(line["數量"]), amount: num(line["金額(數量*入庫單價)"]), remarks: text(line["摘要"]) || null,
    fromWarehouse: transfer ? text(line["出庫倉庫/工廠名稱"]) || null : text(line["倉庫/工廠名稱"]) || null,
    toWarehouse: transfer ? text(line["收貨倉庫/工廠名稱"]) || null : null,
    partyName: transfer ? null : text(line["客戶/供應商名稱"]) || null,
  };
}

/** 庫存異動頁用：舊系統的調撥、領用，一行一筆（跟新系統的庫存異動同一種列法） */
router.get("/stock-entries/legacy-lines", async (_req, res): Promise<void> => {
  const [docs, index] = await Promise.all([
    db.select({ id: legacyDocumentsTable.id, docType: legacyDocumentsTable.docType, docNumber: legacyDocumentsTable.docNumber, docDate: legacyDocumentsTable.docDate, lines: legacyDocumentsTable.lines, note: legacyDocumentsTable.note })
      .from(legacyDocumentsTable).where(inArray(legacyDocumentsTable.docType, MOVEMENT_TYPES)),
    itemIndex(),
  ]);
  const rows = [];
  for (const doc of docs) {
    const lines = Array.isArray(doc.lines) ? doc.lines : [];
    for (const [i, line] of lines.entries()) {
      rows.push({ id: `legacy-${doc.id}-${i}`, legacy: true, legacyDocumentId: doc.id, docNumber: doc.docNumber, docDate: doc.docDate, kind: kindOf(doc.docType), itemId: resolveItem(index, line), note: doc.note, ...movementLine(doc.docType, line) });
    }
  }
  rows.sort((a, b) => String(b.docDate).localeCompare(String(a.docDate)) || b.legacyDocumentId - a.legacyDocumentId);
  res.json(rows);
});

/** 一張舊的調撥單／領用單：整張單的每一行，品項與倉庫對得到的附上編號，畫面可以點過去 */
router.get("/stock-entries/legacy/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "單據編號不正確" }); return; }
  const [doc] = await db.select().from(legacyDocumentsTable).where(and(eq(legacyDocumentsTable.id, id), inArray(legacyDocumentsTable.docType, MOVEMENT_TYPES)));
  if (!doc) { res.status(404).json({ error: "找不到這張歷史庫存單" }); return; }
  const [index, warehouses] = await Promise.all([itemIndex(), warehouseIndex()]);
  const lines = (Array.isArray(doc.lines) ? doc.lines : []).map(line => {
    const row = movementLine(doc.docType, line);
    return { ...row, itemId: resolveItem(index, line), fromWarehouseId: row.fromWarehouse ? warehouses.get(row.fromWarehouse) ?? null : null, toWarehouseId: row.toWarehouse ? warehouses.get(row.toWarehouse) ?? null : null };
  });
  res.json({ id: doc.id, kind: kindOf(doc.docType), docType: doc.docType, docNumber: doc.docNumber, docDate: doc.docDate, total: doc.total === null ? null : Number(doc.total), note: doc.note, lines });
});

/** 舊系統的盤點單（盤點頁用） */
router.get("/stock-counts/legacy", async (_req, res): Promise<void> => {
  const docs = await db.select({ id: legacyDocumentsTable.id, docNumber: legacyDocumentsTable.docNumber, docDate: legacyDocumentsTable.docDate, lines: legacyDocumentsTable.lines, total: legacyDocumentsTable.total, note: legacyDocumentsTable.note })
    .from(legacyDocumentsTable).where(eq(legacyDocumentsTable.docType, COUNT_TYPE));
  res.json(docs.map(doc => {
    const lines = Array.isArray(doc.lines) ? doc.lines : [];
    const amounts = lines.map(line => num(line["金額(數量*入庫單價)"]));
    return {
      legacy: true, legacyDocumentId: doc.id, countNumber: doc.docNumber, countDate: doc.docDate, note: doc.note,
      warehouseName: [...new Set(lines.map(line => text(line["倉庫/工廠名稱"])).filter(Boolean))].join("、") || null,
      lineCount: lines.length, diffLines: lines.filter(line => num(line["調整數量"]) !== 0).length,
      gain: Math.round(amounts.filter(a => a > 0).reduce((s, a) => s + a, 0)), loss: Math.round(-amounts.filter(a => a < 0).reduce((s, a) => s + a, 0)),
    };
  }).sort((a, b) => String(b.countDate).localeCompare(String(a.countDate)) || b.legacyDocumentId - a.legacyDocumentId));
});

router.get("/stock-counts/legacy/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "單據編號不正確" }); return; }
  const [doc] = await db.select().from(legacyDocumentsTable).where(and(eq(legacyDocumentsTable.id, id), eq(legacyDocumentsTable.docType, COUNT_TYPE)));
  if (!doc) { res.status(404).json({ error: "找不到這張歷史盤點單" }); return; }
  const [index, warehouses] = await Promise.all([itemIndex(), warehouseIndex()]);
  res.json({
    id: doc.id, countNumber: doc.docNumber, countDate: doc.docDate, total: doc.total === null ? null : Number(doc.total), note: doc.note,
    lines: (Array.isArray(doc.lines) ? doc.lines : []).map(line => ({
      itemCode: text(line["品項編碼"]) || null, itemName: text(line["品項名稱[規格]"]), itemId: resolveItem(index, line),
      warehouseName: text(line["倉庫/工廠名稱"]) || null, warehouseId: warehouses.get(text(line["倉庫/工廠名稱"])) ?? null,
      // 實際數量空白＝當時盤到 0
      systemQty: num(line["帳簿數量"]), countedQty: num(line["實際數量"]), diffQty: num(line["調整數量"]), amount: num(line["金額(數量*入庫單價)"]), remarks: text(line["摘要"]) || null,
    })),
  });
});

/** 歷史庫存單只能補備註（品項、數量、金額是舊系統的紀錄，不能改） */
async function saveNote(req: any, res: any, types: string[]): Promise<void> {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "單據編號不正確" }); return; }
  if (typeof req.body?.note !== "string" || Object.keys(req.body).some(key => key !== "note")) { res.status(400).json({ error: "歷史庫存單只能改備註：品項、數量、金額是舊系統的紀錄，不能改" }); return; }
  const [row] = await db.update(legacyDocumentsTable).set({ note: req.body.note.trim().slice(0, 2000) || null })
    .where(and(eq(legacyDocumentsTable.id, id), inArray(legacyDocumentsTable.docType, types))).returning({ id: legacyDocumentsTable.id, note: legacyDocumentsTable.note });
  if (!row) { res.status(404).json({ error: "找不到這張歷史庫存單" }); return; }
  res.json(row);
}
router.patch("/stock-entries/legacy/:id", (req, res) => saveNote(req, res, MOVEMENT_TYPES));
router.patch("/stock-counts/legacy/:id", (req, res) => saveNote(req, res, [COUNT_TYPE]));

/** 新系統的庫存異動：數量與金額已經入帳不能改，但備註可以補 */
router.patch("/stock-entries/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "異動編號不正確" }); return; }
  if (typeof req.body?.remarks !== "string" || Object.keys(req.body).some(key => key !== "remarks")) { res.status(400).json({ error: "庫存異動已經入帳，只能改備註；數量有誤請另建一筆反向異動沖回" }); return; }
  const [row] = await db.update(stockEntriesTable).set({ remarks: req.body.remarks.trim().slice(0, 300) || null }).where(eq(stockEntriesTable.id, id)).returning({ id: stockEntriesTable.id, remarks: stockEntriesTable.remarks });
  if (!row) { res.status(404).json({ error: "找不到這筆庫存異動" }); return; }
  res.json(row);
});

export default router;
