/**
 * 電子報服務層：Resend 整合（域名、寄信）、活動批次發送、序列處理。
 *
 * 未設定 RESEND_API_KEY 時，所有需要寄信/呼叫 Resend 的操作會擲出
 * NewsletterConfigError，由路由層轉為清楚的錯誤訊息。
 */
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getPublicBaseUrl } from "./socialService";
import {
  db,
  newsletterCampaignsTable,
  newsletterDomainsTable,
  newsletterSendLogsTable,
  newsletterSequenceEnrollmentsTable,
  newsletterSequenceStepsTable,
  newsletterSequencesTable,
  newsletterSubscribersTable,
  type NewsletterSubscriber,
} from "@workspace/db";
import { logger } from "./logger";

export const BATCH_SIZE = 10;
export const BATCH_DELAY_MS = 1000;

const RESEND_API = "https://api.resend.com";

export class NewsletterConfigError extends Error {
  constructor() {
    super("尚未設定 RESEND_API_KEY，請先於環境變數設定 Resend API 金鑰");
  }
}

export class ResendApiError extends Error {}

export function resendConfigured(): boolean {
  return !!process.env["RESEND_API_KEY"];
}

/** API 金鑰僅儲存 sha256 雜湊，原始金鑰只在建立當下回傳一次。 */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

