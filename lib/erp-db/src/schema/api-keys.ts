import { pgTable, text, serial, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { adminUsersTable } from "./admin-users";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const apiKeysTable = pgTable("api_keys", {
  tenantId: integer("tenant_id").notNull().default(1),
  id: serial("id").primaryKey(),
  keyName: text("key_name").notNull(),
  apiKey: text("api_key").notNull().unique(),
  secretHash: text("secret_hash").notNull(),
  projectId: integer("project_id").references(() => projectsTable.id),
  /** 這把金鑰代表哪一個使用者：用金鑰呼叫時，權限完全跟著這個人目前的角色（老闆 2026-11-19） */
  userId: integer("user_id").references(() => adminUsersTable.id, { onDelete: "set null" }),
  /** 舊欄位，已不再使用：金鑰不再有自己的權限等級 */
  permissions: text("permissions").notNull().default("read"),
  /** AI 助理（MCP）用的設定：{ enabled, role, actions }，見 api-server 的 mcp/agent-caps.ts */
  agentConfig: jsonb("agent_config"),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertApiKeySchema = createInsertSchema(apiKeysTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeysTable.$inferSelect;
