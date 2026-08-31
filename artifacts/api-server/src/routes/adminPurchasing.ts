import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  suppliersTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  productsTable,
  stockMovementsTable,
  type Supplier,
  type PurchaseOrder,
  type PurchaseOrderItem,
} from "@workspace/db";
import {
  CreateAdminSupplierBody,
  UpdateAdminSupplierBody,
  CreateAdminPurchaseOrderBody,
  UpdateAdminPurchaseOrderStatusBody,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireMember";

const router: IRouter = Router();

function serializeSupplier(s: Supplier) {
  return {
    id: s.id,
    name: s.name,
    contactPerson: s.contactPerson,
    phone: s.phone,
    email: s.email,
    address: s.address,
    paymentTerms: s.paymentTerms,
    note: s.note,
    isActive: s.isActive,
    createdAt: s.createdAt.toISOString(),
  };
}

function serializePO(
  po: PurchaseOrder,
  supplierName: string,
  items: PurchaseOrderItem[],
) {
  return {
    id: po.id,
    poNo: po.poNo,
    supplierId: po.supplierId,
    supplierName,
    status: po.status,
    totalAmount: po.totalAmount,
    note: po.note,
    createdAt: po.createdAt.toISOString(),
    orderedAt: po.orderedAt ? po.orderedAt.toISOString() : null,
    receivedAt: po.receivedAt ? po.receivedAt.toISOString() : null,
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      productCode: i.productCode,
      unitCost: i.unitCost,
      quantity: i.quantity,
    })),
  };
}

// ---------- Suppliers ----------

router.get("/admin/suppliers", requireAdmin, async (req, res) => {
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";
  const conditions: SQL[] = [];
  if (search) {
    conditions.push(
      or(
        ilike(suppliersTable.name, `%${search}%`),
        ilike(suppliersTable.contactPerson, `%${search}%`),
        ilike(suppliersTable.phone, `%${search}%`),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(suppliersTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(suppliersTable.isActive), desc(suppliersTable.createdAt));
  res.json(rows.map(serializeSupplier));
});

router.post("/admin/suppliers", requireAdmin, async (req, res) => {
  const parsed = CreateAdminSupplierBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "供應商資料不完整" });
    return;
  }
  const d = parsed.data;
  const [created] = await db
    .insert(suppliersTable)
    .values({
      name: d.name,
      contactPerson: d.contactPerson ?? null,
      phone: d.phone ?? null,
      email: d.email ?? null,
      address: d.address ?? null,
      paymentTerms: d.paymentTerms ?? null,
      note: d.note ?? null,
    })
    .returning();
  res.status(201).json(serializeSupplier(created));
});

router.patch("/admin/suppliers/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateAdminSupplierBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const [updated] = await db
    .update(suppliersTable)
    .set(parsed.data)
    .where(eq(suppliersTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "找不到此供應商" });
    return;
  }
  res.json(serializeSupplier(updated));
});

// ---------- Purchase orders ----------

async function loadPO(id: number) {
  const [row] = await db
    .select({ po: purchaseOrdersTable, supplierName: suppliersTable.name })
    .from(purchaseOrdersTable)
    .innerJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
    .where(eq(purchaseOrdersTable.id, id))
    .limit(1);
  if (!row) return null;
  const items = await db
    .select()
    .from(purchaseOrderItemsTable)
    .where(eq(purchaseOrderItemsTable.purchaseOrderId, id));
  return serializePO(row.po, row.supplierName, items);
}

router.get("/admin/purchase-orders", requireAdmin, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const conditions: SQL[] = [];
  if (["draft", "ordered", "received", "cancelled"].includes(status))
    conditions.push(eq(purchaseOrdersTable.status, status));

  const rows = await db
    .select({ po: purchaseOrdersTable, supplierName: suppliersTable.name })
    .from(purchaseOrdersTable)
    .innerJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(purchaseOrdersTable.createdAt))
    .limit(300);

  const ids = rows.map((r) => r.po.id);
  const items = ids.length
    ? await db
        .select()
        .from(purchaseOrderItemsTable)
        .where(inArray(purchaseOrderItemsTable.purchaseOrderId, ids))
    : [];

  res.json(
    rows.map((r) =>
      serializePO(
        r.po,
        r.supplierName,
        items.filter((i) => i.purchaseOrderId === r.po.id),
      ),
    ),
  );
});

