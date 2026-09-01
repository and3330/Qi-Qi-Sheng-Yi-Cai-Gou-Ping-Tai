import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import {
  db, erpComplaintsTable, erpCustomersTable, erpKbArticlesTable, erpLeadsTable,
  erpOpportunitiesTable, erpTicketCommentsTable, erpTicketsTable, membersTable,
} from "@workspace/db";
import { requireErpMenu } from "../middlewares/requireErp";
import { createErpNotification } from "../lib/erpNotifications";

const router: IRouter = Router();
const id = (v: string | string[]) => Number(Array.isArray(v) ? v[0] : v);
const unique = (e: unknown) => (e as { cause?: { code?: string } })?.cause?.code === "23505";
const date = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()).replaceAll("-", "");
const clean = (body: any, fields: string[]) => Object.fromEntries(fields.filter((x) => body[x] !== undefined).map((x) => [x, body[x]]));
const leadFields = ["name", "company", "phone", "email", "source", "status", "ownerId", "notes"];
const opportunityFields = ["name", "leadId", "customerId", "stage", "expectedAmount", "probability", "expectedCloseDate", "ownerId", "notes", "lostReason"];
const complaintFields = ["customerId", "memberId", "category", "severity", "subject", "content", "status", "assigneeId", "resolution"];
const ticketFields = ["title", "description", "priority", "status", "assigneeId", "requesterName", "customerId", "complaintId", "dueAt"];
const kbFields = ["title", "category", "content", "tags", "isPublished"];
const SOURCES = ["referral", "web", "exhibition", "cold_call", "other"];
const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "lost"];
const STAGES = ["prospecting", "proposal", "negotiation", "won", "lost"];

async function numberedInsert(prefix: "CP" | "TK", table: any, numberColumn: any, values: any) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const p = `${prefix}-${date()}`;
    const result = await db.execute(sql`SELECT COUNT(*)::int n FROM ${table} WHERE ${numberColumn} LIKE ${p + "-%"}`);
    const number = `${p}-${String(Number((result.rows ?? result)[0]?.n || 0) + 1 + attempt).padStart(4, "0")}`;
    try {
      const [row] = await db.insert(table).values({ ...values, [prefix === "CP" ? "complaintNo" : "ticketNo"]: number }).returning() as any[];
      return row;
    } catch (e) { if (!unique(e) || attempt === 4) throw e; }
  }
}

router.get("/erp/crm/assignees", requireErpMenu("/crm/leads"), async (_req, res) => {
  const rows = await db.select({ id: membersTable.id, name: membersTable.name, username: membersTable.username })
    .from(membersTable).where(isNotNull(membersTable.erpRole)).orderBy(membersTable.name);
  res.json(rows);
});

router.get("/erp/crm/leads", requireErpMenu("/crm/leads"), async (req, res) => {
  const q = String(req.query.q || ""); const status = String(req.query.status || "");
  res.json(await db.select().from(erpLeadsTable).where(and(status ? eq(erpLeadsTable.status, status) : undefined, q ? or(ilike(erpLeadsTable.name, `%${q}%`), ilike(erpLeadsTable.company, `%${q}%`)) : undefined)).orderBy(desc(erpLeadsTable.createdAt)));
});
router.post("/erp/crm/leads", requireErpMenu("/crm/leads"), async (req, res) => {
  if (!req.body.name?.trim() || (req.body.source && !SOURCES.includes(req.body.source))) return void res.status(400).json({ error: "潛在客戶資料格式錯誤" });
  const [row] = await db.insert(erpLeadsTable).values(clean(req.body, leadFields) as any).returning(); res.status(201).json(row);
});
router.patch("/erp/crm/leads/:id", requireErpMenu("/crm/leads"), async (req, res) => {
  if (req.body.status && !LEAD_STATUSES.includes(req.body.status)) return void res.status(400).json({ error: "狀態錯誤" });
  const [row] = await db.update(erpLeadsTable).set(clean(req.body, leadFields)).where(eq(erpLeadsTable.id, id(req.params.id))).returning();
  if (!row) return void res.status(404).json({ error: "找不到潛在客戶" }); res.json(row);
});
router.post("/erp/crm/leads/:id/convert", requireErpMenu("/crm/leads"), async (req, res) => {
  try {
    const result = await db.transaction(async (tx) => {
      const [lead] = await tx.update(erpLeadsTable).set({ status: "converted" })
        .where(and(eq(erpLeadsTable.id, id(req.params.id)), or(eq(erpLeadsTable.status, "new"), eq(erpLeadsTable.status, "contacted"), eq(erpLeadsTable.status, "qualified")))).returning();
      if (!lead) throw new Error("CONVERTED");
      let customer = null;
      if (req.body.createCustomer) {
        const code = `CRM-${date()}-${lead.id}`;
        [customer] = await tx.insert(erpCustomersTable).values({ code, name: lead.company || lead.name, contactPerson: lead.name, phone: lead.phone, email: lead.email }).returning();
      }
      let opportunity = null;
      if (req.body.createOpportunity) {
        [opportunity] = await tx.insert(erpOpportunitiesTable).values({
          name: req.body.opportunityName || `${lead.company || lead.name} 商機`, leadId: lead.id,
          customerId: customer?.id ?? null, ownerId: lead.ownerId,
          expectedAmount: req.body.expectedAmount || 0, probability: req.body.probability || 0,
        }).returning();
      }
      return { lead, customer, opportunity };
    });
    res.json(result);
  } catch (e) {
    if ((e as Error).message === "CONVERTED") return void res.status(409).json({ error: "潛在客戶已轉換或目前狀態不可轉換" });
    res.status(unique(e) ? 409 : 400).json({ error: unique(e) ? "客戶代碼已存在" : "轉換失敗" });
  }
});

