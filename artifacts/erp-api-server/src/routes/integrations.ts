import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db, integrationSourcesTable, integrationMappingsTable, integrationItemMapsTable, integrationEventsTable, storedValueLedgerTable,
  projectsTable, departmentsTable, accountsTable, itemsTable, customersTable, apiKeysTable, orderTemplatesTable,
} from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { EVENT_KINDS, KIND_LABEL, SUPPORTED_KINDS, normalizeEvent } from "../lib/integration-format";
import { processEvent } from "../lib/integration-process";
import { ingestEvents } from "../lib/integration-ingest";
import { adapterInfo, pullSource } from "../lib/integration-adapters";
import { ensureQiqiShopSource } from "../lib/qiqi-shop-source";
import { isRealDate } from "../lib/cash-accounts";
import { listCashAccounts } from "../lib/cash-accounts";
import { pgErrorCode } from "../lib/pg-error";
import { logger } from "../lib/logger";
import { machineOnly } from "../lib/api-key-user";

const router: IRouter = Router();
router.use("/integrations", requireAuth);
// 設定與收件匣的處理會影響帳務，只給管理與財務角色；外部系統送資料用 API 金鑰
const manage = requireRole("owner", "admin", "finance_admin", "accountant");

const parseId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const optionalId = (value: unknown): number | null => (value === null || value === undefined || value === "" ? null : parseId(value));
const actorOf = (req: Request): string => req.session?.user?.username || `api:${(req as any).apiKey?.keyName || "key"}`;

async function assertExists(table: any, id: number | null, label: string): Promise<void> {
  if (id === null) return;
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id));
  if (!row) throw new Error(`${label}不存在`);
}

// ───────── 來源 ─────────
router.get("/integrations/sources", manage, async (_req, res): Promise<void> => {
  await ensureQiqiShopSource();
  const sources = await db.select({
    source: integrationSourcesTable, projectName: projectsTable.name, departmentName: departmentsTable.name,
    cashAccountName: accountsTable.accountName, apiKeyName: apiKeysTable.keyName,
  }).from(integrationSourcesTable)
    .leftJoin(projectsTable, eq(projectsTable.id, integrationSourcesTable.defaultProjectId))
    .leftJoin(departmentsTable, eq(departmentsTable.id, integrationSourcesTable.defaultDepartmentId))
    .leftJoin(accountsTable, eq(accountsTable.id, integrationSourcesTable.defaultCashAccountId))
    .leftJoin(apiKeysTable, eq(apiKeysTable.id, integrationSourcesTable.apiKeyId))
    .orderBy(integrationSourcesTable.id);
  const counts = await db.execute(sql`SELECT source_id AS "sourceId", status, count(*)::int AS count FROM integration_events GROUP BY source_id, status`);
  const rows = (counts.rows ?? counts) as Array<{ sourceId: number; status: string; count: number }>;
  res.json(sources.map(s => ({
    ...s.source, ...adapterInfo(s.source.code), defaultProjectName: s.projectName, defaultDepartmentName: s.departmentName, defaultCashAccountName: s.cashAccountName, apiKeyName: s.apiKeyName,
    counts: Object.fromEntries(rows.filter(r => Number(r.sourceId) === s.source.id).map(r => [r.status, r.count])),
  })));
});

async function readSource(body: any): Promise<Record<string, unknown>> {
  const code = typeof body?.code === "string" ? body.code.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(code)) throw new Error("來源代號只能用小寫英數與連字號，例如 cm-life");
  if (!name) throw new Error("請填寫來源名稱");
  const values = {
    code, name,
    apiKeyId: optionalId(body.apiKeyId), defaultProjectId: optionalId(body.defaultProjectId),
    defaultDepartmentId: optionalId(body.defaultDepartmentId), defaultCashAccountId: optionalId(body.defaultCashAccountId),
    isActive: body.isActive !== false, note: typeof body.note === "string" ? body.note.trim().slice(0, 300) || null : null,
  };
  await assertExists(projectsTable, values.defaultProjectId, "專案");
  await assertExists(departmentsTable, values.defaultDepartmentId, "部門");
  await assertExists(apiKeysTable, values.apiKeyId, "API 金鑰");
  if (values.defaultCashAccountId && !(await listCashAccounts(db)).some(a => a.id === values.defaultCashAccountId)) {
    throw new Error("收款帳戶必須是現金或銀行存款的明細科目");
  }
  return values;
}

