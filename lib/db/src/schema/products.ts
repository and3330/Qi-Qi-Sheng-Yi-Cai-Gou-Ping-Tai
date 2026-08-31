import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  priceHospital: integer("price_hospital").notNull(),
  priceClinic: integer("price_clinic").notNull(),
  priceConsumer: integer("price_consumer").notNull(),
  stock: integer("stock").notNull().default(0),
  isHot: boolean("is_hot").notNull().default(false),
  isNew: boolean("is_new").notNull().default(false),
  spec: text("spec"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
