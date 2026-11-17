import { Router, type Request, type Response } from "express";
import { accountName } from "../lib/company-identity";
import rateLimit from "express-rate-limit";
import { pool } from "@workspace/erp-db";
import { hashPassword, verifyPassword } from "../lib/auth";
import { createRecoveryService, digest, padForgotResponse, PASSWORD_POLICY, RECOVERY_MESSAGE, RecoveryError, sendRecoveryEmail, validRecoveryPassword } from "../lib/account-recovery";

const service = createRecoveryService({ pool, hashPassword, verifyPassword, send: sendRecoveryEmail });
export function createRecoveryRouter(recovery = service) {
  const router = Router();
  const ipLimit = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "操作過於頻繁，請稍後再試" } });
  const accountLimit = rateLimit({
    windowMs: 15 * 60_000, limit: 5, standardHeaders: "draft-7", legacyHeaders: false,
    keyGenerator: (req) => digest(!req.path.endsWith("forgot-password") && req.session?.user ? `id:${req.session.user.tenantId}:${req.session.user.id}` : JSON.stringify([typeof req.body?.companyCode === "string" ? req.body.companyCode.trim() : "", typeof req.body?.username === "string" ? req.body.username.trim() : ""])),
    handler: async (req, res) => { if (req.path.endsWith("forgot-password")) { await padForgotResponse(res.locals.recoveryStarted); res.json({ message: RECOVERY_MESSAGE }); } else res.status(429).json({ error: "操作過於頻繁，請稍後再試" }); },
  });
  const safe = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try { await fn(req, res); }
    catch (error) {
      // Never log DB errors: driver errors may contain tokens, emails or SQL params.
      res.status(error instanceof RecoveryError ? error.status : 503).json({ error: error instanceof RecoveryError ? error.message : "服務暫時無法使用，請稍後再試。" });
    }
  };
  router.post("/admin/forgot-password", ipLimit, (_req, res, next) => {
    res.locals.recoveryStarted = performance.now(); next();
  }, accountLimit, async (req, res) => {
    let unavailable = false;
    try {
      const username = accountName(req.body?.username);
      if (username) await recovery.forgot(req.body?.companyCode, username);
    } catch { unavailable = true; }
    // Same six-second floor for missing, inactive, unenrolled, success, mail
    // failure, account throttling and infrastructure errors. All work is bounded:
    // database <=1s, mail <=3s, failed-delivery cleanup <=1s, leaving 1s headroom.
    await padForgotResponse(res.locals.recoveryStarted);
    if (unavailable) res.status(503).json({ error: "服務暫時無法使用，請稍後再試。" });
    else res.json({ message: RECOVERY_MESSAGE });
  });
  router.post("/admin/reset-password", ipLimit, safe(async (req, res) => {
    if (!validRecoveryPassword(req.body?.password)) throw new RecoveryError(400, PASSWORD_POLICY);
    await recovery.consume(typeof req.body?.token === "string" ? req.body.token : "", "reset", req.body.password);
    res.json({ message: "密碼已重設，請使用新密碼登入。" });
  }));
  router.post("/admin/verify-recovery-email", ipLimit, safe(async (req, res) => {
    await recovery.consume(typeof req.body?.token === "string" ? req.body.token : "", "verify");
    res.json({ message: "復原信箱已驗證。" });
  }));
  router.use("/admin/recovery-email", (req, res, next) => {
    if (!req.session?.user || !Number.isInteger(req.session.user.tenantId) || (req.session.user.tenantId ?? 0) <= 0 || (req as any).apiKeyAuth) { res.status(401).json({ error: "請先登入" }); return; }
    next();
  });
  router.get("/admin/recovery-email", safe(async (req, res) => {
    const user = req.session!.user!;
    res.json(await recovery.get(user.id, user.tenantId!));
  }));
  router.post("/admin/recovery-email", ipLimit, accountLimit, safe(async (req, res) => {
    const { email, currentPassword } = req.body ?? {};
    if (typeof email !== "string" || email.length > 254 || !/^[^\s<>@\r\n]+@[^\s<>@\r\n]+\.[^\s<>@\r\n]+$/.test(email) ||
      typeof currentPassword !== "string" || !currentPassword || Buffer.byteLength(currentPassword) > 1024) throw new RecoveryError(400, "請輸入有效信箱及目前密碼");
    const user = req.session!.user!;
    await recovery.enroll(user.id, user.tenantId!, email, currentPassword);
    res.json({ message: "驗證郵件已寄出，請至信箱完成驗證。" });
  }));
  return router;
}
export default createRecoveryRouter();