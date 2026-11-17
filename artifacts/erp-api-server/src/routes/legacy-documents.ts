import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, legacyDocumentsTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";

/**
 * 歷史單據：從舊系統搬來的單據，只供查詢。
 * 匯入只給老闆與管理員；查詢給管理與財務角色（裡面有薪資與出勤）。
 */
const router: IRouter = Router();
router.use("/legacy-documents", requireAuth, requireRole("owner", "admin", "finance_admin", "accountant"));

const text = (value: unknown, max: number): string | null => {
  const s = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return s ? s.slice(0, max) : null;
};

/** 有哪些種類、各幾張、期間 */
router.get("/legacy-documents/types", async (_req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT doc_type AS "docType", count(*)::int AS count, min(doc_date) AS "firstDate", max(doc_date) AS "lastDate", COALESCE(sum(total), 0)::float AS total
    FROM legacy_documents GROUP BY doc_type ORDER BY count(*) DESC`);
  res.json(result.rows ?? result);
});

router.get("/legacy-documents", async (req, res): Promise<void> => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "")) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "")) || 50));
  const conditions = [];
  const type = text(req.query.type, 60), from = text(req.query.from, 10), to = text(req.query.to, 10), q = text(req.query.q, 80);
  if (type) conditions.push(eq(legacyDocumentsTable.docType, type));
  if (from) conditions.push(gte(legacyDocumentsTable.docDate, from));
  if (to) conditions.push(lte(legacyDocumentsTable.docDate, to));
  if (q) {
    const term = "%" + q.replace(/[\\%_]/g, m => "\\" + m) + "%";
    conditions.push(sql`(${legacyDocumentsTable.partyName} ILIKE ${term} OR ${legacyDocumentsTable.docNumber} ILIKE ${term} OR ${legacyDocumentsTable.projectName} ILIKE ${term} OR ${legacyDocumentsTable.staffName} ILIKE ${term} OR ${legacyDocumentsTable.searchText} ILIKE ${term})`);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ count, total }] = await db.select({ count: sql<number>`count(*)::int`, total: sql<number>`COALESCE(sum(${legacyDocumentsTable.total}), 0)::float` }).from(legacyDocumentsTable).where(where);
  const rows = await db.select({
    id: legacyDocumentsTable.id, docType: legacyDocumentsTable.docType, docNumber: legacyDocumentsTable.docNumber, docDate: legacyDocumentsTable.docDate,
    partyName: legacyDocumentsTable.partyName, projectName: legacyDocumentsTable.projectName, staffName: legacyDocumentsTable.staffName,
    total: legacyDocumentsTable.total, lineCount: legacyDocumentsTable.lineCount,
  }).from(legacyDocumentsTable).where(where)
    .orderBy(desc(legacyDocumentsTable.docDate), desc(legacyDocumentsTable.id)).limit(limit).offset((page - 1) * limit);
  res.json({ data: rows.map(r => ({ ...r, total: r.total === null ? null : Number(r.total) })), count, total, page, limit });
});

router.get("/legacy-documents/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "單據編號不正確" }); return; }
  const [row] = await db.select().from(legacyDocumentsTable).where(eq(legacyDocumentsTable.id, id));
  if (!row) { res.status(404).json({ error: "找不到這張歷史單據" }); return; }
  res.json({ ...row, total: row.total === null ? null : Number(row.total) });
});

/** 整批匯入（搬家用）。同一種類、同一個號碼已經有的會跳過，所以可以重跑 */
router.post("/legacy-documents/import", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const docType = text(req.body?.docType, 60), source = text(req.body?.source, 30) ?? "ecount";
  const documents: unknown[] = Array.isArray(req.body?.documents) ? req.body.documents : [];
  if (!docType) { res.status(400).json({ error: "請指定單據種類" }); return; }
  if (documents.length === 0 || documents.length > 1000) { res.status(400).json({ error: "一次請送 1 到 1,000 張" }); return; }
  const values = [];
  for (const [index, raw] of documents.entries()) {
    const d = raw as Record<string, unknown>;
    const docNumber = text(d?.docNumber, 120);
    if (!docNumber) { res.status(400).json({ error: `第 ${index + 1} 張沒有單據號碼` }); return; }
    const lines = Array.isArray(d.lines)
      ? d.lines.slice(0, 2000).map(line => Object.fromEntries(Object.entries(line as Record<string, unknown>).slice(0, 60).map(([k, v]) => [String(k).slice(0, 60), String(v ?? "").slice(0, 600)])))
      : [];
    const docDate = text(d.docDate, 10);
    const total = d.total === null || d.total === undefined || d.total === "" ? null : Number(d.total);
    values.push({
      source, docType, docNumber, docDate: docDate && /^\d{4}-\d{2}-\d{2}$/.test(docDate) ? docDate : null,
      partyName: text(d.partyName, 200), projectName: text(d.projectName, 200), staffName: text(d.staffName, 100),
      total: total !== null && Number.isFinite(total) ? String(Math.round(total * 100) / 100) : null,
      lineCount: lines.length, searchText: text(d.searchText, 4000), lines,
    });
  }
  const inserted = await db.insert(legacyDocumentsTable).values(values).onConflictDoNothing().returning({ id: legacyDocumentsTable.id });
  res.status(201).json({ inserted: inserted.length, skipped: values.length - inserted.length });
});

export default router;
