import { Router, type IRouter } from "express";
import { todayTaipei } from "../lib/inventory-journal";
import { eq } from "drizzle-orm";
import { db, priceListsTable, priceListItemsTable, itemsTable, customersTable, activitiesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/price-lists", requireAuth);

router.get("/price-lists", async (_req, res): Promise<void> => {
  const lists = await db.select().from(priceListsTable).orderBy(priceListsTable.createdAt);
  res.json(lists);
});

router.get("/price-lists/resolve", async (req, res): Promise<void> => {
  const itemId = Number(req.query.itemId);
  const customerId = Number(req.query.customerId);
  const qty = Number(req.query.qty);
  if (!Number.isInteger(itemId) || !Number.isInteger(customerId) || !Number.isFinite(qty) || qty <= 0) {
    res.status(400).json({ error: "itemId、customerId 與正數 qty 為必填" });
    return;
  }

  const [[customer], [item], candidates] = await Promise.all([
    db.select({ category: customersTable.category }).from(customersTable).where(eq(customersTable.id, customerId)).limit(1),
    db.select({ sellingPrice: itemsTable.sellingPrice }).from(itemsTable).where(eq(itemsTable.id, itemId)).limit(1),
    db.select({
      price: priceListItemsTable.price,
      minQuantity: priceListItemsTable.minQuantity,
      validFrom: priceListItemsTable.validFrom,
      validTo: priceListItemsTable.validTo,
      customerGroup: priceListsTable.customerGroup,
      isActive: priceListsTable.isActive,
    })
      .from(priceListItemsTable)
      .innerJoin(priceListsTable, eq(priceListItemsTable.priceListId, priceListsTable.id))
      .where(eq(priceListItemsTable.itemId, itemId)),
  ]);
  if (!customer || !item) {
    res.status(404).json({ error: "找不到客戶或品項" });
    return;
  }

  const today = todayTaipei();
  const match = candidates
    .filter(entry =>
      entry.isActive === "Y"
      && entry.customerGroup === customer.category
      && Number(entry.minQuantity) <= qty
      && (!entry.validFrom || entry.validFrom <= today)
      && (!entry.validTo || entry.validTo >= today)
    )
    .sort((a, b) => Number(b.minQuantity) - Number(a.minQuantity))[0];

  if (match) {
    res.json({ price: Number(match.price), source: "價目表" });
    return;
  }
  res.json({ price: Number(item.sellingPrice), source: "預設" });
});

router.post("/price-lists", async (req, res): Promise<void> => {
  const { name, currency, customerGroup, remarks } = req.body;
  if (!name) { res.status(400).json({ error: "Missing name" }); return; }

  const [list] = await db.insert(priceListsTable).values({
    name,
    currency: currency || "TWD",
    customerGroup: customerGroup || null,
    remarks: remarks || null,
  }).returning();

  await db.insert(activitiesTable).values({
    type: "create", title: "價目表已建立",
    description: `${name} (${currency || "TWD"})`,
    module: "Sales",
  });

  res.status(201).json(list);
});

router.get("/price-lists/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [list] = await db.select().from(priceListsTable).where(eq(priceListsTable.id, id));
  if (!list) { res.status(404).json({ error: "Not found" }); return; }

  const items = await db
    .select({
      id: priceListItemsTable.id,
      priceListId: priceListItemsTable.priceListId,
      itemId: priceListItemsTable.itemId,
      itemName: itemsTable.itemName,
      itemCode: itemsTable.itemCode,
      price: priceListItemsTable.price,
      minQuantity: priceListItemsTable.minQuantity,
      validFrom: priceListItemsTable.validFrom,
      validTo: priceListItemsTable.validTo,
    })
    .from(priceListItemsTable)
    .innerJoin(itemsTable, eq(priceListItemsTable.itemId, itemsTable.id))
    .where(eq(priceListItemsTable.priceListId, id));

  res.json({
    ...list,
    items: items.map(i => ({ ...i, price: Number(i.price), minQuantity: Number(i.minQuantity) })),
  });
});

router.patch("/price-lists/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const updateData: Record<string, unknown> = {};
  if (req.body.name !== undefined) updateData.name = req.body.name;
  if (req.body.currency !== undefined) updateData.currency = req.body.currency;
  if (req.body.customerGroup !== undefined) updateData.customerGroup = req.body.customerGroup;
  if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive;
  if (req.body.remarks !== undefined) updateData.remarks = req.body.remarks;

  const [updated] = await db.update(priceListsTable).set(updateData).where(eq(priceListsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/price-lists/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(priceListItemsTable).where(eq(priceListItemsTable.priceListId, id));
  await db.delete(priceListsTable).where(eq(priceListsTable.id, id));
  res.json({ success: true });
});

router.post("/price-lists/:id/items", async (req, res): Promise<void> => {
  const priceListId = Number(req.params.id);
  if (isNaN(priceListId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { itemId, price, minQuantity, validFrom, validTo } = req.body;
  if (!itemId || price === undefined) { res.status(400).json({ error: "Missing required fields" }); return; }

  const [item] = await db.insert(priceListItemsTable).values({
    priceListId,
    itemId,
    price: String(price),
    minQuantity: String(minQuantity || 1),
    validFrom: validFrom || null,
    validTo: validTo || null,
  }).returning();

  const [dbItem] = await db.select({ itemName: itemsTable.itemName, itemCode: itemsTable.itemCode }).from(itemsTable).where(eq(itemsTable.id, itemId));

  res.status(201).json({
    ...item,
    itemName: dbItem?.itemName || "Unknown",
    itemCode: dbItem?.itemCode || "",
    price: Number(item.price),
    minQuantity: Number(item.minQuantity),
  });
});

router.delete("/price-lists/:id/items/:itemEntryId", async (req, res): Promise<void> => {
  const itemEntryId = Number(req.params.itemEntryId);
  if (isNaN(itemEntryId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(priceListItemsTable).where(eq(priceListItemsTable.id, itemEntryId));
  res.json({ success: true });
});

export default router;
