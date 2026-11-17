import { createHash, randomBytes } from "node:crypto";
import { companyCode, accountName } from "./company-identity";
import type { pool, PoolClient } from "@workspace/erp-db";
type Pool = typeof pool;

export const RECOVERY_MESSAGE = "若帳號已設定並驗證復原信箱，您將收到密碼重設郵件。";
export const PASSWORD_POLICY = "密碼至少 10 個字元、最多 72 個 UTF-8 位元組，且包含英文字母及數字";
export const validRecoveryPassword = (value: unknown): value is string =>
  typeof value === "string" && [...value].length >= 10 &&
  Buffer.byteLength(value, "utf8") <= 72 && /[A-Za-z]/.test(value) && /[0-9]/.test(value);
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export type Purpose = "verify" | "reset";
type User = { id: number; tenant_id: number; password_hash: string; recovery_email: string | null; recovery_email_verified_at: Date | null; is_active: boolean };
type Token = { user_id: number; tenant_id: number; binding_hash: string; expires_at: Date };
export class RecoveryError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const invalid = () => new RecoveryError(400, "連結無效或已過期，請重新申請。");
const binding = (user: User) => digest(JSON.stringify([user.id, user.tenant_id, user.password_hash, user.recovery_email, user.recovery_email_verified_at]));
const userSelect = "SELECT u.*,p.recovery_email,p.recovery_email_verified_at FROM admin_users u LEFT JOIN account_recovery_profiles p ON p.user_id=u.id AND p.tenant_id=u.tenant_id";

export const FORGOT_RESPONSE_MS = 6_000;
export const RECOVERY_DB_TIMEOUT_MS = 1_000;
export const RECOVERY_MAIL_TIMEOUT_MS = 3_000;
export async function padForgotResponse(started: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, FORGOT_RESPONSE_MS - (performance.now() - started))));
}

export async function sendRecoveryEmail(email: string, token: string, purpose: Purpose, signal?: AbortSignal): Promise<void> {
  // Never derive this origin from Host, Origin, proxy headers, or user input.
  const path = purpose === "reset" ? "reset-password" : "verify-recovery-email";
  const base = (process.env.PUBLIC_BASE_URL || `https://${(process.env.REPLIT_DOMAINS || "").split(",")[0]}`).replace(/\/+$/, "");
  const link = `${base}/erp/${path}#token=${token}`;
  const title = purpose === "reset" ? "重設您的密碼" : "驗證您的復原信箱";
  if (!process.env.RESEND_API_KEY) throw new Error("Recovery mail unavailable");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: signal ?? AbortSignal.timeout(RECOVERY_MAIL_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || "七期生醫 ERP <no-reply@example.com>", to: [email], subject: `七期生醫 ERP — ${title}`,
      html: `<h2>${title}</h2><p>此連結將於 30 分鐘後失效，且只能使用一次。</p><p><a href="${link}">${title}</a></p><p>若您未提出此要求，請忽略本郵件。</p>`,
    }),
  });
  if (!response.ok) throw new Error("Recovery mail unavailable");
}

