import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, printTemplatesTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/print-templates", requireAuth);
// 公司層級的設定：只有老闆與系統管理員可以新增、修改、刪除（查詢仍開放給所有登入者）
const adminOnly = requireRole("owner", "admin");

/** 可以寫入的欄位（其他欄位一律忽略，避免改到租戶或編號） */
const WRITABLE = ["name", "module", "documentType", "format", "orientation", "headerHtml", "bodyHtml", "footerHtml", "cssStyles", "isDefault", "status", "layout"] as const;
const MAX_LAYOUT_BYTES = 50_000;

function pickWritable(body: Record<string, unknown>): { data?: Record<string, unknown>; error?: string } {
  const data: Record<string, unknown> = {};
  for (const key of WRITABLE) {
    if (body[key] === undefined) continue;
    const value = body[key];
    if (key === "layout") {
      if (value !== null && (typeof value !== "object" || Array.isArray(value))) return { error: "版面設定格式不正確" };
      if (value !== null && JSON.stringify(value).length > MAX_LAYOUT_BYTES) return { error: "版面設定太大" };
      data.layout = value;
      continue;
    }
    if (value !== null && typeof value !== "string") return { error: `欄位 ${key} 格式不正確` };
    data[key] = value;
  }
  if (data.isDefault !== undefined && data.isDefault !== "Yes" && data.isDefault !== "No") return { error: "預設只能是 Yes 或 No" };
  if (data.status !== undefined && data.status !== "Active" && data.status !== "Inactive") return { error: "狀態只能是啟用或停用" };
  if (data.orientation !== undefined && data.orientation !== "portrait" && data.orientation !== "landscape") return { error: "方向只能是直向或橫向" };
  return { data };
}

router.get("/print-templates", async (req, res): Promise<void> => {
  const conditions: any[] = [];
  if (req.query.module) conditions.push(eq(printTemplatesTable.module, req.query.module as string));
  if (req.query.documentType) conditions.push(eq(printTemplatesTable.documentType, req.query.documentType as string));
  if (req.query.status) conditions.push(eq(printTemplatesTable.status, req.query.status as string));

  const rows = await db.select().from(printTemplatesTable).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(printTemplatesTable.createdAt));
  res.json(rows);
});

router.post("/print-templates", adminOnly, async (req, res): Promise<void> => {
  const picked = pickWritable(req.body || {});
  if (picked.error) { res.status(400).json({ error: picked.error }); return; }
  const data = picked.data!;
  if (!data.name || !data.module || !data.documentType) { res.status(400).json({ error: "請填寫名稱、模組與單據種類" }); return; }

  if (data.isDefault === "Yes") {
    await db.update(printTemplatesTable).set({ isDefault: "No" }).where(and(eq(printTemplatesTable.module, data.module as string), eq(printTemplatesTable.documentType, data.documentType as string)));
  }

  const [row] = await db.insert(printTemplatesTable).values(data as any).returning();
  res.status(201).json(row);
});

router.get("/print-templates/:id", async (req, res): Promise<void> => {
  const [row] = await db.select().from(printTemplatesTable).where(eq(printTemplatesTable.id, Number(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.patch("/print-templates/:id", adminOnly, async (req, res): Promise<void> => {
  const picked = pickWritable(req.body || {});
  if (picked.error) { res.status(400).json({ error: picked.error }); return; }
  const data = picked.data!;
  if (Object.keys(data).length === 0) { res.status(400).json({ error: "沒有要更新的內容" }); return; }
  const [existing] = await db.select().from(printTemplatesTable).where(eq(printTemplatesTable.id, Number(req.params.id)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (data.isDefault === "Yes") {
    await db.update(printTemplatesTable).set({ isDefault: "No" }).where(and(
      eq(printTemplatesTable.module, (data.module as string) ?? existing.module),
      eq(printTemplatesTable.documentType, (data.documentType as string) ?? existing.documentType),
    ));
  }
  const [row] = await db.update(printTemplatesTable).set(data as any).where(eq(printTemplatesTable.id, Number(req.params.id))).returning();
  res.json(row);
});

router.delete("/print-templates/:id", adminOnly, async (req, res): Promise<void> => {
  const [row] = await db.delete(printTemplatesTable).where(eq(printTemplatesTable.id, Number(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
