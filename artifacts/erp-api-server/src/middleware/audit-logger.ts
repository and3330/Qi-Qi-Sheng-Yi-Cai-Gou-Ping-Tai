import { Request, Response, NextFunction } from "express";
import { db, auditLogsTable } from "@workspace/erp-db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/** 稽核紀錄寫不進去時不能默默吞掉，要留在伺服器日誌裡讓人追 */
function reportAuditFailure(req: Request, path: string, err: unknown) {
  logger.error({ err, method: req.method, path, userId: (req as any).session?.user?.id }, "稽核紀錄寫入失敗");
}

const mutatingMethods = ["POST", "PATCH", "PUT", "DELETE"];

const moduleMap: Record<string, string> = {
  "/employees": "HR", "/departments": "HR", "/attendance": "HR", "/leaves": "HR",
  "/shift-types": "HR", "/salary-slips": "HR", "/insurance-brackets": "HR",
  "/customers": "Sales", "/sales-orders": "Sales", "/quotations": "Sales",
  "/delivery-notes": "Sales", "/sales-returns": "Sales", "/price-lists": "Sales",
  "/suppliers": "Purchasing", "/purchase-orders": "Purchasing", "/purchase-receipts": "Purchasing",
  "/purchase-returns": "Purchasing",
  "/items": "Inventory", "/warehouses": "Inventory", "/stock-entries": "Inventory",
  "/accounts": "Accounting", "/journal-entries": "Accounting", "/invoices": "Accounting",
  "/vouchers": "Accounting", "/payment-requests": "Accounting", "/bank-reconciliation": "Accounting",
  "/leads": "CRM", "/opportunities": "CRM",
  "/projects": "Projects", "/tasks": "Projects",
  "/assets": "Assets", "/asset-categories": "Assets", "/asset-maintenance": "Assets",
  "/workstations": "Manufacturing", "/bom": "Manufacturing", "/work-orders": "Manufacturing",
  "/job-cards": "Manufacturing",
  "/quality-inspections": "Quality", "/non-conformance": "Quality", "/capa": "Quality",
  "/support-tickets": "Helpdesk", "/kb-articles": "Helpdesk",
  "/contracts": "Contracts",
  "/hr-contracts": "HR Contracts",
  "/currencies": "System", "/exchange-rates": "System",
  "/approval-workflows": "System", "/approval-requests": "System",
  "/print-templates": "System", "/calendar-events": "System",
  "/notifications": "System",
  // 帳號、權限與系統設定的異動最需要留紀錄
  "/admin": "Admin", "/roles": "Admin", "/api-keys": "Admin", "/menu-permissions": "Admin",
  "/email-settings": "System", "/accounting-settings": "Accounting", "/payroll-settings": "HR",
  "/brands": "System", "/designations": "System", "/grades": "System",
  "/import-export": "System", "/batch": "System", "/clock-in-locations": "HR", "/service-fees": "HR", "/salary-components": "HR", "/timesheets": "HR", "/payment-terms": "Accounting", "/stock-counts": "Inventory", "/dunning": "Accounting", "/recurring-invoices": "Accounting", "/budgets": "Accounting", "/material-requests": "Purchasing", "/subcontract-orders": "Manufacturing", "/integrations": "System", "/advances": "Accounting", "/rfqs": "Purchasing",
  // 2026-11-15 老闆要求：所有異動都要留紀錄，補上原本漏掉的
  "/order-templates": "Sales", "/quotation-templates": "Sales", "/registrants": "Sales", "/create-sales-order": "Sales",
  "/item-categories": "Inventory", "/item-types": "Inventory",
  "/attachments": "System", "/teachers": "Projects", "/reimbursement": "Accounting", "/my-requests": "System",
  "/bank-statements": "Accounting", "/legacy-documents": "System", "/vat-report": "Accounting",
  "/kb-categories": "Helpdesk", "/ticket-categories": "Helpdesk", "/sla-definitions": "Helpdesk",
  "/quality-inspection-templates": "Quality", "/production-planning": "Manufacturing",
  "/settings": "System", "/backup": "System", "/billing": "System", "/platform": "Admin",
  "/data-sync": "System", "/setup": "System", "/scheduled-jobs": "System", "/email": "System",
  "/cm-life": "System", "/noncodingai": "System", "/ai": "AI",
};

/**
 * 不改資料的 POST（AI 問答、預覽、試算、掃描）與登入流程不記；
 * 公開報名頁沒有登入身分與公司，也不在這裡記。
 */
