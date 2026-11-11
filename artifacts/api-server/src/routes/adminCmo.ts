/**
 * AI CMO 智慧中控台
 * - KPI 目標 CRUD（僅 admin）
 * - 每日報告查詢 / 手動觸發生成
 * - 數據快照查詢
 * - AI CMO 策略對話（SSE 串流；僅提供建議，不執行任何操作）
 */
import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { chatAi, chatModel } from "@workspace/integrations-openai-ai-server";
import type OpenAI from "openai";
import {
  db,
  cmoGoalsTable,
  cmoReportsTable,
  cmoMetricSnapshotsTable,
  type CmoGoal,
  type CmoReport,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireMember";
import { addDays, getOrCollectSnapshot, taipeiDateString } from "../lib/cmoMetrics";
import { generateDailyReport, isValidCalendarDate, updateGoalProgress } from "../lib/cmoReport";

const router: IRouter = Router();

const METRICS = new Set([
  "daily_revenue",
  "paid_revenue",
  "orders_count",
  "new_members",
  "published_posts",
  "points_issued",
  "new_articles",
]);
const PERIODS = new Set(["daily", "weekly", "monthly", "quarterly"]);
const PRIORITIES = new Set(["high", "medium", "low"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function serializeGoal(g: CmoGoal) {
  return {
    id: g.id,
    metric: g.metric,
    label: g.label,
    targetValue: g.targetValue,
    currentValue: g.currentValue,
    unit: g.unit,
    period: g.period,
    priority: g.priority,
    status: g.status,
    startDate: g.startDate,
    endDate: g.endDate,
    isActive: g.isActive,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

function serializeReport(r: CmoReport, withDetail: boolean) {
  return {
    id: r.id,
    reportDate: r.reportDate,
    reportType: r.reportType,
    summary: r.summary,
    recommendations: r.recommendations,
    goalProgress: r.goalProgress,
    ...(withDetail ? { kpiSnapshot: r.kpiSnapshot, rawData: r.rawData } : {}),
    createdAt: r.createdAt.toISOString(),
  };
}

type GoalInput = {
  metric?: unknown;
  label?: unknown;
  targetValue?: unknown;
  unit?: unknown;
  period?: unknown;
  priority?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  isActive?: unknown;
};

function validateGoalInput(body: GoalInput, partial: boolean): { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  const values: Record<string, unknown> = {};
  const has = (k: keyof GoalInput) => body[k] !== undefined;

  if (has("metric") || !partial) {
    if (typeof body.metric !== "string" || !METRICS.has(body.metric)) return { ok: false, error: `metric 不合法，可用值：${[...METRICS].join(", ")}` };
    values.metric = body.metric;
  }
  if (has("label") || !partial) {
    if (typeof body.label !== "string" || !body.label.trim()) return { ok: false, error: "label 不可為空" };
    values.label = body.label.trim().slice(0, 100);
  }
  if (has("targetValue") || !partial) {
    const n = Number(body.targetValue);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "targetValue 必須為正數" };
    values.targetValue = String(n);
  }
  if (has("unit")) {
    if (typeof body.unit !== "string") return { ok: false, error: "unit 不合法" };
    values.unit = body.unit.slice(0, 10);
  }
  if (has("period")) {
    if (typeof body.period !== "string" || !PERIODS.has(body.period)) return { ok: false, error: "period 不合法" };
    values.period = body.period;
  }
  if (has("priority")) {
    if (typeof body.priority !== "string" || !PRIORITIES.has(body.priority)) return { ok: false, error: "priority 不合法" };
    values.priority = body.priority;
  }
  if (has("startDate") || !partial) {
    if (typeof body.startDate !== "string" || !DATE_RE.test(body.startDate) || !isValidCalendarDate(body.startDate)) return { ok: false, error: "startDate 須為有效日曆日期（YYYY-MM-DD）" };
    values.startDate = body.startDate;
  }
  if (has("endDate") || !partial) {
    if (typeof body.endDate !== "string" || !DATE_RE.test(body.endDate) || !isValidCalendarDate(body.endDate)) return { ok: false, error: "endDate 須為有效日曆日期（YYYY-MM-DD）" };
    values.endDate = body.endDate;
  }
  if (has("isActive")) {
    if (typeof body.isActive !== "boolean") return { ok: false, error: "isActive 不合法" };
    values.isActive = body.isActive;
  }
  return { ok: true, values };
}

// ===== KPI 目標 CRUD =====

router.get("/admin/cmo/goals", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(cmoGoalsTable).orderBy(desc(cmoGoalsTable.createdAt));
  res.json(rows.map(serializeGoal));
});

router.post("/admin/cmo/goals", requireAdmin, async (req, res) => {
  const parsed = validateGoalInput(req.body ?? {}, false);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  if ((parsed.values.startDate as string) > (parsed.values.endDate as string)) {
    res.status(400).json({ error: "startDate 不可晚於 endDate" });
    return;
  }
  const [row] = await db.insert(cmoGoalsTable).values(parsed.values as never).returning();
  res.status(201).json(serializeGoal(row));
});

router.put("/admin/cmo/goals/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const parsed = validateGoalInput(req.body ?? {}, true);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const [existing] = await db.select().from(cmoGoalsTable).where(eq(cmoGoalsTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "找不到此 KPI 目標" });
    return;
  }
  const startDate = (parsed.values.startDate as string) ?? existing.startDate;
  const endDate = (parsed.values.endDate as string) ?? existing.endDate;
  if (startDate > endDate) {
    res.status(400).json({ error: "startDate 不可晚於 endDate" });
    return;
  }
  const [row] = await db
    .update(cmoGoalsTable)
    .set({ ...(parsed.values as never as Partial<CmoGoal>), updatedAt: new Date() })
    .where(eq(cmoGoalsTable.id, id))
    .returning();
  res.json(serializeGoal(row));
});

router.delete("/admin/cmo/goals/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const rows = await db.delete(cmoGoalsTable).where(eq(cmoGoalsTable.id, id)).returning();
  if (!rows.length) {
    res.status(404).json({ error: "找不到此 KPI 目標" });
    return;
  }
  res.json({ ok: true });
});

