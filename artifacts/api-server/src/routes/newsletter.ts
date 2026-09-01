import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import {
  db,
  newsletterApiKeysTable,
  newsletterCampaignsTable,
  newsletterDomainsTable,
  newsletterSendLogsTable,
  newsletterSequenceEnrollmentsTable,
  newsletterSequenceStepsTable,
  newsletterSequencesTable,
  newsletterSubscribersTable,
  type NewsletterCampaign,
  type NewsletterSequence,
  type NewsletterSequenceStep,
  type NewsletterSubscriber,
} from "@workspace/db";
import {
  CreateNewsletterDomainBody,
  CreateNewsletterApiKeyBody,
  UpdateNewsletterApiKeyBody,
  CreateNewsletterSubscriberBody,
  UpdateNewsletterSubscriberBody,
  ImportNewsletterSubscribersBody,
  CreateNewsletterCampaignBody,
  UpdateNewsletterCampaignBody,
  ScheduleNewsletterCampaignBody,
  CreateNewsletterSequenceBody,
  UpdateNewsletterSequenceBody,
  CreateNewsletterSequenceStepBody,
  UpdateNewsletterSequenceStepBody,
} from "@workspace/api-zod";
import { requireStaff, requireOps } from "../middlewares/requireMember";
import {
  addDomain,
  verifyDomain,
  removeDomain,
  claimAndSendCampaign,
  enrollSubscriberInSequences,
  getUsage,
  hashApiKey,
  resendConfigured,
  NewsletterConfigError,
  ResendApiError,
} from "../lib/newsletter";

const router: IRouter = Router();

function handleResendError(res: import("express").Response, err: unknown) {
  if (err instanceof NewsletterConfigError) {
    res.status(503).json({ error: err.message, configured: false });
    return true;
  }
  if (err instanceof ResendApiError) {
    res.status(502).json({ error: `Resend：${err.message}` });
    return true;
  }
  return false;
}

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/* ---------------- 域名 ---------------- */

function serializeDomain(d: typeof newsletterDomainsTable.$inferSelect) {
  return {
    id: d.id,
    domain: d.domain,
    resendDomainId: d.resendDomainId,
    status: d.status,
    dnsRecords: d.dnsRecords ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

router.get("/newsletter/domains", requireStaff, async (_req, res) => {
  const rows = await db
    .select()
    .from(newsletterDomainsTable)
    .orderBy(desc(newsletterDomainsTable.createdAt));
  res.json(rows.map(serializeDomain));
});

router.post("/newsletter/domains", requireOps, async (req, res) => {
  const parsed = CreateNewsletterDomainBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "請輸入有效的域名" });
    return;
  }
  const domain = parsed.data.domain.trim().toLowerCase();
  const [dup] = await db
    .select({ id: newsletterDomainsTable.id })
    .from(newsletterDomainsTable)
    .where(eq(newsletterDomainsTable.domain, domain))
    .limit(1);
  if (dup) {
    res.status(409).json({ error: "此域名已存在" });
    return;
  }
  try {
    const row = await addDomain(domain);
    res.status(201).json(serializeDomain(row));
  } catch (err) {
    if (!handleResendError(res, err)) throw err;
  }
});

router.post("/newsletter/domains/:id/verify", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const row = await verifyDomain(id);
    if (!row) {
      res.status(404).json({ error: "找不到此域名" });
      return;
    }
    res.json(serializeDomain(row));
  } catch (err) {
    if (!handleResendError(res, err)) throw err;
  }
});

router.delete("/newsletter/domains/:id", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const ok = await removeDomain(id);
  if (!ok) {
    res.status(404).json({ error: "找不到此域名" });
    return;
  }
  res.status(204).end();
});

/* ---------------- API 金鑰 ---------------- */

function serializeApiKey(k: typeof newsletterApiKeysTable.$inferSelect) {
  return {
    id: k.id,
    name: k.name,
    keyLastFour: k.keyLastFour,
    permissions: k.permissions,
    isActive: k.isActive,
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    createdAt: k.createdAt.toISOString(),
  };
}

