import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const membersTable = pgTable("members", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // 預留：之後串接 LINE / Google 額外綁定
  lineUserId: text("line_user_id").unique(),
  googleUserId: text("google_user_id").unique(),
  // admin | member
  role: text("role").notNull().default("member"),
  isActive: boolean("is_active").notNull().default(true),
  name: text("name").notNull().default(""),
  email: text("email"),
  phone: text("phone"),
  // hospital (A 醫院) | clinic (B 診所/藥局) | consumer (C 消費者)
  tier: text("tier").notNull().default("consumer"),
  // 註冊時申請的身份（hospital | clinic），管理員審核通過才會寫進 tier；null = 沒有待審申請
  requestedTier: text("requested_tier"),
  boundInstitutionId: integer("bound_institution_id"),
  // 綁定院所是否已由管理員審核（審核通過才能查看整個院所的訂單資料）
  institutionVerified: boolean("institution_verified").notNull().default(false),
  boundDepartment: text("bound_department"),
  points: integer("points").notNull().default(0),
  // 錢包餘額 (NT$)
  walletBalance: integer("wallet_balance").notNull().default(0),
  shippingAddress: text("shipping_address"),
  // ERP 角色：super_admin | admin | manager | hr_admin | finance_admin | accountant | viewer
  // null = 無 ERP 權限（平台 admin 未設定時視同 super_admin）
  erpRole: text("erp_role"),
  // ERP 部門（erp_departments.id，弱關聯）
  erpDepartmentId: integer("erp_department_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_members_bound_institution").on(t.boundInstitutionId)]);

export const insertMemberSchema = createInsertSchema(membersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof membersTable.$inferSelect;
