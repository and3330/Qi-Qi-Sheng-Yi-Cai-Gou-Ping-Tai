import { createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { db, runWithTenant, currentTenantId, currentTenantClient, aiActionsTable } from "@workspace/erp-db";
import { toolSchemas, executeTool, type ToolName } from "./tools";
import { CustomerDraftConflictError } from "./customer-drafts";
import { DIRECT_WRITE_TOOLS, ROLE_LABEL, ROLE_TOOLS, resolveIdentity, roleAllows, roleAllowsDraftType, type McpRole } from "./identity";

export function validBearer(header: string | undefined, key: string): boolean {
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(supplied), digest(key)) && supplied.length > 0;
}
/** Never persist free text, credentials, payloads, names, or user-provided key names. */
export function auditArgs(args: unknown, role?: McpRole) {
  // 身分（職務）不是使用者內容，記下來才能追查是哪一把金鑰做的
  return { redacted: true, supplied: args !== undefined, ...(role ? { role } : {}) };
}
const TARGET_TYPES: Record<string, string> = {
  create_customer_draft: "ai_customer_drafts", create_customer: "customers",
  create_quotation: "quotations", match_bank_entry: "bank_reconciliation_entries",
  erp_request: "erp_api", send_quotation_pdf: "quotations", get_quotation_pdf: "quotations",
};
export async function audit(tool: unknown, args: unknown, status: "ok" | "denied" | "error", ip?: string, targetId?: number, role?: McpRole) {
  const tenantId = currentTenantId();
  if (!tenantId) throw new Error("Tenant context required");
  await db.insert(aiActionsTable).values({
    tenantId,
    tool: typeof tool === "string" && (Object.hasOwn(toolSchemas,tool) || ["authentication","configuration","rate_limit","invalid_tool","batch"].includes(tool)) ? tool : "unknown",
    args: auditArgs(args, role), status, resultSummary: status === "ok" ? "Completed" : status === "denied" ? "Request denied" : "Tool failed",
    ip: ip?.slice(0,128), targetType: targetId ? (TARGET_TYPES[String(tool)] ?? "ai_draft_documents") : null, targetId,
  });
}
const TOOL_DESCRIPTIONS: Partial<Record<ToolName,string>> = {
  erp_list_endpoints: "List the ERP REST endpoints this identity may call with erp_request (all modules: sales, purchasing, inventory, manufacturing, HR/payroll, assets, accounting, projects...). Pass keyword (e.g. purchase, salary, leave, item, invoice) to narrow down and to see which endpoints are reserved for humans.",
  erp_request: "Call any ERP REST endpoint (method + path + optional query/body), with all the ERP's own validation applied; takes effect immediately. Typical flows: GET /items, /suppliers, /customers, /projects, /employees to look up ids; POST /purchase-orders, /purchase-receipts/from-order/:id, /sales-orders, /quotations, /invoices (invoiceType Sales, taxType taxable) to create documents; POST /sales-orders/:id/issue-ecpay-invoice with body {idempotencyKey: <8-100 chars, letters/digits/dashes, a fresh one per invoice>, invoiceType: personal|company|donation, customerEmail, and for company: taxId + companyTitle} to issue the government e-invoice for a confirmed sales order (GET /sales-orders/:id/ecpay-invoice-preview first to see what will be issued; issuing is real and can only be undone by a human voiding it); POST /leaves, /attendance, /salary-slips for HR. Every income/expense document needs projectId. Reserved for humans (returns humanOnly): paying, payroll payout, void/cancel/delete, approvals, credit-limit override, accounts, keys and system settings. Lists are capped at 100 rows; use query filters.",
  get_quotation_pdf: "Generate the PDF of a quotation and return a download link valid for 7 days (no login needed) that can be forwarded to the customer.",
  send_quotation_pdf: "Send a quotation PDF now: email it as an attachment to the given address, and/or (webhook: true) POST it to the destination URL the owner configured. Sends immediately without human confirmation.",
  create_customer: "Create a formal customer immediately (no human confirmation). Same validation as the ERP: trimmed fields, valid Taiwan tax_id, rejects same-tenant duplicate tax_id/customer_code/name.",
  create_quotation: "Create a quotation immediately in Draft status. Items must reference existing item ids. A human must mark it Accepted in the ERP before it can become a sales order.",
  list_unmatched_bank_entries: "List unmatched bank statement lines with up to 5 candidate vouchers of the same amount that are not yet matched.",
  match_bank_entry: "Match one unmatched bank statement line to a voucher. Amounts must be equal and the voucher must not be matched elsewhere. Takes effect immediately; a human can unmatch it in the ERP.",
  preview_invoice_email: "Read-only check before emailing a sales invoice: recipient, subject and blockers. Does not send; a human sends it from the ERP invoice page.",
  request_quotation_email: "Ask for a quotation to be emailed to the customer. Creates a pending email only; a human must confirm it in the ERP before anything is sent. Body is rebuilt by the server from the quotation.",
  request_invoice_email: "Ask for a sales invoice to be emailed to the customer. Creates a pending email only; a human must confirm it in the ERP before anything is sent. Draft or cancelled invoices are refused.",
  create_receipt_draft: "Create a customer receipt (collection) draft that settles invoices. Requires human confirmation in the ERP before any money or ledger entry is recorded.",
  create_document_draft: "Create a draft (sales_invoice, payment, payment_request, quotation) for human confirmation in the ERP; never posts financial data by itself.",
  create_customer_draft: "Create AI-only customer master draft (ai_customer_drafts) for human review; never creates a formal customer. Rejects invalid Taiwan tax_id and same-tenant duplicate tax_id/customer_code/name (existing customers or pending drafts, exact match after trim).",
};
/** Serialized admission via transaction advisory lock; shared across replicas.
 * Each admitted HTTP request occupies an audit slot, even initialize/list calls. */
