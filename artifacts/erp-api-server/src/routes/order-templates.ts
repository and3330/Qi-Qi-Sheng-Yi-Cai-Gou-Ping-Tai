import { Router, type IRouter } from "express";
import { eq, asc, count } from "drizzle-orm";
import { db, orderTemplatesTable, quotationsTable, salesOrdersTable, purchaseOrdersTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/order-templates", requireAuth);

// 模板決定大家開單要填什麼，只開放管理層維護
const canManageTemplates = requireRole("owner", "admin", "manager");

const FIELD_TYPES = ["text", "number", "date", "select", "textarea"];
/** 檢查欄位定義；回傳錯誤訊息或 null */
function fieldSchemaError(fieldSchema: unknown): string | null {
  if (fieldSchema === undefined) return null;
  if (!Array.isArray(fieldSchema)) return "欄位定義格式不正確";
  const seen = new Set<string>();
  for (const f of fieldSchema) {
    if (!f || typeof f.name !== "string" || !f.name.trim() || typeof f.label !== "string" || !f.label.trim()) return "每個欄位都要有代碼與名稱";
    if (!FIELD_TYPES.includes(f.type)) return `欄位「${f.label}」的類型無效`;
    if (seen.has(f.name)) return `欄位代碼「${f.name}」重複`;
    seen.add(f.name);
    if (f.type === "select" && (!Array.isArray(f.options) || f.options.length === 0)) return `下拉欄位「${f.label}」至少要有一個選項`;
  }
  return null;
}

router.get("/order-templates", async (req, res): Promise<void> => {
  // ?projectId=N → 回傳全域模板 + 該專案專屬模板；不帶參數 → 全部
  const projectIdRaw = req.query["projectId"];
  let templates = await db
    .select()
    .from(orderTemplatesTable)
    .orderBy(asc(orderTemplatesTable.sortOrder));
  if (projectIdRaw !== undefined) {
    const projectId = Number(projectIdRaw);
    if (isNaN(projectId)) { res.status(400).json({ error: "Invalid projectId" }); return; }
    templates = templates.filter(t => t.projectId === null || t.projectId === projectId);
  }
  res.json(templates);
});

router.get("/order-templates/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [template] = await db.select().from(orderTemplatesTable).where(eq(orderTemplatesTable.id, id));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(template);
});

router.post("/order-templates", canManageTemplates, async (req, res): Promise<void> => {
  const { name, businessType, description, fieldSchema, defaultValues, isActive, sortOrder, projectId } = req.body;
  if (!name || !businessType) {
    res.status(400).json({ error: "請填寫模板名稱與業務類型" }); return;
  }
  const schemaErr = fieldSchemaError(fieldSchema);
  if (schemaErr) { res.status(400).json({ error: schemaErr }); return; }
  const [template] = await db.insert(orderTemplatesTable).values({
    name,
    businessType,
    projectId: projectId ? Number(projectId) : null,
    description: description || null,
    fieldSchema: fieldSchema || [],
    defaultValues: defaultValues || {},
    isActive: isActive !== false,
    sortOrder: sortOrder || undefined,
  }).returning();
  res.status(201).json(template);
});

router.patch("/order-templates/:id", canManageTemplates, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, businessType, description, fieldSchema, defaultValues, isActive, sortOrder, projectId } = req.body;
  const schemaErr = fieldSchemaError(fieldSchema);
  if (schemaErr) { res.status(400).json({ error: schemaErr }); return; }
  const updateData: any = {};
  if (projectId !== undefined) updateData.projectId = projectId === null ? null : Number(projectId);
  if (name !== undefined) updateData.name = name;
  if (businessType !== undefined) updateData.businessType = businessType;
  if (description !== undefined) updateData.description = description;
  if (fieldSchema !== undefined) updateData.fieldSchema = fieldSchema;
  if (defaultValues !== undefined) updateData.defaultValues = defaultValues;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

  const [template] = await db.update(orderTemplatesTable).set(updateData).where(eq(orderTemplatesTable.id, id)).returning();
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(template);
});

