import { Router, type IRouter } from "express";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { tenantPool } from "../lib/tenant-db";
import { getEmailSettings, sendEmail, logEmail } from "../lib/email";
import { buildEmailDraft, type EmailDocType } from "../lib/email-templates";

const router: IRouter = Router();
const ADMIN_ROLES = ["owner", "admin", "super_admin"];
/** 可寄送單據郵件的角色（業務/會計/管理職） */
const MAIL_ROLES = ["owner", "admin", "super_admin", "manager", "project_manager", "finance_admin", "accountant"];
const DOC_TYPES = new Set(["quotation", "sales_order", "invoice"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 去除換行等控制字元，防郵件標頭注入 */
const stripHeader = (s: string) => s.replace(/[\r\n\t]+/g, " ").trim();

// 寄信設定
router.get("/email-settings", requireAuth, requireRole(...ADMIN_ROLES), async (_req, res): Promise<void> => {
  res.json(await getEmailSettings());
});

router.put("/email-settings", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { senderName, replyTo, bankInfo, autoSendInvoice } = req.body || {};
  const cleanReplyTo = replyTo ? stripHeader(String(replyTo)) : null;
  if (cleanReplyTo && !EMAIL_RE.test(cleanReplyTo)) {
    res.status(400).json({ error: "回覆信箱格式不正確" });
    return;
  }
  await tenantPool.query(
    `INSERT INTO email_settings (sender_name, reply_to, bank_info, auto_send_invoice)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET sender_name=$1, reply_to=$2, bank_info=$3, auto_send_invoice=$4, updated_at=now()`,
    [stripHeader(String(senderName || "")), cleanReplyTo, String(bankInfo || ""), !!autoSendInvoice],
  );
  res.json({ ok: true });
});

// 預覽草稿
router.get("/email/preview", requireAuth, requireRole(...MAIL_ROLES), async (req, res): Promise<void> => {
  const docType = String(req.query.docType || "");
  const docId = parseInt(String(req.query.docId || ""), 10);
  if (!DOC_TYPES.has(docType) || !Number.isInteger(docId)) {
    res.status(400).json({ error: "docType/docId 無效" });
    return;
  }
  try {
    const settings = await getEmailSettings();
    const draft = await buildEmailDraft(docType as EmailDocType, docId, settings);
    res.json(draft);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// 確認後寄出：內容一律由伺服器依單據重建，僅允許覆寫收件人與主旨（防任意轉發濫用）
router.post("/email/send", requireAuth, requireRole(...MAIL_ROLES), async (req, res): Promise<void> => {
  const { docType, docId, to, subject } = req.body || {};
  if (!DOC_TYPES.has(docType) || !Number.isInteger(docId)) {
    res.status(400).json({ error: "docType/docId 無效" });
    return;
  }
  const settings = await getEmailSettings();
  let draft;
  try {
    draft = await buildEmailDraft(docType as EmailDocType, docId, settings);
  } catch (e: any) {
    res.status(404).json({ error: e.message });
    return;
  }
  const finalTo = typeof to === "string" && to.trim() ? stripHeader(to) : draft.to;
  if (!EMAIL_RE.test(finalTo)) {
    res.status(400).json({ error: "收件人 Email 格式不正確" });
    return;
  }
  const finalSubject = typeof subject === "string" && subject.trim() ? stripHeader(subject) : draft.subject;
  try {
    await sendEmail({ to: finalTo, subject: finalSubject, html: draft.html, senderName: settings.senderName, replyTo: settings.replyTo });
    await logEmail({ docType, docId, recipient: finalTo, subject: finalSubject, status: "sent", trigger: "manual" });
    res.json({ ok: true });
  } catch (e: any) {
    await logEmail({ docType, docId, recipient: finalTo, subject: finalSubject, status: "failed", error: e.message, trigger: "manual" }).catch(() => {});
    res.status(502).json({ error: e.message });
  }
});

/**
 * 可以被確認寄出的信：待確認的，或卡在「寄送中」超過 10 分鐘的。
 * 開始寄的時間暫存在 error 欄位（寄完會被結果覆蓋），這樣不用另外加欄位。
 */
const CLAIM_STAMP = `'claimed:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')`;
const CLAIMABLE = `(status = 'pending' OR (status = 'sending' AND error LIKE 'claimed:%'
  AND to_timestamp(substr(error, 9), 'YYYY-MM-DD"T"HH24:MI:SS') < (now() AT TIME ZONE 'UTC') - interval '10 minutes'))`;

// 待確認的信（AI 助理提出、還沒寄出）
router.get("/email/pending", requireAuth, requireRole(...MAIL_ROLES), async (_req, res): Promise<void> => {
  const { rows } = await tenantPool.query(
    `SELECT id, doc_type AS "docType", doc_id AS "docId", recipient, subject, trigger, created_at AS "createdAt"
     FROM email_logs WHERE ${CLAIMABLE} ORDER BY id DESC LIMIT 100`,
  );
  res.json(rows);
});

// 確認寄出：內容一樣由伺服器依單據重建，收件人與主旨用草稿上記的
router.post("/email/pending/:id/send", requireAuth, requireRole(...MAIL_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "編號格式不正確" }); return; }
  // 先把狀態從 pending 改掉再寄，兩個人同時按也只會寄一次
  const claimed = await tenantPool.query(
    `UPDATE email_logs SET status = 'sending', error = ${CLAIM_STAMP} WHERE id = $1 AND ${CLAIMABLE}
     RETURNING doc_type AS "docType", doc_id AS "docId", recipient, subject`, [id]);
  const pending = claimed.rows[0];
  if (!pending) { res.status(404).json({ error: "找不到這封待確認的信，可能已經處理過了" }); return; }
  const finish = (status: string, error: string | null) =>
    tenantPool.query(`UPDATE email_logs SET status = $2, error = $3 WHERE id = $1`, [id, status, error]);
  try {
    if (!EMAIL_RE.test(pending.recipient)) throw new Error("收件人 Email 格式不正確");
    const settings = await getEmailSettings();
    const draft = await buildEmailDraft(pending.docType as EmailDocType, pending.docId, settings);
    await sendEmail({ to: pending.recipient, subject: stripHeader(pending.subject), html: draft.html, senderName: settings.senderName, replyTo: settings.replyTo });
    await finish("sent", null);
    res.json({ ok: true });
  } catch (e: any) {
    await finish("failed", e.message).catch(() => {});
    res.status(502).json({ error: e.message });
  }
});

// 不寄：留下紀錄，不會寄出
router.post("/email/pending/:id/reject", requireAuth, requireRole(...MAIL_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "編號格式不正確" }); return; }
  const result = await tenantPool.query(`UPDATE email_logs SET status = 'rejected' WHERE id = $1 AND status = 'pending'`, [id]);
  if (result.rowCount === 0) { res.status(404).json({ error: "找不到這封待確認的信，可能已經處理過了" }); return; }
  res.json({ ok: true });
});

// 寄信紀錄（可依單據過濾）
router.get("/email/logs", requireAuth, requireRole(...MAIL_ROLES), async (req, res): Promise<void> => {
  const docType = req.query.docType ? String(req.query.docType) : null;
  const docId = req.query.docId ? parseInt(String(req.query.docId), 10) : null;
  const { rows } = await tenantPool.query(
    `SELECT id, doc_type AS "docType", doc_id AS "docId", recipient, subject, status, error, trigger, created_at AS "createdAt"
     FROM email_logs
     WHERE ($1::text IS NULL OR doc_type = $1) AND ($2::int IS NULL OR doc_id = $2)
     ORDER BY id DESC LIMIT 200`,
    [docType, docId],
  );
  res.json(rows);
});

export default router;
