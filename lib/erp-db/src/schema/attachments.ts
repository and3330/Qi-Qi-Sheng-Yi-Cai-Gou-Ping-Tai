import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const attachmentsTable = pgTable("attachments", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  fileNumber: text("file_number").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  filePath: text("file_path").notNull(),
  module: text("module").notNull(),
  documentType: text("document_type").notNull(),
  documentId: integer("document_id").notNull(),
  uploadedBy: text("uploaded_by"),
  description: text("description"),
  tags: text("tags"),
  status: text("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAttachmentSchema = createInsertSchema(attachmentsTable).omit({ id: true, createdAt: true });
export type InsertAttachment = z.infer<typeof insertAttachmentSchema>;
export type Attachment = typeof attachmentsTable.$inferSelect;
