import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const membersTable = pgTable("members", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  name: text("name").notNull().default(""),
  email: text("email"),
  phone: text("phone"),
  // hospital (A 醫院) | clinic (B 診所/藥局) | consumer (C 消費者)
  tier: text("tier").notNull().default("consumer"),
  boundInstitutionId: integer("bound_institution_id"),
  boundDepartment: text("bound_department"),
  points: integer("points").notNull().default(0),
  shippingAddress: text("shipping_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMemberSchema = createInsertSchema(membersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof membersTable.$inferSelect;
