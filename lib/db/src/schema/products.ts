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
  costPrice: integer("cost_price").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  isHot: boolean("is_hot").notNull().default(false),
  isNew: boolean("is_new").notNull().default(false),
  spec: text("spec"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 商品多規格：同商品下的不同規格（容量／包裝等），各自有價格與庫存 */
export const productVariantsTable = pgTable("product_variants", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .notNull()
    .references(() => productsTable.id),
  // 規格名稱，如「500ml」「大盒裝」
  name: text("name").notNull(),
  priceHospital: integer("price_hospital").notNull(),
  priceClinic: integer("price_clinic").notNull(),
  priceConsumer: integer("price_consumer").notNull(),
  costPrice: integer("cost_price").notNull().default(0),
  stock: integer("stock").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ProductVariant = typeof productVariantsTable.$inferSelect;

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
