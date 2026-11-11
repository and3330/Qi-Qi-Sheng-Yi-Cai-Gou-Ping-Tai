import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, favoritesTable, productsTable } from "@workspace/db";
import { AddFavoriteBody, RemoveFavoriteParams } from "@workspace/api-zod";
import { requireMember } from "../middlewares/requireMember";
import { serializeProduct, maskTierPrices } from "../lib/serialize";

const router: IRouter = Router();

router.use("/favorites", requireMember);

router.get("/favorites", async (req, res) => {
  const rows = await db
    .select()
    .from(favoritesTable)
    .innerJoin(productsTable, eq(favoritesTable.productId, productsTable.id))
    .where(eq(favoritesTable.memberId, req.member!.id))
    .orderBy(favoritesTable.id);
  res.json(rows.map((r) => maskTierPrices(serializeProduct(r.products), req.member!.tier)));
});

router.post("/favorites", async (req, res) => {
  const parsed = AddFavoriteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  await db
    .insert(favoritesTable)
    .values({ memberId: req.member!.id, productId: parsed.data.productId })
    .onConflictDoNothing();
  res.status(204).end();
});

router.delete("/favorites/:productId", async (req, res) => {
  const parsed = RemoveFavoriteParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .delete(favoritesTable)
    .where(
      and(
        eq(favoritesTable.memberId, req.member!.id),
        eq(favoritesTable.productId, parsed.data.productId),
      ),
    );
  res.status(204).end();
});

export default router;