// 僅限系統管理員／營運可檢視與管理金鑰（金鑰可用來寄信，客服角色不應接觸）。
router.get("/newsletter/api-keys", requireOps, async (_req, res) => {
  const rows = await db
    .select()
    .from(newsletterApiKeysTable)
    .orderBy(desc(newsletterApiKeysTable.createdAt));
  res.json(rows.map(serializeApiKey));
});

router.post("/newsletter/api-keys", requireOps, async (req, res) => {
  const parsed = CreateNewsletterApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "請輸入金鑰名稱" });
    return;
  }
  const rawKey = `nl_${randomBytes(24).toString("hex")}`;
  const [row] = await db
    .insert(newsletterApiKeysTable)
    .values({
      name: parsed.data.name,
      keyHash: hashApiKey(rawKey),
      keyLastFour: rawKey.slice(-4),
      permissions: parsed.data.permissions ?? "full",
    })
    .returning();
  // 原始金鑰只在建立當下回傳一次，之後無法再次取得。
  res.status(201).json({ ...serializeApiKey(row), key: rawKey });
});

router.patch("/newsletter/api-keys/:id", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateNewsletterApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const [row] = await db
    .update(newsletterApiKeysTable)
    .set({
      ...(parsed.data.name != null ? { name: parsed.data.name } : {}),
      ...(parsed.data.permissions != null
        ? { permissions: parsed.data.permissions }
        : {}),
      ...(parsed.data.isActive != null ? { isActive: parsed.data.isActive } : {}),
    })
    .where(eq(newsletterApiKeysTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "找不到此金鑰" });
    return;
  }
  res.json(serializeApiKey(row));
});

router.delete("/newsletter/api-keys/:id", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .delete(newsletterApiKeysTable)
    .where(eq(newsletterApiKeysTable.id, id))
    .returning({ id: newsletterApiKeysTable.id });
  if (!row) {
    res.status(404).json({ error: "找不到此金鑰" });
    return;
  }
  res.status(204).end();
});

/* ---------------- 訂閱者 ---------------- */

function serializeSubscriber(s: NewsletterSubscriber) {
  return {
    id: s.id,
    email: s.email,
    name: s.name,
    tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
    status: s.status,
    source: s.source,
    createdAt: s.createdAt.toISOString(),
  };
}

router.get("/newsletter/subscribers", requireStaff, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const tag = typeof req.query.tag === "string" ? req.query.tag : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const conditions: SQL[] = [];
  if (["subscribed", "unsubscribed"].includes(status))
    conditions.push(eq(newsletterSubscribersTable.status, status));
  const rows = await db
    .select()
    .from(newsletterSubscribersTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(newsletterSubscribersTable.createdAt))
    .limit(2000);
  let list = rows;
  if (tag)
    list = list.filter(
      (s) => Array.isArray(s.tags) && (s.tags as string[]).includes(tag),
    );
  if (q)
    list = list.filter(
      (s) =>
        s.email.toLowerCase().includes(q) ||
        (s.name ?? "").toLowerCase().includes(q),
    );
  res.json(list.map(serializeSubscriber));
});

router.post("/newsletter/subscribers", requireOps, async (req, res) => {
  const parsed = CreateNewsletterSubscriberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "請輸入有效的 Email" });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [dup] = await db
    .select({ id: newsletterSubscribersTable.id })
    .from(newsletterSubscribersTable)
    .where(eq(newsletterSubscribersTable.email, email))
    .limit(1);
  if (dup) {
    res.status(409).json({ error: "此 Email 已存在" });
    return;
  }
  const [row] = await db
    .insert(newsletterSubscribersTable)
    .values({
      email,
      name: parsed.data.name ?? null,
      tags: parsed.data.tags ?? [],
      source: "manual",
    })
    .returning();
  await enrollSubscriberInSequences(row);
  res.status(201).json(serializeSubscriber(row));
});

