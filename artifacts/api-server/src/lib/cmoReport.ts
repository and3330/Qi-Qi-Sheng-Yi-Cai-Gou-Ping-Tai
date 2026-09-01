/**
 * AI CMO — 每日營運報告生成器
 *
 * 比較昨今數據、偵測異常（如營收驟降）、更新 KPI currentValue 與狀態，
 * 並透過既有 AI 整合生成繁中摘要與建議，寫入 cmo_reports。
 */
import { and, desc, eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  db,
  cmoGoalsTable,
  cmoReportsTable,
  cmoMetricSnapshotsTable,
  type CmoGoal,
  type CmoReport,
} from "@workspace/db";
import {
  addDays,
  collectAndStoreSnapshot,
  getOrCollectSnapshot,
  taipeiDateString,
  type CmoSnapshotData,
} from "./cmoMetrics";
import { logger } from "./logger";

type Anomaly = { metric: string; message: string; severity: "warning" | "critical" };

function pctChange(prev: number, curr: number): number | null {
  if (!prev) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

function detectAnomalies(prev: CmoSnapshotData, curr: CmoSnapshotData): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const checks: Array<{ metric: string; label: string; prev?: number; curr?: number }> = [
    { metric: "revenue", label: "訂單營收", prev: prev.revenue?.revenue, curr: curr.revenue?.revenue },
    { metric: "orders", label: "訂單數", prev: prev.revenue?.ordersCount, curr: curr.revenue?.ordersCount },
    { metric: "new_members", label: "新會員數", prev: prev.members?.newMembers, curr: curr.members?.newMembers },
  ];
  for (const c of checks) {
    if (typeof c.prev !== "number" || typeof c.curr !== "number") continue;
    const change = pctChange(c.prev, c.curr);
    if (change === null) continue;
    if (change <= -50) {
      anomalies.push({ metric: c.metric, severity: "critical", message: `${c.label}較前日驟降 ${Math.abs(change)}%（${c.prev} → ${c.curr}）` });
    } else if (change <= -30) {
      anomalies.push({ metric: c.metric, severity: "warning", message: `${c.label}較前日下降 ${Math.abs(change)}%（${c.prev} → ${c.curr}）` });
    }
  }
  if ((curr.revenue?.cancelledCount ?? 0) >= 5) {
    anomalies.push({ metric: "cancelled", severity: "warning", message: `本日取消訂單達 ${curr.revenue!.cancelledCount} 筆，建議關注原因` });
  }
  return anomalies;
}

/** 由快照取得指標當日值（對應 cmo_goals.metric） */
function metricDailyValue(snap: CmoSnapshotData, metric: string): number | null {
  switch (metric) {
    case "daily_revenue":
    case "revenue":
      return snap.revenue?.revenue ?? null;
    case "paid_revenue":
      return snap.revenue?.paidRevenue ?? null;
    case "orders_count":
      return snap.revenue?.ordersCount ?? null;
    case "new_members":
      return snap.members?.newMembers ?? null;
    case "published_posts":
      return snap.social?.publishedPosts ?? null;
    case "points_issued":
      return snap.points?.issued ?? null;
    case "new_articles":
      return snap.content?.newArticles ?? null;
    default:
      return null;
  }
}

/** 是否為真實存在的日曆日期（YYYY-MM-DD） */
export function isValidCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export type GoalWindow = {
  /** 本期起日（已夾限於目標 startDate~endDate） */
  winStart: string;
  /** 本期迄日（已夾限） */
  winEnd: string;
  /** 累計迄日 = min(asOf, winEnd) */
  lastDay: string;
};

/**
 * 純函式：依 period 計算 asOf 所屬的考核窗口（並夾限於目標起迄）。
 * - daily：僅 asOf 當日（每日重新歸零考核）
 * - weekly：asOf 所屬 ISO 週（週一~週日）
 * - monthly：asOf 所屬月曆月
 * - quarterly：asOf 所屬季（1-3、4-6、7-9、10-12 月）
 * 回傳 null 表示 asOf 不在目標期間內。
 */
export function goalWindow(
  period: string,
  asOf: string,
  startDate: string,
  endDate: string,
): GoalWindow | null {
  if (asOf < startDate || startDate > endDate) return null;
  let winStart: string;
  let winEnd: string;
  const [y, m, d] = asOf.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastOfMonth = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  switch (period) {
    case "daily":
      winStart = asOf;
      winEnd = asOf;
      break;
    case "weekly": {
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
      const offsetToMon = (dow + 6) % 7;
      winStart = addDays(asOf, -offsetToMon);
      winEnd = addDays(winStart, 6);
      break;
    }
    case "quarterly": {
      const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
      winStart = `${y}-${pad(qStartMonth)}-01`;
      winEnd = `${y}-${pad(qStartMonth + 2)}-${pad(lastOfMonth(y, qStartMonth + 2))}`;
      break;
    }
    case "monthly":
    default:
      winStart = `${y}-${pad(m)}-01`;
      winEnd = `${y}-${pad(m)}-${pad(lastOfMonth(y, m))}`;
      break;
  }
  // 夾限於目標期間
  if (winStart < startDate) winStart = startDate;
  if (winEnd > endDate) winEnd = endDate;
  if (winStart > winEnd) return null;
  const lastDay = asOf < winEnd ? asOf : winEnd;
  return { winStart, winEnd, lastDay };
}

