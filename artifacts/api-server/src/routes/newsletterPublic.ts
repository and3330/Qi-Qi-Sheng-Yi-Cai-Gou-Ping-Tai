/**
 * 公開電子報 API（v1）：以 API 金鑰驗證（Authorization: Bearer <key> 或 x-api-key），
 * 供外部系統訂閱/退訂/發送。另含退訂連結端點（無需金鑰）。
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  newsletterApiKeysTable,
  newsletterSubscribersTable,
  type NewsletterApiKey,
} from "@workspace/db";
import {
  enrollSubscriberInSequences,
  hashApiKey,
  sendEmail,
  NewsletterConfigError,
  ResendApiError,
} from "../lib/newsletter";

const router: IRouter = Router();

declare global {
  namespace Express {
    interface Request {
      newsletterApiKey?: NewsletterApiKey;
    }
  }
}

async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    const key = bearer || (typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : null);
    if (!key) {
      res.status(401).json({ error: "缺少 API 金鑰（Authorization: Bearer <key>）" });
      return;
    }
    const [row] = await db
      .select()
      .from(newsletterApiKeysTable)
      .where(eq(newsletterApiKeysTable.keyHash, hashApiKey(key)))
      .limit(1);
    if (!row || !row.isActive) {
      res.status(401).json({ error: "API 金鑰無效或已停用" });
      return;
    }
    void db
      .update(newsletterApiKeysTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(newsletterApiKeysTable.id, row.id))
      .then(() => {});
    req.newsletterApiKey = row;
    next();
  } catch (err) {
    req.log.error({ err }, "newsletter api key auth failed");
    res.status(500).json({ error: "Internal error" });
  }
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 外部訂閱 */
router.post("/newsletter/v1/subscribers", requireApiKey, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const name = typeof req.body?.name === "string" ? req.body.name : null;
  const tags = Array.isArray(req.body?.tags)
    ? (req.body.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  if (!emailRe.test(email)) {
    res.status(400).json({ error: "請提供有效的 email" });
    return;
  }
  const [existing] = await db
    .select()
    .from(newsletterSubscribersTable)
    .where(eq(newsletterSubscribersTable.email, email))
    .limit(1);
  if (existing) {
    if (existing.status === "unsubscribed") {
      const [row] = await db
        .update(newsletterSubscribersTable)
        .set({ status: "subscribed", updatedAt: new Date() })
        .where(eq(newsletterSubscribersTable.id, existing.id))
        .returning();
      res.json({ id: row.id, email: row.email, status: row.status, resubscribed: true });
      return;
    }
    res.json({ id: existing.id, email: existing.email, status: existing.status, existed: true });
    return;
  }
  const [row] = await db
    .insert(newsletterSubscribersTable)
    .values({ email, name, tags, source: "api" })
    .returning();
  await enrollSubscriberInSequences(row);
  res.status(201).json({ id: row.id, email: row.email, status: row.status });
});

/** 外部退訂 */
router.post("/newsletter/v1/unsubscribe", requireApiKey, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!emailRe.test(email)) {
    res.status(400).json({ error: "請提供有效的 email" });
    return;
  }
  const [row] = await db
    .update(newsletterSubscribersTable)
    .set({ status: "unsubscribed", updatedAt: new Date() })
    .where(eq(newsletterSubscribersTable.email, email))
    .returning();
  if (!row) {
    res.status(404).json({ error: "找不到此訂閱者" });
    return;
  }
  res.json({ id: row.id, email: row.email, status: row.status });
});

/** 外部發送單封郵件 */
router.post("/newsletter/v1/send", requireApiKey, async (req, res) => {
  if (req.newsletterApiKey!.permissions !== "full") {
    res.status(403).json({ error: "此金鑰無發送權限" });
    return;
  }
  const { from, to, subject, html } = req.body ?? {};
  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    typeof subject !== "string" ||
    typeof html !== "string" ||
    !emailRe.test(to.trim().toLowerCase())
  ) {
    res.status(400).json({ error: "請提供 from、to、subject、html" });
    return;
  }
  try {
    const result = await sendEmail({ from, to: to.trim(), subject, html });
    res.json({ ok: true, id: result?.id ?? null });
  } catch (err) {
    if (err instanceof NewsletterConfigError) {
      res.status(503).json({ error: err.message });
      return;
    }
    if (err instanceof ResendApiError) {
      res.status(502).json({ error: `Resend：${err.message}` });
      return;
    }
    throw err;
  }
});

const tokenRe = /^[a-f0-9]{32,}$/i;

function unsubscribePage(body: string) {
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>退訂電子報</title><body style="font-family:sans-serif;text-align:center;padding:60px 20px">${body}</body></html>`;
}

async function doUnsubscribe(token: string) {
  const [row] = await db
    .update(newsletterSubscribersTable)
    .set({ status: "unsubscribed", updatedAt: new Date() })
    .where(eq(newsletterSubscribersTable.unsubscribeToken, token))
    .returning();
  return row;
}

/**
 * 郵件底部退訂連結（無需金鑰）。以每位訂閱者專屬、不可猜測的權杖驗證身分，
 * 不接受直接以 email 退訂，避免任何人代他人退訂。
 *
 * GET 僅顯示確認頁面、不改變任何狀態 —— 郵件安全掃描器與連結預先擷取工具
 * 常會自動存取信件中的每個連結，若 GET 就直接退訂會造成使用者未操作卻被
 * 靜默退訂。實際退訂一律透過下方的 POST 端點（含表單送出與信箱用戶端的
 * 一鍵退訂 List-Unsubscribe=One-Click 語意）。
 */
router.get("/newsletter/unsubscribe", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (!tokenRe.test(token)) {
    res.status(400).send(unsubscribePage("<h2>無效的退訂連結</h2>"));
    return;
  }
  res.status(200).type("html").send(
    unsubscribePage(`
      <h2>確定要取消訂閱嗎？</h2>
      <p>確定後將不再收到我們的電子報。</p>
      <form method="post" action="/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}">
        <button type="submit" style="padding:10px 24px;font-size:14px;cursor:pointer">確定退訂</button>
      </form>
    `),
  );
});

/**
 * 實際執行退訂。供上方表單送出，亦符合信箱用戶端一鍵退訂
 * （RFC 8058 List-Unsubscribe=One-Click）以 POST 呼叫同一網址的慣例。
 */
router.post("/newsletter/unsubscribe", async (req, res) => {
  const token =
    typeof req.query.token === "string"
      ? req.query.token.trim()
      : typeof req.body?.token === "string"
        ? req.body.token.trim()
        : "";
  if (!tokenRe.test(token)) {
    res.status(400).send(unsubscribePage("<h2>無效的退訂連結</h2>"));
    return;
  }
  const row = await doUnsubscribe(token);
  if (!row) {
    res.status(404).send(unsubscribePage("<h2>無效的退訂連結</h2>"));
    return;
  }
  res
    .status(200)
    .type("html")
    .send(unsubscribePage(`<h2>已完成退訂</h2><p>${row.email} 將不再收到我們的電子報。</p>`));
});

export default router;
