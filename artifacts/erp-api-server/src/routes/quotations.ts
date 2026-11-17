import { Router, type IRouter } from "express";
import { todayTaipei } from "../lib/inventory-journal";
import { eq, desc, sql, ilike } from "drizzle-orm";
import { db, quotationsTable, customersTable, salesOrdersTable, itemsTable, activitiesTable } from "@workspace/erp-db";

import { validateTemplateForProject } from "../lib/template-check";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { assertDeletableDraft } from "../lib/document-rules";
import { isLegacyDoc, LEGACY_DOC_READONLY_MESSAGE, readLegacyHeader, legacyImportError, keepLegacyFields } from "../lib/legacy";

/** 下一個報價單號。只看 QT 開頭的流水號，舊系統搬來的單號（EC-…）不算，否則會從 QT00001 重新開始而撞號 */
async function nextQuotationNumber(executor: any): Promise<string> {
  const result = await executor.execute(sql`SELECT COALESCE(MAX(SUBSTRING(quotation_number FROM 3)::integer), 0) AS last FROM quotations WHERE quotation_number ~ '^QT[0-9]{1,9}$'`);
  const rows: any[] = result?.rows ?? result ?? [];
  return `QT${String(Number(rows[0]?.last ?? 0) + 1).padStart(5, "0")}`;
}
const router: IRouter = Router();
router.use("/quotations", requireAuth);

router.get("/quotations", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: quotationsTable.id,
      quotationNumber: quotationsTable.quotationNumber,
      customerId: quotationsTable.customerId,
      customerName: quotationsTable.customerName,
      quotationDate: quotationsTable.quotationDate,
      validUntil: quotationsTable.validUntil,
      status: quotationsTable.status,
      totalAmount: quotationsTable.totalAmount,
      taxAmount: quotationsTable.taxAmount,
      taxIncluded: quotationsTable.taxIncluded,
      grandTotal: quotationsTable.grandTotal,
      template: quotationsTable.template,
      templateId: quotationsTable.templateId,
      extraFields: quotationsTable.extraFields,
      notes: quotationsTable.notes,
      terms: quotationsTable.terms,
      currency: quotationsTable.currency,
      exchangeRate: quotationsTable.exchangeRate,
      items: quotationsTable.items,
      brandId: quotationsTable.brandId,
      title: quotationsTable.title,
      quoterName: quotationsTable.quoterName,
      quoterPhone: quotationsTable.quoterPhone,
      projectId: quotationsTable.projectId,
      departmentId: quotationsTable.departmentId,
      createdAt: quotationsTable.createdAt,
    })
    .from(quotationsTable)
    .orderBy(desc(quotationsTable.quotationDate), desc(quotationsTable.id));
  res.json(rows.map(row => {
    const exchangeRate = Number(row.exchangeRate) || 1;
    return {
      ...row,
      exchangeRate,
      totalAmountTWD: Math.round(Number(row.totalAmount) * exchangeRate * 100) / 100,
      grandTotalTWD: Math.round(Number(row.grandTotal) * exchangeRate * 100) / 100,
    };
  }));
});

router.post("/quotations", async (req, res): Promise<void> => {
  const { customerId, customerName, quotationDate, validUntil, status, totalAmount, taxAmount, grandTotal, notes, terms, items, projectId, departmentId, currency, exchangeRate } = req.body;

  const tplErr = await validateTemplateForProject(req.body.templateId, projectId, req.body.extraFields ?? {});
  if (tplErr) { res.status(400).json({ error: tplErr }); return; }

  const quotationNumber = await nextQuotationNumber(db);

  const [row] = await db.insert(quotationsTable).values({
    quotationNumber,
    customerId: customerId || null,
    customerName: customerName || null,
    quotationDate: quotationDate || todayTaipei(),
    validUntil: validUntil || null,
    status: status || "Draft",
    totalAmount: String(totalAmount || 0),
    taxAmount: String(taxAmount || 0),
    taxIncluded: req.body.taxIncluded === true,
    grandTotal: String(grandTotal || 0),
    template: req.body.template || null,
    templateId: req.body.templateId ? Number(req.body.templateId) : null,
    extraFields: req.body.extraFields || {},
    notes: notes || null,
    terms: terms || null,
    currency: currency || "TWD",
    exchangeRate: String(exchangeRate || 1),
    items: items || [],
    brandId: req.body.brandId || null,
    title: req.body.title || null,
    quoterName: req.body.quoterName || null,
    quoterPhone: req.body.quoterPhone || null,
    projectId: projectId || null,
    departmentId: departmentId || null,
  }).returning();

  res.status(201).json(row);
});