async function admit(tenantId: number, ip?: string) {
  const client = currentTenantClient();
  if (!client) throw new Error("Tenant context required");
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(826317,$1)",[tenantId]);
    const result = await client.query("SELECT count(*)::int AS n FROM ai_actions WHERE tenant_id=$1 AND tool='mcp_request' AND created_at > clock_timestamp()-interval '60 seconds'",[tenantId]);
    if (result.rows[0].n >= 60) { await client.query("COMMIT"); return false; }
    await db.insert(aiActionsTable).values({ tenantId, tool: "mcp_request", args: { redacted: true }, status: "ok", resultSummary: "Request admitted", ip: ip?.slice(0,128) });
    await client.query("COMMIT");
    return true;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
export async function auditedTool(tenantId: number, name: string, args: unknown, ip?: string, role: McpRole = "legacy") {
  return runWithTenant(tenantId, async () => {
    if (!Object.hasOwn(toolSchemas,name)) {
      await audit(name,args,"denied",ip,undefined,role);
      return { isError: true, content: [{ type: "text" as const, text: "Unknown tool" }] };
    }
    // 身分沒有這個工具的權限：拒絕並留下稽核紀錄
    const draftType = name === "create_document_draft" ? String((args as any)?.doc_type ?? "") : null;
    if (!roleAllows(role, name) || (draftType !== null && !roleAllowsDraftType(role, draftType))) {
      await audit(name,args,"denied",ip,undefined,role);
      return { isError: true, content: [{ type: "text" as const, text: `This identity (${role}) is not permitted to use ${name}` }] };
    }
    const schema = toolSchemas[name as ToolName];
    if (!schema.safeParse(args ?? {}).success) {
      await audit(name,args,"denied",ip,undefined,role);
      return { isError: true, content: [{ type: "text" as const, text: "Invalid tool arguments" }] };
    }
    try {
      // Transaction makes draft + success audit atomic; errors audited after rollback.
      const result = await db.transaction(async () => {
        // db is already bound to the same tenant client as this transaction.
        const value = await executeTool(name as ToolName,args ?? {});
        const target = name.startsWith("create_") ? Number((value as any)?.id) : name === "match_bank_entry" ? Number((value as any)?.entryId) : undefined;
        await audit(name,args,"ok",ip,target,role);
        return value;
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      await audit(name,args,"error",ip,undefined,role);
      // Only fixed, content-free duplicate messages are returned; never database errors.
      const text = error instanceof CustomerDraftConflictError
        ? `${error.message}; ${DIRECT_WRITE_TOOLS.has(name) ? "nothing was created" : "no draft created"}.`
        : DIRECT_WRITE_TOOLS.has(name) ? "Tool failed validation or could not complete; nothing was changed." : "Tool failed validation or could not complete; no financial data changed.";
      return { isError: true, content: [{ type: "text" as const, text }] };
    }
  });
}
const router = Router();
router.all("/", async (req,res) => {
  // 七期網站只有一家公司，沒設定 ERP_AI_TENANT_ID 時就用第一家（編號 1）
  const tenantId = Number(process.env.ERP_AI_TENANT_ID || 1);
  const identity = resolveIdentity(req.headers.authorization, process.env);
  if ((!identity.ok && identity.reason !== "unauthorized") || !Number.isSafeInteger(tenantId) || tenantId <= 0) {
    if (Number.isSafeInteger(tenantId) && tenantId > 0) {
      try { await runWithTenant(tenantId, () => audit("configuration",undefined,"denied",req.socket.remoteAddress)); }
      catch { /* Remain unavailable if audit storage itself is unavailable. */ }
    }
    res.status(503).json({ error: "MCP configuration unavailable" }); return;
  }
  const ip = req.socket.remoteAddress;
  if (!identity.ok) {
    try {
      await runWithTenant(tenantId, async () => {
        await audit("authentication",undefined,"denied",ip);
        if (req.body?.method === "tools/call") await audit(req.body?.params?.name,undefined,"denied",ip);
      });
    } catch { /* Denied-auth logging is best effort; never change 401 into 503. */ }
    res.status(401).json({ error: "Unauthorized" }); return;
  }
  const role = identity.role;
  try {
    const accepted = await runWithTenant(tenantId, async () => {
      return await admit(tenantId,ip) ? "ok" : "limited";
    });
    if (accepted !== "ok") {
      if (accepted === "limited") await runWithTenant(tenantId,async () => {
        await audit("rate_limit",undefined,"denied",ip);
        if (req.body?.method === "tools/call") await audit(req.body?.params?.name,undefined,"denied",ip);
      });
      res.status(accepted === "limited" ? 429 : 401).json({ error: accepted === "limited" ? "Rate limit exceeded" : "Unauthorized" }); return;
    }
    if (req.method !== "POST") { res.status(405).set("Allow","POST").end(); return; }
    // Disallow batching; one tools/call per admitted request. Also log invalid
    // tools/call envelopes before SDK schema validation can reject them.
    if (Array.isArray(req.body)) { await runWithTenant(tenantId,() => audit("batch",undefined,"denied",ip)); res.status(400).json({ error: "Batch requests not supported" }); return; }
    if (req.body?.method === "tools/call" && !CallToolRequestSchema.safeParse(req.body).success) {
      await runWithTenant(tenantId,() => audit("invalid_tool",undefined,"denied",ip));
    }
    const server = new Server({ name: `erp-ai (${ROLE_LABEL[role]})`, version: "1.2.0" }, { capabilities: { tools: {} } });
    // 只列出這個身分可以用的工具
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.entries(toolSchemas).filter(([name]) => ROLE_TOOLS[role].includes(name)).map(([name,schema]) => ({
      name, description: TOOL_DESCRIPTIONS[name as ToolName] ?? (name.startsWith("create_") ? "Create AI-only draft for human review; never post financial data" : "Tenant-scoped read only"),
      inputSchema: z.toJSONSchema(schema) as any,
    })) }));
    server.setRequestHandler(CallToolRequestSchema, req => auditedTool(tenantId, req.params.name, req.params.arguments, ip, role));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req,res,req.body);
  } catch {
    if (!res.headersSent) res.status(503).json({ error: "MCP unavailable; audit storage required" });
  }
});
export default router;
