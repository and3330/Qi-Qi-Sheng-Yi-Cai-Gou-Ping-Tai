import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db, productsTable } from "@workspace/db";
import { ListProductsQueryParams, GetProductParams } from "@workspace/api-zod";
import { serializeProduct } from "../lib/serialize";

const router: IRouter = Router();

router.get("/products", async (req, res) => {
  const parsed = ListProductsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const { category, search, sort } = parsed.data;

  const conditions: SQL[] = [eq(productsTable.isActive, true)];
  if (category) conditions.push(eq(productsTable.category, category));
  if (search) {
    conditions.push(
      or(
        ilike(productsTable.name, `%${search}%`),
        ilike(productsTable.code, `%${search}%`),
      )!,
    );
  }

  const orderBy =
    sort === "priceAsc"
      ? asc(productsTable.priceConsumer)
      : sort === "priceDesc"
        ? desc(productsTable.priceConsumer)
        : sort === "newest"
          ? desc(productsTable.createdAt)
          : [desc(productsTable.isHot), asc(productsTable.code)];

  const rows = await db
    .select()
    .from(productsTable)
    .where(and(...conditions))
    .orderBy(...(Array.isArray(orderBy) ? orderBy : [orderBy]));

  res.json(rows.map(serializeProduct));
});

router.get("/products/:id", async (req, res) => {
  const parsed = GetProductParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(productsTable)
    .where(
      and(eq(productsTable.id, parsed.data.id), eq(productsTable.isActive, true)),
    )
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json(serializeProduct(row));
});

export default router;
