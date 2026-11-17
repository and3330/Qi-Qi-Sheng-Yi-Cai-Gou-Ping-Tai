import { pgTable, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { adminUsersTable } from "./admin-users";

export const accountRecoveryProfilesTable = pgTable("account_recovery_profiles", {
  userId: integer("user_id").primaryKey().references(() => adminUsersTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull(),
  recoveryEmail: text("recovery_email").notNull(),
  recoveryEmailVerifiedAt: timestamp("recovery_email_verified_at", { withTimezone: true }),
});

// Pre-login authentication capability table. Like admin_users, access is only
// through the auth service with explicit user AND tenant predicates.
export const accountRecoveryTokensTable = pgTable("account_recovery_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => adminUsersTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull(),
  purpose: text("purpose", { enum: ["verify", "reset"] }).notNull(),
  bindingHash: text("binding_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => ({
  userPurpose: uniqueIndex("account_recovery_tokens_user_purpose").on(t.tenantId, t.userId, t.purpose),
}));