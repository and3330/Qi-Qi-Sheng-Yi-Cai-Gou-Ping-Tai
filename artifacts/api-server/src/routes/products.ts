import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db, productsTable, productVariantsTable } from "@workspace/db";
import { ListProductsQueryParams, GetProductParams } from "@workspace/api-zod";
import { serializeProduct } from "../lib/serialize";
import {
  optionalMember,
  resolveMemberGrade,
  gradeAllowed,
} from "../middlewares/optionalMember";

const router: IRouter = Router();

router.get("/products", optionalMember, async (req, res) => {
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

  // 授權可銷售機構範圍：受限商品僅開放給符合分級的機構會員
  const grade = await resolveMemberGrade(req.member);
  const visible = rows.filter((p) => gradeAllowed(p.allowedGrades, grade));

  res.json(visible.map(serializeProduct));
});

router.get("/products/:id", optionalMember, async (req, res) => {
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
  const grade = await resolveMemberGrade(req.member);
  if (!gradeAllowed(row.allowedGrades, grade)) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const variants = await db
    .select()
    .from(productVariantsTable)
    .where(
      and(
        eq(productVariantsTable.productId, row.id),
        eq(productVariantsTable.isActive, true),
      ),
    )
    .orderBy(asc(productVariantsTable.id));
  res.json({
    ...serializeProduct(row),
    variants: variants.map((v) => ({
      id: v.id,
      productId: v.productId,
      name: v.name,
      priceHospital: v.priceHospital,
      priceClinic: v.priceClinic,
      priceConsumer: v.priceConsumer,
      stock: v.stock,
      isActive: v.isActive,
    })),
  });
});

export default router;
