import type { pool, PoolClient } from "@workspace/erp-db";
import { companyCode, accountName } from "./company-identity";
import { AuthConnectionDeadlineError, reportAuthFailure, type AuthStage, type AuthFailureReporter } from "./auth-diagnostics";

type AuthUser = {
  id: number; tenant_id: number; company_code: string; username: string; password_hash: string;
  display_name: string; role: string; employee_id: number | null; is_active: boolean;
};

// All credential-changing paths and recovery serialize on the admin row.
// This does not reference recovery tables: login remains usable before migration.
export function createLockedAuth(deps: {
  pool: Pick<typeof pool, "connect">;
  verifyPassword: (plain: string, hash: string) => Promise<boolean>;
  hashPassword: (plain: string) => Promise<string>;
  connectionTimeoutMs?: number;
}) {
  const connectionTimeoutMs = deps.connectionTimeoutMs ?? 1_000;
  if (!Number.isInteger(connectionTimeoutMs) || connectionTimeoutMs < 1 || connectionTimeoutMs > 10_000) {
    throw new Error("Invalid authentication connection budget");
  }
  // Shared pool acquisition is bounded even when every slot is already busy.
  async function acquire(): Promise<PoolClient> {
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = deps.pool.connect().then((client) => {
      if (expired) { client.release(); throw new AuthConnectionDeadlineError(); }
      return client;
    });
    try {
      return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { expired = true; reject(new AuthConnectionDeadlineError()); }, connectionTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  function query<T extends Record<string, any> = Record<string, any>>(client: PoolClient, text: string, values: unknown[] = []) {
    // Driver deadline covers network stalls in addition to server-side bounds.
    const config = { text, values, query_timeout: 3_000 };
    return client.query<T>(config);
  }
  async function transaction<T>(fn: (client: PoolClient, stage: (value: AuthStage) => void) => Promise<T>,
    cleanup?: () => Promise<void>, report?: AuthFailureReporter) {
    let stage: AuthStage = "acquire";
    let client: PoolClient;
    try { client = await acquire(); } catch (error) {
      reportAuthFailure(report, stage, error);
      throw error;
    }
    let released = false;
    try {
      stage = "begin";
      await query(client, "BEGIN");
      stage = "bounds";
      await query(client, "SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='2500ms'; SET LOCAL idle_in_transaction_session_timeout='10000ms'");
      const result = await fn(client, (value) => { stage = value; });
      stage = "commit";
      await query(client, "COMMIT");
      return result;
    } catch (error) {
      reportAuthFailure(report, stage, error);
      await query(client, "ROLLBACK").catch(() => {});
      // Destroy possibly timed-out connections and free shared pool capacity
      // before independent session-store cleanup.
      client.release(true);
      released = true;
      // Session store writes use another connection, so rollback alone is not
      // enough when persistence/COMMIT fails. Never leave that session usable.
      if (cleanup) {
        try { await cleanup(); } catch (cleanupError) {
          reportAuthFailure(report, "cleanup", cleanupError);
          throw cleanupError;
        }
      }
      throw error;
    } finally { if (!released) client.release(); }
  }
  return {
    async login(code: string, username: string, password: string, persist: (user: AuthUser) => Promise<void>,
      cleanup: () => Promise<void>, report?: AuthFailureReporter) {
      const canonicalCode = companyCode(code);
      const canonicalName = accountName(username);
      if (!canonicalCode || !canonicalName) return null;
      let persisted = false;
      return transaction(async (c, stage) => {
        stage("user_lookup");
        const { rows } = await query<AuthUser>(c, "SELECT u.*,t.company_code FROM admin_users u JOIN tenants t ON t.id=u.tenant_id WHERE t.company_code=$1 AND u.tenant_id=t.id AND u.username=$2 FOR UPDATE OF u", [canonicalCode, canonicalName]);
        const user = rows[0];
        // Recheck after the user lock: an authoritative company-code edit may
        // have committed while this SELECT waited, invalidating its snapshot.
        stage("tenant_recheck");
        if (user && !(await query(c, "SELECT 1 FROM tenants WHERE id=$1 AND company_code=$2", [user.tenant_id, canonicalCode])).rowCount) return null;
        stage("password_verify");
        if (!user?.is_active || !await deps.verifyPassword(password, user.password_hash)) return null;
        if (!user.password_hash.startsWith("$2")) {
          stage("password_rehash");
          const hash = await deps.hashPassword(password);
          const update = await query(c, "UPDATE admin_users SET password_hash=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3 AND password_hash=$4", [hash, user.id, user.tenant_id, user.password_hash]);
          if (update.rowCount !== 1) throw new Error("Credentials changed");
        }
        persisted = true; // Includes partially failed writes.
        stage("session_persist");
        await persist(user); // Hold account lock until session is durably stored.
        return user;
      }, async () => { if (persisted) await cleanup(); }, report);
    },
    async changePassword(id: number, tenantId: number, oldPassword: string, newPassword: string) {
      return transaction(async (c) => {
        const { rows } = await query<AuthUser>(c, "SELECT * FROM admin_users WHERE id=$1 AND tenant_id=$2 FOR UPDATE", [id, tenantId]);
        const user = rows[0];
        if (!user?.is_active || !await deps.verifyPassword(oldPassword, user.password_hash)) return false;
        const hash = await deps.hashPassword(newPassword);
        const updated = await query(c, "UPDATE admin_users SET password_hash=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3 AND password_hash=$4", [hash, id, tenantId, user.password_hash]);
        return updated.rowCount === 1;
      });
    },
  };
}