/** 立即重算所有 KPI 進度 */
router.post("/admin/cmo/goals/refresh", requireAdmin, async (_req, res) => {
  const goals = await updateGoalProgress(taipeiDateString());
  res.json(goals.map(serializeGoal));
});

// ===== 數據快照 =====

router.get("/admin/cmo/snapshots", requireAdmin, async (req, res) => {
  const days = Math.min(31, Math.max(1, Number(req.query.days) || 7));
  const today = taipeiDateString();
  const out: unknown[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, -i);
    const [row] = await db
      .select()
      .from(cmoMetricSnapshotsTable)
      .where(eq(cmoMetricSnapshotsTable.snapshotDate, d))
      .limit(1);
    if (row) out.push({ date: row.snapshotDate, data: row.data });
    else if (i === 0) out.push({ date: d, data: await getOrCollectSnapshot(d) });
  }
  res.json(out);
});

// ===== 報告 =====

router.get("/admin/cmo/reports", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(cmoReportsTable)
    .orderBy(desc(cmoReportsTable.reportDate), desc(cmoReportsTable.createdAt))
    .limit(60);
  res.json(rows.map((r) => serializeReport(r, false)));
});

router.get("/admin/cmo/reports/:id", requireAdmin, async (req, res) => {
  const [row] = await db
    .select()
    .from(cmoReportsTable)
    .where(eq(cmoReportsTable.id, String(req.params.id)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "找不到此報告" });
    return;
  }
  res.json(serializeReport(row, true));
});

/** 手動觸發生成今日報告 */
router.post("/admin/cmo/reports/generate", requireAdmin, async (_req, res) => {
  try {
    const report = await generateDailyReport(taipeiDateString(), "manual");
    res.status(201).json(serializeReport(report, false));
  } catch (err) {
    console.error("[CMO] 手動生成報告失敗:", err);
    res.status(502).json({ error: "報告生成失敗，請稍後再試" });
  }
});

// ===== AI CMO 策略對話（SSE 串流） =====

