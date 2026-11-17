import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// 登入端點：每 IP 每 15 分鐘最多 10 次失敗
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "登入嘗試過於頻繁，請 15 分鐘後再試" },
});

// 改密碼端點：每使用者每小時最多 5 次（已登入時以 userId 為 key，否則 fallback 到 IP）
export const sensitiveRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "操作過於頻繁，請稍後再試" },
  keyGenerator: (req, res) => {
    const uid = (req as any).session?.user?.id;
    if (uid) return `user:${uid}`;
    return ipKeyGenerator(req.ip || "unknown");
  },
});
