import { tenantPool } from "./tenant-db";
import type { EmailSettings } from "./email";

export type EmailDocType = "quotation" | "sales_order" | "invoice";

export interface EmailDraft {
  to: string;
  customerName: string;
  subject: string;
  html: string;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtMoney = (n: unknown, currency = "TWD") =>
  `${currency === "TWD" ? "NT$" : currency + " "}${Number(n || 0).toLocaleString("zh-TW")}`;

function itemRows(items: any[], currency: string): string {
  if (!Array.isArray(items) || items.length === 0) return "";
  const rows = items.map((it: any) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(it.itemName || it.name || it.description || "-")}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${esc(it.quantity ?? it.qty ?? "")}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${fmtMoney(it.unitPrice ?? it.rate ?? 0, currency)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${fmtMoney(it.amount ?? (Number(it.quantity ?? it.qty ?? 0) * Number(it.unitPrice ?? it.rate ?? 0)), currency)}</td>
    </tr>`).join("");
  return `
  <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:14px;">
    <thead><tr style="background:#f5f5f5;">
      <th style="padding:6px 8px;text-align:left;">品項</th>
      <th style="padding:6px 8px;text-align:right;">數量</th>
      <th style="padding:6px 8px;text-align:right;">單價</th>
      <th style="padding:6px 8px;text-align:right;">金額</th>
    </tr></thead><tbody>${rows}</tbody>
  </table>`;
}

function shell(senderName: string, title: string, body: string): string {
  return `
  <div style="font-family:'Microsoft JhengHei',Arial,sans-serif;max-width:640px;margin:0 auto;color:#333;">
    <div style="background:#1f2937;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
      <div style="font-size:16px;font-weight:bold;">${esc(senderName || "ERP 系統通知")}</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 8px 8px;">
      <h2 style="font-size:18px;margin:0 0 12px;">${esc(title)}</h2>
      ${body}
      <p style="color:#888;font-size:12px;margin-top:24px;">此郵件由系統自動發送，若有疑問請直接回覆本信。</p>
    </div>
  </div>`;
}

function bankBlock(bankInfo: string): string {
  if (!bankInfo.trim()) return "";
  return `
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;margin:16px 0;">
    <div style="font-weight:bold;margin-bottom:6px;">匯款帳戶資訊</div>
    <div style="white-space:pre-line;font-size:14px;">${esc(bankInfo)}</div>
  </div>`;
}

/** 依單據類型與 ID 產生郵件草稿（收件人取客戶 email） */
export async function buildEmailDraft(docType: EmailDocType, docId: number, settings: EmailSettings): Promise<EmailDraft> {
  if (docType === "quotation") {
    const { rows } = await tenantPool.query(
      `SELECT q.*, c.email AS customer_email, c.name AS cname FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id WHERE q.id = $1`, [docId]);
    const q = rows[0];
    if (!q) throw new Error("找不到報價單");
    const name = q.cname || q.customer_name || "客戶";
    const body = `
      <p>${esc(name)} 您好：</p>
      <p>附上報價單 <b>${esc(q.quotation_number)}</b>（報價日期 ${esc(q.quotation_date)}${q.valid_until ? `，有效期限至 ${esc(q.valid_until)}` : ""}）。</p>
      ${itemRows(q.items, q.currency)}
      <p style="text-align:right;font-size:15px;"><b>總計：${fmtMoney(q.grand_total, q.currency)}</b></p>
      ${q.notes ? `<p style="white-space:pre-line;">${esc(q.notes)}</p>` : ""}
      <p>如有任何問題，歡迎與我們聯繫，謝謝！</p>`;
    return {
      to: q.customer_email || "",
      customerName: name,
      subject: `【報價單】${q.quotation_number}${settings.senderName ? `｜${settings.senderName}` : ""}`,
      html: shell(settings.senderName, `報價單 ${q.quotation_number}`, body),
    };
  }

  if (docType === "sales_order") {
    const { rows } = await tenantPool.query(
      `SELECT s.*, c.email AS customer_email, c.name AS cname FROM sales_orders s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = $1`, [docId]);
    const s = rows[0];
    if (!s) throw new Error("找不到銷售訂單");
    const name = s.cname || "客戶";
    const body = `
      <p>${esc(name)} 您好：</p>
      <p>感謝您的訂購，以下為訂單 <b>${esc(s.order_number)}</b> 明細（訂單日期 ${esc(s.order_date)}${s.delivery_date ? `，預計交期 ${esc(s.delivery_date)}` : ""}）。</p>
      ${itemRows(s.items, "TWD")}
      <p style="text-align:right;font-size:15px;"><b>總計：${fmtMoney(s.total_amount)}</b></p>
      <p>如有任何問題，歡迎與我們聯繫，謝謝！</p>`;
    return {
      to: s.customer_email || "",
      customerName: name,
      subject: `【訂單明細】${s.order_number}${settings.senderName ? `｜${settings.senderName}` : ""}`,
      html: shell(settings.senderName, `訂單明細 ${s.order_number}`, body),
    };
  }

  // invoice
  const { rows } = await tenantPool.query(
    `SELECT i.*, c.email AS customer_email, c.name AS cname FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = $1`, [docId]);
  const inv = rows[0];
  if (!inv) throw new Error("找不到發票");
  const name = inv.cname || "客戶";
  const invNo = inv.ecpay_invoice_number || inv.gov_invoice_number || inv.invoice_number;
  const invDate = inv.ecpay_invoice_date || inv.invoice_date;
  const body = `
    <p>${esc(name)} 您好：</p>
    <p>您的發票已開立，資訊如下：</p>
    <table style="font-size:14px;margin:8px 0;">
      <tr><td style="padding:4px 12px 4px 0;color:#666;">發票號碼</td><td><b>${esc(invNo)}</b></td></tr>
      ${inv.ecpay_random_number ? `<tr><td style="padding:4px 12px 4px 0;color:#666;">隨機碼</td><td>${esc(inv.ecpay_random_number)}</td></tr>` : ""}
      <tr><td style="padding:4px 12px 4px 0;color:#666;">開立日期</td><td>${esc(invDate)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">金額（含稅）</td><td><b>${fmtMoney(inv.total_amount, inv.currency)}</b></td></tr>
      ${inv.due_date ? `<tr><td style="padding:4px 12px 4px 0;color:#666;">付款期限</td><td>${esc(inv.due_date)}</td></tr>` : ""}
    </table>
    ${itemRows(inv.items, inv.currency)}
    ${bankBlock(settings.bankInfo)}
    <p>匯款後煩請告知，我們將盡快為您核銷，謝謝！</p>`;
  return {
    // 客戶主檔沒有 Email 時，退回開立電子發票時填寫的買受人 Email
    to: inv.customer_email || inv.ecpay_buyer_email || "",
    customerName: name,
    subject: `【發票通知】發票號碼 ${invNo}${settings.senderName ? `｜${settings.senderName}` : ""}`,
    html: shell(settings.senderName, `發票通知 ${invNo}`, body),
  };
}
