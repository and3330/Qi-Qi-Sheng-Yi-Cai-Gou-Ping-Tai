import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db, accountsTable, adminUsersTable, auditLogsTable, tenantsTable,
} from "@workspace/erp-db";
import {
  ListAccountsQueryParams, CreateAccountBody,
  UpdateAccountParams, UpdateAccountBody,
} from "@workspace/erp-api-zod";
import { requireAuth, requireRole, sessionOnly } from "../middleware/require-auth";
import { ensureAccountingBaseline, selectAccountingBaseline } from "../lib/accounting-baseline";
import { buildBaselineRepairPreview } from "../lib/accounting-baseline-repair";
import { listCashAccounts } from "../lib/cash-accounts";
import { pgErrorCode } from "../lib/pg-error";

const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"];

/** 每個科目已過帳分錄的借貸合計 */
async function postedTotals(): Promise<Map<number, { debit: number; credit: number }>> {
  const result = await db.execute(sql`
    SELECT (line->>'accountId')::int AS id,
           COALESCE(SUM(COALESCE((line->>'debit')::numeric, 0)), 0)::float AS debit,
           COALESCE(SUM(COALESCE((line->>'credit')::numeric, 0)), 0)::float AS credit
    FROM journal_entries je, jsonb_array_elements(COALESCE(je.lines, '[]'::jsonb)) line
    WHERE je.status <> 'Draft' AND line->>'accountId' ~ '^[0-9]+$'
    GROUP BY 1
  `);
  const rows: any[] = (result as any)?.rows ?? (result as any) ?? [];
  return new Map(rows.map(r => [Number(r.id), { debit: Number(r.debit), credit: Number(r.credit) }]));
}

/** 檢查上層科目：要存在、是彙總科目、同一個類型，而且不能是自己 */
async function parentProblem(parentId: unknown, accountType: string, selfId?: number): Promise<string | null> {
  if (parentId === undefined || parentId === null) return null;
  if (selfId !== undefined && Number(parentId) === selfId) return "上層科目不能是自己";
  const [parent] = await db.select().from(accountsTable).where(eq(accountsTable.id, Number(parentId)));
  if (!parent) return "上層科目不存在";
  if (!parent.isGroup) return `上層科目「${parent.accountName}」不是彙總科目`;
  if (parent.accountType !== accountType) return "上層科目的類型要和這個科目相同";
  return null;
}

const router: IRouter = Router();
const financeWrite = [requireAuth, requireRole("owner", "admin", "finance_admin", "accountant")] as const;
const REPAIR_TENANT_ID = 1;
const REPAIR_COMPANY_CODE = "83483621";
const REPAIR_CONFIRMATION = "補齊育邦會計科目";
const repairGuards = [sessionOnly, requireAuth] as const;

function numericAccount(acc: any) {
  return { ...acc, balance: Number(acc.balance) };
}

async function repairIdentity(database: any, req: any) {
  const sessionUser = req.session?.user;
  if (!sessionUser || sessionUser.tenantId !== REPAIR_TENANT_ID || !Number.isInteger(sessionUser.id)) return null;
  const [tenant] = await database.select().from(tenantsTable)
    .where(and(eq(tenantsTable.id, REPAIR_TENANT_ID), eq(tenantsTable.companyCode, REPAIR_COMPANY_CODE)));
  if (!tenant) return null;
  const [user] = await database.select().from(adminUsersTable).where(and(
    eq(adminUsersTable.id, sessionUser.id),
    eq(adminUsersTable.tenantId, REPAIR_TENANT_ID),
    eq(adminUsersTable.isActive, true),
  ));
  if (!user || (user.role !== "owner" && user.role !== "super_admin")) return null;
  return { tenant, user };
}

async function repairPreview(database: any, tenant: any) {
  const rows = await database.select().from(accountsTable)
    .where(eq(accountsTable.tenantId, REPAIR_TENANT_ID));
  return buildBaselineRepairPreview(
    tenant,
    rows,
    selectAccountingBaseline("yubang-83483621"),
  );
}

// Keep these fixed paths before /accounts/:id routes.
router.get("/accounts/baseline-repair/preview", ...repairGuards, async (req, res): Promise<void> => {
  const identity = await repairIdentity(db, req);
  if (!identity) { res.status(403).json({ error: "權限不足" }); return; }
  res.json(await repairPreview(db, identity.tenant));
});

