import cron from "node-cron";
import { db, runWithTenant, currentTenantClient, tenantsTable } from "@workspace/erp-db";
import { logger } from "./logger";
import { notify } from "./notify";
import { closeResignedEmployees, ensureAnnualGrants } from "./hr-data";
import { taipeiToday } from "./hr-rules";
import { notifySetupReminders } from "./setup-reminders";
import { ensureFoundation } from "./foundation";
import { integrationSourcesTable } from "@workspace/erp-db";
import { ADAPTERS, adapterConfigured, pullSource } from "./integration-adapters";
import { ensureQiqiShopSource } from "./qiqi-shop-source";

/** 排程任務必須在租戶上下文內執行（RLS），逐一輪過所有租戶 */
async function forEachTenant(fn: () => Promise<void>): Promise<void> {
  const tenants = await db.select({ id: tenantsTable.id }).from(tenantsTable);
  for (const t of tenants) {
    try {
      await runWithTenant(t.id, fn);
    } catch (e: any) {
      logger.error({ tenantId: t.id, err: e.message }, "scheduled job failed for tenant");
    }
  }
}

/**
 * 每家公司都要有育邦那套預設會計科目、一間倉庫和會計設定。
 * 早期開的公司沒有自動建立，這裡補上；只補「整張科目表是空的」公司，已有科目的不動。
 */
export async function backfillFoundation(): Promise<void> {
  const tenants = await db.select({ id: tenantsTable.id }).from(tenantsTable);
  for (const t of tenants) {
    try {
      const ensured = await runWithTenant(t.id, () => db.transaction((tx) => ensureFoundation(tx, t.id)));
      if (ensured.accountsInserted > 0 || ensured.warehouseCreated || ensured.accountingSettingsCreated) {
        logger.info({ tenantId: t.id, ...ensured }, "foundation backfilled");
      }
    } catch (e: any) {
      logger.error({ tenantId: t.id, err: e.message }, "foundation backfill failed for tenant");
    }
  }
}

/** 每天自動去 CM生活+、AI 大學抓最近一週的資料進收件匣；已經入過帳的不會重複 */
async function dailyIntegrationPull() {
  await ensureQiqiShopSource();
  const sources = await db.select().from(integrationSourcesTable);
  const from = new Date(Date.now() + 8 * 3600_000 - 7 * 86_400_000).toISOString().slice(0, 10);
  for (const source of sources) {
    const adapter = ADAPTERS[source.code];
    if (!adapter || !source.isActive || !adapterConfigured(adapter)) continue;
    try {
      const summary = await pullSource(db as any, source, { from }, "scheduler");
      logger.info({ source: source.code, ...summary, errors: undefined }, "integration pull done");
      if (summary.failed > 0) {
        await notify({ title: `外部串接：${source.name} 有 ${summary.failed} 筆沒有入帳`, message: `請到「系統管理 → 外部串接」的收件匣看原因。${summary.errors[0] || ""}`.slice(0, 300), type: "warning", module: "Accounting", documentType: "Integration" });
      }
    } catch (e: any) {
      logger.error({ source: source.code, err: e.message }, "integration pull failed");
    }
  }
}

/** 租戶上下文內的查詢用連線（沒有上下文時直接丟錯，避免 RLS 下靜默查無資料） */
function tenantClient() {
  const client = currentTenantClient();
  if (!client) throw new Error("scheduler job executed without tenant context");
  return client;
}

interface JobRun { name: string; lastRunAt: string | null; lastStatus: string | null; lastError: string | null; }
const jobRuns = new Map<string, JobRun>();

export function getJobStatus(): JobRun[] {
  return Array.from(jobRuns.values());
}

async function runJob(name: string, fn: () => Promise<void>) {
  const startedAt = new Date().toISOString();
  try {
    logger.info({ job: name }, "scheduled job start");
    await fn();
    jobRuns.set(name, { name, lastRunAt: startedAt, lastStatus: "success", lastError: null });
    logger.info({ job: name }, "scheduled job success");
  } catch (e: any) {
    jobRuns.set(name, { name, lastRunAt: startedAt, lastStatus: "error", lastError: e.message });
    logger.error({ job: name, err: e.message }, "scheduled job failed");
  }
}

