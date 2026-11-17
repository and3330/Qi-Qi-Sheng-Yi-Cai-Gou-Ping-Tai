import { currentTenantId } from "@workspace/erp-db";
import { tenantPool } from "./tenant-db";
import { openSecrets } from "./secret-box";
import { getInvoiceConfig, type EcpayInvoiceConfig } from "./ecpay-invoice";

/**
 * 各公司自己的串接設定。
 *
 * - 綠界電子發票：每家公司用自己的商店代號開發票。平台環境變數那一組只給 ECPAY_INVOICE_TENANT_ID
 *   指定的那一家用；其他公司沒填自己的就不能開，避免用別家公司的統編開出發票。
 * - Resend 寄信：有填自己的就用自己的帳號與寄件信箱；沒填就用平台的帳號，從 no-reply@yubonerp.com 寄出。
 */
export const PROVIDERS = ["ecpay_invoice", "resend", "icta_pro"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const isProvider = (value: unknown): value is Provider => PROVIDERS.includes(value as Provider);

export interface StoredIntegration {
  provider: Provider;
  settings: Record<string, unknown>;
  secretCipher: string | null;
  secretHint: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export async function loadIntegration(provider: Provider): Promise<StoredIntegration | null> {
  const { rows } = await tenantPool.query(
    `SELECT provider, settings, secret_cipher AS "secretCipher", secret_hint AS "secretHint", updated_by AS "updatedBy", updated_at AS "updatedAt"
     FROM tenant_integrations WHERE provider = $1 LIMIT 1`,
    [provider],
  );
  return (rows[0] as StoredIntegration | undefined) ?? null;
}

const ECPAY_STAGE_URL = "https://einvoice-stage.ecpay.com.tw";
const ECPAY_PRODUCTION_URL = "https://einvoice.ecpay.com.tw";

/** 平台那一組綠界金鑰是不是這家公司的 */
export function platformEcpayBelongsTo(tenantId: number | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const owner = Number(env.ECPAY_INVOICE_TENANT_ID);
  return Number.isInteger(owner) && owner > 0 && tenantId === owner;
}

/** 這家公司開發票要用的綠界設定；沒設定就丟出要給人看的原因 */
export async function tenantEcpayConfig(env: NodeJS.ProcessEnv = process.env): Promise<EcpayInvoiceConfig & { source: "tenant" | "platform" }> {
  const stored = await loadIntegration("ecpay_invoice");
  if (stored?.secretCipher) {
    const secrets = openSecrets(stored.secretCipher, env);
    const merchantId = String(stored.settings.merchantId || "");
    const isTest = stored.settings.environment === "stage";
    if (!merchantId || !secrets.hashKey || !secrets.hashIV) throw new Error("綠界電子發票設定不完整，請到「系統管理 › 串接金鑰」補齊");
    return { merchantId, hashKey: secrets.hashKey, hashIV: secrets.hashIV, isTest, apiUrl: isTest ? ECPAY_STAGE_URL : ECPAY_PRODUCTION_URL, source: "tenant" };
  }
  if (platformEcpayBelongsTo(currentTenantId(), env)) return { ...getInvoiceConfig(env), source: "platform" };
  throw new Error("這家公司還沒設定綠界電子發票，請老闆或管理員到「系統管理 › 串接金鑰」填入自己的綠界商店代號與金鑰");
}

export interface ResendSender { apiKey: string; fromEmail: string; source: "tenant" | "platform" }
export const PLATFORM_FROM_EMAIL = (process.env.MAIL_FROM || "no-reply@example.com").replace(/^.*<([^>]+)>.*$/, "$1");

/** 這家公司連 ICTA PRO（講師平台）用的網址與金鑰；沒設定就丟出要給人看的原因 */
export async function tenantIctaConfig(env: NodeJS.ProcessEnv = process.env): Promise<{ baseUrl: string; apiKey: string }> {
  const stored = await loadIntegration("icta_pro");
  if (!stored?.secretCipher) throw new Error("還沒設定講師平台（ICTA PRO）的連線，請到「系統管理 › 串接金鑰」填入網址與金鑰");
  const secrets = openSecrets(stored.secretCipher, env);
  const baseUrl = String(stored.settings.baseUrl || "").replace(/\/+$/, "");
  if (!secrets.apiKey || !baseUrl) throw new Error("講師平台（ICTA PRO）的連線設定不完整，請到「系統管理 › 串接金鑰」補齊");
  return { baseUrl, apiKey: secrets.apiKey };
}

/** 這家公司寄信要用的 Resend 帳號與寄件信箱 */
export async function tenantResendSender(env: NodeJS.ProcessEnv = process.env): Promise<ResendSender> {
  const stored = await loadIntegration("resend");
  if (stored?.secretCipher) {
    const secrets = openSecrets(stored.secretCipher, env);
    const fromEmail = String(stored.settings.fromEmail || "");
    if (!secrets.apiKey || !fromEmail) throw new Error("Resend 設定不完整，請到「系統管理 › 串接金鑰」補齊");
    return { apiKey: secrets.apiKey, fromEmail, source: "tenant" };
  }
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) throw new Error("尚未設定寄信帳號：請到「系統管理 › 串接金鑰」填入自己的 Resend 金鑰");
  return { apiKey, fromEmail: PLATFORM_FROM_EMAIL, source: "platform" };
}