const NOT_A_CHANGE = [
  /^\/admin\/(login|logout|forgot-password|reset-password|verify-recovery-email)/,
  /^\/ai\/(ask|classify-complaint|product-description|document-ocr)$/,
  /^\/bi\/ai-consultant/, /^\/anomaly-check/, /\/preview$/, /^\/reimbursement\/scan/,
  /^\/public\//, /\/notifications/, /\/audit-logs/,
];

/** 找不到對應模組的異動也要記，模組就用網址第一段 */
export function moduleForPath(path: string): string | null {
  if (NOT_A_CHANGE.some(rule => rule.test(path))) return null;
  const mapped = getModuleFromPath(path);
  if (mapped) return mapped;
  const first = path.split("/").filter(Boolean)[0];
  return first ? first : null;
}

/** 單筆紀錄最多存這麼多字，避免匯入、備份這類大量回應塞爆紀錄表 */
const MAX_VALUE_CHARS = 200_000;
export function capSize(value: unknown): unknown {
  if (value == null) return value;
  let text: string;
  try { text = JSON.stringify(value); } catch { return { note: "內容無法序列化" }; }
  if (text.length <= MAX_VALUE_CHARS) return value;
  return { note: "內容過大，只保留開頭", truncated: text.slice(0, 2000) };
}

export function clientIp(req: Request): string | undefined {
  return req.ip || req.socket?.remoteAddress || undefined;
}

/** 密碼、金鑰、權杖這類欄位一律不寫進稽核紀錄 */
const SECRET_FIELD = /pass(word)?|secret|token|hash|apikey|api_key|^key$|plainkey|rawkey|authorization|cookie/i;
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object" || depth > 6) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map(item => redactSecrets(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_FIELD.test(key) ? "〔已遮蔽〕" : redactSecrets(inner, depth + 1);
  }
  return out;
}

const pathToTableName: Record<string, string> = {
  "/employees": "employees", "/departments": "departments", "/attendance": "attendance",
  "/leaves": "leaves", "/shift-types": "shift_types", "/salary-slips": "salary_slips",
  "/insurance-brackets": "insurance_brackets",
  "/customers": "customers", "/sales-orders": "sales_orders", "/quotations": "quotations",
  "/delivery-notes": "delivery_notes", "/sales-returns": "sales_returns", "/price-lists": "price_lists",
  "/suppliers": "suppliers", "/purchase-orders": "purchase_orders", "/purchase-receipts": "purchase_receipts",
  "/purchase-returns": "purchase_returns",
  "/items": "items", "/warehouses": "warehouses", "/stock-entries": "stock_entries",
  "/accounts": "accounts", "/journal-entries": "journal_entries", "/invoices": "invoices",
  "/vouchers": "vouchers", "/payment-requests": "payment_requests", "/bank-reconciliation": "bank_reconciliation_entries",
  "/leads": "leads", "/opportunities": "opportunities",
  "/projects": "projects", "/tasks": "tasks",
  "/assets": "assets", "/asset-categories": "asset_categories", "/asset-maintenance": "asset_maintenance",
  "/workstations": "workstations", "/boms": "boms", "/work-orders": "work_orders",
  "/job-cards": "job_cards",
  "/quality-inspection-templates": "quality_inspection_templates",
  "/quality-inspections": "quality_inspections", "/non-conformance": "non_conformance_reports", "/capa": "capa_actions",
  "/order-templates": "order_templates", "/registrants": "order_registrants",
  "/item-categories": "item_categories", "/item-types": "item_types",
  "/attachments": "attachments", "/teachers": "teachers", "/bank-statements": "bank_statements",
  "/kb-categories": "kb_categories", "/ticket-categories": "ticket_categories", "/sla-definitions": "sla_definitions",
  "/admin/users": "admin_users", "/advances": "advances", "/rfqs": "rfqs",
  "/budgets": "budgets", "/material-requests": "material_requests", "/subcontract-orders": "subcontract_orders",
  "/stock-counts": "stock_counts", "/recurring-invoices": "recurring_invoices", "/payment-terms": "payment_terms",
  "/timesheets": "timesheets", "/salary-components": "salary_components", "/service-fees": "service_fees",
  "/clock-in-locations": "clock_in_locations", "/designations": "designations", "/grades": "grades",
  "/brands": "brands", "/api-keys": "api_keys", "/menu-permissions": "menu_permissions",
  "/support-tickets": "support_tickets", "/kb-articles": "kb_articles",
  "/contracts": "contracts",
  "/currencies": "currencies", "/exchange-rates": "exchange_rates",
  "/approval-workflows": "approval_workflows", "/approval-requests": "approval_requests",
  "/print-templates": "print_templates", "/calendar-events": "calendar_events",
};

