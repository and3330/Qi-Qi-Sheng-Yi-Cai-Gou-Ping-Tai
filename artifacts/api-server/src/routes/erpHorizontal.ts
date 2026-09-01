import { Router, type IRouter } from "express";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db, erpNotificationsTable } from "@workspace/db";
import { effectiveErpRole, requireErpAny } from "../middlewares/requireErp";

const router: IRouter = Router();
const rows = (result: any) => (result.rows ?? result) as Record<string, any>[];

router.get("/erp/search", requireErpAny, async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return void res.json([]);
  const pattern = `%${q}%`;
  const queries: Array<[string, any]> = [
    ["item", sql`SELECT id, name title, code subtitle, '/inventory/items' path FROM products WHERE name ILIKE ${pattern} OR code ILIKE ${pattern} LIMIT 5`],
    ["customer", sql`SELECT id, name title, code subtitle, '/partners/customers' path FROM erp_customers WHERE name ILIKE ${pattern} OR code ILIKE ${pattern} LIMIT 5`],
    ["supplier", sql`SELECT id, name title, contact_person subtitle, '/partners/suppliers' path FROM suppliers WHERE name ILIKE ${pattern} LIMIT 5`],
    ["sales_order", sql`SELECT id, so_no title, customer_name subtitle, '/sales/orders' path FROM sales_orders WHERE so_no ILIKE ${pattern} LIMIT 5`],
    ["purchase_order", sql`SELECT p.id, p.po_no title, s.name subtitle, '/purchasing/orders' path FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id WHERE p.po_no ILIKE ${pattern} LIMIT 5`],
    ["project", sql`SELECT id, name title, project_no subtitle, '/projects/list' path FROM erp_projects WHERE name ILIKE ${pattern} OR project_no ILIKE ${pattern} LIMIT 5`],
    ["work_order", sql`SELECT id, work_order_no title, status subtitle, '/manufacturing/work-orders' path FROM erp_work_orders WHERE work_order_no ILIKE ${pattern} LIMIT 5`],
    ["ticket", sql`SELECT id, title, ticket_no subtitle, '/crm/tickets' path FROM erp_tickets WHERE title ILIKE ${pattern} OR ticket_no ILIKE ${pattern} LIMIT 5`],
    ["complaint", sql`SELECT id, subject title, complaint_no subtitle, '/crm/complaints' path FROM erp_complaints WHERE subject ILIKE ${pattern} OR complaint_no ILIKE ${pattern} LIMIT 5`],
    ["contract", sql`SELECT id, title, contract_no subtitle, '/contracts/list' path FROM erp_contracts WHERE title ILIKE ${pattern} OR contract_no ILIKE ${pattern} LIMIT 5`],
    ["knowledge_base", sql`SELECT id, title, category subtitle, '/crm/knowledge-base' path FROM erp_kb_articles WHERE title ILIKE ${pattern} LIMIT 5`],
  ];
  if (["super_admin", "admin", "hr_admin", "manager"].includes(effectiveErpRole(req.member!) ?? "")) {
    queries.push(["employee", sql`SELECT id, name title, employee_no subtitle, '/hr/employees' path FROM erp_employees WHERE name ILIKE ${pattern} OR employee_no ILIKE ${pattern} LIMIT 5`]);
  }
  const results = await Promise.all(queries.map(async ([type, query]) => rows(await db.execute(query)).map((r) => ({ type, ...r }))));
  res.json(results.flat());
});

router.get("/erp/notifications", requireErpAny, async (req, res) => {
  res.json(await db.select().from(erpNotificationsTable).where(eq(erpNotificationsTable.memberId, req.member!.id)).orderBy(desc(erpNotificationsTable.createdAt)).limit(50));
});
router.get("/erp/notifications/unread-count", requireErpAny, async (req, res) => {
  const [result] = await db.select({ count: count() }).from(erpNotificationsTable)
    .where(and(eq(erpNotificationsTable.memberId, req.member!.id), eq(erpNotificationsTable.isRead, false)));
  res.json({ count: result.count });
});
router.post("/erp/notifications/read", requireErpAny, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isInteger) : [];
  if (req.body?.all !== true && ids.length === 0) return void res.status(400).json({ error: "ids 或 all 必填" });
  await db.update(erpNotificationsTable).set({ isRead: true }).where(and(
    eq(erpNotificationsTable.memberId, req.member!.id),
    req.body.all === true ? undefined : inArray(erpNotificationsTable.id, ids),
  ));
  res.json({ success: true });
});

router.get("/erp/calendar", requireErpAny, async (req, res) => {
  const month = String(req.query.month ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return void res.status(400).json({ error: "month 格式須為 YYYY-MM" });
  const result = await db.execute(sql`
    SELECT to_char(start_at AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD') date, 'leave' type,
      '請假：'||e.name title, '/hr/leaves' path FROM erp_leave_requests l JOIN erp_employees e ON e.id=l.employee_id
      WHERE l.status IN ('approved','pending') AND to_char(start_at AT TIME ZONE 'Asia/Taipei','YYYY-MM')=${month}
    UNION ALL SELECT due_date, 'task', title, '/projects/tasks' FROM erp_project_tasks WHERE due_date LIKE ${month + "%"}
    UNION ALL SELECT end_date, 'contract', title, '/contracts/list' FROM erp_contracts WHERE end_date LIKE ${month + "%"}
    UNION ALL SELECT period||'-01', 'payroll', '薪資批次 '||period, '/hr/payroll' FROM erp_payroll_runs WHERE period=${month} AND status IN ('confirmed','paid')
    UNION ALL SELECT maintenance_date, 'maintenance', '資產保養', '/assets/list' FROM erp_asset_maintenances WHERE maintenance_date LIKE ${month + "%"}
    UNION ALL SELECT planned_start_date, 'manufacturing', '製令 '||work_order_no, '/manufacturing/work-orders' FROM erp_work_orders WHERE planned_start_date LIKE ${month + "%"}
    UNION ALL SELECT planned_end_date, 'manufacturing', '製令完成 '||work_order_no, '/manufacturing/work-orders' FROM erp_work_orders WHERE planned_end_date LIKE ${month + "%"}
    ORDER BY date
  `);
  res.json(rows(result));
});

export default router;