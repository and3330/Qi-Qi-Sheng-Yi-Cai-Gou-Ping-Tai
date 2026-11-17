import { Router, type IRouter } from "express";
import { provisionTenant } from "../lib/tenant-provision";
import { loginRateLimit } from "../middleware/rate-limit";
import { companyCode } from "../lib/company-identity";
import { pool } from "@workspace/erp-db";

const router: IRouter = Router();

/** 七期網站只有一家公司：還沒建立公司時才開放首次設定，建好之後這個入口就關閉 */
async function companyExists(): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM tenants LIMIT 1");
  return rows.length > 0;
}

/** 登入頁用：要不要顯示「首次設定」 */
router.get("/public/setup-state", async (_req, res): Promise<void> => {
  // 只有一家公司時把統編（公開資訊）帶給登入頁，使用者就不用每次輸入
  const { rows } = await pool.query("SELECT company_code FROM tenants ORDER BY id LIMIT 2");
  res.json({ needsSetup: rows.length === 0, companyCode: rows.length === 1 ? rows[0].company_code : null });
});

/** 首次設定：建立公司 + 老闆帳號（只能做一次） */
router.post("/public/signup", loginRateLimit, async (req, res): Promise<void> => {
  if (await companyExists()) { res.status(403).json({ error: "公司已經建立，請直接登入；要新增帳號請由管理員在「使用者管理」新增" }); return; }
  const { companyName, contactEmail, username, password, displayName } = req.body ?? {};
  const code = companyCode(req.body?.companyCode);
  if (!code) { res.status(400).json({ error: "公司編碼需為 8 位數字統編" }); return; }
  if (!companyName || !String(companyName).trim()) { res.status(400).json({ error: "公司名稱為必填" }); return; }
  if (typeof username !== "string" || !/^[a-zA-Z0-9_.-]{3,50}$/.test(username.trim())) {
    res.status(400).json({ error: "帳號需為 3-50 字元的英數字（可含 _ . -）" }); return;
  }
  if (!password || String(password).length < 6) { res.status(400).json({ error: "密碼至少 6 字元" }); return; }
  if (!contactEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(contactEmail))) {
    res.status(400).json({ error: "請填寫有效的 Email" }); return;
  }

  try {
    const { tenant, adminUserId } = await provisionTenant({
      companyCode: code,
      companyName: String(companyName).trim(),
      contactEmail: String(contactEmail).trim(),
      username: String(username).trim(),
      password: String(password),
      displayName: String(displayName || companyName).trim(),
    });

    // 直接登入（與 /admin/login 相同的 session 重生流程）
    req.session.regenerate((err) => {
      if (err) { res.status(500).json({ error: "註冊成功，請前往登入頁登入" }); return; }
      req.session.user = {
        id: adminUserId,
        username: String(username).trim(),
        displayName: String(displayName || companyName).trim(),
        role: "owner",
        employeeId: null,
        tenantId: tenant.id,
        companyCode: tenant.companyCode,
      };
      req.session.save((err2) => {
        if (err2) { res.status(500).json({ error: "註冊成功，請前往登入頁登入" }); return; }
        res.status(201).json({
          ok: true,
          tenant: { id: tenant.id, companyCode: tenant.companyCode, name: tenant.name, status: tenant.status, trialEndsAt: tenant.trialEndsAt, aiCredits: tenant.aiCredits },
        });
      });
    });
  } catch (e: any) {
    if (e?.statusCode === 409 || e?.statusCode === 400) { res.status(e.statusCode).json({ error: e.message }); return; }
    throw e;
  }
});

export default router;
