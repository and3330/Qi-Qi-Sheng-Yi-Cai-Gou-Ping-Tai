import { Router } from "express";
import { isPlatformAdmin } from "./insurance-brackets";
import { pgErrorCode } from "../lib/pg-error";
import { db } from "@workspace/erp-db";
import { eq, inArray, sql } from "drizzle-orm";
import {
  employeesTable, teachersTable, departmentsTable, customersTable, suppliersTable,
  itemsTable, warehousesTable, stockEntriesTable, salesOrdersTable, purchaseOrdersTable,
  leadsTable, opportunitiesTable, projectsTable, tasksTable, accountsTable,
  journalEntriesTable, invoicesTable, designationsTable, gradesTable,
  insuranceBracketsTable, shiftTypesTable, salarySlipsTable, vouchersTable,
  quotationsTable, deliveryNotesTable, purchaseReceiptsTable, salesReturnsTable,
  purchaseReturnsTable, paymentRequestsTable, priceListsTable,
  assetCategoriesTable, assetsTable, assetMaintenanceTable, assetDepreciationEntriesTable,
  workstationsTable, bomsTable, workOrdersTable, jobCardsTable,
  qualityInspectionsTable, nonConformanceReportsTable, capaActionsTable,
  supportTicketsTable, kbArticlesTable, contractsTable,
  approvalWorkflowsTable, currenciesTable, calendarEventsTable,
  attendanceTable, slaDefinitionsTable,
  qualityInspectionTemplatesTable, attachmentsTable,
  itemCategoriesTable, itemTypesTable, orderTemplatesTable,
} from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";
import { batchDeleteRule, batchRoleError, batchUpdateError, isDraftStatus } from "../lib/batch-policy";

const actorOf = (req: any) => ({
  role: req.session?.user?.role ?? null,
  apiKey: !!req.apiKeyAuth,
  apiKeyPermissions: req.apiKey?.permissions ?? null,
});

const router = Router();
router.use("/batch", requireAuth);

