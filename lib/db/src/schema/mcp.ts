import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { membersTable } from "./members";

/**
 * Bot 連線金鑰（MCP）。外部 Bot 用這把金鑰連進 /api/mcp，
 * 能用的工具與後台 AI 助理相同。金鑰只存雜湊，明碼只在建立當下顯示一次。
 * memberId：這把金鑰代表哪一位後台人員（必須是 admin 或 ops），稽核紀錄記在他名下。
 */
export const mcpApiKeysTable = pgTable("mcp_api_keys", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyLastFour: text("key_last_four").notNull().default(""),
  memberId: integer("member_id")
    .notNull()
    .references(() => membersTable.id),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type McpApiKey = typeof mcpApiKeysTable.$inferSelect;
