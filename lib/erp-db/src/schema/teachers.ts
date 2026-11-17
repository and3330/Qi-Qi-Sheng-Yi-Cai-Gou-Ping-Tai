import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const teachersTable = pgTable("teachers", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  teacherId: text("teacher_id").notNull(),
  name: text("name").notNull(),
  position: text("position"),
  phone: text("phone"),
  email: text("email"),
  skills: text("skills"),
  address: text("address"),
  registeredAddress: text("registered_address"),
  idNumber: text("id_number"),
  dateOfBirth: text("date_of_birth"),
  bankName: text("bank_name"),
  bankAccountName: text("bank_account_name"),
  bankAccountNumber: text("bank_account_number"),
  bankBranch: text("bank_branch"),
  otherPositions: text("other_positions"),
  referrer: text("referrer"),
  teachingExperience: text("teaching_experience"),
  preferredArea: text("preferred_area"),
  notes: text("notes"),
  status: text("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("teachers_teacher_id_unique").on(t.tenantId, t.teacherId),
]);

export const insertTeacherSchema = createInsertSchema(teachersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTeacher = z.infer<typeof insertTeacherSchema>;
export type Teacher = typeof teachersTable.$inferSelect;