router.delete("/order-templates/:id", canManageTemplates, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  // 已經有單據用這個模板填過資料：刪掉會讓那些單據看不到當初填的欄位，所以只能停用
  const [[q], [so], [po]] = await Promise.all([
    db.select({ n: count() }).from(quotationsTable).where(eq(quotationsTable.templateId, id)),
    db.select({ n: count() }).from(salesOrdersTable).where(eq(salesOrdersTable.templateId, id)),
    db.select({ n: count() }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.templateId, id)),
  ]);
  const used = Number(q?.n ?? 0) + Number(so?.n ?? 0) + Number(po?.n ?? 0);
  if (used > 0) {
    res.status(409).json({ error: `已有 ${used} 張單據使用這個模板，不能刪除。請改為「停用」，舊單據的資料會保留。` }); return;
  }
  const [deleted] = await db.delete(orderTemplatesTable).where(eq(orderTemplatesTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Template not found" }); return; }
  res.status(204).send();
});

router.post("/order-templates/seed-defaults", canManageTemplates, async (_req, res): Promise<void> => {
  const existing = await db.select().from(orderTemplatesTable);
  if (existing.length > 0) {
    res.json({ message: "Templates already exist", count: existing.length }); return;
  }

  const defaults = [
    {
      name: "商城電商",
      businessType: "ecommerce",
      description: "商城電商訂單模板",
      fieldSchema: [
        { name: "shippingAddress", label: "收貨地址", type: "text", required: true },
        { name: "shippingMethod", label: "配送方式", type: "select", required: true, options: ["宅配", "超商取貨", "門市自取"] },
        { name: "trackingNumber", label: "物流編號", type: "text", required: false },
        { name: "paymentMethod", label: "付款方式", type: "select", required: true, options: ["信用卡", "ATM轉帳", "貨到付款", "LINE Pay"] },
      ],
      sortOrder: 1,
    },
    {
      name: "校園業務",
      businessType: "campus",
      description: "校園課程與活動訂單模板",
      fieldSchema: [
        { name: "classWeeks", label: "上課週數", type: "number", required: false },
        { name: "courseStartDate", label: "開課日期", type: "date", required: false },
        { name: "courseEndDate", label: "課程截止日", type: "date", required: false },
        { name: "coursePeriod", label: "課程期數", type: "text", required: false },
        { name: "caseTime", label: "案件時間", type: "text", required: false },
        { name: "teacherCode", label: "老師代碼", type: "text", required: false },
        { name: "teacherFeePerSession", label: "講師費用/次", type: "number", required: false },
        { name: "teacherMaterialFeeMethod", label: "材料費方式", type: "select", required: false, options: ["不需要", "老師代收", "公司收取", "其他"] },
      ],
      sortOrder: 2,
    },
    {
      name: "活動業務",
      businessType: "event",
      description: "活動營隊訂單模板",
      fieldSchema: [
        { name: "eventName", label: "活動名稱", type: "text", required: true },
        { name: "eventDate", label: "活動日期", type: "date", required: true },
        { name: "eventLocation", label: "活動地點", type: "text", required: false },
        { name: "participantCount", label: "報名人數", type: "number", required: false },
        { name: "eventType", label: "活動類型", type: "select", required: false, options: ["營隊", "講座", "研習", "工作坊", "其他"] },
      ],
      sortOrder: 3,
    },
    {
      name: "居家服務",
      businessType: "home_service",
      description: "居家服務訂單模板",
      fieldSchema: [
        { name: "masterName", label: "負責師傅", type: "text", required: true },
        { name: "serviceAddress", label: "服務地址", type: "text", required: true },
        { name: "serviceDate", label: "服務日期", type: "date", required: true },
        { name: "serviceTime", label: "服務時段", type: "text", required: false },
        { name: "serviceType", label: "服務類型", type: "select", required: false, options: ["清潔", "修繕", "安裝", "搬運", "其他"] },
      ],
      sortOrder: 4,
    },
  ];

  const inserted = [];
  for (const tpl of defaults) {
    const [t] = await db.insert(orderTemplatesTable).values({
      name: tpl.name,
      businessType: tpl.businessType,
      description: tpl.description,
      fieldSchema: tpl.fieldSchema,
      defaultValues: {},
      sortOrder: tpl.sortOrder,
    }).returning();
    inserted.push(t);
  }

  res.status(201).json({ message: "Default templates created", templates: inserted });
});

export default router;
