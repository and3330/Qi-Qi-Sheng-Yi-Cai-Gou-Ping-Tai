import crypto from "node:crypto";

/**
 * 把各公司填的金鑰加密後才存進資料庫（AES-256-GCM）。
 * 解密用的主金鑰放在主機環境變數 ERP_SECRETS_KEY（至少 32 個字元的亂數字串），不在資料庫裡；
 * 就算資料庫外流，沒有這把主金鑰也解不開。主金鑰換掉之後，舊的設定要請各公司重填。
 */
const PREFIX = "v1:";

export class SecretKeyMissingError extends Error {
  constructor() { super("平台還沒設定加密主金鑰（ERP_SECRETS_KEY），暫時不能儲存金鑰，請通知系統管理員"); }
}

function masterKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.ERP_SECRETS_KEY || "";
  if (raw.length < 32) throw new SecretKeyMissingError();
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function hasMasterKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.ERP_SECRETS_KEY || "").length >= 32;
}

export function sealSecrets(secrets: Record<string, string>, env: NodeJS.ProcessEnv = process.env): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(env), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(secrets), "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function openSecrets(sealed: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (!sealed.startsWith(PREFIX)) throw new Error("金鑰格式不正確，請重新填寫");
  const raw = Buffer.from(sealed.slice(PREFIX.length), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(env), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  try {
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    return JSON.parse(text) as Record<string, string>;
  } catch {
    throw new Error("金鑰解不開（主金鑰可能換過了），請到「串接金鑰」重新填寫");
  }
}

/** 給畫面看的提示：只留最後四碼 */
export const hintOf = (value: string): string => (value.length <= 4 ? "••••" : `••••${value.slice(-4)}`);