router.get("/erp/crm/opportunities", requireErpMenu("/crm/opportunities"), async (req, res) => {
  const stage = String(req.query.stage || "");
  res.json(await db.select().from(erpOpportunitiesTable).where(stage ? eq(erpOpportunitiesTable.stage, stage) : undefined).orderBy(desc(erpOpportunitiesTable.createdAt)));
});
router.post("/erp/crm/opportunities", requireErpMenu("/crm/opportunities"), async (req, res) => {
  if (!req.body.name?.trim() || !STAGES.includes(req.body.stage || "prospecting") || req.body.probability < 0 || req.body.probability > 100) return void res.status(400).json({ error: "商機資料格式錯誤" });
  const [row] = await db.insert(erpOpportunitiesTable).values(clean(req.body, opportunityFields) as any).returning(); res.status(201).json(row);
});
router.patch("/erp/crm/opportunities/:id", requireErpMenu("/crm/opportunities"), async (req, res) => {
  if (req.body.stage && !STAGES.includes(req.body.stage)) return void res.status(400).json({ error: "階段錯誤" });
  if (req.body.probability !== undefined && (req.body.probability < 0 || req.body.probability > 100)) return void res.status(400).json({ error: "機率須為 0–100" });
  const [row] = await db.update(erpOpportunitiesTable).set(clean(req.body, opportunityFields))
    .where(and(eq(erpOpportunitiesTable.id, id(req.params.id)), req.body.stage ? or(eq(erpOpportunitiesTable.stage, "prospecting"), eq(erpOpportunitiesTable.stage, "proposal"), eq(erpOpportunitiesTable.stage, "negotiation")) : undefined)).returning();
  if (!row) return void res.status(409).json({ error: "商機不存在或已為終態" }); res.json(row);
});

router.get("/erp/crm/complaints", requireErpMenu("/crm/complaints"), async (req, res) => {
  const status = String(req.query.status || ""); res.json(await db.select().from(erpComplaintsTable).where(status ? eq(erpComplaintsTable.status, status) : undefined).orderBy(desc(erpComplaintsTable.createdAt)));
});
router.post("/erp/crm/complaints", requireErpMenu("/crm/complaints"), async (req, res) => {
  if (!req.body.subject?.trim() || !req.body.content?.trim()) return void res.status(400).json({ error: "主旨與內容為必填" });
  try {
    const row = await numberedInsert("CP", erpComplaintsTable, erpComplaintsTable.complaintNo, clean(req.body, complaintFields));
    if (row.assigneeId) void createErpNotification({ memberId: row.assigneeId, type: "complaint_assigned", title: `客訴已指派：${row.subject}`, body: row.complaintNo, linkPath: "/crm/complaints" }).catch((err) => req.log.warn({ err }, "complaint notification failed"));
    res.status(201).json(row);
  }
  catch { res.status(409).json({ error: "客訴單號產生失敗，請重試" }); }
});
router.patch("/erp/crm/complaints/:id", requireErpMenu("/crm/complaints"), async (req, res) => {
  const values: any = clean(req.body, complaintFields);
  if (["resolved", "closed"].includes(req.body.status)) { if (!req.body.resolution?.trim()) return void res.status(400).json({ error: "結案須填寫處理結果" }); values.resolvedAt = new Date(); }
  const [row] = await db.update(erpComplaintsTable).set(values).where(eq(erpComplaintsTable.id, id(req.params.id))).returning();
  if (row?.assigneeId && req.body.assigneeId !== undefined) void createErpNotification({
    memberId: row.assigneeId, type: "complaint_assigned", title: `客訴已指派：${row.subject}`,
    body: row.complaintNo, linkPath: "/crm/complaints",
  }).catch((err) => req.log.warn({ err }, "complaint notification failed"));
  if (!row) return void res.status(404).json({ error: "找不到客訴" }); res.json(row);
});
router.post("/erp/crm/complaints/:id/ticket", requireErpMenu("/crm/complaints"), async (req, res) => {
  const [c] = await db.select().from(erpComplaintsTable).where(eq(erpComplaintsTable.id, id(req.params.id))).limit(1);
  if (!c) return void res.status(404).json({ error: "找不到客訴" });
  try { res.status(201).json(await numberedInsert("TK", erpTicketsTable, erpTicketsTable.ticketNo, { title: c.subject, description: c.content, priority: c.severity, assigneeId: c.assigneeId, customerId: c.customerId, complaintId: c.id, requesterName: req.body.requesterName || null })); }
  catch { res.status(409).json({ error: "工單單號產生失敗，請重試" }); }
});