router.post("/integrations/sources", manage, async (req, res): Promise<void> => {
  try {
    const [row] = await db.insert(integrationSourcesTable).values(await readSource(req.body) as typeof integrationSourcesTable.$inferInsert).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(pgErrorCode(err) === "23505" ? 409 : 400).json({ error: pgErrorCode(err) === "23505" ? "這個來源代號已經有了" : err.message });
  }
});

router.put("/integrations/sources/:id", manage, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "來源編號格式不正確" }); return; }
  try {
    const [row] = await db.update(integrationSourcesTable).set(await readSource(req.body)).where(eq(integrationSourcesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "找不到這個來源" }); return; }
    res.json(row);
  } catch (err: any) {
    res.status(pgErrorCode(err) === "23505" ? 409 : 400).json({ error: pgErrorCode(err) === "23505" ? "這個來源代號已經有了" : err.message });
  }
});

router.delete("/integrations/sources/:id", manage, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "來源編號格式不正確" }); return; }
  const [used] = await db.select({ id: integrationEventsTable.id }).from(integrationEventsTable).where(eq(integrationEventsTable.sourceId, id)).limit(1);
  if (used) { res.status(400).json({ error: "這個來源已經有收過單據，不能刪除；不再使用請改成停用" }); return; }
  await db.transaction(async (tx) => {
    await tx.delete(integrationMappingsTable).where(eq(integrationMappingsTable.sourceId, id));
    await tx.delete(integrationItemMapsTable).where(eq(integrationItemMapsTable.sourceId, id));
    await tx.delete(integrationSourcesTable).where(eq(integrationSourcesTable.id, id));
  });
  res.status(204).end();
});

// ───────── 對應表：訂單類型 → 專案、部門、收入科目 ─────────
router.get("/integrations/mappings", manage, async (req, res): Promise<void> => {
  const sourceId = parseId(req.query.sourceId);
  const rows = await db.select({
    mapping: integrationMappingsTable, projectName: projectsTable.name, departmentName: departmentsTable.name,
    revenueAccountName: accountsTable.accountName, defaultItemName: itemsTable.itemName,
    expenseAccountName: sql<string | null>`(SELECT account_name FROM accounts e WHERE e.id = ${integrationMappingsTable.expenseAccountId})`,
    templateName: sql<string | null>`(SELECT name FROM order_templates t WHERE t.id = ${integrationMappingsTable.templateId})`,
  }).from(integrationMappingsTable)
    .leftJoin(projectsTable, eq(projectsTable.id, integrationMappingsTable.projectId))
    .leftJoin(departmentsTable, eq(departmentsTable.id, integrationMappingsTable.departmentId))
    .leftJoin(accountsTable, eq(accountsTable.id, integrationMappingsTable.revenueAccountId))
    .leftJoin(itemsTable, eq(itemsTable.id, integrationMappingsTable.defaultItemId))
    .where(sourceId ? eq(integrationMappingsTable.sourceId, sourceId) : undefined)
    .orderBy(integrationMappingsTable.sourceId, integrationMappingsTable.externalType);
  res.json(rows.map(r => ({ ...r.mapping, projectName: r.projectName, departmentName: r.departmentName, revenueAccountName: r.revenueAccountName, expenseAccountName: r.expenseAccountName, templateName: r.templateName, defaultItemName: r.defaultItemName })));
});

