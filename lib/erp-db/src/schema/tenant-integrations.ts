import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * 各公司自己的串接設定：綠界電子發票、Resend 寄信（之後 Slack 也放這裡）。
 * settings 放不機密的設定（商店代號、寄件信箱…）；金鑰加密後放 secret_cipher，
 * 用平台的 ERP_SECRETS_KEY 解，畫面上只會看到末四碼（secret_hint）。
 */
export const tenantIntegrationsTable = pgTable("tenant_integrations", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  secretCipher: text("secret_cipher"),
  secretHint: text("secret_hint"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("tenant_integrations_provider_unique").on(t.tenantId, t.provider)]);
