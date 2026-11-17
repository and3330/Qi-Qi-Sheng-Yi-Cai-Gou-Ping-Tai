import { Router, type IRouter } from "express";
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db, accountsTable, departmentsTable, journalEntriesTable, projectsTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
const FINANCE_ROLES = ["owner", "admin", "finance_admin", "accountant"] as const;

interface JournalLine {
  accountId: number;
  debit?: number | string;
  credit?: number | string;
}

interface Totals {
  revenue: number;
  expense: number;
}

interface BuReportRow extends Totals {
  departmentId: number | null;
  name: string;
  netProfit: number;
  internalTransferOut: number;
  internalTransferIn: number;
  adjustedNet: number;
  projects: Array<Totals & { projectId: number; name: string; net: number }>;
}

router.get(
  "/reports/bu",
  requireAuth,
  requireRole(...FINANCE_ROLES),
  async (req, res): Promise<void> => {
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : "";
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(startDate) || !datePattern.test(endDate) || startDate > endDate) {
      res.status(400).json({ error: "請提供有效的起訖日期" });
      return;
    }

    const [departments, projects, accounts, entries] = await Promise.all([
      db.select({ id: departmentsTable.id, name: departmentsTable.name })
        .from(departmentsTable)
        .where(eq(departmentsTable.isActive, true))
        .orderBy(departmentsTable.name),
      db.select({ id: projectsTable.id, name: projectsTable.name, departmentId: projectsTable.departmentId })
        .from(projectsTable)
        .orderBy(projectsTable.name),
      db.select({ id: accountsTable.id, accountType: accountsTable.accountType })
        .from(accountsTable)
        .where(inArray(accountsTable.accountType, ["Income", "Expense"])),
      db.select({
        lines: journalEntriesTable.lines,
        projectId: journalEntriesTable.projectId,
        departmentId: journalEntriesTable.departmentId,
        totalDebit: journalEntriesTable.totalDebit,
        isInternalTransfer: journalEntriesTable.isInternalTransfer,
        transferFromDepartmentId: journalEntriesTable.transferFromDepartmentId,
        transferToDepartmentId: journalEntriesTable.transferToDepartmentId,
      })
        .from(journalEntriesTable)
        .where(and(
          ne(journalEntriesTable.status, "Draft"),
          gte(journalEntriesTable.entryDate, startDate),
          lte(journalEntriesTable.entryDate, endDate),
        )),
    ]);

    const accountTypes = new Map(accounts.map(account => [account.id, account.accountType]));
    const projectMap = new Map(projects.map(project => [project.id, project]));
    const totals = new Map<number | null, Totals>();
    const projectTotals = new Map<number, Totals>();
    const transferOut = new Map<number, number>();
    const transferIn = new Map<number, number>();
    const getTotals = (map: Map<number | null, Totals> | Map<number, Totals>, key: number | null) => {
      let value = map.get(key as never);
      if (!value) {
        value = { revenue: 0, expense: 0 };
        map.set(key as never, value);
      }
      return value;
    };

    for (const entry of entries) {
      if (entry.isInternalTransfer) {
        const amount = Number(entry.totalDebit);
        if (entry.transferFromDepartmentId != null) {
          transferOut.set(entry.transferFromDepartmentId, (transferOut.get(entry.transferFromDepartmentId) || 0) + amount);
        }
        if (entry.transferToDepartmentId != null) {
          transferIn.set(entry.transferToDepartmentId, (transferIn.get(entry.transferToDepartmentId) || 0) + amount);
        }
        continue;
      }

      let revenue = 0;
      let expense = 0;
      for (const line of entry.lines as JournalLine[]) {
        const debit = Number(line.debit || 0);
        const credit = Number(line.credit || 0);
        const type = accountTypes.get(line.accountId);
        if (type === "Income") revenue += credit - debit;
        if (type === "Expense") expense += debit - credit;
      }

      const project = entry.projectId ? projectMap.get(entry.projectId) : undefined;

      const attributed = new Set<number>();
      const attributedDepartmentId = entry.departmentId ?? project?.departmentId ?? null;
      const value = getTotals(totals, attributedDepartmentId);
      value.revenue += revenue;
      value.expense += expense;

      if (project && project.departmentId === attributedDepartmentId) {
        const projectValue = getTotals(projectTotals, project.id);
        projectValue.revenue += revenue;
        projectValue.expense += expense;
      }
    }

    const makeProjects = (departmentId: number | null) => projects
      .filter(project => project.departmentId === departmentId)
      .map(project => {
        const value = projectTotals.get(project.id) || { revenue: 0, expense: 0 };
        return { projectId: project.id, name: project.name, ...value, net: value.revenue - value.expense };
      });

    const result: BuReportRow[] = departments.map(department => {
      const value = totals.get(department.id) || { revenue: 0, expense: 0 };
      const netProfit = value.revenue - value.expense;
      const internalTransferOut = transferOut.get(department.id) || 0;
      const internalTransferIn = transferIn.get(department.id) || 0;
      return {
        departmentId: department.id,
        name: department.name,
        ...value,
        netProfit,
        internalTransferOut,
        internalTransferIn,
        adjustedNet: netProfit + internalTransferIn - internalTransferOut,
        projects: makeProjects(department.id),
      };
    });

    const unallocated = totals.get(null) || { revenue: 0, expense: 0 };
    result.push({
      departmentId: null,
      name: "未分配",
      ...unallocated,
      netProfit: unallocated.revenue - unallocated.expense,
      internalTransferOut: 0,
      internalTransferIn: 0,
      adjustedNet: unallocated.revenue - unallocated.expense,
      projects: makeProjects(null),
    });
    res.json(result);
  },
);

export default router;
