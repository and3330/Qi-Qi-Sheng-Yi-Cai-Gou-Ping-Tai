import { Router, type IRouter } from "express";
import {
  customersTable,
  db,
  invoicesTable,
  itemsTable,
  projectsTable,
  purchaseOrdersTable,
  quotationsTable,
  salesOrdersTable,
  suppliersTable,
} from "@workspace/erp-db";
import { desc, ilike, or } from "drizzle-orm";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();

interface SearchResult {
  type: string;
  id: number;
  title: string;
  subtitle: string;
  link: string;
}

router.get("/search", requireAuth, async (req, res): Promise<void> => {
  const query = String(req.query.q ?? "").trim();
  if (query.length < 2) {
    res.status(400).json({ error: "搜尋關鍵字至少需要 2 個字元" });
    return;
  }
  if (query.length > 200) {
    res.status(400).json({ error: "搜尋關鍵字不可超過 200 個字元" });
    return;
  }

  const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;

  try {
    const [customers, suppliers, items, salesOrders, quotations, purchaseOrders, invoices, projects] =
      await Promise.all([
        db.select({
          id: customersTable.id,
          code: customersTable.customerCode,
          name: customersTable.name,
          contact: customersTable.contactPerson,
        })
          .from(customersTable)
          .where(or(ilike(customersTable.name, pattern), ilike(customersTable.customerCode, pattern)))
          .orderBy(desc(customersTable.id))
          .limit(5),
        db.select({
          id: suppliersTable.id,
          code: suppliersTable.supplierCode,
          name: suppliersTable.name,
          contact: suppliersTable.contactPerson,
        })
          .from(suppliersTable)
          .where(or(ilike(suppliersTable.name, pattern), ilike(suppliersTable.supplierCode, pattern)))
          .orderBy(desc(suppliersTable.id))
          .limit(5),
        db.select({
          id: itemsTable.id,
          code: itemsTable.itemCode,
          name: itemsTable.itemName,
          group: itemsTable.itemGroup,
        })
          .from(itemsTable)
          .where(or(ilike(itemsTable.itemName, pattern), ilike(itemsTable.itemCode, pattern)))
          .orderBy(desc(itemsTable.id))
          .limit(5),
        db.select({
          id: salesOrdersTable.id,
          number: salesOrdersTable.orderNumber,
          date: salesOrdersTable.orderDate,
          status: salesOrdersTable.status,
        })
          .from(salesOrdersTable)
          .where(ilike(salesOrdersTable.orderNumber, pattern))
          .orderBy(desc(salesOrdersTable.id))
          .limit(5),
        db.select({
          id: quotationsTable.id,
          number: quotationsTable.quotationNumber,
          customer: quotationsTable.customerName,
          status: quotationsTable.status,
        })
          .from(quotationsTable)
          .where(ilike(quotationsTable.quotationNumber, pattern))
          .orderBy(desc(quotationsTable.id))
          .limit(5),
        db.select({
          id: purchaseOrdersTable.id,
          number: purchaseOrdersTable.orderNumber,
          date: purchaseOrdersTable.orderDate,
          status: purchaseOrdersTable.status,
        })
          .from(purchaseOrdersTable)
          .where(ilike(purchaseOrdersTable.orderNumber, pattern))
          .orderBy(desc(purchaseOrdersTable.id))
          .limit(5),
        db.select({
          id: invoicesTable.id,
          number: invoicesTable.invoiceNumber,
          governmentNumber: invoicesTable.govInvoiceNumber,
          date: invoicesTable.invoiceDate,
          status: invoicesTable.status,
        })
          .from(invoicesTable)
          .where(or(
            ilike(invoicesTable.invoiceNumber, pattern),
            ilike(invoicesTable.govInvoiceNumber, pattern),
          ))
          .orderBy(desc(invoicesTable.id))
          .limit(5),
        db.select({
          id: projectsTable.id,
          name: projectsTable.name,
          status: projectsTable.status,
          description: projectsTable.description,
        })
          .from(projectsTable)
          .where(ilike(projectsTable.name, pattern))
          .orderBy(desc(projectsTable.id))
          .limit(5),
      ]);

    const grouped: Record<string, SearchResult[]> = {
      customers: customers.map((row) => ({
        type: "customer",
        id: row.id,
        title: row.name,
        subtitle: [row.code, row.contact].filter(Boolean).join(" · "),
        link: `/sales/customers?id=${row.id}`,
      })),
      suppliers: suppliers.map((row) => ({
        type: "supplier",
        id: row.id,
        title: row.name,
        subtitle: [row.code, row.contact].filter(Boolean).join(" · "),
        link: `/purchasing/suppliers?id=${row.id}`,
      })),
      items: items.map((row) => ({
        type: "item",
        id: row.id,
        title: row.name,
        subtitle: [row.code, row.group].filter(Boolean).join(" · "),
        link: `/inventory/items?id=${row.id}`,
      })),
      salesOrders: salesOrders.map((row) => ({
        type: "salesOrder",
        id: row.id,
        title: row.number,
        subtitle: [row.date, row.status].join(" · "),
        link: `/sales/orders/${row.id}`,
      })),
      quotations: quotations.map((row) => ({
        type: "quotation",
        id: row.id,
        title: row.number,
        subtitle: [row.customer, row.status].filter(Boolean).join(" · "),
        link: `/sales/quotations?id=${row.id}`,
      })),
      purchaseOrders: purchaseOrders.map((row) => ({
        type: "purchaseOrder",
        id: row.id,
        title: row.number,
        subtitle: [row.date, row.status].join(" · "),
        link: `/purchasing/orders/${row.id}`,
      })),
      invoices: invoices.map((row) => ({
        type: "invoice",
        id: row.id,
        title: row.number,
        subtitle: [row.governmentNumber && `發票號碼 ${row.governmentNumber}`, row.date, row.status]
          .filter(Boolean).join(" · "),
        link: `/sales/invoices?id=${row.id}`,
      })),
      projects: projects.map((row) => ({
        type: "project",
        id: row.id,
        title: row.name,
        subtitle: [row.status, row.description].filter(Boolean).join(" · "),
        link: `/projects?id=${row.id}`,
      })),
    };

    res.json(grouped);
  } catch (error) {
    (req as any).log?.error({ err: error }, "global search failed");
    res.status(500).json({ error: "搜尋失敗，請稍後再試" });
  }
});

export default router;