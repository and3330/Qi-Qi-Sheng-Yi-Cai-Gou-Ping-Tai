import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, uiLayoutsTable, voucherTemplatesTable, vouchersTable, type UiLayoutConfig, type UiLayoutItem, type VoucherTemplateConfig, type VoucherTemplateField } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";

/**
 * 兩個「自己調整畫面」的工具（老闆 2026-11-17）：
 *   /ui-layouts         視覺化編輯：每個視窗的標題、欄位名稱、要不要顯示、順序
 *   /voucher-templates  收付款單模板：依項目類型預先設好帳戶、專案、摘要行和自訂欄位
 * 大家都讀得到（開視窗就要套用）；只有管理層能改。
 */
const router: IRouter = Router();
router.use(["/ui-layouts", "/voucher-templates"], requireAuth);
const canEditLayouts = requireRole("owner", "admin");
const canEditTemplates = requireRole("owner", "admin", "finance_admin", "accountant");
const actor = (req: any): string => String(req.session?.user?.username || "API");
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ---------- 視覺化編輯：畫面版面 ----------
function cleanItems(raw: unknown): Record<string, UiLayoutItem> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, UiLayoutItem> = {};
  for (const [key, value] of Object.entries(raw as Record<string, any>).slice(0, 200)) {
    if (!key || key.length > 80 || !value || typeof value !== "object") continue;
    const item: UiLayoutItem = {};
    const label = text(value.label, 40);
    if (label && label !== key) item.label = label;
    if (value.hidden === true) item.hidden = true;
    if (Number.isInteger(value.order) && value.order >= 0 && value.order < 1000) item.order = value.order;
    if (Object.keys(item).length > 0) out[key] = item;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
function cleanLayout(body: any): UiLayoutConfig {
  const config: UiLayoutConfig = {};
  const title = text(body?.title, 40);
  if (title) config.title = title;
  const fields = cleanItems(body?.fields); if (fields) config.fields = fields;
  const columns = cleanItems(body?.columns); if (columns) config.columns = columns;
  if (body?.labels && typeof body.labels === "object" && !Array.isArray(body.labels)) {
    const labels: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.labels as Record<string, unknown>).slice(0, 200)) {
      const label = text(value, 40);
      if (key && key.length <= 80 && label && label !== key) labels[key] = label;
    }
    if (Object.keys(labels).length > 0) config.labels = labels;
  }
  return config;
}
const layoutKey = (raw: unknown): string | null => { const k = text(raw, 80); return k ? k : null; };

router.get("/ui-layouts", async (_req, res): Promise<void> => {
  const rows = await db.select({ layoutKey: uiLayoutsTable.layoutKey, config: uiLayoutsTable.config }).from(uiLayoutsTable);
  res.json(Object.fromEntries(rows.map(r => [r.layoutKey, r.config])));
});

router.put("/ui-layouts", canEditLayouts, async (req, res): Promise<void> => {
  const key = layoutKey(req.body?.key);
  if (!key) { res.status(400).json({ error: "缺少視窗名稱" }); return; }
  const config = cleanLayout(req.body?.config);
  // 全部改回原樣＝不用留設定
  if (Object.keys(config).length === 0) {
    await db.delete(uiLayoutsTable).where(eq(uiLayoutsTable.layoutKey, key));
    res.json({ key, config: null }); return;
  }
  await db.insert(uiLayoutsTable).values({ layoutKey: key, config, updatedBy: actor(req) })
    .onConflictDoUpdate({ target: [uiLayoutsTable.tenantId, uiLayoutsTable.layoutKey], set: { config, updatedBy: actor(req), updatedAt: new Date() } });
  res.json({ key, config });
});

router.delete("/ui-layouts", canEditLayouts, async (req, res): Promise<void> => {
  const key = layoutKey(req.query.key);
  if (!key) { res.status(400).json({ error: "缺少視窗名稱" }); return; }
  await db.delete(uiLayoutsTable).where(eq(uiLayoutsTable.layoutKey, key));
  res.json({ key, config: null });
});

// ---------- 收付款單模板 ----------
const VOUCHER_TYPES = ["Receipt", "Payment"];
const FIELD_TYPES = ["text", "number", "date", "select"];
const idOrNull = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