/** 天數（含首尾） */
function daysBetweenInclusive(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1;
}

/**
 * 更新所有進行中 KPI 的 currentValue 與狀態。
 * currentValue = asOf 所屬「period 窗口」內每日值累加：
 * 每日目標每天歸零重新考核，週/月/季目標則於各自窗口內累計，跨窗口自動重算。
 */
export async function updateGoalProgress(dateStr: string): Promise<CmoGoal[]> {
  const goals = await db.select().from(cmoGoalsTable).where(eq(cmoGoalsTable.isActive, true));
  const updated: CmoGoal[] = [];
  for (const goal of goals) {
    try {
      // asOf 不得超過目標期間（過期目標以最後一期窗口結算）
      const asOf = dateStr > goal.endDate ? goal.endDate : dateStr;
      const win = goalWindow(goal.period, asOf, goal.startDate, goal.endDate);
      if (!win) {
        updated.push(goal);
        continue;
      }
      // 累加本期窗口內（winStart ~ lastDay）每日值
      let sum = 0;
      let known = false;
      for (let d = win.winStart; d <= win.lastDay; d = addDays(d, 1)) {
        const snap = await getOrCollectSnapshot(d);
        const v = metricDailyValue(snap, goal.metric);
        if (v !== null) {
          sum += v;
          known = true;
        }
      }
      const target = Number(goal.targetValue);
      const progress = target > 0 ? sum / target : 0;
      // 本期窗口經過比例（每日目標恆為 1，即以全日目標考核）
      const totalDays = Math.max(1, daysBetweenInclusive(win.winStart, win.winEnd));
      const elapsedDays = Math.max(1, Math.min(totalDays, daysBetweenInclusive(win.winStart, win.lastDay)));
      const expected = elapsedDays / totalDays;
      let status = goal.status;
      if (!known) status = "active";
      else if (progress >= 1) status = "achieved";
      else if (progress >= expected * 0.9) status = "on_track";
      else if (progress >= expected * 0.6) status = "at_risk";
      else status = "behind";
      const [row] = await db
        .update(cmoGoalsTable)
        .set({ currentValue: String(Math.round(sum * 100) / 100), status, updatedAt: new Date() })
        .where(eq(cmoGoalsTable.id, goal.id))
        .returning();
      updated.push(row);
    } catch (err) {
      logger.warn({ err, goalId: goal.id }, "[CMO] KPI 進度更新失敗");
      updated.push(goal);
    }
  }
  return updated;
}

function buildComparison(prev: CmoSnapshotData, curr: CmoSnapshotData) {
  return {
    revenue: { yesterday: prev.revenue ?? null, today: curr.revenue ?? null, changePct: pctChange(prev.revenue?.revenue ?? 0, curr.revenue?.revenue ?? 0) },
    newMembers: { yesterday: prev.members?.newMembers ?? null, today: curr.members?.newMembers ?? null },
    points: { yesterday: prev.points ?? null, today: curr.points ?? null },
    social: { yesterday: prev.social ?? null, today: curr.social ?? null },
    wallet: { yesterday: prev.wallet ?? null, today: curr.wallet ?? null },
  };
}