router.put("/integrations/mappings", manage, async (req, res): Promise<void> => {
  const body = req.body || {};
  const sourceId = parseId(body.sourceId);
  const externalType = typeof body.externalType === "string" ? body.externalType.trim().slice(0, 50) : "";
  if (!sourceId) { res.status(400).json({ error: "請選擇來源" }); return; }
  if (!externalType) { res.status(400).json({ error: "請填寫訂單類型（對方系統送來的 type；填 * 代表其他全部）" }); return; }
  const values = {
    sourceId, externalType, label: typeof body.label === "string" ? body.label.trim().slice(0, 100) || null : null,
    projectId: optionalId(body.projectId), departmentId: optionalId(body.departmentId),
    revenueAccountId: optionalId(body.revenueAccountId), expenseAccountId: optionalId(body.expenseAccountId), defaultItemId: optionalId(body.defaultItemId),
    templateId: optionalId(body.templateId),
  };
  try {
    await assertExists(integrationSourcesTable, sourceId, "來源");
    await assertExists(projectsTable, values.projectId, "專案");
    await assertExists(departmentsTable, values.departmentId, "部門");
    await assertExists(itemsTable, values.defaultItemId, "品項");
    await assertExists(orderTemplatesTable, values.templateId, "銷貨訂單模組");
    if (values.templateId) {
      // 模組有綁專案時，這裡選的專案要一樣，不然進來的訂單會掛在不屬於那個模組的專案下
      const [template] = await db.select().from(orderTemplatesTable).where(eq(orderTemplatesTable.id, values.templateId));
      if (template?.projectId && values.projectId && template.projectId !== values.projectId) throw new Error(`「${template.name}」這個模組綁定了別的專案，請選同一個專案，或把專案留空（會用模組綁定的專案）`);
    }
    if (values.revenueAccountId) {
      const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, values.revenueAccountId));
      if (!account || account.isGroup || account.accountType !== "Income") throw new Error("收入科目必須是收入類的明細科目");
    }
    if (values.expenseAccountId) {
      const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, values.expenseAccountId));
      if (!account || account.isGroup || account.accountType !== "Expense") throw new Error("費用科目必須是費用類的明細科目");
    }
    const [row] = await db.insert(integrationMappingsTable).values(values)
      .onConflictDoUpdate({ target: [integrationMappingsTable.tenantId, integrationMappingsTable.sourceId, integrationMappingsTable.externalType], set: values }).returning();
    res.json(row);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.delete("/integrations/mappings/:id", manage, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "編號格式不正確" }); return; }
  await db.delete(integrationMappingsTable).where(eq(integrationMappingsTable.id, id));
  res.status(204).end();
});

// ───────── 品項對應：外部商品編號 → ERP 品項 ─────────
router.get("/integrations/item-maps", manage, async (req, res): Promise<void> => {
  const sourceId = parseId(req.query.sourceId);
  const rows = await db.select({ map: integrationItemMapsTable, itemName: itemsTable.itemName, itemCode: itemsTable.itemCode })
    .from(integrationItemMapsTable).leftJoin(itemsTable, eq(itemsTable.id, integrationItemMapsTable.itemId))
    .where(sourceId ? eq(integrationItemMapsTable.sourceId, sourceId) : undefined)
    .orderBy(integrationItemMapsTable.sourceId, integrationItemMapsTable.externalSku).limit(2000);
  res.json(rows.map(r => ({ ...r.map, itemName: r.itemName, itemCode: r.itemCode })));
});

