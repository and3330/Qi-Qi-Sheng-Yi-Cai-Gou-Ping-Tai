import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, cartItemsTable, productsTable } from "@workspace/db";
import {
  AddCartItemBody,
  UpdateCartItemBody,
  UpdateCartItemParams,
  RemoveCartItemParams,
} from "@workspace/api-zod";
import { requireMember } from "../middlewares/requireMember";
import { serializeProduct } from "../lib/serialize";

const router: IRouter = Router();

router.use("/cart", requireMember);

async function cartItemWithProduct(id: number) {
  const [row] = await db
    .select()
    .from(cartItemsTable)
    .innerJoin(productsTable, eq(cartItemsTable.productId, productsTable.id))
    .where(eq(cartItemsTable.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.cart_items.id,
    productId: row.cart_items.productId,
    quantity: row.cart_items.quantity,
    product: serializeProduct(row.products),
  };
}

router.get("/cart", async (req, res) => {
  const rows = await db
    .select()
    .from(cartItemsTable)
    .innerJoin(productsTable, eq(cartItemsTable.productId, productsTable.id))
    .where(eq(cartItemsTable.memberId, req.member!.id))
    .orderBy(cartItemsTable.id);
  res.json(
    rows.map((row) => ({
      id: row.cart_items.id,
      productId: row.cart_items.productId,
      quantity: row.cart_items.quantity,
      product: serializeProduct(row.products),
    })),
  );
});

router.post("/cart", async (req, res) => {
  const parsed = AddCartItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { productId, quantity } = parsed.data;

  const [product] = await db
    .select({ id: productsTable.id, isActive: productsTable.isActive })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!product) {
    res.status(400).json({ error: "Product not found" });
    return;
  }
  if (!product.isActive) {
    res.status(400).json({ error: "商品已下架，無法加入購物車" });
    return;
  }

  const [existing] = await db
    .select()
    .from(cartItemsTable)
    .where(
      and(
        eq(cartItemsTable.memberId, req.member!.id),
        eq(cartItemsTable.productId, productId),
      ),
    )
    .limit(1);

  let itemId: number;
  if (existing) {
    const [updated] = await db
      .update(cartItemsTable)
      .set({ quantity: existing.quantity + quantity })
      .where(eq(cartItemsTable.id, existing.id))
      .returning();
    itemId = updated.id;
  } else {
    const [inserted] = await db
      .insert(cartItemsTable)
      .values({ memberId: req.member!.id, productId, quantity })
      .returning();
    itemId = inserted.id;
  }
  res.json(await cartItemWithProduct(itemId));
});

router.delete("/cart", async (req, res) => {
  await db
    .delete(cartItemsTable)
    .where(eq(cartItemsTable.memberId, req.member!.id));
  res.status(204).end();
});

router.patch("/cart/:id", async (req, res) => {
  const params = UpdateCartItemParams.safeParse(req.params);
  const body = UpdateCartItemBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [updated] = await db
    .update(cartItemsTable)
    .set({ quantity: body.data.quantity })
    .where(
      and(
        eq(cartItemsTable.id, params.data.id),
        eq(cartItemsTable.memberId, req.member!.id),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Cart item not found" });
    return;
  }
  res.json(await cartItemWithProduct(updated.id));
});

router.delete("/cart/:id", async (req, res) => {
  const params = RemoveCartItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .delete(cartItemsTable)
    .where(
      and(
        eq(cartItemsTable.id, params.data.id),
        eq(cartItemsTable.memberId, req.member!.id),
      ),
    );
  res.status(204).end();
});

export default router;