router.post("/newsletter/subscribers/import", requireOps, async (req, res) => {
  const parsed = ImportNewsletterSubscribersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "請提供 CSV 內容" });
    return;
  }
  const extraTags = parsed.data.tags ?? [];
  const lines = parsed.data.csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  for (let idx = 0; idx < lines.length; idx++) {
    const cols = lines[idx].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    let [email, name, tagsRaw] = [cols[0] ?? "", cols[1] ?? "", cols[2] ?? ""];
    email = email.toLowerCase();
    // 跳過標題列
    if (idx === 0 && /email/i.test(email) && !emailRe.test(email)) continue;
    if (!emailRe.test(email)) {
      skipped++;
      if (errors.length < 20) errors.push(`第 ${idx + 1} 行：Email 格式不正確（${email || "空白"}）`);
      continue;
    }
    const tags = Array.from(
      new Set([
        ...extraTags,
        ...tagsRaw.split(/[;|]/).map((t) => t.trim()).filter(Boolean),
      ]),
    );
    const [row] = await db
      .insert(newsletterSubscribersTable)
      .values({ email, name: name || null, tags, source: "import" })
      .onConflictDoNothing({ target: newsletterSubscribersTable.email })
      .returning();
    if (row) {
      imported++;
      await enrollSubscriberInSequences(row);
    } else {
      skipped++;
    }
  }
  res.json({ imported, skipped, errors });
});

router.patch("/newsletter/subscribers/:id", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateNewsletterSubscriberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const input = parsed.data;
  const [row] = await db
    .update(newsletterSubscribersTable)
    .set({
      ...(input.email != null ? { email: input.email.trim().toLowerCase() } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.tags != null ? { tags: input.tags } : {}),
      ...(input.status != null ? { status: input.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(newsletterSubscribersTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "找不到此訂閱者" });
    return;
  }
  res.json(serializeSubscriber(row));
});

router.delete("/newsletter/subscribers/:id", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .delete(newsletterSequenceEnrollmentsTable)
    .where(eq(newsletterSequenceEnrollmentsTable.subscriberId, id));
  const [row] = await db
    .delete(newsletterSubscribersTable)
    .where(eq(newsletterSubscribersTable.id, id))
    .returning({ id: newsletterSubscribersTable.id });
  if (!row) {
    res.status(404).json({ error: "找不到此訂閱者" });
    return;
  }
  res.status(204).end();
});

/* ---------------- 活動 ---------------- */

function serializeCampaign(c: NewsletterCampaign) {
  return {
    id: c.id,
    name: c.name,
    subject: c.subject,
    fromEmail: c.fromEmail,
    htmlContent: c.htmlContent,
    tagFilter: c.tagFilter,
    status: c.status,
    scheduledAt: c.scheduledAt ? c.scheduledAt.toISOString() : null,
    sentAt: c.sentAt ? c.sentAt.toISOString() : null,
    recipientCount: c.recipientCount,
    sentCount: c.sentCount,
    failedCount: c.failedCount,
    createdAt: c.createdAt.toISOString(),
  };
}

router.get("/newsletter/campaigns", requireStaff, async (_req, res) => {
  const rows = await db
    .select()
    .from(newsletterCampaignsTable)
    .orderBy(desc(newsletterCampaignsTable.createdAt))
    .limit(300);
  res.json(rows.map(serializeCampaign));
});

router.post("/newsletter/campaigns", requireOps, async (req, res) => {
  const parsed = CreateNewsletterCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "活動資料不完整（名稱、主旨、寄件人必填）" });
    return;
  }
  const [row] = await db
    .insert(newsletterCampaignsTable)
    .values({
      name: parsed.data.name,
      subject: parsed.data.subject,
      fromEmail: parsed.data.fromEmail,
      htmlContent: parsed.data.htmlContent ?? "",
      tagFilter: parsed.data.tagFilter ?? null,
    })
    .returning();
  res.status(201).json(serializeCampaign(row));
});