async function dailyOverdueInvoiceCheck() {
  const today = taipeiToday();
  const r = await tenantClient().query(
    `SELECT id, invoice_number,
            COALESCE(NULLIF(due_date,''), invoice_date) AS effective_due,
            outstanding_amount,
            (CURRENT_DATE - COALESCE(NULLIF(due_date,''), invoice_date)::date) AS days_overdue
     FROM invoices
     WHERE status NOT IN ('Paid','Cancelled','Voided')
       AND outstanding_amount > 0
       AND COALESCE(NULLIF(due_date,''), invoice_date) IS NOT NULL
       AND COALESCE(NULLIF(due_date,''), invoice_date)::date < CURRENT_DATE - INTERVAL '30 days'
     ORDER BY (CURRENT_DATE - COALESCE(NULLIF(due_date,''), invoice_date)::date) DESC LIMIT 50`,
  );
  if (r.rows.length === 0) return;
  const top = r.rows.slice(0, 5);
  const totalAmt = r.rows.reduce((a, x) => a + Number(x.outstanding_amount), 0);
  await notify({
    title: `逾期應收帳款警示（${r.rows.length} 筆）`,
    message: `截至 ${today}，共 ${r.rows.length} 筆逾期未收，合計 NT$${totalAmt.toLocaleString()}。最久：${top.map((t) => `${t.invoice_number}(${t.days_overdue}天)`).join("、")}`,
    type: "warning",
    module: "Accounting",
    documentType: "Invoice",
  });
}

async function dailyLowStockCheck() {
  const r = await tenantClient().query(
    `SELECT id, item_code, item_name, current_stock, reorder_level
     FROM items
     WHERE reorder_level > 0 AND current_stock < reorder_level
     ORDER BY (reorder_level - current_stock) DESC LIMIT 30`,
  );
  if (r.rows.length === 0) return;
  await notify({
    title: `低庫存預警（${r.rows.length} 項商品）`,
    message: `${r.rows.length} 項商品低於補貨點。前 5 項：${r.rows.slice(0, 5).map((x) => `${x.item_name}(${Number(x.current_stock)}/${Number(x.reorder_level)})`).join("、")}`,
    type: "warning",
    module: "Inventory",
    documentType: "Item",
  });
}

async function dailyAnomalyDigest() {
  const client = tenantClient();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    // 每天檢查「全部」已過帳的分錄（不只最近幾天）：表頭的借貸合計要相等，明細加起來也要相等
    const r = await client.query(
      `SELECT entry_number, entry_date, diff FROM (
         SELECT je.entry_number, je.entry_date,
           GREATEST(
             ABS(je.total_debit - je.total_credit),
             ABS(COALESCE((
               SELECT SUM(
                 (CASE WHEN line->>'debit' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (line->>'debit')::numeric ELSE 0 END)
                 - (CASE WHEN line->>'credit' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (line->>'credit')::numeric ELSE 0 END))
               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(je.lines) = 'array' THEN je.lines ELSE '[]'::jsonb END) line
             ), 0))
           ) AS diff
         FROM journal_entries je
         WHERE je.status IN ('Posted', 'Reversed')
       ) checked
       WHERE diff > 0.01
       ORDER BY diff DESC LIMIT 50`,
    );
    await client.query("COMMIT");
    if (r.rows.length === 0) return;
    await notify({
      title: `帳不平警示（${r.rows.length >= 50 ? "50 筆以上" : r.rows.length + " 筆"}分錄借貸不相等）`,
      message: `最大差額：${r.rows[0].entry_number}（${r.rows[0].entry_date}）差 NT$${Number(r.rows[0].diff).toLocaleString()}。其他：${r.rows.slice(1, 5).map((x: any) => x.entry_number).join("、") || "無"}。請到日記帳檢查，否則資產負債表會不平。`.slice(0, 300),
      type: "error",
      module: "Accounting",
      documentType: "JournalEntry",
    });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  }
}

