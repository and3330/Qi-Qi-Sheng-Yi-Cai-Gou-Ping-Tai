/**
 * 社群貼文排程器：每 60 秒檢查到期的 scheduled 貼文並自動發布。
 */
import { logger } from "./logger";
import { processScheduledPosts } from "./socialService";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startSocialScheduler() {
  if (schedulerInterval) return;
  logger.info("[Social] 排程器已啟動（每 60 秒檢查排程貼文）");
  schedulerInterval = setInterval(async () => {
    try {
      await processScheduledPosts();
    } catch (err) {
      logger.error({ err }, "[Social] 排程處理失敗");
    }
  }, 60000);
  schedulerInterval.unref?.();
}