export function createRecoveryService(deps: {
  pool: Pick<Pool, "connect">;
  verifyPassword: (plain: string, hash: string) => Promise<boolean>;
  hashPassword: (plain: string) => Promise<string>;
  send: typeof sendRecoveryEmail;
}) {
  async function transaction<T>(fn: (client: PoolClient) => Promise<T>, bounded = false): Promise<T> {
    let client: PoolClient | undefined;
    let expired = false;
    let released = false;
    const release = (destroy = false) => { if (client && !released) { released = true; client.release(destroy); } };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = (async () => {
      client = await deps.pool.connect();
      if (expired) { release(true); throw new Error("Recovery database deadline"); }
      try {
        await client.query("BEGIN");
        if (bounded) await client.query("SET LOCAL statement_timeout='800ms'; SET LOCAL lock_timeout='500ms'");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        if (!released) await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally { release(); }
    })();
    if (!bounded) return work;
    try {
      return await Promise.race([work, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          // Cancel work by destroying the dedicated connection. PostgreSQL rolls
          // back its transaction; a late queued pool acquisition is also released.
          release(true);
          reject(new Error("Recovery database deadline"));
        }, RECOVERY_DB_TIMEOUT_MS);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function issue(client: PoolClient, user: User, purpose: Purpose) {
    const token = randomBytes(32).toString("base64url");
    await client.query("DELETE FROM account_recovery_tokens WHERE user_id=$1 AND tenant_id=$2 AND purpose=$3", [user.id, user.tenant_id, purpose]);
    await client.query("INSERT INTO account_recovery_tokens (token_hash,user_id,tenant_id,purpose,binding_hash,expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval '30 minutes')",
      [digest(token), user.id, user.tenant_id, purpose, binding(user)]);
    return { email: user.recovery_email!, token, purpose };
  }
  async function deliver(mail: Awaited<ReturnType<typeof issue>>, hideFailure: boolean) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        deps.send(mail.email, mail.token, mail.purpose, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("Recovery mail deadline")); }, RECOVERY_MAIL_TIMEOUT_MS);
        }),
      ]);
    }
    catch {
      // Delete only this issuance; never revoke a concurrently issued successor.
      await transaction(async (c) => { await c.query("DELETE FROM account_recovery_tokens WHERE token_hash=$1", [digest(mail.token)]); }, true);
      if (!hideFailure) throw new RecoveryError(503, "郵件暫時無法寄送，請稍後再試。");
    } finally { clearTimeout(timer); }
  }
  return {
    async get(userId: number, tenantId: number) {
      return transaction(async (c) => {
        const { rows } = await c.query<User>(`${userSelect} WHERE u.id=$1 AND u.tenant_id=$2 AND u.is_active=true`, [userId, tenantId]);
        if (!rows[0]) throw new RecoveryError(401, "請先登入");
        return { email: rows[0].recovery_email, verified: !!rows[0].recovery_email_verified_at };
      });
    },
    async enroll(userId: number, tenantId: number, email: string, password: string) {
      const mail = await transaction(async (c) => {
        const { rows } = await c.query<User>(`${userSelect} WHERE u.id=$1 AND u.tenant_id=$2 FOR UPDATE OF u`, [userId, tenantId]);
        const user = rows[0];
        if (!user?.is_active || !await deps.verifyPassword(password, user.password_hash)) throw new RecoveryError(400, "目前密碼不正確");
        await c.query("INSERT INTO account_recovery_profiles (recovery_email,user_id,tenant_id) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET recovery_email=EXCLUDED.recovery_email,recovery_email_verified_at=NULL WHERE account_recovery_profiles.tenant_id=EXCLUDED.tenant_id", [email, user.id, user.tenant_id]);
        await c.query("DELETE FROM account_recovery_tokens WHERE user_id=$1 AND tenant_id=$2", [user.id, user.tenant_id]);
        return issue(c, { ...user, recovery_email: email, recovery_email_verified_at: null }, "verify");
      });
      await deliver(mail, false);
    },
    async forgot(code: string, username: string) {
      const canonicalCode = companyCode(code);
      const canonicalName = accountName(username);
      if (!canonicalCode || !canonicalName) return;
      const mail = await transaction(async (c) => {
        // Check BOTH new tables before identity lookup, including the token
        // columns used on issuance. Missing migration must not reveal accounts.
        await c.query("SELECT token_hash,user_id,tenant_id,purpose,binding_hash,expires_at FROM account_recovery_tokens LIMIT 0");
        // Exact, case-sensitive company/account pair; limiter uses the same trim.
        const { rows } = await c.query<User>(`${userSelect} JOIN tenants t ON t.id=u.tenant_id WHERE t.company_code=$1 AND u.tenant_id=t.id AND u.username=$2 FOR UPDATE OF u`, [canonicalCode, canonicalName]);
        const user = rows[0];
        if (user && !(await c.query("SELECT 1 FROM tenants WHERE id=$1 AND company_code=$2", [user.tenant_id, canonicalCode])).rowCount) return null;
        if (!user?.is_active || !user.recovery_email || !user.recovery_email_verified_at) return null;
        return issue(c, user, "reset");
      }, true);
      if (mail) await deliver(mail, true);
    },
    async consume(token: string, purpose: Purpose, password?: string) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
      if (purpose === "reset" && !validRecoveryPassword(password)) throw new RecoveryError(400, PASSWORD_POLICY);
      // Expensive hashing before holding locks; validation still happens in transaction.
      const newHash = purpose === "reset" ? await deps.hashPassword(password!) : null;
      await transaction(async (c) => {
        const hash = digest(token);
        const first = await c.query<Token>("SELECT * FROM account_recovery_tokens WHERE token_hash=$1 AND purpose=$2", [hash, purpose]);
        if (!first.rows[0]) throw invalid();
        const { user_id: id, tenant_id: tenantId } = first.rows[0];
        // Every issuance/consumption takes the same account lock FIRST.
        const users = await c.query<User>(`${userSelect} WHERE u.id=$1 AND u.tenant_id=$2 FOR UPDATE OF u`, [id, tenantId]);
        const user = users.rows[0];
        const tokens = await c.query<Token>("SELECT * FROM account_recovery_tokens WHERE token_hash=$1 AND purpose=$2 AND user_id=$3 AND tenant_id=$4 AND expires_at>now()", [hash, purpose, id, tenantId]);
        if (!user?.is_active || !tokens.rows[0] || tokens.rows[0].binding_hash !== binding(user)) throw invalid();
        if (purpose === "reset") {
          if (!user.recovery_email_verified_at) throw invalid();
          await c.query("UPDATE admin_users SET password_hash=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3", [newHash, id, tenantId]);
          // admin id is globally unique; include legacy sessions without tenantId.
          await c.query("DELETE FROM user_sessions WHERE sess->'user'->>'id'=$1", [String(id)]);
        } else {
          await c.query("UPDATE account_recovery_profiles SET recovery_email_verified_at=now() WHERE user_id=$1 AND tenant_id=$2", [id, tenantId]);
        }
        await c.query("DELETE FROM account_recovery_tokens WHERE user_id=$1 AND tenant_id=$2", [id, tenantId]);
      });
    },
  };
}