import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  suppliersTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  productsTable,
  productVariantsTable,
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
import { requireOps } from "../middlewares/requireMember";

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
      variantId: i.variantId,
      variantName: i.variantName,
      productName: i.productName,
      productCode: i.productCode,
      unitCost: i.unitCost,
      quantity: i.quantity,
    })),
  };
}

// ---------- Suppliers ----------

router.get("/admin/suppliers", requireOps, async (req, res) => {
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

router.post("/admin/suppliers", requireOps, async (_req, res) => {
  res.status(410).json({ error: "供應商維護已移至 ERP（往來對象 › 供應商）" });
});

router.patch("/admin/suppliers/:id", requireOps, async (_req, res) => {
  res.status(410).json({ error: "供應商維護已移至 ERP（往來對象 › 供應商）" });
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

router.get("/admin/purchase-orders", requireOps, async (req, res) => {
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

router.post("/admin/purchase-orders", requireOps, async (_req, res) => {
  res.status(410).json({ error: "採購單開立已移至 ERP（採購 › 採購單）" });
});

router.patch("/admin/purchase-orders/:id/status", requireOps, async (_req, res) => {
  res.status(410).json({ error: "採購單狀態變更已移至 ERP（採購 › 採購單）" });
});

router.post("/admin/purchase-orders/:id/receive", requireOps, async (_req, res) => {
  res.status(410).json({ error: "採購收貨已移至 ERP（採購 › 採購收貨）" });
});

export default router;