router.put("/integrations/item-maps", manage, async (req, res): Promise<void> => {
  const body = req.body || {};
  const sourceId = parseId(body.sourceId), itemId = parseId(body.itemId);
  const externalSku = typeof body.externalSku === "string" ? body.externalSku.trim().slice(0, 100) : "";
  if (!sourceId || !itemId || !externalSku) { res.status(400).json({ error: "請填寫來源、對方的商品編號與 ERP 品項" }); return; }
  try {
    await assertExists(integrationSourcesTable, sourceId, "來源");
    await assertExists(itemsTable, itemId, "品項");
    const values = { sourceId, externalSku, itemId, externalName: typeof body.externalName === "string" ? body.externalName.trim().slice(0, 200) || null : null };
    const [row] = await db.insert(integrationItemMapsTable).values(values)
      .onConflictDoUpdate({ target: [integrationItemMapsTable.tenantId, integrationItemMapsTable.sourceId, integrationItemMapsTable.externalSku], set: values }).returning();
    res.json(row);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.delete("/integrations/item-maps/:id", manage, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "編號格式不正確" }); return; }
  await db.delete(integrationItemMapsTable).where(eq(integrationItemMapsTable.id, id));
  res.status(204).end();
});

// ───────── 收件匣 ─────────
router.get("/integrations/events", manage, async (req, res): Promise<void> => {
  const conditions = [];
  const sourceId = parseId(req.query.sourceId);
  if (sourceId) conditions.push(eq(integrationEventsTable.sourceId, sourceId));
  if (typeof req.query.status === "string" && req.query.status) conditions.push(eq(integrationEventsTable.status, req.query.status));
  if (typeof req.query.kind === "string" && req.query.kind) conditions.push(eq(integrationEventsTable.kind, req.query.kind));
  const rows = await db.select({ event: integrationEventsTable, sourceName: integrationSourcesTable.name, sourceCode: integrationSourcesTable.code })
    .from(integrationEventsTable).leftJoin(integrationSourcesTable, eq(integrationSourcesTable.id, integrationEventsTable.sourceId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(integrationEventsTable.id)).limit(300);
  res.json(rows.map(r => ({ ...r.event, amount: Number(r.event.amount), sourceName: r.sourceName, sourceCode: r.sourceCode, kindLabel: KIND_LABEL[r.event.kind as keyof typeof KIND_LABEL] ?? r.event.kind })));
});

/**
 * 外部系統送資料進來的入口。可以一次送一筆，或用 { events: [...] } 一次送多筆（最多 200 筆）。
 * 同一筆（來源＋種類＋外部編號）重送不會重複入帳，會回傳原本的處理結果。
 */
router.post("/integrations/events", async (req, res): Promise<void> => {
  const batch: unknown[] = Array.isArray(req.body?.events) ? req.body.events : [req.body];
  if (batch.length === 0) { res.status(400).json({ error: "沒有收到任何單據" }); return; }
  if (batch.length > 200) { res.status(400).json({ error: "一次最多送 200 筆" }); return; }
  // 登入的使用者要有管理或財務角色；API 金鑰要有寫入權限（唯讀金鑰在更前面就被擋掉了）
  const sessionRole = req.session?.user?.role;
  if (!machineOnly(req) && !["owner", "admin", "finance_admin", "accountant", "super_admin"].includes(sessionRole || "")) {
    res.status(403).json({ error: "權限不足" }); return;
  }
  const results = await ingestEvents(db as any, batch, { actor: actorOf(req), apiKeyId: (req as any).apiKeyAuth ? Number((req as any).apiKey?.id) || null : null });
  const failed = results.filter(r => !r.ok).length;
  const body = Array.isArray(req.body?.events) ? { received: results.length, failed, results } : results[0];
  // 單筆送失敗用 422，讓對方系統知道要重送或修正；整批則一律 200，逐筆看結果
  res.status(!Array.isArray(req.body?.events) && failed > 0 ? 422 : 200).json(body);
});

router.get("/integrations/events/:id", manage, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "編號格式不正確" }); return; }
  const [row] = await db.select().from(integrationEventsTable).where(eq(integrationEventsTable.id, id));
  if (!row) { res.status(404).json({ error: "找不到這筆單據" }); return; }
  res.json({ ...row, amount: Number(row.amount) });
});