/** 特休自動發放：員工滿半年、滿一年……的當天早上自動發放（勞基法第 38 條） */
async function dailyAnnualLeaveGrant() {
  const today = taipeiToday();
  const closed = await closeResignedEmployees(today);
  if (closed > 0) logger.info({ count: closed }, "resigned employees closed");
  const created = await ensureAnnualGrants(today);
  if (created.length > 0) logger.info({ count: created.length }, "annual leave granted");
}

/** 每週一提醒老闆與管理員還沒完成的上線前設定 */
/** 定期發票到期提醒：通知財務有幾張該開了（每人最多一則未讀） */
async function dailyRecurringInvoiceReminder() {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const due = await tenantClient().query(`SELECT count(*)::int AS count FROM recurring_invoices WHERE is_active AND next_run_date <= $1`, [today]);
  const count = Number(due.rows[0]?.count) || 0;
  if (count === 0) return;
  const title = "定期發票到期";
  const users = await tenantClient().query(`SELECT username FROM admin_users WHERE is_active AND role IN ('owner', 'admin', 'finance_admin', 'accountant')`);
  for (const user of users.rows) {
    const existing = await tenantClient().query(`SELECT id FROM notifications WHERE recipient = $1 AND title = $2 AND is_read = 'No' LIMIT 1`, [user.username, title]);
    if (existing.rows.length > 0) continue;
    await tenantClient().query(
      `INSERT INTO notifications (title, message, type, module, document_type, recipient) VALUES ($1, $2, 'info', 'Accounting', 'RecurringInvoice', $3)`,
      [title, `有 ${count} 張定期發票到期了，請到「定期發票」開立。`, user.username],
    );
  }
}

async function weeklySetupReminder() {
  const sent = await notifySetupReminders(db);
  if (sent > 0) logger.info({ count: sent }, "setup reminders sent");
}

const SCHEDULES: Array<{ name: string; cron: string; fn: () => Promise<void> }> = [
  { name: "foundation_backfill", cron: "0 3 * * *", fn: backfillFoundation },
  { name: "integration_pull", cron: "15 * * * *", fn: () => forEachTenant(dailyIntegrationPull) },
  { name: "setup_reminder", cron: "0 9 * * 1", fn: () => forEachTenant(weeklySetupReminder) },
  { name: "annual_leave_grant", cron: "10 0 * * *", fn: () => forEachTenant(dailyAnnualLeaveGrant) },
  { name: "overdue_invoice_check", cron: "0 9 * * *", fn: () => forEachTenant(dailyOverdueInvoiceCheck) },
  { name: "recurring_invoice_reminder", cron: "5 9 * * *", fn: () => forEachTenant(dailyRecurringInvoiceReminder) },
  { name: "low_stock_check", cron: "30 9 * * *", fn: () => forEachTenant(dailyLowStockCheck) },
  { name: "ledger_balance_check", cron: "0 8 * * *", fn: () => forEachTenant(dailyAnomalyDigest) },
];

let started = false;
export function startScheduler() {
  if (started) return;
  started = true;
  for (const job of SCHEDULES) {
    cron.schedule(job.cron, () => runJob(job.name, job.fn), { timezone: "Asia/Taipei" });
    jobRuns.set(job.name, { name: job.name, lastRunAt: null, lastStatus: null, lastError: null });
  }
  logger.info({ jobs: SCHEDULES.length }, "scheduler started");
  // 啟動時先補一次，新上線的版本不用等到隔天凌晨
  void runJob("foundation_backfill", backfillFoundation);
}

export async function runJobByName(name: string): Promise<{ ok: boolean; error?: string }> {
  const job = SCHEDULES.find((j) => j.name === name);
  if (!job) return { ok: false, error: "找不到指定排程任務" };
  await runJob(job.name, job.fn);
  const status = jobRuns.get(job.name);
  return status?.lastStatus === "success" ? { ok: true } : { ok: false, error: status?.lastError || "unknown" };
}

export function listJobs() {
  return SCHEDULES.map((j) => ({
    name: j.name,
    schedule: j.cron,
    ...jobRuns.get(j.name),
  }));
}
