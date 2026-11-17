import {
  db, pool, runWithTenant, tenantsTable, adminUsersTable,
  menuPermissionsTable, accountingSettingsTable, warehousesTable,
  type Tenant,
} from "@workspace/erp-db";
import { drizzle } from "drizzle-orm/node-postgres";
import { hashPassword } from "./auth";
import { companyCode, accountName } from "./company-identity";
import { pgErrorCode } from "./pg-error";
import { ensureAccountingBaseline, selectAccountingBaseline } from "./accounting-baseline";
import { DEFAULT_WAREHOUSE_NAME } from "./foundation";

const TEMPLATE_TENANT_ID = 1;
const SIGNUP_FREE_CREDITS = 10;

export interface SignupInput {
  companyCode: string;
  companyName: string;
  contactEmail: string;
  username: string;
  password: string;
  displayName: string;
}

/**
 * 建立新租戶：
 * 1. tenants 一筆（7 天試用、贈送 10 點 AI 點數）
 * 2. 老闆（owner）登入帳號
 * 3. 從不可變通用基線建立會計科目；選單權限仍沿用平台範本，並建立會計設定
 */
export async function provisionTenant(input: SignupInput): Promise<{ tenant: Tenant; adminUserId: number }> {
  const code = companyCode(input.companyCode);
  const username = accountName(input.username);
  if (!code || !username) throw Object.assign(new Error("公司編碼或帳號格式錯誤"), { statusCode: 400 });
  const passwordHash = await hashPassword(input.password);
  // 範本公司的自訂角色（@role/…）綁著那家公司的帳號，不複製給新公司
  const templateMenus = (await runWithTenant(TEMPLATE_TENANT_ID, async () =>
    db.select().from(menuPermissionsTable))).filter((row) => !row.path.startsWith("@role/"));
  const ownerClient = await pool.connect();
  try {
    // Owner provisioning transaction: every business insert has an explicit tenant.
    // Never mix runWithTenant's independent connection into this transaction.
    // Construct directly from owner pool, never the ALS-sensitive db proxy.
    // The only tenant written below is returned by this transaction's INSERT;
    // neither an authenticated caller's tenant nor an input tenantId is used.
    return await drizzle(ownerClient).transaction(async (tx) => {
      const [tenant] = await tx.insert(tenantsTable).values({
        companyCode: code,
        name: input.companyName,
        // 七期網站：這套 ERP 是七期自己專用的，不是訂閱制，開戶就是正式、免收費
        status: "active",
        isExempt: true,
        trialEndsAt: null,
        aiCredits: SIGNUP_FREE_CREDITS,
        contactEmail: input.contactEmail,
      }).returning();

      const [adminUser] = await tx.insert(adminUsersTable).values({
        username,
        tenantId: tenant.id,
        passwordHash,
        displayName: input.displayName || username,
        role: "owner",
      }).returning();

      // Signup is deliberately profile-independent: unverified input company
      // codes can never select the source-company labels.
      await ensureAccountingBaseline(tx, selectAccountingBaseline("generic"), { tenantId: tenant.id });

      if (templateMenus.length > 0) {
        await tx.insert(menuPermissionsTable).values(
          templateMenus.map((m) => ({ tenantId: tenant.id, path: m.path, roles: m.roles })),
        );
      }
      await tx.insert(accountingSettingsTable).values({ tenantId: tenant.id });
      // 出貨、收貨、庫存異動都要指定倉庫：開戶就先給一間，流程才接得起來
      await tx.insert(warehousesTable).values({ tenantId: tenant.id, name: DEFAULT_WAREHOUSE_NAME });

      return { tenant, adminUserId: adminUser.id };
    });
  } catch (e) {
    if (pgErrorCode(e) === "23505") throw Object.assign(new Error("公司編碼或公司帳號已存在"), { statusCode: 409 });
    throw e;
  } finally {
    ownerClient.release();
  }
}
