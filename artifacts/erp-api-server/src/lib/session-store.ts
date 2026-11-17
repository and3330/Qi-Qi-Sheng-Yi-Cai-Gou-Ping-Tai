import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { pool } from "@workspace/erp-db";

const PgStore = connectPgSimple(session);

/**
 * 登入時效的延長（touch）多久寫一次資料庫。
 * 登入有效期是 14 天，每個請求都去更新到期時間沒有意義，卻讓每個回應多等一趟資料庫往返
 * （資料庫與主機不在同一個地區時大約 0.2 秒），還佔用只有兩條連線的 session 連線池。
 * 同一個登入 5 分鐘內只寫一次，對到期時間的影響最多 5 分鐘。
 */
export const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TRACKED_SESSIONS = 5000;

/** 判斷這次要不要真的寫資料庫；獨立成函式方便測試 */
export function createTouchThrottle(intervalMs = TOUCH_INTERVAL_MS, now: () => number = Date.now) {
  const lastTouched = new Map<string, number>();
  return {
    shouldTouch(sid: string): boolean {
      const at = now();
      const last = lastTouched.get(sid);
      if (last !== undefined && at - last < intervalMs) return false;
      // 記錄數量有上限，超過就把最舊的清掉（Map 依加入順序排列）
      if (lastTouched.size >= MAX_TRACKED_SESSIONS) {
        const oldest = lastTouched.keys().next().value;
        if (oldest !== undefined) lastTouched.delete(oldest);
      }
      lastTouched.delete(sid);
      lastTouched.set(sid, at);
      return true;
    },
    forget(sid: string): void { lastTouched.delete(sid); },
  };
}

export function createPgSessionStore(sessionPool: typeof pool, onError: () => void, pruneSessionInterval?: false) {
  const store = new PgStore({
    pool: sessionPool as any, // 七期專案裡有兩個版本的 pg 型別定義，執行時是同一個類別
    tableName: "user_sessions",
    createTableIfMissing: false,
    errorLog: onError, // Never pass driver SQL/parameters to a logger.
    ...(pruneSessionInterval === false ? { pruneSessionInterval: false } : {}),
  });

  const throttle = createTouchThrottle();
  const touch = store.touch.bind(store);
  const destroy = store.destroy.bind(store);
  store.touch = ((sid: string, sess: session.SessionData, callback?: () => void) => {
    if (!throttle.shouldTouch(sid)) { callback?.(); return; }
    touch(sid, sess, callback);
  }) as typeof store.touch;
  // 登出後忘掉這個登入，之後同一個 sid 不會被誤判成「剛更新過」
  store.destroy = ((sid: string, callback?: (err?: unknown) => void) => {
    throttle.forget(sid);
    destroy(sid, callback);
  }) as typeof store.destroy;
  return store;
}