router.patch("/newsletter/campaigns/:id", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateNewsletterCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const [existing] = await db
    .select()
    .from(newsletterCampaignsTable)
    .where(eq(newsletterCampaignsTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "找不到此活動" });
    return;
  }
  if (!["draft", "scheduled", "failed"].includes(existing.status)) {
    res.status(400).json({ error: "已發送或發送中的活動無法編輯" });
    return;
  }
  const input = parsed.data;
  const [row] = await db
    .update(newsletterCampaignsTable)
    .set({
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.subject != null ? { subject: input.subject } : {}),
      ...(input.fromEmail != null ? { fromEmail: input.fromEmail } : {}),
      ...(input.htmlContent != null ? { htmlContent: input.htmlContent } : {}),
      ...(input.tagFilter !== undefined ? { tagFilter: input.tagFilter } : {}),
      updatedAt: new Date(),
    })
    .where(eq(newsletterCampaignsTable.id, id))
    .returning();
  res.json(serializeCampaign(row));
});

router.delete("/newsletter/campaigns/:id", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(newsletterCampaignsTable)
    .where(eq(newsletterCampaignsTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "找不到此活動" });
    return;
  }
  if (existing.status === "sending") {
    res.status(400).json({ error: "發送中的活動無法刪除" });
    return;
  }
  await db
    .delete(newsletterSendLogsTable)
    .where(eq(newsletterSendLogsTable.campaignId, id));
  await db.delete(newsletterCampaignsTable).where(eq(newsletterCampaignsTable.id, id));
  res.status(204).end();
});

router.post("/newsletter/campaigns/:id/send", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!resendConfigured()) {
    res.status(503).json({
      error: "尚未設定 RESEND_API_KEY，請先於環境變數設定 Resend API 金鑰",
      configured: false,
    });
    return;
  }
  const claimed = await claimAndSendCampaign(id, ["draft", "scheduled", "failed"]);
  if (!claimed) {
    res.status(400).json({ error: "活動不存在或狀態不允許發送" });
    return;
  }
  const [row] = await db
    .select()
    .from(newsletterCampaignsTable)
    .where(eq(newsletterCampaignsTable.id, id))
    .limit(1);
  res.json(serializeCampaign(row));
});

router.post("/newsletter/campaigns/:id/schedule", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = ScheduleNewsletterCampaignBody.safeParse(req.body);
  const when = parsed.success ? new Date(parsed.data.scheduledAt) : null;
  if (!when || Number.isNaN(when.getTime())) {
    res.status(400).json({ error: "請提供有效的排程時間" });
    return;
  }
  if (when.getTime() <= Date.now()) {
    res.status(400).json({ error: "排程時間必須在未來" });
    return;
  }
  const [row] = await db
    .update(newsletterCampaignsTable)
    .set({ status: "scheduled", scheduledAt: when, updatedAt: new Date() })
    .where(
      and(
        eq(newsletterCampaignsTable.id, id),
        sql`${newsletterCampaignsTable.status} in ('draft', 'scheduled', 'failed')`,
      ),
    )
    .returning();
  if (!row) {
    res.status(400).json({ error: "活動不存在或狀態不允許排程" });
    return;
  }
  res.json(serializeCampaign(row));
});

router.get("/newsletter/campaigns/:id/logs", requireStaff, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const rows = await db
    .select()
    .from(newsletterSendLogsTable)
    .where(eq(newsletterSendLogsTable.campaignId, id))
    .orderBy(desc(newsletterSendLogsTable.sentAt))
    .limit(1000);
  res.json(
    rows.map((l) => ({
      id: l.id,
      campaignId: l.campaignId,
      sequenceStepId: l.sequenceStepId,
      subscriberId: l.subscriberId,
      email: l.email,
      subject: l.subject,
      status: l.status,
      error: l.error,
      sentAt: l.sentAt.toISOString(),
    })),
  );
});

/* ---------------- 序列 ---------------- */

