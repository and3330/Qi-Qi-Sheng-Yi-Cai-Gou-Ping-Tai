import { Router, type IRouter } from "express";
import { asc, count, desc, eq, ilike, or, sql, and, isNotNull } from "drizzle-orm";
import {
  db,
  membersTable,
  erpDepartmentsTable,
  erpMenuPermissionsTable,
  erpAuditLogsTable,
} from "@workspace/db";
import {
  UpdateErpUserBody,
  CreateErpDepartmentBody,
  UpdateErpDepartmentBody,
  PutErpMenuPermissionsBody,
} from "@workspace/api-zod";
import {
  requireErpAny,
  requireErpMenu,
  effectiveErpRole,
} from "../middlewares/requireErp";
import { ERP_MENU_PATHS } from "../lib/erpMenu";

const router: IRouter = Router();

/** 寫入審計日誌（失敗不影響主流程） */
async function audit(
  req: { member?: { id: number; name: string; username: string } },
  entry: {
    action: string;
    module: string;
    documentType?: string;
    documentId?: string;
    description?: string;
    oldValues?: unknown;
    newValues?: unknown;
  },
) {
  try {
    const m = req.member!;
    await db.insert(erpAuditLogsTable).values({
      action: entry.action,
      module: entry.module,
      documentType: entry.documentType ?? null,
      documentId: entry.documentId ?? null,
      userId: m.id,
      userName: m.name || m.username,
      description: entry.description ?? null,
      oldValues: entry.oldValues ?? null,
      newValues: entry.newValues ?? null,
    });
  } catch {
    /* audit 失敗不阻斷主流程 */
  }
}

function serializeAuditLog(l: typeof erpAuditLogsTable.$inferSelect) {
  return {
    id: l.id,
    action: l.action,
    module: l.module,
    documentType: l.documentType,
    documentId: l.documentId,
    userId: l.userId,
    userName: l.userName,
    description: l.description,
    oldValues: l.oldValues,
    newValues: l.newValues,
    createdAt: l.createdAt.toISOString(),
  };
}

/* ---------- me ---------- */

router.get("/erp/me", requireErpAny, (req, res) => {
  const m = req.member!;
  res.json({
    id: m.id,
    username: m.username,
    name: m.name,
    role: m.role,
    erpRole: effectiveErpRole(m),
  });
});

/* ---------- dashboard ---------- */

router.get("/erp/dashboard", requireErpMenu("/"), async (_req, res) => {
  const [[users], [erpUsers], [depts], [logs], recent, metricsResult] = await Promise.all([
    db.select({ n: count() }).from(membersTable),
    db
      .select({ n: count() })
      .from(membersTable)
      .where(
        or(isNotNull(membersTable.erpRole), eq(membersTable.role, "admin")),
      ),
    db
      .select({ n: count() })
      .from(erpDepartmentsTable)
      .where(eq(erpDepartmentsTable.isActive, true)),
    db.select({ n: count() }).from(erpAuditLogsTable),
    db
      .select()
      .from(erpAuditLogsTable)
      .orderBy(desc(erpAuditLogsTable.id))
      .limit(10),
    db.execute(sql`SELECT
      COALESCE((SELECT sum(total_amount) FROM sales_orders WHERE created_at >= date_trunc('month', now()) AND status <> 'cancelled'),0)::int monthly_sales_amount,
      (SELECT count(*) FROM sales_orders WHERE created_at >= date_trunc('month', now()) AND status <> 'cancelled')::int monthly_sales_order_count,
      (SELECT count(*) FROM purchase_orders WHERE status='ordered')::int pending_purchase_order_count,
      (SELECT count(*) FROM products WHERE stock < safety_stock AND is_virtual=false)::int low_stock_item_count,
      (SELECT count(*) FROM erp_leave_requests WHERE status='pending')::int pending_leave_request_count,
      (SELECT count(*) FROM erp_work_orders WHERE status NOT IN ('completed','cancelled'))::int open_work_order_count,
      (SELECT count(*) FROM erp_complaints WHERE status NOT IN ('resolved','closed'))::int open_complaint_count,
      (SELECT count(*) FROM erp_projects WHERE status='active')::int active_project_count,
      (SELECT count(*) FROM erp_contracts WHERE status='active' AND end_date::date BETWEEN current_date AND current_date+30)::int expiring_contract_count,
      (SELECT count(*) FROM erp_leads WHERE created_at >= date_trunc('month', now()))::int monthly_new_lead_count`),
  ]);
  const metrics = ((metricsResult as any).rows ?? metricsResult)[0] ?? {};
  res.json({
    userCount: users.n,
    erpUserCount: erpUsers.n,
    departmentCount: depts.n,
    auditLogCount: logs.n,
    recentAuditLogs: recent.map(serializeAuditLog),
    monthlySalesAmount: metrics.monthly_sales_amount,
    monthlySalesOrderCount: metrics.monthly_sales_order_count,
    pendingPurchaseOrderCount: metrics.pending_purchase_order_count,
    lowStockItemCount: metrics.low_stock_item_count,
    pendingLeaveRequestCount: metrics.pending_leave_request_count,
    openWorkOrderCount: metrics.open_work_order_count,
    openComplaintCount: metrics.open_complaint_count,
    activeProjectCount: metrics.active_project_count,
    expiringContractCount: metrics.expiring_contract_count,
    monthlyNewLeadCount: metrics.monthly_new_lead_count,
  });
});

