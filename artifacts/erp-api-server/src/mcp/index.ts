import { createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { eq, and } from "drizzle-orm";
import { db, runWithTenant, currentTenantId, currentTenantClient, aiActionsTable, apiKeysTable } from "@workspace/erp-db";
import { MAX_ACTIONS, NO_ACTIONS, parseAgentConfig, runWithAgent, type AgentContext } from "./agent-caps";
import { loadKeyUser } from "../lib/api-key-user";
import { bearerProblem, mcpAuthHeader } from "./auth-help";
import { buildUserProfile } from "./user-identity";
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
  erp_whoami: "Call this first. Tells you whose key this is (the ERP user it represents), that user's role, and exactly which ERP modules and actions (view/create/edit/delete) that role allows. The key has no permissions of its own: everything follows this user's current role, the same as if they were logged in to the ERP.",
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
  create_receipt_draft: "Create a customer receipt (collection) draft. Each line settles either an invoice (invoice_id) or, for sales orders without an invoice such as Ecount historical orders, the sales order itself (sales_order_id). Requires human confirmation in the ERP before any money or ledger entry is recorded.",
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
/**
 * 在 ERP「API 金鑰」頁面建立的金鑰：Authorization: Bearer <金鑰>:<密鑰>。
 * 金鑰沒有自己的權限：可用的工具與能做的動作都跟著金鑰綁定的使用者目前的角色（老闆 2026-11-19）。
 * 沒有開放 AI 助理、還沒指定使用者、或使用者已停用的金鑰都不能用：
 * 金鑰和密鑰都對了才會回 denied 說明是哪一種（不對的人問不出金鑰狀態）。
 */
export type DbKeyDenied = { denied: string; tenantId: number };
export async function resolveDbKey(header: string | undefined): Promise<{ tenantId: number; role: McpRole; agent: AgentContext } | DbKeyDenied | null> {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const cut = token.indexOf(":");
  if (cut <= 0 || cut !== token.lastIndexOf(":")) return null;
  const [record] = await db.select().from(apiKeysTable).where(and(eq(apiKeysTable.apiKey, token.slice(0, cut)), eq(apiKeysTable.isActive, true))).limit(1);
  if (!record) return null;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const suppliedHash = createHash("sha256").update(token.slice(cut + 1)).digest("hex");
  if (!timingSafeEqual(digest(suppliedHash), digest(record.secretHash))) return null;
  const denied = (reason: string): DbKeyDenied => ({ denied: `金鑰「${record.keyName}」${reason}`, tenantId: record.tenantId });
  if (record.expiresAt && new Date(record.expiresAt) < new Date()) return denied("已經過期。請到 ERP「API 金鑰」頁建立新的金鑰。");
  const config = parseAgentConfig(record.agentConfig);
  if (!config.enabled) return denied("沒有開放給 AI 助理連線。請到 ERP「API 金鑰」頁點這把金鑰的「AI 助理」，打勾「開放給 AI 助理連線」。");
  if (!record.userId) return denied("還沒指定代表哪一位使用者，所以暫停使用。請到 ERP「API 金鑰」頁指定。");
  const profile = await runWithTenant(record.tenantId, async () => {
    const user = await loadKeyUser(record.tenantId, record.userId);
    return user ? buildUserProfile(record.tenantId, user) : null;
  });
  if (!profile) return denied("代表的使用者帳號已停用或不存在，所以暫停使用。");
  db.update(apiKeysTable).set({ lastUsedAt: new Date() }).where(eq(apiKeysTable.id, record.id)).execute().catch(() => {});
  // 四類動作不再由金鑰決定：照那個人的角色，ERP 自己的守衛會擋下他不能做的
  return { tenantId: record.tenantId, role: profile.mcpRole, agent: { keyId: record.id, keyName: record.keyName, actions: MAX_ACTIONS, profile } };
}

export async function auditedTool(tenantId: number, name: string, args: unknown, ip?: string, role: McpRole = "legacy", agent: AgentContext = { keyId: null, keyName: ROLE_LABEL[role], actions: NO_ACTIONS }) {
  return runWithTenant(tenantId, async () => runWithAgent(agent, async () => {
    if (!Object.hasOwn(toolSchemas,name)) {
      await audit(name,args,"denied",ip,undefined,role);
      return { isError: true, content: [{ type: "text" as const, text: "Unknown tool" }] };
    }
    // 身分沒有這個工具的權限：拒絕並留下稽核紀錄
    const draftType = name === "create_document_draft" ? String((args as any)?.doc_type ?? "") : null;
    const toolAllowed = agent.profile ? agent.profile.tools.includes(name) : roleAllows(role, name);
    if (!toolAllowed || (draftType !== null && !roleAllowsDraftType(role, draftType))) {
      await audit(name,args,"denied",ip,undefined,role);
      const who = agent.profile ? `${agent.profile.user.displayName}（${agent.profile.roleLabel}）` : role;
      return { isError: true, content: [{ type: "text" as const, text: `This key acts as ${who}, whose role is not permitted to use ${name}. Call erp_whoami to see what this user can do.` }] };
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
  }));
}
const router = Router();
router.all("/", async (req,res) => {
  // ERP 裡建立的金鑰優先；不是這種格式或不認得，才看環境變數設定的舊金鑰
  const authHeader = mcpAuthHeader(req.headers);
  let resolved: Awaited<ReturnType<typeof resolveDbKey>> = null;
  try { resolved = await resolveDbKey(authHeader); } catch { res.status(503).json({ error: "MCP unavailable" }); return; }
  // 金鑰和密鑰都對，但金鑰暫停中（過期、沒開放 AI 助理、沒指定使用者、使用者停用）：說明是哪一種
  if (resolved && "denied" in resolved) {
    const paused = resolved;
    try { await runWithTenant(paused.tenantId, () => audit("authentication", undefined, "denied", req.socket.remoteAddress)); } catch { /* best effort */ }
    res.status(401).json({ error: "Unauthorized", reason: paused.denied }); return;
  }
  const dbKey = resolved;
  // 長得像 ERP 金鑰（金鑰:密鑰）但不認得或已停用：直接回未授權
  if (!dbKey && /^Bearer [^:\s]+:[^:\s]+$/.test(authHeader || "")) { res.status(401).json({ error: "Unauthorized", reason: bearerProblem(authHeader) }); return; }
  const tenantId = dbKey ? dbKey.tenantId : Number(process.env.ERP_AI_TENANT_ID || 1) /* 七期只有一家公司，沒設定就用第一家 */;
  const identity: ReturnType<typeof resolveIdentity> = dbKey ? { ok: true, role: dbKey.role } : resolveIdentity(authHeader, process.env);
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
    res.status(401).json({ error: "Unauthorized", reason: bearerProblem(authHeader) }); return;
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
    const profile = dbKey?.agent.profile;
    const serverName = profile ? `erp-ai (${profile.user.displayName}・${profile.roleLabel})` : `erp-ai (${ROLE_LABEL[role]})`;
    const server = new Server({ name: serverName, version: "1.3.0" }, {
      capabilities: { tools: {} },
      ...(profile ? { instructions: `這把金鑰代表 ERP 使用者「${profile.user.displayName}」，角色是「${profile.roleLabel}」。金鑰沒有自己的權限，能做什麼完全跟著這個人的角色。先呼叫 erp_whoami 看他能用哪些功能。` } : {}),
    });
    // 只列出這個身分可以用的工具（ERP 金鑰：跟著綁定使用者的角色）
    const visibleTools = profile ? profile.tools : ROLE_TOOLS[role];
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.entries(toolSchemas).filter(([name]) => visibleTools.includes(name)).map(([name,schema]) => ({
      name, description: TOOL_DESCRIPTIONS[name as ToolName] ?? (name.startsWith("create_") ? "Create AI-only draft for human review; never post financial data" : "Tenant-scoped read only"),
      inputSchema: z.toJSONSchema(schema) as any,
    })) }));
    server.setRequestHandler(CallToolRequestSchema, req => auditedTool(tenantId, req.params.name, req.params.arguments, ip, role, dbKey?.agent));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req,res,req.body);
  } catch {
    if (!res.headersSent) res.status(503).json({ error: "MCP unavailable; audit storage required" });
  }
});
export default router;
