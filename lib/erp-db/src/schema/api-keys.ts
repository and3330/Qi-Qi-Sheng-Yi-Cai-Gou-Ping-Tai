import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const apiKeysTable = pgTable("api_keys", {
  tenantId: integer("tenant_id").notNull().default(1),
  id: serial("id").primaryKey(),
  keyName: text("key_name").notNull(),
  apiKey: text("api_key").notNull().unique(),
  secretHash: text("secret_hash").notNull(),
  projectId: integer("project_id").references(() => projectsTable.id),
  permissions: text("permissions").notNull().default("read"),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertApiKeySchema = createInsertSchema(apiKeysTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeysTable.$inferSelect;