router.post("/integrations/events/:id/retry", manage, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "編號格式不正確" }); return; }
  try {
    const record = await processEvent(db as any, id, actorOf(req));
    res.json({ ...record, amount: Number(record.amount) });
  } catch (err: any) {
    res.status(400).json({ error: /[㐀-鿿]/.test(err?.message || "") ? err.message : "重試失敗，請稍後再試" });
  }
});

/** 略過：測試單、重複單這類不需要入帳的。已入帳的不能略過 */
router.post("/integrations/events/:id/ignore", manage, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "編號格式不正確" }); return; }
  const restore = req.body?.restore === true;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : "";
  const [current] = await db.select().from(integrationEventsTable).where(eq(integrationEventsTable.id, id));
  if (!current) { res.status(404).json({ error: "找不到這筆單據" }); return; }
  if (current.status === "processed") { res.status(400).json({ error: "已經入帳的單據不能略過；要取消請到銷貨單或日記帳處理" }); return; }
  if (restore && current.status !== "ignored") { res.status(400).json({ error: "這筆沒有被略過" }); return; }
  const [row] = await db.update(integrationEventsTable).set(restore
    ? { status: "pending", error: null }
    : { status: "ignored", error: reason ? `已略過：${reason}` : "已略過", processedBy: actorOf(req) }).where(eq(integrationEventsTable.id, id)).returning();
  res.json({ ...row, amount: Number(row.amount) });
});

/**
 * 主動去對方的資料出口抓資料（CM生活+、AI 大學）。對方的程式不用改。
 * 可以指定日期區間；不指定就抓對方出口預設的範圍。舊同步已經入過帳的單據會自動略過。
 */
router.post("/integrations/sources/:id/pull", manage, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "來源編號格式不正確" }); return; }
  const from = req.body?.from || undefined, to = req.body?.to || undefined;
  if ((from && !isRealDate(from)) || (to && !isRealDate(to))) { res.status(400).json({ error: "日期格式不正確" }); return; }
  if (from && to && to < from) { res.status(400).json({ error: "結束日期不能早於開始日期" }); return; }
  const [source] = await db.select().from(integrationSourcesTable).where(eq(integrationSourcesTable.id, id));
  if (!source) { res.status(404).json({ error: "找不到這個來源" }); return; }
  try {
    res.json(await pullSource(db as any, source, { from, to }, actorOf(req)));
  } catch (err: any) {
    res.status(400).json({ error: /[\u3400-\u9fff]/.test(err?.message || "") ? err.message : "抓資料失敗：連不到對方的網站，請稍後再試" });
  }
});

// ───────── 會員儲值餘額 ─────────
router.get("/integrations/stored-value", manage, async (req, res): Promise<void> => {
  const sourceId = parseId(req.query.sourceId);
  const rows = await db.select({
    sourceId: storedValueLedgerTable.sourceId, sourceName: integrationSourcesTable.name,
    customerId: storedValueLedgerTable.customerId, customerName: customersTable.name, email: customersTable.email,
    balance: sql<number>`SUM(${storedValueLedgerTable.amount})::float`,
    toppedUp: sql<number>`COALESCE(SUM(${storedValueLedgerTable.amount}) FILTER (WHERE ${storedValueLedgerTable.entryType} = 'topup'), 0)::float`,
    lastDate: sql<string>`MAX(${storedValueLedgerTable.entryDate})`,
  }).from(storedValueLedgerTable)
    .leftJoin(customersTable, eq(customersTable.id, storedValueLedgerTable.customerId))
    .leftJoin(integrationSourcesTable, eq(integrationSourcesTable.id, storedValueLedgerTable.sourceId))
    .where(sourceId ? eq(storedValueLedgerTable.sourceId, sourceId) : undefined)
    .groupBy(storedValueLedgerTable.sourceId, integrationSourcesTable.name, storedValueLedgerTable.customerId, customersTable.name, customersTable.email)
    .orderBy(desc(sql`SUM(${storedValueLedgerTable.amount})`)).limit(1000);
  const members = rows.map(r => ({ ...r, balance: Math.round(Number(r.balance) * 100) / 100, toppedUp: Math.round(Number(r.toppedUp) * 100) / 100 }));
  res.json({ members, totalBalance: Math.round(members.reduce((sum, m) => sum + m.balance, 0) * 100) / 100 });
});