async function generateAiSummary(
  reportDate: string,
  prev: CmoSnapshotData,
  curr: CmoSnapshotData,
  goals: CmoGoal[],
  anomalies: Anomaly[],
): Promise<{ summary: string; recommendations: string }> {
  const goalLines = goals.map(
    (g) => `- ${g.label}（${g.metric}，${g.period}）：目標 ${g.targetValue}${g.unit}，目前 ${g.currentValue}${g.unit}，狀態 ${g.status}，優先級 ${g.priority}，期間 ${g.startDate}~${g.endDate}`,
  );
  const prompt = `你是「七期生醫」電商平台的 AI CMO。以下是 ${reportDate}（今日）與前一日的營運數據、KPI 目標進度與異常偵測結果。請用繁體中文撰寫每日營運報告。

【前一日數據】
${JSON.stringify(prev, null, 1).slice(0, 3000)}

【今日數據】
${JSON.stringify(curr, null, 1).slice(0, 3000)}

【KPI 目標】
${goalLines.join("\n") || "（尚未設定 KPI 目標）"}

【異常偵測】
${anomalies.map((a) => `- [${a.severity}] ${a.message}`).join("\n") || "（無異常）"}

【未串接數據源】${curr.notConnected.join("、")}（略過，不要臆測其數據）

請輸出 JSON（不要包 markdown code block），格式：
{"summary": "營運摘要（昨今對比重點、KPI 進度、異常說明，條列清楚，約 200-400 字）", "recommendations": "具體可執行的行銷/營運建議 3-5 條，條列"}
金額單位為新台幣元，數字必須來自上方資料，不可臆測。`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-terra",
      max_completion_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
    const text = completion.choices[0]?.message?.content ?? "";
    const jsonText = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
    const parsed = JSON.parse(jsonText) as { summary?: string; recommendations?: string };
    if (parsed.summary) {
      return { summary: parsed.summary, recommendations: parsed.recommendations ?? "" };
    }
  } catch (err) {
    logger.warn({ err }, "[CMO] AI 摘要生成失敗，改用規則式摘要");
  }
  // 規則式退回：AI 失敗時仍產出可讀報告
  const lines = [
    `【${reportDate} 營運摘要（系統自動彙整）】`,
    curr.revenue ? `- 訂單 ${curr.revenue.ordersCount} 筆、營收 NT$${curr.revenue.revenue}（前日 NT$${prev.revenue?.revenue ?? "—"}）` : "- 訂單數據收集失敗",
    curr.members ? `- 新會員 ${curr.members.newMembers} 人，會員總數 ${curr.members.totalMembers}` : "- 會員數據收集失敗",
    curr.points ? `- 點數發放 ${curr.points.issued}、使用 ${curr.points.redeemed}` : "",
    curr.social ? `- 已發布社群貼文 ${curr.social.publishedPosts} 篇` : "",
    ...anomalies.map((a) => `- ⚠ ${a.message}`),
  ].filter(Boolean);
  return { summary: lines.join("\n"), recommendations: "AI 服務暫時無法生成建議，請稍後手動重新生成報告。" };
}

/**
 * 生成指定日期的營運報告（reportDate 對比其前一日）。
 * - daily：由排程針對「已完整結束的日期」生成；受 DB 部分唯一索引保護，
 *   同日重複觸發（含多實例競態）只會保留一筆。
 * - manual：即時報告（reportDate 截至目前的數據），可重複生成多筆。
 */
export async function generateDailyReport(
  reportDate: string = taipeiDateString(),
  reportType: "daily" | "manual" = "daily",
): Promise<CmoReport> {
  if (reportType === "daily" && (await hasDailyReport(reportDate))) {
    const [existing] = await db
      .select()
      .from(cmoReportsTable)
      .where(and(eq(cmoReportsTable.reportDate, reportDate), eq(cmoReportsTable.reportType, "daily")))
      .orderBy(desc(cmoReportsTable.createdAt))
      .limit(1);
    if (existing) return existing;
  }
  // reportDate 快照重新收集（daily 針對完整日、manual 為截至目前），前一日沿用既有快照
  const curr = await collectAndStoreSnapshot(reportDate);
  const prev = await getOrCollectSnapshot(addDays(reportDate, -1));
  const anomalies = detectAnomalies(prev, curr);
  const goals = await updateGoalProgress(reportDate);
  const activeGoals = goals.filter((g) => g.isActive);
  const { summary, recommendations } = await generateAiSummary(reportDate, prev, curr, activeGoals, anomalies);

  const goalProgress = activeGoals.map((g) => ({
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
  }));

  const inserted = await db
    .insert(cmoReportsTable)
    .values({
      reportDate,
      reportType,
      summary,
      recommendations,
      kpiSnapshot: { yesterday: prev, today: curr, comparison: buildComparison(prev, curr), anomalies },
      goalProgress,
      rawData: { yesterday: prev, today: curr },
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) {
    // 另一實例已同時寫入 daily 報告（uq_cmo_reports_daily），回傳既有那筆
    const [existing] = await db
      .select()
      .from(cmoReportsTable)
      .where(and(eq(cmoReportsTable.reportDate, reportDate), eq(cmoReportsTable.reportType, "daily")))
      .orderBy(desc(cmoReportsTable.createdAt))
      .limit(1);
    return existing;
  }
  logger.info({ reportDate, reportType, anomalies: anomalies.length }, "[CMO] 營運報告已生成");
  return inserted[0];
}

/** 指定日期是否已有快照 */
export async function hasSnapshot(dateStr: string): Promise<boolean> {
  const [row] = await db
    .select({ id: cmoMetricSnapshotsTable.id })
    .from(cmoMetricSnapshotsTable)
    .where(eq(cmoMetricSnapshotsTable.snapshotDate, dateStr))
    .limit(1);
  return !!row;
}

/** 是否已有當日 daily 報告 */
export async function hasDailyReport(reportDate: string): Promise<boolean> {
  const [row] = await db
    .select({ id: cmoReportsTable.id })
    .from(cmoReportsTable)
    .where(and(eq(cmoReportsTable.reportDate, reportDate), eq(cmoReportsTable.reportType, "daily")))
    .orderBy(desc(cmoReportsTable.createdAt))
    .limit(1);
  return !!row;
}