/* ---------- users ---------- */

function serializeErpUser(
  m: typeof membersTable.$inferSelect,
  departmentName: string | null,
) {
  return {
    id: m.id,
    username: m.username,
    name: m.name,
    email: m.email,
    role: m.role,
    erpRole: m.erpRole,
    departmentId: m.erpDepartmentId,
    departmentName,
    createdAt: m.createdAt.toISOString(),
  };
}

router.get("/erp/users", requireErpMenu("/system/users"), async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const erpOnly = req.query.erpOnly === "true";
  const conds = [];
  if (q) {
    conds.push(
      or(
        ilike(membersTable.username, `%${q}%`),
        ilike(membersTable.name, `%${q}%`),
        ilike(membersTable.email, `%${q}%`),
      ),
    );
  }
  if (erpOnly) {
    conds.push(
      or(isNotNull(membersTable.erpRole), eq(membersTable.role, "admin")),
    );
  }
  const rows = await db
    .select({
      member: membersTable,
      departmentName: erpDepartmentsTable.name,
    })
    .from(membersTable)
    .leftJoin(
      erpDepartmentsTable,
      eq(membersTable.erpDepartmentId, erpDepartmentsTable.id),
    )
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(membersTable.id))
    .limit(200);
  res.json(rows.map((r) => serializeErpUser(r.member, r.departmentName)));
});

router.patch("/erp/users/:id", requireErpMenu("/system/users"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateErpUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const [before] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.id, id))
    .limit(1);
  if (!before) {
    res.status(404).json({ error: "找不到此使用者" });
    return;
  }
  // 角色階層：指派/移除 super_admin，或變更現任 super_admin（含平台 admin 視同），僅限現任 super_admin
  const actorRole = effectiveErpRole(req.member!);
  const targetEffective = effectiveErpRole(before);
  if (
    actorRole !== "super_admin" &&
    "erpRole" in parsed.data &&
    (parsed.data.erpRole === "super_admin" || targetEffective === "super_admin")
  ) {
    res.status(403).json({ error: "僅系統最高管理員可指派或變更 super_admin 角色" });
    return;
  }
  const changes: Record<string, unknown> = {};
  if ("erpRole" in parsed.data) changes.erpRole = parsed.data.erpRole ?? null;
  if ("departmentId" in parsed.data)
    changes.erpDepartmentId = parsed.data.departmentId ?? null;
  const [updated] = await db
    .update(membersTable)
    .set(changes)
    .where(eq(membersTable.id, id))
    .returning();
  await audit(req, {
    action: "update",
    module: "users",
    documentType: "member",
    documentId: String(id),
    description: `更新使用者 ${updated.username} 的 ERP 角色/部門`,
    oldValues: { erpRole: before.erpRole, departmentId: before.erpDepartmentId },
    newValues: { erpRole: updated.erpRole, departmentId: updated.erpDepartmentId },
  });
  let departmentName: string | null = null;
  if (updated.erpDepartmentId) {
    const [d] = await db
      .select({ name: erpDepartmentsTable.name })
      .from(erpDepartmentsTable)
      .where(eq(erpDepartmentsTable.id, updated.erpDepartmentId))
      .limit(1);
    departmentName = d?.name ?? null;
  }
  res.json(serializeErpUser(updated, departmentName));
});

/* ---------- departments ---------- */

async function serializeDepartment(d: typeof erpDepartmentsTable.$inferSelect) {
  let managerName: string | null = null;
  if (d.managerId) {
    const [m] = await db
      .select({ name: membersTable.name, username: membersTable.username })
      .from(membersTable)
      .where(eq(membersTable.id, d.managerId))
      .limit(1);
    managerName = m ? m.name || m.username : null;
  }
  const [{ n: memberCount }] = await db
    .select({ n: count() })
    .from(membersTable)
    .where(eq(membersTable.erpDepartmentId, d.id));
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    parentId: d.parentId,
    managerId: d.managerId,
    managerName,
    costCenter: d.costCenter,
    isActive: d.isActive,
    memberCount,
    createdAt: d.createdAt.toISOString(),
  };
}

router.get("/erp/departments", requireErpMenu("/system/departments"), async (_req, res) => {
  const rows = await db
    .select()
    .from(erpDepartmentsTable)
    .orderBy(asc(erpDepartmentsTable.id));
  res.json(await Promise.all(rows.map(serializeDepartment)));
});