const BATCH_REFERENCE_FIELDS = new Set(["projectId", "assignedTo", "categoryId", "departmentId", "defaultUsefulLifeYears", "templateId", "handlerId", "parentId"]);
const entityMap: Record<string, { table: any; label: string; allowedFields?: string[] }> = {
  employees: { table: employeesTable, label: "員工", allowedFields: ["departmentId", "designation"] },
  teachers: { table: teachersTable, label: "老師", allowedFields: ["status", "position", "phone", "email"] },
  departments: { table: departmentsTable, label: "部門", allowedFields: ["name", "description"] },
  customers: { table: customersTable, label: "客戶", allowedFields: ["status", "customerGroup", "territory", "currency"] },
  suppliers: { table: suppliersTable, label: "供應商", allowedFields: ["status", "supplierGroup", "currency"] },
  items: { table: itemsTable, label: "品項", allowedFields: ["status", "itemGroup", "itemType", "unit", "stockUom", "defaultWarehouse", "supplierName"] },
  warehouses: { table: warehousesTable, label: "倉庫", allowedFields: ["status", "type"] },
  "stock-entries": { table: stockEntriesTable, label: "庫存異動", allowedFields: [] },
  "sales-orders": { table: salesOrdersTable, label: "銷貨單", allowedFields: ["status", "label", "templateId", "handlerId"] },
  "purchase-orders": { table: purchaseOrdersTable, label: "採購單", allowedFields: ["status"] },
  leads: { table: leadsTable, label: "潛在客戶", allowedFields: ["status", "source", "priority"] },
  opportunities: { table: opportunitiesTable, label: "商機", allowedFields: ["status", "stage", "probability"] },
  projects: { table: projectsTable, label: "專案", allowedFields: ["status", "priority", "departmentId", "parentId"] },
  tasks: { table: tasksTable, label: "任務", allowedFields: ["status", "priority", "projectId", "assignedTo", "dueDate", "taskGroup"] },
  accounts: { table: accountsTable, label: "科目", allowedFields: [] },
  "journal-entries": { table: journalEntriesTable, label: "分錄", allowedFields: ["status"] },
  invoices: { table: invoicesTable, label: "發票", allowedFields: ["status"] },
  designations: { table: designationsTable, label: "職稱", allowedFields: ["name"] },
  grades: { table: gradesTable, label: "職等", allowedFields: ["name"] },
  "insurance-brackets": { table: insuranceBracketsTable, label: "投保級距", allowedFields: [] },
  "shift-types": { table: shiftTypesTable, label: "班制", allowedFields: ["name"] },
  "salary-slips": { table: salarySlipsTable, label: "薪資單", allowedFields: ["status"] },
  vouchers: { table: vouchersTable, label: "傳票", allowedFields: ["status"] },
  quotations: { table: quotationsTable, label: "報價單", allowedFields: ["status"] },
  "delivery-notes": { table: deliveryNotesTable, label: "送貨單", allowedFields: ["status"] },
  "purchase-receipts": { table: purchaseReceiptsTable, label: "進貨單", allowedFields: ["status"] },
  // 退貨單狀態流轉會連動庫存/折讓單/分錄，禁止批次修改狀態，僅允許批次刪除草稿（delete 端點另有狀態檢查）
  "sales-returns": { table: salesReturnsTable, label: "銷售退貨", allowedFields: [] },
  "purchase-returns": { table: purchaseReturnsTable, label: "採購退貨", allowedFields: [] },
  "payment-requests": { table: paymentRequestsTable, label: "付款申請", allowedFields: ["status"] },
  "price-lists": { table: priceListsTable, label: "價目表", allowedFields: ["status", "currency"] },
  "order-templates": { table: orderTemplatesTable, label: "訂單模板", allowedFields: ["businessType", "isActive"] },
  "asset-categories": { table: assetCategoriesTable, label: "資產類別", allowedFields: ["name", "depreciationMethod", "defaultUsefulLifeYears", "description"] },
  "item-categories": { table: itemCategoriesTable, label: "品項分類", allowedFields: ["description"] },
  "item-types": { table: itemTypesTable, label: "品項類型", allowedFields: ["label", "colorClass", "description"] },
  assets: { table: assetsTable, label: "資產", allowedFields: ["status", "location", "categoryId", "assignedTo", "warrantyExpiry", "remarks"] },
  "asset-maintenance": { table: assetMaintenanceTable, label: "資產維護", allowedFields: ["status", "maintenanceType", "scheduledDate", "vendor", "remarks"] },
  "asset-depreciation": { table: assetDepreciationEntriesTable, label: "資產折舊", allowedFields: [] },
  workstations: { table: workstationsTable, label: "工作站", allowedFields: ["status", "productionCapacity", "hourRate", "description"] },
  boms: { table: bomsTable, label: "BOM", allowedFields: ["status"] },
  "work-orders": { table: workOrdersTable, label: "工單", allowedFields: ["status", "priority"] },
  "job-cards": { table: jobCardsTable, label: "工作卡", allowedFields: ["status"] },
  "quality-inspections": { table: qualityInspectionsTable, label: "品檢", allowedFields: ["status"] },
  "quality-templates": { table: qualityInspectionTemplatesTable, label: "品檢模板", allowedFields: [] },
  "non-conformance": { table: nonConformanceReportsTable, label: "不合格", allowedFields: ["status"] },
  capa: { table: capaActionsTable, label: "CAPA", allowedFields: ["status"] },
  "support-tickets": { table: supportTicketsTable, label: "工單", allowedFields: ["status", "priority"] },
  "kb-articles": { table: kbArticlesTable, label: "知識庫", allowedFields: ["status"] },
  contracts: { table: contractsTable, label: "合約", allowedFields: ["status"] },
  sla: { table: slaDefinitionsTable, label: "SLA", allowedFields: [] },
  "approval-workflows": { table: approvalWorkflowsTable, label: "審批流程", allowedFields: ["status"] },
  currencies: { table: currenciesTable, label: "幣別", allowedFields: ["enabled"] },
  "calendar-events": { table: calendarEventsTable, label: "行事曆", allowedFields: [] },
  attendance: { table: attendanceTable, label: "出勤", allowedFields: ["status"] },
  attachments: { table: attachmentsTable, label: "檔案", allowedFields: ["status", "module", "documentType", "tags"] },
};

