import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const erpLeadsTable = pgTable("erp_leads", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company"),
  phone: text("phone"),
  email: text("email"),
  source: text("source").notNull().default("other"),
  status: text("status").notNull().default("new"),
  ownerId: integer("owner_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_erp_leads_status").on(t.status)]);

export const erpOpportunitiesTable = pgTable("erp_opportunities", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  leadId: integer("lead_id"),
  customerId: integer("customer_id"),
  stage: text("stage").notNull().default("prospecting"),
  expectedAmount: integer("expected_amount").notNull().default(0),
  probability: integer("probability").notNull().default(0),
  expectedCloseDate: text("expected_close_date"),
  ownerId: integer("owner_id"),
  notes: text("notes"),
  lostReason: text("lost_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_erp_opportunities_stage").on(t.stage)]);

export const erpComplaintsTable = pgTable("erp_complaints", {
  id: serial("id").primaryKey(),
  complaintNo: text("complaint_no").notNull(),
  customerId: integer("customer_id"),
  memberId: integer("member_id"),
  category: text("category").notNull().default("other"),
  severity: text("severity").notNull().default("medium"),
  subject: text("subject").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("open"),
  assigneeId: integer("assignee_id"),
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("uq_erp_complaints_no").on(t.complaintNo), index("idx_erp_complaints_status").on(t.status)]);

export const erpTicketsTable = pgTable("erp_tickets", {
  id: serial("id").primaryKey(),
  ticketNo: text("ticket_no").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  assigneeId: integer("assignee_id"),
  requesterName: text("requester_name"),
  customerId: integer("customer_id"),
  complaintId: integer("complaint_id"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("uq_erp_tickets_no").on(t.ticketNo), index("idx_erp_tickets_status").on(t.status)]);

export const erpTicketCommentsTable = pgTable("erp_ticket_comments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => erpTicketsTable.id, { onDelete: "cascade" }),
  authorId: integer("author_id"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_erp_ticket_comments_ticket").on(t.ticketId)]);

export const erpKbArticlesTable = pgTable("erp_kb_articles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("一般"),
  content: text("content").notNull(),
  tags: text("tags").array().notNull().default([]),
  isPublished: boolean("is_published").notNull().default(false),
  authorId: integer("author_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});