function serializeStep(s: NewsletterSequenceStep) {
  return {
    id: s.id,
    sequenceId: s.sequenceId,
    stepOrder: s.stepOrder,
    delayDays: s.delayDays,
    subject: s.subject,
    htmlContent: s.htmlContent,
  };
}

async function sequenceCounts(ids: number[]) {
  if (!ids.length)
    return { steps: new Map<number, number>(), active: new Map<number, number>(), completed: new Map<number, number>() };
  const stepRows = await db
    .select({
      sequenceId: newsletterSequenceStepsTable.sequenceId,
      count: sql<number>`count(*)::int`,
    })
    .from(newsletterSequenceStepsTable)
    .where(inArray(newsletterSequenceStepsTable.sequenceId, ids))
    .groupBy(newsletterSequenceStepsTable.sequenceId);
  const enrollRows = await db
    .select({
      sequenceId: newsletterSequenceEnrollmentsTable.sequenceId,
      status: newsletterSequenceEnrollmentsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(newsletterSequenceEnrollmentsTable)
    .where(inArray(newsletterSequenceEnrollmentsTable.sequenceId, ids))
    .groupBy(
      newsletterSequenceEnrollmentsTable.sequenceId,
      newsletterSequenceEnrollmentsTable.status,
    );
  const steps = new Map(stepRows.map((r) => [r.sequenceId, r.count]));
  const active = new Map<number, number>();
  const completed = new Map<number, number>();
  for (const r of enrollRows) {
    if (r.status === "active") active.set(r.sequenceId, r.count);
    if (r.status === "completed") completed.set(r.sequenceId, r.count);
  }
  return { steps, active, completed };
}

function serializeSequence(
  s: NewsletterSequence,
  counts?: { stepCount?: number; activeEnrollments?: number },
) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    fromEmail: s.fromEmail,
    isActive: s.isActive,
    flowData: s.flowData ?? null,
    stepCount: counts?.stepCount ?? 0,
    activeEnrollments: counts?.activeEnrollments ?? 0,
    createdAt: s.createdAt.toISOString(),
  };
}

router.get("/newsletter/sequences", requireStaff, async (_req, res) => {
  const rows = await db
    .select()
    .from(newsletterSequencesTable)
    .orderBy(desc(newsletterSequencesTable.createdAt));
  const counts = await sequenceCounts(rows.map((r) => r.id));
  res.json(
    rows.map((s) =>
      serializeSequence(s, {
        stepCount: counts.steps.get(s.id) ?? 0,
        activeEnrollments: counts.active.get(s.id) ?? 0,
      }),
    ),
  );
});

router.post("/newsletter/sequences", requireOps, async (req, res) => {
  const parsed = CreateNewsletterSequenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "請輸入序列名稱" });
    return;
  }
  const [row] = await db
    .insert(newsletterSequencesTable)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      fromEmail: parsed.data.fromEmail ?? null,
    })
    .returning();
  res.status(201).json(serializeSequence(row));
});

router.get("/newsletter/sequences/:id", requireStaff, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(newsletterSequencesTable)
    .where(eq(newsletterSequencesTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "找不到此序列" });
    return;
  }
  const steps = await db
    .select()
    .from(newsletterSequenceStepsTable)
    .where(eq(newsletterSequenceStepsTable.sequenceId, id))
    .orderBy(asc(newsletterSequenceStepsTable.stepOrder));
  const counts = await sequenceCounts([id]);
  res.json({
    ...serializeSequence(row, {
      stepCount: steps.length,
      activeEnrollments: counts.active.get(id) ?? 0,
    }),
    completedEnrollments: counts.completed.get(id) ?? 0,
    steps: steps.map(serializeStep),
  });
});

router.patch("/newsletter/sequences/:id", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateNewsletterSequenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const input = parsed.data;
  const [row] = await db
    .update(newsletterSequencesTable)
    .set({
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.fromEmail !== undefined ? { fromEmail: input.fromEmail } : {}),
      ...(input.isActive != null ? { isActive: input.isActive } : {}),
      ...(input.flowData !== undefined ? { flowData: input.flowData } : {}),
      updatedAt: new Date(),
    })
    .where(eq(newsletterSequencesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "找不到此序列" });
    return;
  }
  res.json(serializeSequence(row));
});