router.post("/batch/:entity/delete", async (req, res): Promise<void> => {
  const { entity } = req.params;
  const config = entityMap[entity];
  if (!config) {
    res.status(404).json({ error: `Unknown entity: ${entity}` });
    return;
  }
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }
  const numIds = ids.map((id: any) => Number(id)).filter((id: number) => !isNaN(id));
  if (numIds.length === 0) {
    res.status(400).json({ error: "No valid ids provided" });
    return;
  }
  try {
    if (entity === "insurance-brackets" && !isPlatformAdmin(req)) {
      res.status(403).json({ error: "投保級距為全系統共用的法定資料，僅平台管理員可以維護" });
      return;
    }
    const roleError = batchRoleError(entity, actorOf(req));
    if (roleError) { res.status(403).json({ error: roleError }); return; }
    const rule = batchDeleteRule(entity);
    if (rule.kind === "forbidden") { res.status(400).json({ error: rule.message }); return; }
    const legacyInDelete = await legacyCount(entity, numIds);
    if (legacyInDelete > 0) { res.status(400).json({ error: LEGACY_BATCH_MESSAGE(legacyInDelete) }); return; }
    if (entity === "accounts") {
      // 已有分錄使用、或底下還有子科目的會計科目不能刪，否則報表會對不到科目
      const used = await db.execute(sql`
        SELECT a.id FROM accounts a
        WHERE a.id IN (${sql.join(numIds.map(id => sql`${id}`), sql`, `)})
          AND (
            EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = a.id)
            OR EXISTS (
              SELECT 1 FROM journal_entries je,
                jsonb_array_elements(CASE WHEN jsonb_typeof(je.lines) = 'array' THEN je.lines ELSE '[]'::jsonb END) AS l
              WHERE CASE WHEN (l->>'accountId') ~ '^[0-9]+$' THEN (l->>'accountId')::int END = a.id
            )
          )
      `);
      const usedIds = new Set<number>(((used as any).rows ?? used).map((r: any) => Number(r.id)));
      const free = numIds.filter(id => !usedIds.has(id));
      let removed = 0;
      for (const id of free) {
        try { await db.delete(accountsTable).where(eq(accountsTable.id, id)); removed++; } catch { usedIds.add(id); }
      }
      res.json({
        success: true,
        deleted: removed,
        ...(usedIds.size ? { blocked: Array.from(usedIds), error: `${usedIds.size} 個科目已有分錄使用或仍有子科目，不能刪除（可改為停用）` } : {}),
      });
      return;
    }
    if (entity === "item-categories") {
      const cats = await db.select().from(itemCategoriesTable).where(inArray(itemCategoriesTable.id, numIds));
      const deletable: number[] = [];
      const blocked: { name: string; count: number }[] = [];
      for (const cat of cats) {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(itemsTable)
          .where(eq(itemsTable.itemGroup, cat.name));
        if (count > 0) blocked.push({ name: cat.name, count });
        else deletable.push(cat.id);
      }
      if (deletable.length) await db.delete(itemCategoriesTable).where(inArray(itemCategoriesTable.id, deletable));
      res.json({
        success: true,
        deleted: deletable.length,
        ...(blocked.length ? { blocked, error: `${blocked.length} 個分類仍有品項使用，已略過：${blocked.map(b => `${b.name}(${b.count})`).join("、")}` } : {}),
      });
      return;
    }
    let deleted = 0;
    const blocked: (number | string)[] = [];
    let lastErr: string | null = null;
    // 退貨單確認後會連動庫存/折讓單/分錄，批次刪除僅允許草稿（與單筆刪除規則一致）
    let deletableIds = numIds;
    if (rule.kind === "draft-only") {
      const table = config.table as typeof salesReturnsTable;
      const rows = await db.select({ id: table.id, status: table.status }).from(table).where(inArray(table.id, numIds));
      const draftIds = new Set(rows.filter((r: any) => isDraftStatus(r.status)).map((r: any) => r.id));
      for (const id of numIds) {
        if (!draftIds.has(id)) { blocked.push(id); lastErr = `只能刪除草稿狀態的${config.label}，已確認的單據請先作廢`; }
      }
      deletableIds = numIds.filter((id) => draftIds.has(id));
    }
    for (const id of deletableIds) {
      try {
        await db.delete(config.table).where(eq(config.table.id, id));
        deleted++;
      } catch (e: any) {
        if (pgErrorCode(e) === "23503") {
          blocked.push(id);
        } else {
          lastErr = e?.message || "Delete failed";
          blocked.push(id);
        }
      }
    }
    res.json({
      success: true,
      deleted,
      ...(blocked.length
        ? { blocked, error: lastErr && rule.kind === "draft-only" ? `${blocked.length} 筆無法刪除：${lastErr}` : `${blocked.length} 筆${config.label}因仍被其他資料參照而無法刪除${lastErr ? `（${lastErr}）` : ""}` }
        : {}),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Delete failed" });
  }
});

/** 這批資料裡有幾筆是舊系統搬來的歷史單（歷史單只能查看，批次端點也不能繞過） */
async function legacyCount(entity: string, ids: number[]): Promise<number> {
  const condition: Record<string, ReturnType<typeof sql>> = {
    "sales-orders": sql`order_source = 'ecount'`,
    quotations: sql`extra_fields->>'legacy' = 'true'`,
    "purchase-orders": sql`extra_fields->>'legacy' = 'true'`,
    "purchase-receipts": sql`extra_fields->>'legacy' = 'true'`,
    vouchers: sql`items @> '[{"legacy": true}]'::jsonb`,
  };
  const table: Record<string, string> = { "sales-orders": "sales_orders", quotations: "quotations", "purchase-orders": "purchase_orders", "purchase-receipts": "purchase_receipts", vouchers: "vouchers" };
  if (!condition[entity] || ids.length === 0) return 0;
  const result = await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(table[entity])} WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) AND ${condition[entity]}`);
  return Number((((result as any).rows ?? result) as Array<{ n: number }>)[0]?.n) || 0;
}
const LEGACY_BATCH_MESSAGE = (n: number) => `選到的資料裡有 ${n} 筆是從舊系統（Ecount）搬過來的歷史單，歷史單不能刪除，請取消勾選後再操作`;

router.post("/batch/:entity/update", async (req, res): Promise<void> => {
  const { entity } = req.params;
  const config = entityMap[entity];
  if (!config) {
    res.status(404).json({ error: `Unknown entity: ${entity}` });
    return;
  }
  const { ids, updates } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }
  if (!updates || typeof updates !== "object") {
    res.status(400).json({ error: "updates object is required" });
    return;
  }
  const numIds = ids.map((id: any) => Number(id)).filter((id: number) => !isNaN(id));
  if (numIds.length === 0) {
    res.status(400).json({ error: "No valid ids provided" });
    return;
  }
  const roleError = batchRoleError(entity, actorOf(req));
  if (roleError) { res.status(403).json({ error: roleError }); return; }
  const updateError = batchUpdateError(entity, config.label, Object.keys(updates));
  if (updateError) { res.status(400).json({ error: updateError }); return; }
  // 歷史單可以批次改的只有不影響帳的欄位：報價單的狀態、銷貨單的標題。其餘（進貨、採購、收款的狀態）本來就被上面的規則鎖住
  if (entity === "quotations" && updates.status === "Converted" && (await legacyCount(entity, numIds)) > 0) { res.status(400).json({ error: "選到的資料裡有歷史報價單，歷史報價單不能標成已轉單" }); return; }
  const allowedFields = config.allowedFields || [];
  const setData: Record<string, any> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      // 關聯欄位（專案、負責人、類別、部門）傳進來是文字，轉成數字；清空就是 null
      if (BATCH_REFERENCE_FIELDS.has(key)) {
        if (value === null || value === "") { setData[key] = null; continue; }
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) { res.status(400).json({ error: "選擇的項目不正確" }); return; }
        setData[key] = n;
        continue;
      }
      setData[key] = key === "isActive" ? value === true || value === "true" : value;
    }
  }
  if (Object.keys(setData).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  // 批次改分類（模板）：只能套啟用中、不限定專案的模板
  if (setData.templateId != null) {
    const found = await db.execute(sql`SELECT is_active, project_id FROM order_templates WHERE id = ${setData.templateId} AND tenant_id = current_setting('app.tenant_id')::int`);
    const tpl = (((found as any).rows ?? found) as Array<{ is_active: boolean; project_id: number | null }>)[0];
    if (!tpl) { res.status(400).json({ error: "找不到這個模板" }); return; }
    if (!tpl.is_active) { res.status(400).json({ error: "這個模板已停用" }); return; }
    if (tpl.project_id != null) { res.status(400).json({ error: "這是專案專屬模板，請逐筆在單據裡套用" }); return; }
  }
  // 批次移動專案：只能掛到第一層的主專案底下；自己底下已有子專案的不能再被掛
  if (entity === "projects" && setData.parentId != null) {
    if (numIds.includes(setData.parentId)) { res.status(400).json({ error: "專案不能掛在自己底下" }); return; }
    const [target] = await db.select({ id: projectsTable.id, parentId: projectsTable.parentId }).from(projectsTable).where(eq(projectsTable.id, setData.parentId));
    if (!target) { res.status(400).json({ error: "找不到這個主專案" }); return; }
    if (target.parentId != null) { res.status(400).json({ error: "只能移到主專案底下（選到的是子專案）" }); return; }
    const withChildren = await db.select({ id: projectsTable.id }).from(projectsTable).where(inArray(projectsTable.parentId, numIds)).limit(1);
    if (withChildren.length > 0) { res.status(400).json({ error: "選到的專案底下已經有子專案，不能再掛到別的主專案底下" }); return; }
  }
  try {
    await db.update(config.table).set(setData).where(inArray(config.table.id, numIds));
    res.json({ success: true, updated: numIds.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Update failed" });
  }
});

export default router;
