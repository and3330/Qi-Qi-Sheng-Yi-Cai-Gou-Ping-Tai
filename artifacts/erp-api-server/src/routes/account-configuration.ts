import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, accountsTable, adminUsersTable, auditLogsTable, tenantsTable } from "@workspace/erp-db";
import { requireAuth, sessionOnly } from "../middleware/require-auth";
import {
  AccountConfigurationError, exportAccountConfiguration,
  parseAccountConfiguration, previewAccountConfiguration,
} from "../lib/account-configuration";

const router: IRouter = Router();
const roles = new Set(["owner", "super_admin", "admin", "finance_admin", "accountant"]);
router.use("/accounts/configuration", sessionOnly, requireAuth);

async function identity(database: any, req: any) {
  const session = req.session?.user;
  const [user] = await database.select().from(adminUsersTable).where(and(
    eq(adminUsersTable.id, session.id), eq(adminUsersTable.tenantId, session.tenantId),
    eq(adminUsersTable.isActive, true),
  ));
  if (!user || !roles.has(user.role)) throw new AccountConfigurationError("權限不足", 403);
  const [tenant] = await database.select().from(tenantsTable).where(eq(tenantsTable.id, session.tenantId));
  if (!tenant?.companyCode || tenant.companyCode !== session.companyCode) {
    throw new AccountConfigurationError("公司資料已變更，請重新登入", 403);
  }
  return { user, tenant };
}
function handleError(error: unknown, res: any) {
  if (!(error instanceof AccountConfigurationError)) throw error;
  res.status(error.status).json({ error: error.message });
}

router.get("/accounts/configuration/export", async (req, res) => {
  try {
    const { tenant } = await identity(db, req);
    const rows = await db.select().from(accountsTable).where(eq(accountsTable.tenantId, tenant.id));
    res.set("Cache-Control", "no-store").json(exportAccountConfiguration(tenant.companyCode, rows));
  } catch (error) { handleError(error, res); }
});
router.post("/accounts/configuration/preview", async (req, res) => {
  try {
    const { tenant } = await identity(db, req);
    const configuration = parseAccountConfiguration(req.body);
    const rows = await db.select().from(accountsTable).where(eq(accountsTable.tenantId, tenant.id));
    res.set("Cache-Control", "no-store").json(previewAccountConfiguration(tenant.id, tenant.companyCode, rows, configuration));
  } catch (error) { handleError(error, res); }
});
router.post("/accounts/configuration/import", async (req, res) => {
  try {
    await identity(db, req);
    if (!req.body || Object.keys(req.body).sort().join(",") !== "configuration,confirmation,fingerprint" ||
      req.body.confirmation !== "新增缺少科目" ||
      typeof req.body.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(req.body.fingerprint)) {
      throw new AccountConfigurationError("請先取得預覽並確認新增缺少科目");
    }
    const configuration = parseAccountConfiguration(req.body.configuration);
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
      await tx.execute(sql`LOCK TABLE accounts IN SHARE ROW EXCLUSIVE MODE`);
      const { tenant, user } = await identity(tx, req);
      const rows = await tx.select().from(accountsTable).where(eq(accountsTable.tenantId, tenant.id));
      const preview = previewAccountConfiguration(tenant.id, tenant.companyCode, rows, configuration);
      if (preview.conflicts.length) throw new AccountConfigurationError("科目結構有衝突，未匯入任何科目", 409);
      if (preview.fingerprint !== req.body.fingerprint) throw new AccountConfigurationError("預覽已過期，請重新預覽", 409);
      const idByCode = new Map(rows.map(row => [row.accountNumber, row.id]));
      let pending = [...preview.missing];
      while (pending.length) {
        const ready = pending.filter(row => row.parentCode === null || idByCode.has(row.parentCode));
        if (!ready.length) throw new AccountConfigurationError("階層無效，未匯入任何科目", 409);
        for (const row of ready) {
          const [created] = await tx.insert(accountsTable).values({
            tenantId: tenant.id, accountNumber: row.accountNumber, accountName: row.accountName,
            accountType: row.accountType, isGroup: row.isGroup,
            parentAccountId: row.parentCode === null ? null : idByCode.get(row.parentCode)!,
            cashFlowCategory: row.cashFlowCategory, balance: "0",
          }).returning({ id: accountsTable.id });
          idByCode.set(row.accountNumber, created.id);
        }
        const readyCodes = new Set(ready.map(row => row.accountNumber));
        pending = pending.filter(row => !readyCodes.has(row.accountNumber));
      }
      if (preview.missing.length) {
        await tx.insert(auditLogsTable).values({
          tenantId: tenant.id, action: "create", module: "accounting",
          documentType: "account_configuration_import", userId: String(user.id),
          userName: user.displayName, ipAddress: req.ip,
          newValues: { inserted: preview.missing.length, existing: preview.existing, codes: preview.missing.map(row => row.accountNumber) },
          description: "批量上傳會計科目設定（只新增、不覆寫）",
        });
      }
      return { inserted: preview.missing.length, existing: preview.existing };
    });
    res.json(result);
  } catch (error) { handleError(error, res); }
});
export default router;
