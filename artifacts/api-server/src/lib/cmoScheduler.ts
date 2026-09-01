/**
 * AI CMO 排程器
 * - 每日凌晨（台北 00:00 後）將「前一日」數據快照做最終收集（整日完整數據）
 * - 每日早上（台北 07:00 後）為「已完整結束的前一日」自動生成營運報告
 *   （報告內容 = 前一日 vs 前二日的完整日對比；當日即時數據請用手動生成）
 * 以 5 分鐘輪詢實作，冪等：快照為 upsert、daily 報告受 DB 部分唯一索引保護。
 */
import { logger } from "./logger";
import { addDays, collectAndStoreSnapshot, taipeiDateString } from "./cmoMetrics";
import { generateDailyReport, hasDailyReport, hasSnapshot } from "./cmoReport";

let timer: ReturnType<typeof setInterval> | null = null;
let finalizedFor: string | null = null;
let reportedFor: string | null = null;
let running = false;

export function taipeiHour(d: Date = new Date()): number {
  return (d.getUTCHours() + 8) % 24;
}

export type CmoSchedulerDecision = {
  /** 需要最終收集前一日快照 */
  collectYesterday: boolean;
  /** 需要生成前一日的每日報告 */
  generateYesterdayReport: boolean;
};

/**
 * 純函式：判斷本次 tick 該做什麼（可單元測試）。
 * - 凌晨（00:00 後、當日尚未 finalize）→ 最終收集昨日快照
 * - 任何時刻若昨日快照不存在 → 補收（伺服器可能整夜未運行）
 * - 07:00 後且昨日 daily 報告不存在 → 生成昨日報告
 */
export function decideCmoActions(input: {
  hour: number;
  today: string;
  finalizedFor: string | null;
  yesterdaySnapshotExists: boolean;
  yesterdayDailyReportExists: boolean;
}): CmoSchedulerDecision {
  const needFinalize = input.finalizedFor !== input.today;
  return {
    collectYesterday: needFinalize || !input.yesterdaySnapshotExists,
    generateYesterdayReport: input.hour >= 7 && !input.yesterdayDailyReportExists,
  };
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const today = taipeiDateString();
    const yesterday = addDays(today, -1);
    const hour = taipeiHour();

    const decision = decideCmoActions({
      hour,
      today,
      finalizedFor,
      yesterdaySnapshotExists: await hasSnapshot(yesterday),
      yesterdayDailyReportExists: reportedFor === today ? true : await hasDailyReport(yesterday),
    });

    // 凌晨：最終收集前一日完整數據（upsert 冪等）
    if (decision.collectYesterday) {
      try {
        await collectAndStoreSnapshot(yesterday);
        finalizedFor = today;
        logger.info({ date: yesterday }, "[CMO] 前一日數據快照已最終收集");
      } catch (err) {
        logger.error({ err }, "[CMO] 每日數據收集失敗");
      }
    }

    // 早上 07:00 後：生成「前一日（完整日）」報告
    if (decision.generateYesterdayReport) {
      try {
        await generateDailyReport(yesterday, "daily");
        reportedFor = today;
      } catch (err) {
        logger.error({ err }, "[CMO] 每日報告生成失敗");
      }
    } else if (decision.generateYesterdayReport === false && hour >= 7) {
      reportedFor = today;
    }
  } finally {
    running = false;
  }
}

export function startCmoScheduler() {
  if (timer) return;
  logger.info("[CMO] 排程器已啟動（凌晨最終收集前一日數據、07:00 生成前一日報告）");
  timer = setInterval(() => {
    tick().catch((err) => logger.error({ err }, "[CMO] 排程處理失敗"));
  }, 5 * 60 * 1000);
  timer.unref?.();
  // 啟動時先跑一次（補收昨日快照 / 補生成報告）
  setTimeout(() => {
    tick().catch((err) => logger.error({ err }, "[CMO] 初始排程失敗"));
  }, 10_000).unref?.();
}