router.get("/erp/crm/tickets", requireErpMenu("/crm/tickets"), async (req, res) => {
  const status = String(req.query.status || ""); res.json(await db.select().from(erpTicketsTable).where(status ? eq(erpTicketsTable.status, status) : undefined).orderBy(desc(erpTicketsTable.createdAt)));
});
router.post("/erp/crm/tickets", requireErpMenu("/crm/tickets"), async (req, res) => {
  if (!req.body.title?.trim() || !req.body.description?.trim()) return void res.status(400).json({ error: "標題與說明為必填" });
  try {
    const row = await numberedInsert("TK", erpTicketsTable, erpTicketsTable.ticketNo, clean(req.body, ticketFields));
    if (row.assigneeId) void createErpNotification({ memberId: row.assigneeId, type: "ticket_assigned", title: `工單已指派：${row.title}`, body: row.ticketNo, linkPath: "/crm/tickets" }).catch((err) => req.log.warn({ err }, "ticket notification failed"));
    res.status(201).json(row);
  }
  catch { res.status(409).json({ error: "工單單號產生失敗，請重試" }); }
});
router.get("/erp/crm/tickets/:id", requireErpMenu("/crm/tickets"), async (req, res) => {
  const [ticket] = await db.select().from(erpTicketsTable).where(eq(erpTicketsTable.id, id(req.params.id))).limit(1);
  if (!ticket) return void res.status(404).json({ error: "找不到工單" });
  const comments = await db.select().from(erpTicketCommentsTable).where(eq(erpTicketCommentsTable.ticketId, ticket.id)).orderBy(erpTicketCommentsTable.createdAt); res.json({ ...ticket, comments });
});
router.patch("/erp/crm/tickets/:id", requireErpMenu("/crm/tickets"), async (req, res) => {
  const values: any = clean(req.body, ticketFields);
  if (["resolved", "closed"].includes(req.body.status)) values.resolvedAt = new Date();
  const [row] = await db.update(erpTicketsTable).set(values).where(and(eq(erpTicketsTable.id, id(req.params.id)), req.body.status ? or(eq(erpTicketsTable.status, "open"), eq(erpTicketsTable.status, "in_progress"), eq(erpTicketsTable.status, "pending"), eq(erpTicketsTable.status, "resolved")) : undefined)).returning();
  if (row?.assigneeId && req.body.assigneeId !== undefined) void createErpNotification({
    memberId: row.assigneeId, type: "ticket_assigned", title: `工單已指派：${row.title}`,
    body: row.ticketNo, linkPath: "/crm/tickets",
  }).catch((err) => req.log.warn({ err }, "ticket notification failed"));
  if (!row) return void res.status(409).json({ error: "工單不存在或已關閉" }); res.json(row);
});
router.post("/erp/crm/tickets/:id/comments", requireErpMenu("/crm/tickets"), async (req, res) => {
  if (!req.body.content?.trim()) return void res.status(400).json({ error: "留言不可空白" });
  const [row] = await db.insert(erpTicketCommentsTable).values({ ticketId: id(req.params.id), authorId: req.member!.id, content: req.body.content.trim() }).returning(); res.status(201).json(row);
});

router.get("/erp/crm/kb", requireErpMenu("/crm/knowledge-base"), async (req, res) => {
  const q = String(req.query.q || ""); const category = String(req.query.category || "");
  res.json(await db.select().from(erpKbArticlesTable).where(and(category ? eq(erpKbArticlesTable.category, category) : undefined, q ? or(ilike(erpKbArticlesTable.title, `%${q}%`), ilike(erpKbArticlesTable.content, `%${q}%`)) : undefined)).orderBy(desc(erpKbArticlesTable.updatedAt)));
});
router.post("/erp/crm/kb", requireErpMenu("/crm/knowledge-base"), async (req, res) => {
  if (!req.body.title?.trim() || !req.body.content?.trim()) return void res.status(400).json({ error: "標題與內容為必填" });
  const [row] = await db.insert(erpKbArticlesTable).values({ ...clean(req.body, kbFields), authorId: req.member!.id } as any).returning(); res.status(201).json(row);
});
router.patch("/erp/crm/kb/:id", requireErpMenu("/crm/knowledge-base"), async (req, res) => {
  const [row] = await db.update(erpKbArticlesTable).set({ ...clean(req.body, kbFields), updatedAt: new Date() }).where(eq(erpKbArticlesTable.id, id(req.params.id))).returning();
  if (!row) return void res.status(404).json({ error: "找不到文章" }); res.json(row);
});

export default router;