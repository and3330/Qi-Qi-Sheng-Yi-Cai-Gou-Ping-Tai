import { tenantPool } from "./tenant-db";
import { tenantResendSender } from "./tenant-integrations";

export interface EmailSettings {
  senderName: string;
  replyTo: string | null;
  bankInfo: string;
  autoSendInvoice: boolean;
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const { rows } = await tenantPool.query(
    `SELECT sender_name AS "senderName", reply_to AS "replyTo", bank_info AS "bankInfo", auto_send_invoice AS "autoSendInvoice" FROM email_settings LIMIT 1`,
  );
  return rows[0] || { senderName: "", replyTo: null, bankInfo: "", autoSendInvoice: false };
}

/** 透過 Resend 寄信；回傳 Resend 郵件 id */
export async function sendEmail(opts: {
  to: string; subject: string; html: string; senderName?: string; replyTo?: string | null;
  /** 附件：content 是 base64 */
  attachments?: Array<{ filename: string; content: string }>;
}): Promise<string> {
  // 有填自己 Resend 的公司用自己的帳號與寄件信箱；沒填的用平台帳號，從 no-reply@yubonerp.com 寄
  const { apiKey, fromEmail } = await tenantResendSender();
  const from = `${(opts.senderName || "ERP 系統通知").replace(/[<>"\r\n]/g, "")} <${fromEmail}>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Resend 寄信失敗（HTTP ${res.status}）`);
  return data.id as string;
}

/** 開立發票後自動寄通知信（需在租戶請求情境內呼叫；失敗只記錄不拋錯） */
export async function autoSendInvoiceEmail(invoiceId: number): Promise<void> {
  try {
    const settings = await getEmailSettings();
    if (!settings.autoSendInvoice) return;
    const { buildEmailDraft } = await import("./email-templates");
    const draft = await buildEmailDraft("invoice", invoiceId, settings);
    if (!draft.to) {
      await logEmail({ docType: "invoice", docId: invoiceId, recipient: "", subject: draft.subject, status: "failed", error: "客戶未設定 Email", trigger: "auto" });
      return;
    }
    await sendEmail({ to: draft.to, subject: draft.subject, html: draft.html, senderName: settings.senderName, replyTo: settings.replyTo });
    await logEmail({ docType: "invoice", docId: invoiceId, recipient: draft.to, subject: draft.subject, status: "sent", trigger: "auto" });
  } catch (e: any) {
    await logEmail({ docType: "invoice", docId: invoiceId, recipient: "", subject: "發票通知", status: "failed", error: e.message, trigger: "auto" }).catch(() => {});
  }
}

export async function logEmail(entry: {
  docType: string; docId: number; recipient: string; subject: string;
  /** pending＝等人確認才寄；rejected＝有人決定不寄 */
  status: "sent" | "failed" | "pending" | "rejected"; error?: string | null; trigger?: "manual" | "auto" | "ai";
}): Promise<void> {
  await tenantPool.query(
    `INSERT INTO email_logs (doc_type, doc_id, recipient, subject, status, error, trigger)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [entry.docType, entry.docId, entry.recipient, entry.subject, entry.status, entry.error || null, entry.trigger || "manual"],
  );
}
