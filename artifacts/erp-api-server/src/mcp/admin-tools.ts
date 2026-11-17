import { z } from "zod/v4";
import { currentTenantId } from "@workspace/erp-db";
import { internalHeaders } from "../lib/internal-auth";
import { buildQuotationPdf, quotationPdfPath } from "../lib/quotation-pdf";
import { getEmailSettings, logEmail, sendEmail } from "../lib/email";
import { judgeRequest, normalizePath, trimResult } from "./admin-guard";
import { describeEndpoint } from "../lib/api-catalog";

/**
 * AI 全權身分的工具：
 * - erp_list_endpoints／erp_request：操作 ERP 的所有模組（採購、庫存、人事、製造、資產、會計…）。
 *   做法是在伺服器內部轉呼叫既有的 /api 路由，所以必填、關帳、庫存、信用額度這些檢查全部照常生效。
 * - get_quotation_pdf／send_quotation_pdf：報價單 PDF 的下載連結、寄 Email、送到指定網址。
 */

const id = z.number().int().positive();
export const adminToolSchemas = {
  erp_list_endpoints: z.object({ keyword: z.string().trim().max(60).optional() }).strict(),
  erp_request: z.object({
    method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
    path: z.string().min(2).max(300),
    query: z.record(z.string().max(60), z.union([z.string().max(300), z.number(), z.boolean()])).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  get_quotation_pdf: z.object({ quotation_id: id }).strict(),
  send_quotation_pdf: z.object({
    quotation_id: id,
    email: z.string().trim().max(200).optional(),
    webhook: z.boolean().optional(),
    message: z.string().trim().max(500).optional(),
  }).strict(),
};

// ───────── 端點目錄 ─────────
interface Endpoint { method: string; path: string }
let catalog: Endpoint[] | null = null;
function collect(stack: any[], out: Endpoint[]): void {
  for (const layer of stack || []) {
    if (layer.route?.path) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const path of paths) {
        if (typeof path !== "string") continue;
        for (const [method, on] of Object.entries(layer.route.methods || {})) if (on && method !== "_all") out.push({ method: method.toUpperCase(), path });
      }
    } else if (layer.handle?.stack) collect(layer.handle.stack, out);
  }
}
export async function endpointCatalog(): Promise<Endpoint[]> {
  if (!catalog) {
    const all: Endpoint[] = [];
    // 用到時才載入整套路由，避免 MCP 模組一載入就把所有路由拉進來
    const apiRouter = (await import("../routes")).default;
    collect((apiRouter as any).stack, all);
    const seen = new Set<string>();
    catalog = all.filter(e => { const key = `${e.method} ${e.path}`; if (seen.has(key)) return false; seen.add(key); return true; })
      .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  }
  return catalog;
}