/** 給對方工程師看的格式說明 */
router.get("/integrations/format", (_req, res): void => {
  res.json({
    endpoint: "POST /api/integrations/events",
    auth: "Authorization: Bearer <API Key>:<API Secret>（金鑰需要寫入權限）",
    kinds: EVENT_KINDS.map(kind => ({ kind, label: KIND_LABEL[kind], autoPosted: SUPPORTED_KINDS.includes(kind) })),
    notes: [
      "同一筆（source + kind + externalId）重送不會重複入帳",
      "金額一律是含稅價、新台幣",
      "訂單必須是已付款的；payments 的合計要等於 total",
      "用儲值餘額付款的部分，method 填 stored_value",
      "儲值只算實際收到的錢，贈送的點數不要算進 amount",
      "人員報酬只送稅前的應付金額，代扣稅款與二代健保由 ERP 計算",
      "退款的 orderExternalId 填當初送訂單時的 externalId；退回儲值餘額的 method 填 stored_value",
      "資產異動用資產編號或序號對 ERP 的資產，資產要先在 ERP 建檔",
    ],
    examples: {
      order: {
        source: "cm-life", kind: "order", externalId: "A1001", occurredAt: "2026-11-13",
        data: {
          orderNumber: "CM20261113001", type: "product",
          buyer: { externalId: "u_88", name: "王小明", email: "buyer@example.com", phone: "0900000000" },
          lines: [{ sku: "TOY-001", name: "積木教具組", quantity: 2, unitPrice: 900 }],
          shippingFee: 80, discount: 0, total: 1880, taxType: "taxable",
          payments: [{ method: "stored_value", amount: 500 }, { method: "card", amount: 1380 }],
          invoiceNumber: "AB12345678",
        },
      },
      stored_value: {
        source: "cm-life", kind: "stored_value", externalId: "T5001", occurredAt: "2026-11-13",
        data: { action: "topup", member: { externalId: "u_88", name: "王小明", email: "buyer@example.com" }, amount: 1000, paymentMethod: "card" },
      },
      refund: {
        source: "cm-life", kind: "refund", externalId: "R3001", occurredAt: "2026-11-15",
        data: { orderExternalId: "A1001", amount: 900, refundTo: [{ method: "card", amount: 900 }], restock: [{ sku: "TOY-001", quantity: 1 }], reason: "商品瑕疵" },
      },
      payout: {
        source: "icta-pro", kind: "payout", externalId: "S7001", occurredAt: "2026-11-30",
        data: {
          type: "teaching", orderExternalId: "CASE-2026-018", serviceDate: "2026-11-28", description: "11 月魔術課 4 堂",
          payee: { kind: "teacher", externalId: "t_12", name: "林老師", idNumber: "A123456789", email: "teacher@example.com", bankName: "國泰世華", bankAccountNumber: "000000000000" },
          hours: 8, rate: 800, amount: 6400, incomeType: "50",
        },
      },
      expense: {
        source: "cm-life", kind: "expense", externalId: "E2001", occurredAt: "2026-11-13",
        data: { type: "廣告", description: "Meta 廣告 11 月第二週", amount: 5250, taxAmount: 250, paid: true, payee: "Meta" },
      },
      asset_movement: {
        source: "icta-pro", kind: "asset_movement", externalId: "RENT-501", occurredAt: "2026-11-13",
        data: { assetNumber: "AST-00012345", action: "checkout", holder: "林老師", location: "板橋國小", note: "魔術道具箱，11/20 歸還" },
      },
    },
  });
});

export default router;