function getModuleFromPath(path: string): string | null {
  for (const [prefix, mod] of Object.entries(moduleMap)) {
    if (path.startsWith(prefix)) return mod;
  }
  return null;
}

function getTableNameFromPath(path: string): string | null {
  for (const [prefix, table] of Object.entries(pathToTableName)) {
    if (path.startsWith(prefix)) return table;
  }
  return null;
}

function getDocTypeFromPath(path: string): string {
  const segment = path.split("/").filter(Boolean)[0] || "";
  return segment.replace(/-/g, "_");
}

function getActionFromMethod(method: string): string {
  switch (method) {
    case "POST": return "create";
    case "PATCH": case "PUT": return "update";
    case "DELETE": return "delete";
    default: return method.toLowerCase();
  }
}

async function fetchOldRecord(tableName: string, id: number): Promise<any> {
  try {
    if (!Number.isInteger(id)) return null;
    const result = await db.execute(sql`SELECT * FROM ${sql.identifier(tableName)} WHERE id = ${id} LIMIT 1`);
    return result.rows?.[0] || null;
  } catch {
    return null;
  }
}

export function auditLogger(req: Request, res: Response, next: NextFunction) {
  if (!mutatingMethods.includes(req.method)) { next(); return; }

  const apiPath = req.path.replace(/^\/api/, "");
  const module = moduleForPath(apiPath);
  if (!module) { next(); return; }
  const ipAddress = clientIp(req);

  const originalJson = res.json.bind(res);
  const originalSendStatus = res.sendStatus.bind(res);

  const action = getActionFromMethod(req.method);
  const documentType = getDocTypeFromPath(apiPath);
  const idMatch = apiPath.match(/\/(\d+)/);
  const documentId = idMatch ? Number(idMatch[1]) : undefined;

  // 只信任 session 身分，不採信 client header（避免偽造稽核身分）
  const sessionUser = (req as any).session?.user;
  const apiKeyAuth = (req as any).apiKeyAuth;
  // 用金鑰操作時記成「那個人（金鑰：名稱）」，看得出是本人還是他的金鑰做的
  const keyLabel = apiKeyAuth ? `金鑰：${(req as any).apiKey?.keyName || "未命名"}` : "";
  const baseName = sessionUser?.displayName || sessionUser?.username || "";
  const userName = baseName ? (keyLabel ? `${baseName}（${keyLabel}）` : baseName) : (apiKeyAuth ? `apikey:${(req as any).apiKey?.keyName || "未命名"}` : "system");
  const userId = sessionUser?.id ? String(sessionUser.id) : undefined;

  const tableName = getTableNameFromPath(apiPath);
  let oldRecordPromise: Promise<any> | null = null;
  if ((action === "update" || action === "delete") && documentId && tableName) {
    oldRecordPromise = fetchOldRecord(tableName, documentId);
  }

  res.json = function (body: any) {
    if (res.statusCode < 400) {
      const writeAudit = async () => {
        const logEntry: any = {
          action,
          module,
          documentType,
          documentId: documentId || body?.id,
          userId,
          userName,
          ipAddress,
          description: `${action} ${documentType}${documentId ? ` #${documentId}` : body?.id ? ` #${body.id}` : ""}`,
        };

        if (action === "create") {
          logEntry.newValues = capSize(redactSecrets(body));
        } else if (action === "update") {
          const oldRecord = oldRecordPromise ? await oldRecordPromise : null;
          logEntry.oldValues = capSize(redactSecrets(oldRecord));
          logEntry.newValues = capSize(redactSecrets(body));
        } else if (action === "delete") {
          const oldRecord = oldRecordPromise ? await oldRecordPromise : body;
          logEntry.oldValues = capSize(redactSecrets(oldRecord));
        }

        await db.insert(auditLogsTable).values(logEntry);
      };
      writeAudit().catch(err => reportAuditFailure(req, apiPath, err));
    }
    return originalJson(body);
  };

  res.sendStatus = function (code: number) {
    if (code < 400) {
      const writeAudit = async () => {
        const oldRecord = oldRecordPromise ? await oldRecordPromise : null;
        await db.insert(auditLogsTable).values({
          action,
          module,
          documentType,
          documentId,
          userId,
          userName,
          ipAddress,
          oldValues: capSize(redactSecrets(oldRecord)) as any,
          description: `${action} ${documentType}${documentId ? ` #${documentId}` : ""}`,
        });
      };
      writeAudit().catch(err => reportAuditFailure(req, apiPath, err));
    }
    return originalSendStatus(code);
  };

  next();
}