// 交易式端點：同一資料庫交易內建立（或沿用）客戶 + 建立報價單，任一步失敗全部回滾
router.post("/quotations/with-customer", async (req, res): Promise<void> => {
  const { customerId, newCustomer, quotation } = req.body || {};

  if (!quotation || typeof quotation !== "object") {
    res.status(400).json({ error: "quotation 為必填" }); return;
  }
  const hasNewCustomer = newCustomer && typeof newCustomer === "object" && String(newCustomer.name || "").trim();
  if (!customerId && !hasNewCustomer) {
    res.status(400).json({ error: "請提供 customerId 或 newCustomer.name" }); return;
  }

  // 報價單基本驗證（避免建了客戶才發現報價單無效）
  const items = Array.isArray(quotation.items) ? quotation.items : [];
  if (items.length === 0) { res.status(400).json({ error: "報價單至少需要一個品項" }); return; }
  for (const it of items) {
    const qty = Number(it?.qty);
    const unitPrice = Number(it?.unitPrice);
    if (!String(it?.name || "").trim() || !(qty > 0) || !(unitPrice >= 0)) {
      res.status(400).json({ error: "品項需有名稱、數量大於 0、單價不小於 0" }); return;
    }
  }
  if (quotation.quotationDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(quotation.quotationDate))) {
    res.status(400).json({ error: "日期格式不正確（YYYY-MM-DD）" }); return;
  }

  const tplErr = await validateTemplateForProject(quotation.templateId, quotation.projectId, quotation.extraFields ?? {});
  if (tplErr) { res.status(400).json({ error: tplErr }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      // 1) 解析客戶：既有 ID → 驗證存在；否則以名稱比對沿用，找不到才新建
      let custRow: { id: number; name: string };
      let customerCreated = false;

      if (customerId) {
        const [existing] = await tx.select({ id: customersTable.id, name: customersTable.name })
          .from(customersTable).where(eq(customersTable.id, Number(customerId))).limit(1);
        if (!existing) throw Object.assign(new Error("找不到指定的客戶"), { statusCode: 400 });
        custRow = existing;
      } else {
        const name = String(newCustomer.name).trim();
        const [dup] = await tx.select({ id: customersTable.id, name: customersTable.name })
          .from(customersTable).where(ilike(customersTable.name, name)).limit(1);
        if (dup) {
          custRow = dup; // 同名客戶已存在：沿用，不重複建立
        } else {
          const [created] = await tx.insert(customersTable).values({
            name,
            contactPerson: String(newCustomer.contactPerson || "").trim() || null,
            email: String(newCustomer.email || "").trim() || null,
            phone: String(newCustomer.phone || "").trim() || null,
            taxId: String(newCustomer.taxId || "").trim() || null,
          }).returning({ id: customersTable.id, name: customersTable.name });
          custRow = created;
          customerCreated = true;
          await tx.insert(activitiesTable).values({ type: "create", title: "New Customer", description: `${name} added as customer`, module: "Sales" });
        }
      }

      // 2) 產生單號並建立報價單（與客戶同一交易）
      const quotationNumber = await nextQuotationNumber(tx);

      const [qRow] = await tx.insert(quotationsTable).values({
        quotationNumber,
        customerId: custRow.id,
        customerName: custRow.name,
        quotationDate: quotation.quotationDate || todayTaipei(),
        validUntil: quotation.validUntil || null,
        status: quotation.status || "Draft",
        totalAmount: String(quotation.totalAmount || 0),
        taxAmount: String(quotation.taxAmount || 0),
        taxIncluded: quotation.taxIncluded === true,
        grandTotal: String(quotation.grandTotal || 0),
        template: quotation.template || "校園",
        templateId: quotation.templateId ? Number(quotation.templateId) : null,
        extraFields: quotation.extraFields || {},
        notes: quotation.notes || null,
        terms: quotation.terms || null,
        currency: quotation.currency || "TWD",
        exchangeRate: String(quotation.exchangeRate || 1),
        items,
        brandId: quotation.brandId || null,
        title: quotation.title || null,
        quoterName: quotation.quoterName || null,
        quoterPhone: quotation.quoterPhone || null,
        projectId: quotation.projectId || null,
        departmentId: quotation.departmentId || null,
      }).returning();

      return { quotation: qRow, customer: custRow, customerCreated };
    });

    res.status(201).json(result);
  } catch (e: any) {
    if (e?.statusCode === 400) { res.status(400).json({ error: e.message }); return; }
    throw e;
  }
});