function cleanTemplate(body: any): { error: string } | { name: string; voucherType: string; description: string | null; config: VoucherTemplateConfig; isActive: boolean; sortOrder: number } {
  const name = text(body?.name, 60);
  if (!name) return { error: "請填模板名稱" };
  const voucherType = String(body?.voucherType || "");
  if (!VOUCHER_TYPES.includes(voucherType)) return { error: "請選擇這個模板是收款單還是付款單" };
  const raw = body?.config ?? {};
  const lines = (Array.isArray(raw.lines) ? raw.lines : []).slice(0, 50)
    .map((l: any) => ({ description: text(l?.description, 200), amount: Number(l?.amount) > 0 ? Math.round(Number(l.amount) * 100) / 100 : null }))
    .filter((l: { description: string }) => l.description);
  const fields: VoucherTemplateField[] = [];
  const seen = new Set<string>();
  for (const f of (Array.isArray(raw.fields) ? raw.fields : []).slice(0, 30)) {
    const label = text(f?.label, 40);
    if (!label) return { error: "每個自訂欄位都要有名稱" };
    const type = FIELD_TYPES.includes(f?.type) ? f.type : "text";
    // 欄位代碼：沒給就用名稱；同一個模板裡不能重複
    const fieldName = text(f?.name, 40) || label;
    if (seen.has(fieldName)) return { error: `自訂欄位「${label}」重複了` };
    seen.add(fieldName);
    const options = type === "select" ? (Array.isArray(f?.options) ? f.options : []).map((o: unknown) => text(o, 60)).filter(Boolean).slice(0, 50) : undefined;
    if (type === "select" && (!options || options.length === 0)) return { error: `下拉欄位「${label}」至少要有一個選項` };
    fields.push({ name: fieldName, label, type, ...(options ? { options } : {}), ...(f?.required === true ? { required: true } : {}) });
  }
  return {
    name, voucherType, description: text(body?.description, 300) || null,
    config: { description: text(raw.description, 300) || undefined, projectId: idOrNull(raw.projectId), departmentId: idOrNull(raw.departmentId), cashAccountId: idOrNull(raw.cashAccountId), lines, fields },
    isActive: body?.isActive !== false, sortOrder: Number.isInteger(body?.sortOrder) ? body.sortOrder : 0,
  };
}

router.get("/voucher-templates", async (req, res): Promise<void> => {
  const rows = await db.select().from(voucherTemplatesTable).orderBy(asc(voucherTemplatesTable.sortOrder), asc(voucherTemplatesTable.id));
  const type = typeof req.query.voucherType === "string" ? req.query.voucherType : "";
  res.json(rows.filter(r => (!type || r.voucherType === type) && (req.query.all === "1" || r.isActive)));
});

router.post("/voucher-templates", canEditTemplates, async (req, res): Promise<void> => {
  const data = cleanTemplate(req.body);
  if ("error" in data) { res.status(400).json({ error: data.error }); return; }
  const [row] = await db.insert(voucherTemplatesTable).values(data).returning();
  res.status(201).json(row);
});

router.put("/voucher-templates/:id", canEditTemplates, async (req, res): Promise<void> => {
  const id = idOrNull(req.params.id);
  if (!id) { res.status(400).json({ error: "模板編號不正確" }); return; }
  const data = cleanTemplate(req.body);
  if ("error" in data) { res.status(400).json({ error: data.error }); return; }
  const [row] = await db.update(voucherTemplatesTable).set(data).where(eq(voucherTemplatesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "找不到這個模板" }); return; }
  res.json(row);
});

router.delete("/voucher-templates/:id", canEditTemplates, async (req, res): Promise<void> => {
  const id = idOrNull(req.params.id);
  if (!id) { res.status(400).json({ error: "模板編號不正確" }); return; }
  // 已經有單據用過的模板不刪，改成停用：舊單還要用它的欄位名稱顯示自訂欄位
  const [used] = await db.select({ id: vouchersTable.id }).from(vouchersTable).where(eq(vouchersTable.templateId, id)).limit(1);
  if (used) {
    await db.update(voucherTemplatesTable).set({ isActive: false }).where(eq(voucherTemplatesTable.id, id));
    res.json({ id, deactivated: true, message: "已經有單據用過這個模板，所以改成停用（新單不會再出現），舊單照常顯示。" }); return;
  }
  await db.delete(voucherTemplatesTable).where(eq(voucherTemplatesTable.id, id));
  res.json({ id, deleted: true });
});

export default router;
