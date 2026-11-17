import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export function migrationMaintenanceEnabled(env = process.env): boolean {
  const value = env.ERP_MIGRATION_MAINTENANCE;
  if (value !== undefined && value !== "true" && value !== "false") {
    throw new Error("Invalid ERP_MIGRATION_MAINTENANCE");
  }
  return value === "true";
}

export const DATABASE_IDENTITY_SQL = `
  SELECT md5(c.system_identifier::text || ':' || current_database() || ':' || d.oid::text)
    AS fingerprint, pg_is_in_recovery() AS replica,
    CASE WHEN pg_is_in_recovery() THEN pg_last_wal_replay_lsn()
      ELSE pg_current_wal_lsn() END::text AS wal_position
  FROM pg_control_system() c
  JOIN pg_database d ON d.datname=current_database()
`;

/** Must precede webhooks, sessions, audit writes and MCP. Default is unchanged. */
export function migrationMaintenanceGate(env = process.env): RequestHandler {
  return (req, res, next) => {
    if (!migrationMaintenanceEnabled(env)) { next(); return; }
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET" && req.path === "/api/healthz") {
      res.json({ status: "maintenance" }); return;
    }
    if (req.method === "GET" && req.path === "/api/migration/status") { next(); return; }
    res.setHeader("Retry-After", "120");
    res.status(503).json({ error: "資料庫搬遷維護中，請稍後再試", code: "MIGRATION_MAINTENANCE" });
  };
}

/** Maintenance-only, bearer-authenticated, metadata-only identity proof. No SQL input. */
export function migrationIdentityHandler(
  readFingerprint: () => Promise<string | {
    fingerprint: string; readOnlyReplica: boolean; walPosition: string; storageFingerprint?: string;
  }>,
  env = process.env,
): RequestHandler {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!migrationMaintenanceEnabled(env)) { res.sendStatus(404); return; }
    const key = env.ERP_AI_KEY;
    if (!key) { res.sendStatus(503); return; }
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const actual = Buffer.from(token);
    const expected = Buffer.from(key);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.sendStatus(401); return;
    }
    try {
      const identity = await readFingerprint();
      const fingerprint = typeof identity === "string" ? identity : identity.fingerprint;
      if (!/^[a-f0-9]{32}$/.test(fingerprint)) throw new Error("Identity unavailable");
      if (typeof identity !== "string" && !/^[A-F0-9]+\/[A-F0-9]+$/i.test(identity.walPosition)) {
        throw new Error("WAL position unavailable");
      }
      if (typeof identity !== "string" && identity.storageFingerprint !== undefined &&
          !/^[a-f0-9]{64}$/.test(identity.storageFingerprint)) throw new Error("Storage identity unavailable");
      res.json({
        maintenance: true, databaseFingerprint: fingerprint,
        ...(typeof identity === "string" ? {} : {
          readOnlyReplica: identity.readOnlyReplica, walPosition: identity.walPosition,
          ...(identity.storageFingerprint ? { storageFingerprint: identity.storageFingerprint } : {}),
        }),
      });
    } catch { res.status(503).json({ error: "Database identity unavailable" }); }
  };
}