router.delete("/newsletter/sequences/:id", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db
    .select({ id: newsletterSequencesTable.id })
    .from(newsletterSequencesTable)
    .where(eq(newsletterSequencesTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "找不到此序列" });
    return;
  }
  await db
    .delete(newsletterSequenceEnrollmentsTable)
    .where(eq(newsletterSequenceEnrollmentsTable.sequenceId, id));
  await db
    .delete(newsletterSequenceStepsTable)
    .where(eq(newsletterSequenceStepsTable.sequenceId, id));
  await db.delete(newsletterSequencesTable).where(eq(newsletterSequencesTable.id, id));
  res.status(204).end();
});

router.get("/newsletter/sequences/:id/steps", requireStaff, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const steps = await db
    .select()
    .from(newsletterSequenceStepsTable)
    .where(eq(newsletterSequenceStepsTable.sequenceId, id))
    .orderBy(asc(newsletterSequenceStepsTable.stepOrder));
  res.json(steps.map(serializeStep));
});

router.post("/newsletter/sequences/:id/steps", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = CreateNewsletterSequenceStepBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "請輸入步驟主旨" });
    return;
  }
  const [seq] = await db
    .select({ id: newsletterSequencesTable.id })
    .from(newsletterSequencesTable)
    .where(eq(newsletterSequencesTable.id, id))
    .limit(1);
  if (!seq) {
    res.status(404).json({ error: "找不到此序列" });
    return;
  }
  let stepOrder = parsed.data.stepOrder;
  if (stepOrder == null) {
    const [max] = await db
      .select({ max: sql<number>`coalesce(max(${newsletterSequenceStepsTable.stepOrder}), 0)::int` })
      .from(newsletterSequenceStepsTable)
      .where(eq(newsletterSequenceStepsTable.sequenceId, id));
    stepOrder = (max?.max ?? 0) + 1;
  }
  const [row] = await db
    .insert(newsletterSequenceStepsTable)
    .values({
      sequenceId: id,
      stepOrder,
      delayDays: parsed.data.delayDays ?? 0,
      subject: parsed.data.subject,
      htmlContent: parsed.data.htmlContent ?? "",
    })
    .returning();
  res.status(201).json(serializeStep(row));
});

router.patch("/newsletter/sequences/steps/:id", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateNewsletterSequenceStepBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const input = parsed.data;
  const [row] = await db
    .update(newsletterSequenceStepsTable)
    .set({
      ...(input.subject != null ? { subject: input.subject } : {}),
      ...(input.htmlContent != null ? { htmlContent: input.htmlContent } : {}),
      ...(input.delayDays != null ? { delayDays: input.delayDays } : {}),
      ...(input.stepOrder != null ? { stepOrder: input.stepOrder } : {}),
    })
    .where(eq(newsletterSequenceStepsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "找不到此步驟" });
    return;
  }
  res.json(serializeStep(row));
});

router.delete("/newsletter/sequences/steps/:id", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .delete(newsletterSequenceStepsTable)
    .where(eq(newsletterSequenceStepsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "找不到此步驟" });
    return;
  }
  // 重新整理剩餘步驟順序
  const remaining = await db
    .select()
    .from(newsletterSequenceStepsTable)
    .where(eq(newsletterSequenceStepsTable.sequenceId, row.sequenceId))
    .orderBy(asc(newsletterSequenceStepsTable.stepOrder));
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].stepOrder !== i + 1) {
      await db
        .update(newsletterSequenceStepsTable)
        .set({ stepOrder: i + 1 })
        .where(eq(newsletterSequenceStepsTable.id, remaining[i].id));
    }
  }
  res.status(204).end();
});

/* ---------------- 用量 ---------------- */

router.get("/newsletter/usage", requireStaff, async (_req, res) => {
  res.json(await getUsage());
});

export default router;
