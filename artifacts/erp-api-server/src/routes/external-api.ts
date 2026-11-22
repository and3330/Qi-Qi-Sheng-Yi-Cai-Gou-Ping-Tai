import { Router, type IRouter } from "express";
import { apiKeyAuth } from "../middleware/api-key-auth";

const router: IRouter = Router();

router.use(apiKeyAuth);

router.get("/info", (req, res) => {
  const apiKey = (req as any).apiKey;
  const user = req.session?.user;
  res.json({
    message: "API 連線成功",
    keyName: apiKey?.keyName,
    projectId: apiKey?.projectId,
    // 金鑰沒有自己的權限：能做什麼完全跟著這個使用者目前的角色
    actingAs: user ? { id: user.id, username: user.username, displayName: user.displayName, role: user.role } : null,
  });
});

router.get("/endpoints", (_req, res) => {
  res.json({
    version: "1.0",
    baseUrl: "/api",
    modules: {
      hr: {
        employees: { list: "GET /employees", create: "POST /employees", get: "GET /employees/:id", update: "PATCH /employees/:id", delete: "DELETE /employees/:id" },
        departments: { list: "GET /departments", create: "POST /departments", update: "PATCH /departments/:id", delete: "DELETE /departments/:id", financials: "GET /departments/:id/financials" },
        attendance: { list: "GET /attendance", create: "POST /attendance", update: "PATCH /attendance/:id" },
        leaves: { list: "GET /leaves", create: "POST /leaves", approve: "PATCH /leaves/:id/approve" },
        salarySlips: { list: "GET /salary-slips", calculate: "POST /salary-slips/calculate", create: "POST /salary-slips", updateStatus: "PUT /salary-slips/:id/status" },
        shiftTypes: { list: "GET /shift-types", create: "POST /shift-types", update: "PUT /shift-types/:id", delete: "DELETE /shift-types/:id" },
      },
      sales: {
        customers: { list: "GET /customers", create: "POST /customers", get: "GET /customers/:id", update: "PATCH /customers/:id", delete: "DELETE /customers/:id" },
        salesOrders: { list: "GET /sales-orders", create: "POST /sales-orders", get: "GET /sales-orders/:id", update: "PATCH /sales-orders/:id" },
      },
      purchasing: {
        suppliers: { list: "GET /suppliers", create: "POST /suppliers", get: "GET /suppliers/:id", update: "PATCH /suppliers/:id", delete: "DELETE /suppliers/:id" },
        purchaseOrders: { list: "GET /purchase-orders", create: "POST /purchase-orders", get: "GET /purchase-orders/:id", update: "PATCH /purchase-orders/:id" },
      },
      inventory: {
        items: { list: "GET /items", create: "POST /items", get: "GET /items/:id", update: "PATCH /items/:id", delete: "DELETE /items/:id" },
        warehouses: { list: "GET /warehouses", create: "POST /warehouses" },
        stockEntries: { list: "GET /stock-entries", create: "POST /stock-entries" },
      },
      crm: {
        leads: { list: "GET /leads", create: "POST /leads", get: "GET /leads/:id", update: "PATCH /leads/:id", delete: "DELETE /leads/:id", convert: "POST /leads/:id/convert" },
        opportunities: { list: "GET /opportunities", create: "POST /opportunities", update: "PATCH /opportunities/:id" },
      },
      projects: {
        projects: { list: "GET /projects", create: "POST /projects", get: "GET /projects/:id", update: "PATCH /projects/:id", delete: "DELETE /projects/:id", financials: "GET /projects/:id/financials" },
        tasks: { list: "GET /tasks", create: "POST /tasks", update: "PATCH /tasks/:id", delete: "DELETE /tasks/:id" },
      },
      accounting: {
        accounts: { list: "GET /accounts", create: "POST /accounts", update: "PATCH /accounts/:id" },
        journalEntries: { list: "GET /journal-entries", create: "POST /journal-entries" },
        invoices: { list: "GET /invoices", create: "POST /invoices", get: "GET /invoices/:id", update: "PATCH /invoices/:id" },
        vouchers: { list: "GET /vouchers", create: "POST /vouchers", get: "GET /vouchers/:id", update: "PATCH /vouchers/:id", delete: "DELETE /vouchers/:id" },
      },
      reports: {
        incomeStatement: { vertical: "GET /reports/income-statement", cross: "GET /reports/income-statement/cross" },
        balanceSheet: { vertical: "GET /reports/balance-sheet", cross: "GET /reports/balance-sheet/cross" },
      },
      dashboard: {
        summary: "GET /dashboard/summary",
        recentActivity: "GET /dashboard/recent-activity",
        revenueChart: "GET /dashboard/revenue-chart",
      },
    },
  });
});

export default router;