router.post("/accounts/baseline-repair/apply", ...repairGuards, async (req, res): Promise<void> => {
  const body = req.body;
  if (
    !body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== "confirmation,fingerprint" ||
    typeof body.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.fingerprint) ||
    body.confirmation !== REPAIR_CONFIRMATION
  ) {
    res.status(400).json({ error: "無效的修復確認資料" });
    return;
  }
  // Fast rejection only; authority is checked again after taking the write-blocking lock.
  if (!await repairIdentity(db, req)) { res.status(403).json({ error: "權限不足" }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE accounts IN SHARE ROW EXCLUSIVE MODE`);
      const identity = await repairIdentity(tx, req);
      if (!identity) throw Object.assign(new Error("forbidden"), { statusCode: 403 });
      const preview = await repairPreview(tx, identity.tenant);
      if (preview.conflicts.length > 0) {
        throw Object.assign(new Error("會計科目結構衝突"), { statusCode: 409 });
      }
      if (preview.fingerprint !== body.fingerprint) {
        throw Object.assign(new Error("預覽已過期，請重新預覽"), { statusCode: 409 });
      }
      const ensured = await ensureAccountingBaseline(
        tx,
        selectAccountingBaseline("yubang-83483621"),
        { tenantId: REPAIR_TENANT_ID },
      );
      await tx.insert(auditLogsTable).values({
        tenantId: REPAIR_TENANT_ID,
        action: "create",
        module: "accounting",
        documentType: "account_baseline_repair",
        userId: String(identity.user.id),
        userName: identity.user.displayName,
        ipAddress: req.ip,
        oldValues: { existing: preview.existing, missing: preview.missing.length },
        newValues: { inserted: ensured.inserted, existing: ensured.existing },
        description: REPAIR_CONFIRMATION,
      });
      return ensured;
    });
    res.json(result);
  } catch (error) {
    const status = Number((error as any)?.statusCode);
    if (status === 403 || status === 409) {
      res.status(status).json({ error: (error as Error).message === "forbidden" ? "權限不足" : (error as Error).message });
      return;
    }
    throw error;
  }
});

// 收付款帳戶（現金與銀行存款的明細科目）。固定路徑要放在 /accounts/:id 之前。
router.get("/accounts/cash-accounts", requireAuth, async (_req, res): Promise<void> => {
  res.json(await listCashAccounts(db));
});

router.get("/accounts", requireAuth, async (req, res): Promise<void> => {
  const query = ListAccountsQueryParams.safeParse(req.query);
  const condition = query.success && query.data.type ? eq(accountsTable.accountType, query.data.type) : undefined;

  const [accounts, totals] = await Promise.all([
    db.select().from(accountsTable).where(condition).orderBy(accountsTable.accountNumber),
    postedTotals(),
  ]);
  // balance 是期初餘額；currentBalance = 期初 + 已過帳分錄（資產、費用借方為正，其餘貸方為正）
  res.json(accounts.map(acc => {
    const t = totals.get(acc.id);
    const debitNormal = acc.accountType === "Asset" || acc.accountType === "Expense";
    const movement = t ? (debitNormal ? t.debit - t.credit : t.credit - t.debit) : 0;
    const opening = Number(acc.balance);
    return { ...numericAccount(acc), openingBalance: opening, currentBalance: Math.round((opening + movement) * 100) / 100, hasEntries: Boolean(t) };
  }));
});

router.post("/accounts", ...financeWrite, async (req, res): Promise<void> => {
  const parsed = CreateAccountBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const category = req.body.cashFlowCategory;
  if (category !== undefined && category !== null && category !== "" && !["operating", "investing", "financing", "cash"].includes(category)) {
    res.status(400).json({ error: "現金流量分類無效" }); return;
  }
  const accountNumber = String(parsed.data.accountNumber ?? "").trim();
  const accountName = String(parsed.data.accountName ?? "").trim();
  if (!accountNumber || !accountName) { res.status(400).json({ error: "請填寫科目編號與科目名稱" }); return; }
  if (!ACCOUNT_TYPES.includes(parsed.data.accountType)) { res.status(400).json({ error: "科目類型無效" }); return; }
  const problem = await parentProblem((parsed.data as any).parentAccountId, parsed.data.accountType);
  if (problem) { res.status(400).json({ error: problem }); return; }
  try {
    const [acc] = await db.insert(accountsTable).values({ ...parsed.data, accountNumber, accountName, ...(category ? { cashFlowCategory: category } : {}) }).returning();
    res.status(201).json(numericAccount(acc));
  } catch (err) {
    if (pgErrorCode(err) === "23505") { res.status(409).json({ error: `科目編號「${accountNumber}」已經存在` }); return; }
    throw err;
  }
});

router.patch("/accounts/:id", ...financeWrite, async (req, res): Promise<void> => {
  const params = UpdateAccountParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateAccountBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const category = req.body.cashFlowCategory;
  if (category !== undefined && category !== null && !["operating", "investing", "financing", "cash"].includes(category)) {
    res.status(400).json({ error: "現金流量分類無效" }); return;
  }
  const [current] = await db.select().from(accountsTable).where(eq(accountsTable.id, params.data.id));
  if (!current) { res.status(404).json({ error: "找不到這個科目" }); return; }
  const next = parsed.data as Record<string, any>;
  if (next.accountType !== undefined && !ACCOUNT_TYPES.includes(next.accountType)) { res.status(400).json({ error: "科目類型無效" }); return; }
  for (const key of ["accountNumber", "accountName"]) {
    if (next[key] !== undefined && !String(next[key]).trim()) { res.status(400).json({ error: "科目編號與科目名稱不可空白" }); return; }
  }
  const typeChanged = next.accountType !== undefined && next.accountType !== current.accountType;
  const becomesGroup = next.isGroup === true && !current.isGroup;
  if (typeChanged || becomesGroup) {
    // 已經有分錄的科目改類型或改成彙總科目，報表會整個錯位
    if ((await postedTotals()).has(current.id)) {
      res.status(400).json({ error: typeChanged ? "這個科目已經有分錄，不能改類型" : "這個科目已經有分錄，不能改成彙總科目" }); return;
    }
  }
  if (next.isGroup === false && current.isGroup) {
    const [child] = await db.select({ id: accountsTable.id }).from(accountsTable).where(eq(accountsTable.parentAccountId, current.id)).limit(1);
    if (child) { res.status(400).json({ error: "這個彙總科目底下還有子科目，不能改成明細科目" }); return; }
  }
  if (next.parentAccountId !== undefined) {
    const problem = await parentProblem(next.parentAccountId, next.accountType ?? current.accountType, current.id);
    if (problem) { res.status(400).json({ error: problem }); return; }
  }
  try {
    const [acc] = await db.update(accountsTable).set({
      ...parsed.data,
      ...(category !== undefined ? { cashFlowCategory: category || null } : {}),
    }).where(eq(accountsTable.id, params.data.id)).returning();
    res.json(numericAccount(acc));
  } catch (err) {
    if (pgErrorCode(err) === "23505") { res.status(409).json({ error: "科目編號已經存在" }); return; }
    throw err;
  }
});

// 刪除科目：只有沒用過的才能刪（沒有分錄、沒有子科目、期初餘額是 0）
router.delete("/accounts/:id", ...financeWrite, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "科目編號格式不正確" }); return; }
  const [current] = await db.select().from(accountsTable).where(eq(accountsTable.id, id));
  if (!current) { res.status(404).json({ error: "找不到這個科目" }); return; }
  const [child] = await db.select({ id: accountsTable.id }).from(accountsTable).where(eq(accountsTable.parentAccountId, id)).limit(1);
  if (child) { res.status(400).json({ error: "底下還有子科目，請先處理子科目" }); return; }
  if (Number(current.balance) !== 0) { res.status(400).json({ error: "這個科目有期初餘額，不能刪除" }); return; }
  if ((await postedTotals()).has(id)) { res.status(400).json({ error: "這個科目已經有分錄，不能刪除" }); return; }
  try {
    await db.delete(accountsTable).where(eq(accountsTable.id, id));
  } catch (err) {
    if (pgErrorCode(err) === "23503") { res.status(400).json({ error: "這個科目已被其他資料使用，不能刪除" }); return; }
    throw err;
  }
  res.sendStatus(204);
});

export default router;