export async function listEndpoints(args: unknown) {
  const p = adminToolSchemas.erp_list_endpoints.parse(args);
  const keyword = p.keyword?.toLowerCase();
  // 路徑參數（:id）用 1 代入來判斷這個端點 AI 能不能用
  const rows = (await endpointCatalog())
    .filter(e => {
      if (!keyword) return true;
      if (e.path.toLowerCase().includes(keyword)) return true;
      // 也可以用中文找：模組或說明裡有這個字就算（例如「合約」「請款」「物料」）
      const d = describeEndpoint(e.method, e.path);
      return d.module.includes(p.keyword!) || d.label.includes(p.keyword!) || d.description.includes(p.keyword!);
    })
    .map(e => {
      const verdict = judgeRequest(e.method, e.path.replace(/:[A-Za-z]+\??/g, "1"), {});
      const described = describeEndpoint(e.method, e.path);
      return { method: e.method, path: e.path, module: described.module, description: described.description, ...(verdict.allowed ? {} : { humanOnly: verdict.reason }) };
    });
  const usable = rows.filter(row => !("humanOnly" in row));
  return {
    total: rows.length, usable: usable.length,
    endpoints: (keyword ? rows : usable).slice(0, 400),
    note: keyword ? undefined : "只列出 AI 可以用的端點；加 keyword（英文路徑或中文都可以，例如 purchase、salary、合約、請款、物料）可以縮小範圍並看到哪些留給人。",
    howTo: "先用 GET 讀清單或單筆了解欄位，再用 POST 新增、PATCH 修改。金額多為含稅；每一筆收入與支出都要帶 projectId。",
    tips: [
      "歷史單（Ecount 搬來的）：銷貨單 orderSource=ecount、報價／採購／進貨單 extraFields.legacy=true、收款單明細 legacy=true。只能改標題、專案、部門、備註這類不影響帳的欄位；金額、品項、狀態、客戶、日期不能改，也不能作廢或轉單。",
      "歷史發票與歷史庫存單（調撥、領用、盤點）放在 legacy-documents，用 GET /invoices/legacy、GET /sales-orders/:id/legacy-invoices 查，唯讀。",
      "員工請款：POST /my-requests 會直接送審；財務代建用 POST /payment-requests。核准、駁回、付款要由人按。",
      "人事合約在 /hr-contracts（員工、老師、臨時人員），客戶與供應商的合約在 /contracts，兩邊不會混在一起。",
      "任務可以用 taskGroup 歸組；要一次改多筆用 POST /batch/tasks/update（這個端點留給人，AI 請逐筆 PATCH /tasks/:id）。",
      "停用的資料：倉庫預設只列啟用中的（includeInactive=1 看全部）；員工 status=Active 才是在職；物料清單與工作站 status=Inactive 是已停用。",
    ],
  };
}

// ───────── 通用操作 ─────────
const baseUrl = (): string => {
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port <= 0) throw new Error("Server port unavailable");
  return `http://127.0.0.1:${port}`;
};

export async function erpRequest(args: unknown) {
  const p = adminToolSchemas.erp_request.parse(args);
  const tenantId = currentTenantId();
  if (!tenantId) throw new Error("Tenant context required");
  const path = normalizePath(p.path);
  if (!path) return { ok: false, status: 400, error: "路徑格式不正確：請用 /purchase-orders 這種以斜線開頭的路徑，查詢條件放在 query" };
  const verdict = judgeRequest(p.method, path, p.body);
  if (!verdict.allowed) return { ok: false, status: 403, humanOnly: true, error: verdict.reason };

  const url = new URL(`/api${path}`, baseUrl());
  for (const [key, value] of Object.entries(p.query ?? {})) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    method: p.method,
    headers: { "content-type": "application/json", ...internalHeaders(tenantId) },
    body: p.method === "GET" ? undefined : JSON.stringify(p.body ?? {}),
    signal: AbortSignal.timeout(60_000),
  });
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    return { ok: response.ok, status: response.status, note: response.ok ? "這個端點回傳的不是資料（可能是檔案），無法在這裡顯示" : "操作沒有成功" };
  }
  const json: any = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, status: response.status, error: json?.error || json?.message || "操作沒有成功" };
  const trimmed = trimResult(json);
  return { ok: true, status: response.status, data: trimmed.data, ...(trimmed.truncated ? { truncated: true, total: trimmed.total, note: "資料太多只回前 100 筆，請用 query 加上搜尋或日期條件" } : {}) };
}

// ───────── 報價單 PDF ─────────
const publicBase = (): string => (process.env.PUBLIC_BASE_URL || `https://${(process.env.REPLIT_DOMAINS || "").split(",")[0]}`).replace(/\/+$/, "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function getQuotationPdf(args: unknown) {
  const p = adminToolSchemas.get_quotation_pdf.parse(args);
  const tenantId = currentTenantId();
  if (!tenantId) throw new Error("Tenant context required");
  const pdf = await buildQuotationPdf(p.quotation_id);
  const link = quotationPdfPath(tenantId, p.quotation_id);
  return {
    quotationId: p.quotation_id, quotationNumber: pdf.quotationNumber, customerName: pdf.customerName, grandTotal: pdf.grandTotal,
    fileName: pdf.fileName, sizeBytes: pdf.bytes.length, downloadUrl: publicBase() + link.path, expiresAt: link.expiresAt,
    note: "下載連結 7 天內有效，拿到連結的人不用登入就能下載這一張報價單。",
  };
}