/**
 * 把舊系統（Ecount）的報價單併進報價單。歷史單只能查看：不能改、不能刪、不能轉銷貨單。
 * 單號重複的會跳過，所以可以重跑。
 */
router.post("/quotations/legacy-import", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const documents: any[] = Array.isArray(req.body?.documents) ? req.body.documents : [];
  if (documents.length === 0 || documents.length > 500) { res.status(400).json({ error: "一次請送 1 到 500 張" }); return; }
  const values = [];
  for (const [index, d] of documents.entries()) {
    const h = readLegacyHeader(d, index, "customerId");
    if (typeof h === "string") { res.status(400).json({ error: h }); return; }
    values.push({
      quotationNumber: h.number, customerId: h.partyId, customerName: String(d.customerName ?? "").slice(0, 200) || null,
      quotationDate: h.date, validUntil: /^\d{4}-\d{2}-\d{2}$/.test(String(d.validUntil || "")) ? String(d.validUntil) : null,
      status: "Sent", totalAmount: String(h.total), taxAmount: "0", taxIncluded: true, grandTotal: String(h.total),
      extraFields: h.extraFields, notes: h.remarks, title: h.title, quoterName: h.staff || null,
      items: h.lines.map((line: any) => ({
        code: String(line?.code ?? "").slice(0, 60), name: String(line?.name ?? "").slice(0, 300), qty: Number(line?.qty) || 0, unit: String(line?.unit ?? "").slice(0, 20),
        unitPrice: Number(line?.unitPrice) || 0, amount: Math.round((Number(line?.amount) || 0) * 100) / 100, summary: String(line?.summary ?? "").slice(0, 500),
      })),
      projectId: h.projectId, departmentId: h.departmentId, createdAt: h.createdAt,
    });
  }
  try {
    const inserted = await db.insert(quotationsTable).values(values as any).onConflictDoNothing().returning({ id: quotationsTable.id });
    res.status(201).json({ inserted: inserted.length, skipped: values.length - inserted.length });
  } catch (err: any) {
    res.status(400).json({ error: legacyImportError(err) });
  }
});

router.get("/quotations/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "報價單編號格式不正確" }); return; }
  const [row] = await db.select().from(quotationsTable).where(eq(quotationsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "找不到報價單" }); return; }
  res.json(row);
});

router.patch("/quotations/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "報價單編號格式不正確" }); return; }

  const [legacyCheck] = await db.select({ extraFields: quotationsTable.extraFields }).from(quotationsTable).where(eq(quotationsTable.id, id));
  const legacyQuotation = !!legacyCheck && isLegacyDoc(legacyCheck.extraFields);
  // 歷史報價單不能改成「已轉單」（它沒有對應的新銷貨單）
  if (legacyQuotation && req.body.status === "Converted") { res.status(400).json({ error: "歷史報價單不能標成已轉單" }); return; }

  if (req.body.templateId !== undefined || req.body.projectId !== undefined) {
    const [existing] = await db
      .select({ templateId: quotationsTable.templateId, projectId: quotationsTable.projectId })
      .from(quotationsTable).where(eq(quotationsTable.id, id));
    if (!existing) { res.status(404).json({ error: "找不到報價單" }); return; }
    const finalTpl = req.body.templateId !== undefined ? req.body.templateId : existing.templateId;
    const finalProj = req.body.projectId !== undefined ? req.body.projectId : existing.projectId;
    const tplErr = await validateTemplateForProject(finalTpl, finalProj);
    if (tplErr) { res.status(400).json({ error: tplErr }); return; }
  }

  const updates: Record<string, unknown> = {};
  const fields = ["customerId", "customerName", "quotationDate", "validUntil", "status", "totalAmount", "taxAmount", "grandTotal", "template", "templateId", "extraFields", "notes", "terms", "items", "projectId", "departmentId", "currency", "exchangeRate", "brandId", "title", "quoterName", "quoterPhone", "taxIncluded"];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      if (["totalAmount", "taxAmount", "grandTotal"].includes(f)) {
        updates[f] = String(req.body[f]);
      } else {
        updates[f] = req.body[f];
      }
    }
  }

  // 歷史單的標記要留著，不能被畫面送來的額外欄位蓋掉
  if (legacyQuotation && updates.extraFields !== undefined) updates.extraFields = keepLegacyFields(legacyCheck!.extraFields, updates.extraFields);
  const [row] = await db.update(quotationsTable).set(updates).where(eq(quotationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "找不到報價單" }); return; }
  res.json(row);
});

