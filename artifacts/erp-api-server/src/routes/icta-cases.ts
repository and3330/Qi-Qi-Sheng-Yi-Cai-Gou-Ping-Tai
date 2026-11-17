import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, salesOrdersTable, customersTable, activitiesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";
import { loadIntegration, tenantIctaConfig } from "../lib/tenant-integrations";
import { ictaCaseRecord, salesOrderToIctaCase, type IctaCaseRecord } from "../lib/icta-case";
import { logger } from "../lib/logger";

/**
 * 銷貨單送件到 ICTA PRO（講師平台）。老闆 2026-11-16：按鈕手動送件，不自動送。
 * 送件紀錄存在銷貨單的 extraFields.ictaCase（對方的案件編號、狀態、排了哪位講師），不影響帳。
 * 同一張單重送不會在對方多建一筆：對方用 ERP 單號認，還沒排講師就更新內容，已經排了就只回報現況。
 */
const router: IRouter = Router();
router.use("/sales-orders/:id/icta-case", requireAuth);

/** 這家公司有沒有設定講師平台的連線（畫面用來決定要不要顯示送件按鈕；不回任何金鑰內容） */
router.get("/icta-status", requireAuth, async (_req, res): Promise<void> => {
  const stored = await loadIntegration("icta_pro").catch(() => null);
  res.json({ configured: !!stored?.secretCipher });
});

const TIMEOUT_MS = 15_000;

async function callIcta(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  const { baseUrl, apiKey } = await tenantIctaConfig();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method, signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "X-API-Key": apiKey, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err: any) {
    logger.warn({ path, reason: err?.name }, "icta pro request failed");
    throw new Error("連不上講師平台（ICTA PRO），請稍後再試；一直不行的話請確認「串接金鑰」裡的網址");
  }
  const data: any = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403) throw new Error(`講師平台不接受這把金鑰：${data?.error || "請到「串接金鑰」重新設定"}`);
  if (!response.ok) throw Object.assign(new Error(data?.error ? `講師平台回覆：${data.error}` : `講師平台暫時無法處理（代碼 ${response.status}）`), { remoteStatus: response.status });
  return data;
}

async function loadOrder(id: number) {
  const [row] = await db.select({ order: salesOrdersTable, customerName: customersTable.name, customerAddress: customersTable.address })
    .from(salesOrdersTable).leftJoin(customersTable, eq(customersTable.id, salesOrdersTable.customerId)).where(eq(salesOrdersTable.id, id));
  return row;
}

const recordOf = (order: { extraFields: unknown }): IctaCaseRecord | null => {
  const found = (order.extraFields as { ictaCase?: IctaCaseRecord } | null)?.ictaCase;
  return found && typeof found === "object" ? found : null;
};

async function saveRecord(order: { id: number; extraFields: unknown }, record: IctaCaseRecord): Promise<void> {
  // 只動 ictaCase 這一格，其他附加欄位原樣留著
  const extra = { ...((order.extraFields as Record<string, unknown> | null) ?? {}), ictaCase: record };
  await db.update(salesOrdersTable).set({ extraFields: extra }).where(eq(salesOrdersTable.id, order.id));
}

const parseId = (raw: unknown): number | null => { const n = Number(raw); return Number.isInteger(n) && n > 0 ? n : null; };

/** 送件（或重送更新內容） */
router.post("/sales-orders/:id/icta-case", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "銷貨單編號格式不正確" }); return; }
  try {
    const row = await loadOrder(id);
    if (!row) { res.status(404).json({ error: "找不到銷貨單" }); return; }
    const built = salesOrderToIctaCase(row.order, { name: row.customerName, address: row.customerAddress });
    if (!built.ok) { res.status(400).json({ error: built.error }); return; }
    const actor = String(req.session?.user?.username || "API");
    const previous = recordOf(row.order);
    const reply = await callIcta("POST", "/api/partner/erp/cases", built.payload);
    const record = ictaCaseRecord(reply?.case, previous, actor);
    await saveRecord(row.order, record);
    await db.insert(activitiesTable).values({
      type: "update", title: previous ? "重送講師案件" : "送件到講師平台", module: "Sales",
      description: `${actor} 把銷貨單 ${row.order.orderNumber} ${previous ? "重送" : "送件"}到 ICTA PRO（案件 #${record.id}，${record.statusLabel}）`,
    });
    res.json({ ictaCase: record, created: !!reply?.created, updated: !!reply?.updated, message: reply?.message ?? null });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "送件失敗" });
  }
});

/** 查現況：排了哪位講師、完成了沒 */
router.post("/sales-orders/:id/icta-case/refresh", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "銷貨單編號格式不正確" }); return; }
  try {
    const row = await loadOrder(id);
    if (!row) { res.status(404).json({ error: "找不到銷貨單" }); return; }
    const previous = recordOf(row.order);
    if (!previous) { res.status(400).json({ error: "這張銷貨單還沒送件到講師平台" }); return; }
    const reply = await callIcta("GET", `/api/partner/erp/cases/${encodeURIComponent(row.order.orderNumber)}`);
    const record = ictaCaseRecord(reply?.case, previous, previous.sentBy);
    await saveRecord(row.order, record);
    res.json({ ictaCase: record });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "查詢失敗" });
  }
});

export default router;
