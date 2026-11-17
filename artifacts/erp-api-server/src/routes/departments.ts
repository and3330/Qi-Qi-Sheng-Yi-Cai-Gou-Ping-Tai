import { Router, type IRouter } from "express";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { db, departmentsTable, employeesTable, journalEntriesTable, vouchersTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { getDimensionPnl } from "../lib/dimension-pnl";
import {
  CreateDepartmentBody,
  UpdateDepartmentParams,
  UpdateDepartmentBody,
  DeleteDepartmentParams,
  GetDepartmentFinancialsParams,
} from "@workspace/erp-api-zod";

const router: IRouter = Router();
router.use("/departments", requireAuth);

router.get("/departments", async (_req, res): Promise<void> => {
  const departments = await db
    .select({
      id: departmentsTable.id,
      name: departmentsTable.name,
      description: departmentsTable.description,
      parentId: departmentsTable.parentId,
      managerId: departmentsTable.managerId,
      costCenter: departmentsTable.costCenter,
      isActive: departmentsTable.isActive,
      createdAt: departmentsTable.createdAt,
      employeeCount: sql<number>`(SELECT COUNT(*) FROM employees WHERE department_id = ${departmentsTable.id})::int`,
      parentName: sql<string | null>`(SELECT name FROM departments d2 WHERE d2.id = ${departmentsTable.parentId})`,
      managerName: sql<string | null>`(SELECT first_name || ' ' || last_name FROM employees WHERE id = ${departmentsTable.managerId})`,
    })
    .from(departmentsTable)
    .orderBy(departmentsTable.name);

  res.json(departments);
});

router.post("/departments", async (req, res): Promise<void> => {
  const parsed = CreateDepartmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [dept] = await db.insert(departmentsTable).values(parsed.data).returning();
  res.status(201).json({ ...dept, employeeCount: 0, parentName: null, managerName: null, isActive: dept.isActive });
});

router.patch("/departments/:id", async (req, res): Promise<void> => {
  const params = UpdateDepartmentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateDepartmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [dept] = await db.update(departmentsTable).set(parsed.data).where(eq(departmentsTable.id, params.data.id)).returning();
  if (!dept) { res.status(404).json({ error: "Department not found" }); return; }
  res.json({ ...dept, employeeCount: 0, parentName: null, managerName: null, isActive: dept.isActive });
});

router.delete("/departments/:id", async (req, res): Promise<void> => {
  const params = DeleteDepartmentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [dept] = await db.delete(departmentsTable).where(eq(departmentsTable.id, params.data.id)).returning();
  if (!dept) { res.status(404).json({ error: "Department not found" }); return; }
  res.sendStatus(204);
});

router.get("/departments/:id/financials", requireRole("owner", "admin", "finance_admin", "accountant"), async (req, res): Promise<void> => {
  const params = GetDepartmentFinancialsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, params.data.id));
  if (!dept) { res.status(404).json({ error: "Department not found" }); return; }

  const entries = await db
    .select()
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.departmentId, params.data.id));

  const vouchers = await db
    .select({
      id: vouchersTable.id,
      voucherNumber: vouchersTable.voucherNumber,
      voucherType: vouchersTable.voucherType,
      voucherDate: vouchersTable.voucherDate,
      description: vouchersTable.description,
      totalAmount: vouchersTable.totalAmount,
      status: vouchersTable.status,
      items: vouchersTable.items,
    })
    .from(vouchersTable)
    .where(eq(vouchersTable.departmentId, params.data.id));

  const employees = await db
    .select({
      id: employeesTable.id,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      designation: employeesTable.designation,
    })
    .from(employeesTable)
    .where(eq(employeesTable.departmentId, params.data.id));

  const { totalIncome, totalExpense, netProfit } = await getDimensionPnl({ departmentId: params.data.id });

  res.json({
    departmentId: dept.id,
    departmentName: dept.name,
    totalIncome,
    totalExpense,
    netProfit: totalIncome - totalExpense,
    employees,
    entries,
    vouchers,
  });
});

export default router;