router.delete("/quotations/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "報價單編號格式不正確" }); return; }
  const [existing] = await db.select({ status: quotationsTable.status, extraFields: quotationsTable.extraFields }).from(quotationsTable).where(eq(quotationsTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到報價單" }); return; }
  if (isLegacyDoc(existing.extraFields)) { res.status(400).json({ error: LEGACY_DOC_READONLY_MESSAGE }); return; }
  try {
    assertDeletableDraft("報價單", existing.status, "已拒絕或已過期");
  } catch (err: any) {
    res.status(400).json({ error: err.message }); return;
  }
  const [row] = await db.delete(quotationsTable).where(eq(quotationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "找不到報價單" }); return; }
  res.sendStatus(204);
});

router.post("/quotations/:id/convert-to-sales-order", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "報價單編號格式不正確" }); return; }
  const [quotation] = await db.select().from(quotationsTable).where(eq(quotationsTable.id, id)).limit(1);
  if (!quotation) { res.status(404).json({ error: "找不到報價單" }); return; }
  if (isLegacyDoc(quotation.extraFields)) { res.status(400).json({ error: LEGACY_DOC_READONLY_MESSAGE }); return; }
  if (quotation.status === "Converted") { res.status(409).json({ error: "此報價單已轉換為銷售訂單" }); return; }
  if (quotation.status !== "Accepted") {
    res.status(400).json({ error: `只有「已接受」的報價單可以轉成銷貨單（目前狀態：${quotation.status}）。請先把報價單狀態改為已接受` }); return;
  }
  if (!quotation.customerId) { res.status(400).json({ error: "報價單尚未選擇客戶，請先編輯報價單選擇客戶後再轉單" }); return; }

  const quotItems = Array.isArray(quotation.items) ? (quotation.items as any[]) : [];
  const validItems = quotItems.filter((it) => it.name);
  if (validItems.length === 0) { res.status(400).json({ error: "報價單沒有品項，無法轉換" }); return; }

  const orderItems: Array<{ itemId: number | null; itemName: string; quantity: number; rate: number; amount: number; unit: string | null; summary: string | null }> = [];
  for (const it of validItems) {
    let itemId: number | null = null;
    if (it.code) {
      const [dbItem] = await db.select({ id: itemsTable.id }).from(itemsTable).where(eq(itemsTable.itemCode, it.code)).limit(1);
      itemId = dbItem?.id ?? null;
    }
    if (itemId == null && it.name) {
      // 沒填代碼或代碼對不到時，用品名對回品項主檔；只有剛好一筆同名才採用，避免連錯品項
      const sameName = await db.select({ id: itemsTable.id }).from(itemsTable).where(eq(itemsTable.itemName, String(it.name).trim())).limit(2);
      if (sameName.length === 1) itemId = sameName[0].id;
    }
    const quantity = Number(it.qty) || 1;
    const rate = Number(it.unitPrice) || 0;
    orderItems.push({
      itemId,
      itemName: it.name,
      quantity,
      rate,
      amount: Number(it.amount) || quantity * rate,
      unit: it.unit || null,
      summary: it.summary || null,
    });
  }

  const order = await db.transaction(async (tx) => {
    const claimed = await tx.update(quotationsTable)
      .set({ status: "Converted" })
      .where(sql`${quotationsTable.id} = ${id} AND ${quotationsTable.status} = 'Accepted'`)
      .returning({ id: quotationsTable.id });
    if (claimed.length === 0) return null;

    const [created] = await tx.insert(salesOrdersTable).values({
      orderNumber: "SO-" + String(Date.now()).slice(-8),
      customerId: quotation.customerId!,
      orderDate: todayTaipei(),
      status: "Draft",
      totalAmount: String(quotation.grandTotal ?? 0),
      items: orderItems,
      departmentId: quotation.departmentId,
      projectId: quotation.projectId,
      orderSource: "quotation",
      quotationId: quotation.id,
      templateId: quotation.templateId,
      extraFields: quotation.extraFields || {},
      remarks: quotation.notes || null,
    }).returning();
    return created;
  });

  if (!order) { res.status(409).json({ error: "此報價單已轉換為銷售訂單" }); return; }

  const [cust] = await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, quotation.customerId));
  await db.insert(activitiesTable).values({
    type: "create",
    title: "報價單轉銷售訂單",
    description: `${quotation.quotationNumber} → ${order.orderNumber}（${cust?.name || "客戶"}）`,
    module: "Sales",
  });

  res.status(201).json({
    message: `已建立銷售訂單 ${order.orderNumber}`,
    order,
  });
});

export default router;