/** 把 PDF 送出去：寄到指定 Email（附件），以及／或送到老闆預先設定的網址 */
export async function sendQuotationPdf(args: unknown) {
  const p = adminToolSchemas.send_quotation_pdf.parse(args);
  const tenantId = currentTenantId();
  if (!tenantId) throw new Error("Tenant context required");
  if (!p.email && !p.webhook) return { ok: false, error: "請指定 email（收件人）或 webhook: true（送到預先設定的網址）" };
  if (p.email && !EMAIL_RE.test(p.email)) return { ok: false, error: "Email 格式不正確" };
  const webhookUrl = (process.env.ERP_AI_PDF_WEBHOOK_URL || "").trim();
  // 正式環境只接受 https；本機開發時允許送到自己電腦上的測試接收端
  const webhookOk = /^https:\/\//.test(webhookUrl) || (process.env.NODE_ENV !== "production" && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(webhookUrl));
  if (p.webhook && !webhookOk) return { ok: false, error: "還沒設定接收 PDF 的網址：請老闆在 Replit 的 Secrets 設定 ERP_AI_PDF_WEBHOOK_URL（https 開頭）" };

  const pdf = await buildQuotationPdf(p.quotation_id);
  const link = quotationPdfPath(tenantId, p.quotation_id);
  const downloadUrl = publicBase() + link.path;
  const base64 = Buffer.from(pdf.bytes).toString("base64");
  const result: Record<string, unknown> = { ok: true, quotationNumber: pdf.quotationNumber, fileName: pdf.fileName, downloadUrl, expiresAt: link.expiresAt };

  if (p.email) {
    const settings = await getEmailSettings();
    const subject = `報價單 ${pdf.quotationNumber}${pdf.customerName ? `（${pdf.customerName}）` : ""}`;
    const escape = (text: string) => text.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
    const html = `<p>您好，</p><p>${escape(p.message || "附上報價單，請查收。")}</p><p>報價單號：${escape(pdf.quotationNumber)}<br>合計：NT$ ${pdf.grandTotal.toLocaleString("en-US")}</p><p>也可以從這個連結下載（7 天內有效）：<br><a href="${downloadUrl}">${escape(pdf.fileName)}</a></p>`;
    try {
      await sendEmail({ to: p.email, subject, html, senderName: settings.senderName, replyTo: settings.replyTo, attachments: [{ filename: pdf.fileName, content: base64 }] });
      await logEmail({ docType: "quotation", docId: p.quotation_id, recipient: p.email, subject, status: "sent", trigger: "ai" });
      result.email = { sent: true, to: p.email };
    } catch (error: any) {
      await logEmail({ docType: "quotation", docId: p.quotation_id, recipient: p.email, subject, status: "failed", error: String(error?.message || error).slice(0, 300), trigger: "ai" }).catch(() => {});
      result.email = { sent: false, error: "信沒有寄出去（寄信服務沒有回應或尚未設定）" };
      result.ok = false;
    }
  }
  if (p.webhook) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          type: "quotation_pdf", quotationId: p.quotation_id, quotationNumber: pdf.quotationNumber, customerName: pdf.customerName,
          grandTotal: pdf.grandTotal, fileName: pdf.fileName, downloadUrl, expiresAt: link.expiresAt, message: p.message || null,
          contentType: "application/pdf", contentBase64: base64,
        }),
      });
      result.webhook = { delivered: response.ok, status: response.status };
      if (!response.ok) result.ok = false;
    } catch {
      result.webhook = { delivered: false, error: "指定的網址沒有回應" };
      result.ok = false;
    }
  }
  return result;
}