async function resendFetch(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<any> {
  const key = process.env["RESEND_API_KEY"];
  if (!key) throw new NewsletterConfigError();
  const res = await fetch(`${RESEND_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-json */
  }
  if (!res.ok) {
    const message =
      (json && (json.message || json.error)) || `Resend API 錯誤 (${res.status})`;
    throw new ResendApiError(String(message));
  }
  return json;
}

/* ---------------- 域名 ---------------- */

export async function addDomain(domain: string) {
  const created = await resendFetch("/domains", {
    method: "POST",
    body: { name: domain },
  });
  const [row] = await db
    .insert(newsletterDomainsTable)
    .values({
      domain,
      resendDomainId: created?.id ?? null,
      status: created?.status ?? "pending",
      dnsRecords: created?.records ?? null,
    })
    .returning();
  return row;
}

export async function verifyDomain(id: number) {
  const [row] = await db
    .select()
    .from(newsletterDomainsTable)
    .where(eq(newsletterDomainsTable.id, id))
    .limit(1);
  if (!row) return null;
  if (!row.resendDomainId) throw new ResendApiError("此域名缺少 Resend 域名 ID");
  await resendFetch(`/domains/${row.resendDomainId}/verify`, { method: "POST" });
  const status = await resendFetch(`/domains/${row.resendDomainId}`);
  const [updated] = await db
    .update(newsletterDomainsTable)
    .set({
      status: status?.status ?? row.status,
      dnsRecords: status?.records ?? row.dnsRecords,
    })
    .where(eq(newsletterDomainsTable.id, id))
    .returning();
  return updated;
}

export async function removeDomain(id: number) {
  const [row] = await db
    .select()
    .from(newsletterDomainsTable)
    .where(eq(newsletterDomainsTable.id, id))
    .limit(1);
  if (!row) return false;
  if (row.resendDomainId) {
    try {
      await resendFetch(`/domains/${row.resendDomainId}`, { method: "DELETE" });
    } catch (err) {
      // Resend 端不存在也允許刪除本地記錄
      logger.warn({ err }, "resend domain delete failed; removing local row anyway");
    }
  }
  await db.delete(newsletterDomainsTable).where(eq(newsletterDomainsTable.id, id));
  return true;
}

/* ---------------- 寄信 ---------------- */

function unsubscribeUrl(unsubscribeToken: string) {
  // getPublicBaseUrl() 會在無法取得公開網域時丟出例外，
  // 我們寧可讓寄信失敗，也不要寄出一封退訂連結指向錯誤網域的郵件。
  return `${getPublicBaseUrl()}/api/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
}

function appendUnsubscribeFooter(html: string, unsubUrl: string) {
  return `${html}\n<p style="font-size:12px;color:#888;margin-top:24px;text-align:center">若不想再收到此郵件，<a href="${unsubUrl}">點此退訂</a></p>`;
}

export async function sendEmail(input: {
  from: string;
  to: string;
  subject: string;
  html: string;
  /** 提供訂閱者專屬的退訂權杖時，會在郵件底部附上退訂連結（不可用 email 直接猜測），並附上標準 List-Unsubscribe 標頭。 */
  unsubscribeToken?: string;
}) {
  let html = input.html;
  let headers: Record<string, string> | undefined;
  if (input.unsubscribeToken) {
    const url = unsubscribeUrl(input.unsubscribeToken);
    html = appendUnsubscribeFooter(input.html, url);
    // 標準一鍵退訂標頭（RFC 8058），讓 Gmail/Outlook 等信箱用戶端顯示原生退訂按鈕，
    // 並直接以 POST 呼叫本系統的退訂端點，而不需使用者點開郵件內文的連結。
    headers = {
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }
  return resendFetch("/emails", {
    method: "POST",
    body: { from: input.from, to: [input.to], subject: input.subject, html, ...(headers ? { headers } : {}) },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 取活動的收件人（已訂閱、符合標籤篩選） */
async function campaignRecipients(tagFilter: string | null) {
  const subs = await db
    .select()
    .from(newsletterSubscribersTable)
    .where(eq(newsletterSubscribersTable.status, "subscribed"));
  if (!tagFilter) return subs;
  return subs.filter(
    (s) => Array.isArray(s.tags) && (s.tags as string[]).includes(tagFilter),
  );
}

/**
 * 批次發送活動郵件（BATCH_SIZE=10、間隔 BATCH_DELAY_MS=1000）。
 * 呼叫前活動須已被標記為 sending（以條件式 UPDATE 取得所有權，避免重複發送）。
 */
export async function sendCampaign(campaignId: number) {
  const [campaign] = await db
    .select()
    .from(newsletterCampaignsTable)
    .where(eq(newsletterCampaignsTable.id, campaignId))
    .limit(1);
  if (!campaign) return;

  const recipients = await campaignRecipients(campaign.tagFilter);
  await db
    .update(newsletterCampaignsTable)
    .set({ recipientCount: recipients.length, updatedAt: new Date() })
    .where(eq(newsletterCampaignsTable.id, campaignId));

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (sub) => {
        try {
          await sendEmail({
            from: campaign.fromEmail,
            to: sub.email,
            subject: campaign.subject,
            html: campaign.htmlContent,
            unsubscribeToken: sub.unsubscribeToken,
          });
          sent++;
          await db.insert(newsletterSendLogsTable).values({
            campaignId,
            subscriberId: sub.id,
            email: sub.email,
            subject: campaign.subject,
            status: "sent",
          });
        } catch (err) {
          failed++;
          await db.insert(newsletterSendLogsTable).values({
            campaignId,
            subscriberId: sub.id,
            email: sub.email,
            subject: campaign.subject,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
    if (i + BATCH_SIZE < recipients.length) await sleep(BATCH_DELAY_MS);
  }

  await db
    .update(newsletterCampaignsTable)
    .set({
      status: failed > 0 && sent === 0 ? "failed" : "sent",
      sentAt: new Date(),
      sentCount: sent,
      failedCount: failed,
      updatedAt: new Date(),
    })
    .where(eq(newsletterCampaignsTable.id, campaignId));
  logger.info({ campaignId, sent, failed }, "newsletter campaign send finished");
}

/** 條件式取得活動所有權並開始發送（回傳 false 表示狀態不允許或已被他人接手） */
export async function claimAndSendCampaign(
  campaignId: number,
  fromStatuses: string[],
) {
  const [claimed] = await db
    .update(newsletterCampaignsTable)
    .set({ status: "sending", updatedAt: new Date() })
    .where(
      and(
        eq(newsletterCampaignsTable.id, campaignId),
        inArray(newsletterCampaignsTable.status, fromStatuses),
      ),
    )
    .returning({ id: newsletterCampaignsTable.id });
  if (!claimed) return false;
  // 非同步執行批次發送（不阻塞請求）
  void sendCampaign(campaignId).catch(async (err) => {
    logger.error({ err, campaignId }, "sendCampaign failed");
    await db
      .update(newsletterCampaignsTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(newsletterCampaignsTable.id, campaignId));
  });
  return true;
}

/* ---------------- 排程與序列背景處理 ---------------- */

/** 每分鐘：處理到期的排程活動 */
export async function processScheduledCampaigns() {
  if (!resendConfigured()) return;
  const due = await db
    .select({ id: newsletterCampaignsTable.id })
    .from(newsletterCampaignsTable)
    .where(
      and(
        eq(newsletterCampaignsTable.status, "scheduled"),
        lte(newsletterCampaignsTable.scheduledAt, new Date()),
      ),
    );
  for (const c of due) {
    await claimAndSendCampaign(c.id, ["scheduled"]);
  }
}

/** 新訂閱者自動加入所有啟用中的序列 */
export async function enrollSubscriberInSequences(subscriber: NewsletterSubscriber) {
  const active = await db
    .select()
    .from(newsletterSequencesTable)
    .where(eq(newsletterSequencesTable.isActive, true));
  for (const seq of active) {
    const [firstStep] = await db
      .select()
      .from(newsletterSequenceStepsTable)
      .where(eq(newsletterSequenceStepsTable.sequenceId, seq.id))
      .orderBy(asc(newsletterSequenceStepsTable.stepOrder))
      .limit(1);
    const nextSendAt = firstStep
      ? new Date(Date.now() + firstStep.delayDays * 86400_000)
      : null;
    await db
      .insert(newsletterSequenceEnrollmentsTable)
      .values({
        sequenceId: seq.id,
        subscriberId: subscriber.id,
        currentStep: 0,
        status: firstStep ? "active" : "completed",
        nextSendAt,
      })
      .onConflictDoNothing();
  }
}

/** 定期：寄出到期的序列步驟並推進下一步 */
export async function processSequenceEnrollments() {
  if (!resendConfigured()) return;
  const due = await db
    .select()
    .from(newsletterSequenceEnrollmentsTable)
    .where(
      and(
        eq(newsletterSequenceEnrollmentsTable.status, "active"),
        lte(newsletterSequenceEnrollmentsTable.nextSendAt, new Date()),
      ),
    )
    .limit(200);

  for (const enrollment of due) {
    // 條件式清空 nextSendAt 取得所有權，避免多實例重複寄送
    const [claimed] = await db
      .update(newsletterSequenceEnrollmentsTable)
      .set({ nextSendAt: null })
      .where(
        and(
          eq(newsletterSequenceEnrollmentsTable.id, enrollment.id),
          eq(newsletterSequenceEnrollmentsTable.status, "active"),
          eq(newsletterSequenceEnrollmentsTable.nextSendAt, enrollment.nextSendAt!),
        ),
      )
      .returning();
    if (!claimed) continue;

    try {
      const [seq] = await db
        .select()
        .from(newsletterSequencesTable)
        .where(eq(newsletterSequencesTable.id, enrollment.sequenceId))
        .limit(1);
      const [sub] = await db
        .select()
        .from(newsletterSubscribersTable)
        .where(eq(newsletterSubscribersTable.id, enrollment.subscriberId))
        .limit(1);
      const steps = await db
        .select()
        .from(newsletterSequenceStepsTable)
        .where(eq(newsletterSequenceStepsTable.sequenceId, enrollment.sequenceId))
        .orderBy(asc(newsletterSequenceStepsTable.stepOrder));
      const step = steps[enrollment.currentStep];

      if (!seq || !seq.isActive || !sub || sub.status !== "subscribed" || !step) {
        await db
          .update(newsletterSequenceEnrollmentsTable)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(newsletterSequenceEnrollmentsTable.id, enrollment.id));
        continue;
      }

      const from = seq.fromEmail || "onboarding@resend.dev";
      let sendFailed = false;
      try {
        await sendEmail({
          from,
          to: sub.email,
          subject: step.subject,
          html: step.htmlContent,
          unsubscribeToken: sub.unsubscribeToken,
        });
        await db.insert(newsletterSendLogsTable).values({
          sequenceStepId: step.id,
          subscriberId: sub.id,
          email: sub.email,
          subject: step.subject,
          status: "sent",
        });
      } catch (err) {
        sendFailed = true;
        const message = err instanceof Error ? err.message : String(err);
        await db.insert(newsletterSendLogsTable).values({
          sequenceStepId: step.id,
          subscriberId: sub.id,
          email: sub.email,
          subject: step.subject,
          status: "failed",
          error: message,
        });

        // 寄送失敗（例如 Resend 暫時故障、寄件網域尚未驗證、公開網域未設定）時，
        // 停留在目前步驟並以退避排程重試，達上限才轉為 failed 交由人工處理，
        // 絕不能在寄信失敗的情況下仍推進到下一步，否則訂閱者會永久漏收這封信。
        const attempts = enrollment.failedAttempts + 1;
        const maxAttempts = 5;
        if (attempts >= maxAttempts) {
          await db
            .update(newsletterSequenceEnrollmentsTable)
            .set({ status: "failed", failedAttempts: attempts, lastError: message })
            .where(eq(newsletterSequenceEnrollmentsTable.id, enrollment.id));
        } else {
          const backoffMs = Math.min(2 ** attempts, 24 * 60) * 60_000; // 上限 24 小時
          await db
            .update(newsletterSequenceEnrollmentsTable)
            .set({
              failedAttempts: attempts,
              lastError: message,
              nextSendAt: new Date(Date.now() + backoffMs),
            })
            .where(eq(newsletterSequenceEnrollmentsTable.id, enrollment.id));
        }
      }

      if (sendFailed) continue;

      const nextIndex = enrollment.currentStep + 1;
      const nextStep = steps[nextIndex];
      if (nextStep) {
        await db
          .update(newsletterSequenceEnrollmentsTable)
          .set({
            currentStep: nextIndex,
            failedAttempts: 0,
            lastError: null,
            nextSendAt: new Date(Date.now() + nextStep.delayDays * 86400_000),
          })
          .where(eq(newsletterSequenceEnrollmentsTable.id, enrollment.id));
      } else {
        await db
          .update(newsletterSequenceEnrollmentsTable)
          .set({
            currentStep: nextIndex,
            status: "completed",
            failedAttempts: 0,
            lastError: null,
            completedAt: new Date(),
          })
          .where(eq(newsletterSequenceEnrollmentsTable.id, enrollment.id));
      }
    } catch (err) {
      logger.error({ err, enrollmentId: enrollment.id }, "sequence step send failed");
      // 還原 nextSendAt 讓下一輪重試
      await db
        .update(newsletterSequenceEnrollmentsTable)
        .set({ nextSendAt: enrollment.nextSendAt })
        .where(eq(newsletterSequenceEnrollmentsTable.id, enrollment.id));
    }
  }
}

/* ---------------- 用量統計 ---------------- */

export async function getUsage() {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      sent: sql<number>`count(*) filter (where ${newsletterSendLogsTable.status} = 'sent')::int`,
      failed: sql<number>`count(*) filter (where ${newsletterSendLogsTable.status} = 'failed')::int`,
    })
    .from(newsletterSendLogsTable);
  const [month] = await db
    .select({
      total: sql<number>`count(*)::int`,
      sent: sql<number>`count(*) filter (where ${newsletterSendLogsTable.status} = 'sent')::int`,
      failed: sql<number>`count(*) filter (where ${newsletterSendLogsTable.status} = 'failed')::int`,
    })
    .from(newsletterSendLogsTable)
    .where(sql`${newsletterSendLogsTable.sentAt} >= ${startOfMonth}`);
  return {
    configured: resendConfigured(),
    allTime: totals ?? { total: 0, sent: 0, failed: 0 },
    thisMonth: month ?? { total: 0, sent: 0, failed: 0 },
  };
}

/* ---------------- 排程器 ---------------- */

let started = false;
/** 啟動背景排程（每分鐘處理排程活動與到期序列步驟） */
export function startNewsletterScheduler() {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      await processScheduledCampaigns();
    } catch (err) {
      logger.error({ err }, "processScheduledCampaigns failed");
    }
    try {
      await processSequenceEnrollments();
    } catch (err) {
      logger.error({ err }, "processSequenceEnrollments failed");
    }
  };
  setInterval(tick, 60_000).unref();
  // 啟動後先跑一次（延遲數秒等 DB 就緒）
  setTimeout(tick, 5_000).unref();
  logger.info("newsletter scheduler started");
}