const CMO_SYSTEM_PROMPT = `你是「七期生醫」電商平台的 AI CMO（行銷長）。使用繁體中文回答。

你的職責：根據提供的最新 KPI 目標、每日營運報告與數據快照，回答管理員的行銷與營運策略問題，提出可執行的建議。

規則：
1. 只根據下方注入的實際數據回答，數字要精確，不可臆測；資料中沒有的數據要明說「未收集/未串接」。
2. GA4、Ahrefs、Search Console、廣告花費、電子報等外部數據源尚未串接，不要臆測其數據。
3. 你不能執行任何操作（發文、改價、調庫存等），只提供建議；若管理員要求執行，請引導其使用對應後台功能。
4. 金額單位為新台幣元，日期格式 YYYY-MM-DD。回覆精簡、條列清楚。`;

async function buildCmoContext(): Promise<string> {
  const parts: string[] = [];
  try {
    const goals = await db.select().from(cmoGoalsTable).where(eq(cmoGoalsTable.isActive, true)).orderBy(desc(cmoGoalsTable.createdAt)).limit(20);
    parts.push(
      "【KPI 目標】\n" +
        (goals.length
          ? goals.map((g) => `- ${g.label}（${g.metric}，${g.period}，${g.startDate}~${g.endDate}）：目標 ${g.targetValue}${g.unit}，目前 ${g.currentValue}${g.unit}，狀態 ${g.status}，優先級 ${g.priority}`).join("\n")
          : "（尚未設定）"),
    );
  } catch {
    parts.push("【KPI 目標】讀取失敗");
  }
  try {
    const [report] = await db.select().from(cmoReportsTable).orderBy(desc(cmoReportsTable.reportDate), desc(cmoReportsTable.createdAt)).limit(1);
    if (report) {
      parts.push(`【最新營運報告（${report.reportDate}）】\n${report.summary.slice(0, 2000)}\n建議：${(report.recommendations ?? "").slice(0, 1000)}`);
    } else {
      parts.push("【最新營運報告】尚無報告");
    }
  } catch {
    parts.push("【最新營運報告】讀取失敗");
  }
  try {
    const today = taipeiDateString();
    const snaps: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, -i);
      const [row] = await db.select().from(cmoMetricSnapshotsTable).where(eq(cmoMetricSnapshotsTable.snapshotDate, d)).limit(1);
      const data = i === 0 ? await getOrCollectSnapshot(d) : row?.data;
      if (data) snaps.push(`- ${d}: ${JSON.stringify(data).slice(0, 900)}`);
    }
    parts.push("【近 7 日數據快照】\n" + (snaps.join("\n") || "（無）"));
  } catch {
    parts.push("【近 7 日數據快照】讀取失敗");
  }
  return parts.join("\n\n");
}

router.post("/admin/cmo/chat", requireAdmin, async (req, res) => {
  const content = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
  if (!content) {
    res.status(400).json({ error: "訊息不可為空" });
    return;
  }
  if (content.length > 4000) {
    res.status(400).json({ error: "訊息過長（上限 4000 字）" });
    return;
  }
  // 僅接受最近 20 則、每則 4000 字內的 user/assistant 歷史（由前端維護、無伺服器狀態）
  const history = rawHistory
    .filter(
      (m: unknown): m is { role: string; content: string } =>
        !!m &&
        typeof m === "object" &&
        ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant") &&
        typeof (m as { content?: unknown }).content === "string",
    )
    .slice(-20)
    .map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, 4000),
    }));

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const context = await buildCmoContext();
    const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: CMO_SYSTEM_PROMPT },
      { role: "system", content: `以下為即時營運資料（伺服器注入，管理員與 AI 均不可修改）：\n\n${context}` },
      ...history,
      { role: "user", content },
    ];
    const stream = await chatAi.chat.completions.create({
      model: chatModel(),
      max_completion_tokens: 8192,
      messages: chatMessages,
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) send("delta", { text: delta });
    }
    send("done", { ok: true });
  } catch (err) {
    console.error("[CMO] chat 串流失敗:", err);
    send("error", { error: "AI 服務暫時無法回應，請稍後再試" });
  } finally {
    res.end();
  }
});

export default router;