router.post("/erp/departments", requireErpMenu("/system/departments"), async (req, res) => {
  const parsed = CreateErpDepartmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確（名稱必填）" });
    return;
  }
  const [created] = await db
    .insert(erpDepartmentsTable)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      parentId: parsed.data.parentId ?? null,
      managerId: parsed.data.managerId ?? null,
      costCenter: parsed.data.costCenter ?? null,
      isActive: parsed.data.isActive ?? true,
    })
    .returning();
  await audit(req, {
    action: "create",
    module: "departments",
    documentType: "department",
    documentId: String(created.id),
    description: `新增部門「${created.name}」`,
    newValues: parsed.data,
  });
  res.status(201).json(await serializeDepartment(created));
});

router.patch("/erp/departments/:id", requireErpMenu("/system/departments"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateErpDepartmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const [before] = await db
    .select()
    .from(erpDepartmentsTable)
    .where(eq(erpDepartmentsTable.id, id))
    .limit(1);
  if (!before) {
    res.status(404).json({ error: "找不到此部門" });
    return;
  }
  const [updated] = await db
    .update(erpDepartmentsTable)
    .set({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      parentId: parsed.data.parentId ?? null,
      managerId: parsed.data.managerId ?? null,
      costCenter: parsed.data.costCenter ?? null,
      isActive: parsed.data.isActive ?? before.isActive,
    })
    .where(eq(erpDepartmentsTable.id, id))
    .returning();
  await audit(req, {
    action: "update",
    module: "departments",
    documentType: "department",
    documentId: String(id),
    description: `更新部門「${updated.name}」`,
    oldValues: before,
    newValues: parsed.data,
  });
  res.json(await serializeDepartment(updated));
});

router.delete("/erp/departments/:id", requireErpMenu("/system/departments"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [updated] = await db
    .update(erpDepartmentsTable)
    .set({ isActive: false })
    .where(eq(erpDepartmentsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "找不到此部門" });
    return;
  }
  await audit(req, {
    action: "delete",
    module: "departments",
    documentType: "department",
    documentId: String(id),
    description: `停用部門「${updated.name}」`,
  });
  res.status(204).end();
});

/* ---------- menu permissions ---------- */

router.get("/erp/menu-permissions", requireErpAny, async (_req, res) => {
  const rows = await db.select().from(erpMenuPermissionsTable);
  const overrides: Record<string, string[]> = {};
  for (const r of rows) overrides[r.path] = r.roles;
  res.json({ overrides });
});

router.put("/erp/menu-permissions", requireErpMenu("/system/menu-permissions"), async (req, res) => {
  const parsed = PutErpMenuPermissionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const overrides = parsed.data.overrides as Record<string, string[]>;
  const VALID_ROLES = [
    "super_admin",
    "admin",
    "manager",
    "hr_admin",
    "finance_admin",
    "accountant",
    "viewer",
  ];
  for (const [path, roles] of Object.entries(overrides)) {
    if (!ERP_MENU_PATHS.includes(path)) {
      res.status(400).json({ error: `未知的選單路徑：${path}` });
      return;
    }
    if (roles.some((r) => !VALID_ROLES.includes(r))) {
      res.status(400).json({ error: `未知的 ERP 角色（${path}）` });
      return;
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(erpMenuPermissionsTable);
    // 空陣列代表「開放所有 ERP 角色」，需保留為明確覆寫（與預設區分）
    const entries = Object.entries(overrides);
    if (entries.length > 0) {
      await tx.insert(erpMenuPermissionsTable).values(
        entries.map(([path, roles]) => ({
          path,
          roles,
          updatedAt: sql`now()`,
        })),
      );
    }
  });
  await audit(req, {
    action: "update",
    module: "menu-permissions",
    description: "更新選單權限覆寫",
    newValues: overrides,
  });
  const rows = await db.select().from(erpMenuPermissionsTable);
  const saved: Record<string, string[]> = {};
  for (const r of rows) saved[r.path] = r.roles;
  res.json({ overrides: saved });
});

/* ---------- audit logs ---------- */

router.get("/erp/audit-logs", requireErpMenu("/system/audit-logs"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 20;
  const conds = [];
  const module_ =
    typeof req.query.module === "string" ? req.query.module.trim() : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (module_) conds.push(eq(erpAuditLogsTable.module, module_));
  if (q) {
    conds.push(
      or(
        ilike(erpAuditLogsTable.userName, `%${q}%`),
        ilike(erpAuditLogsTable.description, `%${q}%`),
      ),
    );
  }
  const where = conds.length ? and(...conds) : undefined;
  const [[total], items] = await Promise.all([
    db.select({ n: count() }).from(erpAuditLogsTable).where(where),
    db
      .select()
      .from(erpAuditLogsTable)
      .where(where)
      .orderBy(desc(erpAuditLogsTable.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);
  res.json({
    items: items.map(serializeAuditLog),
    total: total.n,
    page,
    pageSize,
  });
});

export default router;