router.post("/admin/purchase-orders", requireAdmin, async (req, res) => {
  const parsed = CreateAdminPurchaseOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "採購單資料不完整" });
    return;
  }
  const input = parsed.data;

  const [supplier] = await db
    .select()
    .from(suppliersTable)
    .where(eq(suppliersTable.id, input.supplierId))
    .limit(1);
  if (!supplier) {
    res.status(400).json({ error: "供應商不存在" });
    return;
  }

  const productIds = input.items.map((i) => i.productId);
  const products = await db
    .select()
    .from(productsTable)
    .where(inArray(productsTable.id, productIds));
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const line of input.items) {
    if (!byId.has(line.productId)) {
      res.status(400).json({ error: `商品不存在 (id=${line.productId})` });
      return;
    }
  }

  const totalAmount = input.items.reduce(
    (sum, l) => sum + l.unitCost * l.quantity,
    0,
  );
  const poNo = `PO${Date.now()}`;

  const result = await db.transaction(async (tx) => {
    const [po] = await tx
      .insert(purchaseOrdersTable)
      .values({
        poNo,
        supplierId: input.supplierId,
        status: "draft",
        totalAmount,
        note: input.note ?? null,
      })
      .returning();
    const items = await tx
      .insert(purchaseOrderItemsTable)
      .values(
        input.items.map((l) => {
          const p = byId.get(l.productId)!;
          return {
            purchaseOrderId: po.id,
            productId: p.id,
            productName: p.name,
            productCode: p.code,
            unitCost: l.unitCost,
            quantity: l.quantity,
          };
        }),
      )
      .returning();
    return { po, items };
  });

  res
    .status(201)
    .json(serializePO(result.po, supplier.name, result.items));
});

router.get("/admin/purchase-orders/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const po = await loadPO(id);
  if (!po) {
    res.status(404).json({ error: "找不到此採購單" });
    return;
  }
  res.json(po);
});

router.patch(
  "/admin/purchase-orders/:id/status",
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = UpdateAdminPurchaseOrderStatusBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "狀態不正確" });
      return;
    }
    const target = parsed.data.status;

    const [po] = await db
      .select()
      .from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.id, id))
      .limit(1);
    if (!po) {
      res.status(404).json({ error: "找不到此採購單" });
      return;
    }

    const allowed =
      (target === "ordered" && po.status === "draft") ||
      (target === "cancelled" &&
        (po.status === "draft" || po.status === "ordered"));
    if (!allowed) {
      res.status(400).json({ error: `無法從「${po.status}」變更為「${target}」` });
      return;
    }

    await db
      .update(purchaseOrdersTable)
      .set(
        target === "ordered"
          ? { status: "ordered", orderedAt: new Date() }
          : { status: "cancelled" },
      )
      .where(eq(purchaseOrdersTable.id, id));

    res.json(await loadPO(id));
  },
);

router.post(
  "/admin/purchase-orders/:id/receive",
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    try {
      await db.transaction(async (tx) => {
        // Lock the PO row to prevent double receiving
        const [po] = await tx
          .select()
          .from(purchaseOrdersTable)
          .where(eq(purchaseOrdersTable.id, id))
          .for("update")
          .limit(1);
        if (!po) throw new Error("PO_NOT_FOUND");
        if (po.status !== "ordered") throw new Error("PO_BAD_STATUS");

        const items = await tx
          .select()
          .from(purchaseOrderItemsTable)
          .where(eq(purchaseOrderItemsTable.purchaseOrderId, id));

        for (const item of items) {
          const [updated] = await tx
            .update(productsTable)
            .set({
              stock: sql`${productsTable.stock} + ${item.quantity}`,
              costPrice: item.unitCost,
            })
            .where(eq(productsTable.id, item.productId))
            .returning();
          if (!updated) continue;
          await tx.insert(stockMovementsTable).values({
            productId: item.productId,
            type: "purchase",
            quantity: item.quantity,
            stockAfter: updated.stock,
            reason: "採購進貨",
            refNo: po.poNo,
          });
        }

        await tx
          .update(purchaseOrdersTable)
          .set({ status: "received", receivedAt: new Date() })
          .where(eq(purchaseOrdersTable.id, id));
      });
    } catch (err) {
      if (err instanceof Error && err.message === "PO_NOT_FOUND") {
        res.status(404).json({ error: "找不到此採購單" });
        return;
      }
      if (err instanceof Error && err.message === "PO_BAD_STATUS") {
        res.status(400).json({ error: "只有「已下單」的採購單可以收貨" });
        return;
      }
      throw err;
    }

    res.json(await loadPO(id));
  },
);

export default router;
