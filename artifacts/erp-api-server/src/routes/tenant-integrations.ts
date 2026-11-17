import { Router, type IRouter } from "express";
import { currentTenantId } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { tenantPool } from "../lib/tenant-db";
import { sealSecrets, openSecrets, hintOf, hasMasterKey, SecretKeyMissingError } from "../lib/secret-box";
import { isProvider, loadIntegration, platformEcpayBelongsTo, PLATFORM_FROM_EMAIL, type Provider } from "../lib/tenant-integrations";
import { sendEmail } from "../lib/email";
import { ictaBaseUrlError } from "../lib/icta-case";

/**
 * 串接金鑰：每家公司自己的綠界電子發票與 Resend 寄信設定。只有老闆與管理員能看、能改。
 * 金鑰只進不出：存的時候加密，畫面上只回末四碼，任何 API 都不會把完整金鑰傳回去。
 */
const router: IRouter = Router();
const ADMIN_ROLES = ["owner", "admin", "super_admin"];
router.use("/settings/integrations", requireAuth, requireRole(...ADMIN_ROLES));

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const actor = (req: any): string => String(req.session?.user?.username || "API");
const clean = (value: unknown, max = 200): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

type Validated = { settings: Record<string, unknown>; secrets: Record<string, string>; error: string | null };

/** 檢查格式；secrets 沒填的欄位沿用原本存的 */
function validate(provider: Provider, body: any, previous: Record<string, string>): Validated {
  const secrets: Record<string, string> = { ...previous };
  if (provider === "ecpay_invoice") {
    const merchantId = clean(body.merchantId, 20);
    const environment = body.environment === "stage" ? "stage" : "production";
    for (const key of ["hashKey", "hashIV"] as const) {
      const value = clean(body[key], 64);
      if (value) secrets[key] = value;
    }
    if (!/^\d{4,10}$/.test(merchantId)) return { settings: {}, secrets, error: "綠界商店代號（MerchantID）應該是數字" };
    if (!secrets.hashKey || !secrets.hashIV) return { settings: {}, secrets, error: "請填 HashKey 與 HashIV（在綠界廠商後台 › 系統開發管理 › 系統介接設定）" };
    if (Buffer.byteLength(secrets.hashKey, "utf8") !== 16 || Buffer.byteLength(secrets.hashIV, "utf8") !== 16) return { settings: {}, secrets, error: "HashKey 與 HashIV 都應該是 16 個字元，請再核對一次" };
    return { settings: { merchantId, environment }, secrets, error: null };
  }
  if (provider === "icta_pro") {
    const baseUrl = clean(body.baseUrl, 200).replace(/\/+$/, "");
    const key = clean(body.apiKey, 200);
    if (key) secrets.apiKey = key;
    const urlError = ictaBaseUrlError(baseUrl);
    if (urlError) return { settings: {}, secrets, error: urlError };
    if (!secrets.apiKey) return { settings: {}, secrets, error: "請填講師平台給 ERP 用的金鑰（在 ICTA PRO 後台的合作夥伴金鑰建立，名稱要以 ERP 開頭）" };
    return { settings: { baseUrl }, secrets, error: null };
  }
  const fromEmail = clean(body.fromEmail, 120).toLowerCase();
  const apiKey = clean(body.apiKey, 200);
  if (apiKey) secrets.apiKey = apiKey;
  if (!secrets.apiKey) return { settings: {}, secrets, error: "請填 Resend 的 API Key" };
  if (!secrets.apiKey.startsWith("re_")) return { settings: {}, secrets, error: "Resend 的 API Key 應該是 re_ 開頭" };
  if (!EMAIL_RE.test(fromEmail)) return { settings: {}, secrets, error: "請填寄件信箱，例如 service@你的網域.com（網域要先在 Resend 驗證過）" };
  return { settings: { fromEmail }, secrets, error: null };
}

/** 給畫面看的狀態：有沒有設定、用的是自己的還是平台的、末四碼 */
router.get("/settings/integrations", async (_req, res): Promise<void> => {
  const tenantId = currentTenantId();
  const [ecpay, resend, icta] = await Promise.all([loadIntegration("ecpay_invoice"), loadIntegration("resend"), loadIntegration("icta_pro")]);
  const view = (row: Awaited<ReturnType<typeof loadIntegration>>) => row && {
    configured: !!row.secretCipher, settings: row.settings, secretHint: row.secretHint, updatedBy: row.updatedBy, updatedAt: row.updatedAt,
  };
  res.json({
    canSave: hasMasterKey(),
    ecpay_invoice: { ...(view(ecpay) ?? { configured: false }), platformFallback: platformEcpayBelongsTo(tenantId) },
    resend: { ...(view(resend) ?? { configured: false }), platformFallback: !!process.env.RESEND_API_KEY, platformFromEmail: PLATFORM_FROM_EMAIL },
    icta_pro: { ...(view(icta) ?? { configured: false }), platformFallback: false },
  });
});

router.put("/settings/integrations/:provider", async (req, res): Promise<void> => {
  const provider = req.params.provider;
  if (!isProvider(provider)) { res.status(404).json({ error: "沒有這種串接" }); return; }
  try {
    const stored = await loadIntegration(provider);
    const previous = stored?.secretCipher ? openSecrets(stored.secretCipher) : {};
    const { settings, secrets, error } = validate(provider, req.body ?? {}, previous);
    if (error) { res.status(400).json({ error }); return; }
    const hintSource = provider === "ecpay_invoice" ? secrets.hashKey : secrets.apiKey;
    await tenantPool.query(
      `INSERT INTO tenant_integrations (provider, settings, secret_cipher, secret_hint, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5, now())
       ON CONFLICT (tenant_id, provider) DO UPDATE SET settings = EXCLUDED.settings, secret_cipher = EXCLUDED.secret_cipher,
         secret_hint = EXCLUDED.secret_hint, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [provider, JSON.stringify(settings), sealSecrets(secrets), hintOf(hintSource), actor(req)],
    );
    res.json({ ok: true, provider, settings, secretHint: hintOf(hintSource) });
  } catch (err: any) {
    res.status(err instanceof SecretKeyMissingError ? 503 : 400).json({ error: err?.message || "儲存失敗" });
  }
});

/** 刪掉自己的設定（之後改用平台的；綠界則變成不能開發票） */
router.delete("/settings/integrations/:provider", async (req, res): Promise<void> => {
  const provider = req.params.provider;
  if (!isProvider(provider)) { res.status(404).json({ error: "沒有這種串接" }); return; }
  await tenantPool.query(`DELETE FROM tenant_integrations WHERE provider = $1`, [provider]);
  res.sendStatus(204);
});

/** 用目前的寄信設定寄一封測試信 */
router.post("/settings/integrations/resend/test", async (req, res): Promise<void> => {
  const to = clean(req.body?.to, 120);
  if (!EMAIL_RE.test(to)) { res.status(400).json({ error: "請填要收測試信的信箱" }); return; }
  try {
    const id = await sendEmail({ to, subject: "測試信：ERP 寄信設定成功", html: "<p>收到這封信，代表這家公司的寄信設定可以用了。</p>", senderName: "ERP 測試" });
    res.json({ ok: true, id });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "寄送失敗" });
  }
});

export default router;
