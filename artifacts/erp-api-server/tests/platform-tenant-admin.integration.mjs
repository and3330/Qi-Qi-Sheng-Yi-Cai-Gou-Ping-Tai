// Integration test: 平台後台調整 AI 點數 / 試用期限 / 免收費（Task 93）
// - 點數調整寫入 credit_transactions 並更新餘額；扣至負數被擋
// - PATCH trialEndsAt / isExempt 生效
// - 每次成功變更都有 audit_logs（module='Platform'）紀錄
// - audit_logs 寫入失敗時整筆 rollback（點數與 credit_transactions 均不變）
// Run: node tests/platform-tenant-admin.integration.mjs
// (dev server must be running; TEST_ADMIN must be a tenant-1 super_admin; DATABASE_URL required)
import { createRequire } from "node:module";
const pg = createRequire(new URL("../../../lib/erp-db/package.json", import.meta.url))("pg");

const BASE = process.env.API_BASE || `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
// 優先使用平台 PG* 環境變數；殘留的 DATABASE_URL 可能指向舊端點或 fork。
function resolveDatabaseUrl() {
  const { PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT } = process.env;
  if (PGHOST && PGUSER && PGPASSWORD && PGDATABASE) {
    const u = new URL(`postgresql://${PGHOST}:${PGPORT || "5432"}/${PGDATABASE}`);
    u.username = PGUSER;
    u.password = PGPASSWORD;
    u.searchParams.set("sslmode", "require");
    return u.toString();
  }
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error("PG* env vars or DATABASE_URL required");
}
const db = new pg.Pool({ connectionString: resolveDatabaseUrl() });

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`PASS ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
}

const cookieJar = { cookie: "" };
async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", cookie: cookieJar.cookie, ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookieJar.cookie = setCookie.split(";")[0];
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const login = await api(`/admin/login`, { method: "POST", body: JSON.stringify({ companyCode: process.env.TEST_COMPANY_CODE, username: process.env.TEST_ADMIN_USER, password: process.env.TEST_ADMIN_PW }) });
if (login.status !== 200) { console.log("Login failed", login.status, JSON.stringify(login.json)); process.exit(1); }

// --- setup: 建立臨時租戶 ---
const { rows: [{ id: tid }] } = await db.query(
  `INSERT INTO tenants (name, status, ai_credits) VALUES ('平台測試租戶-task93', 'trialing', 10) RETURNING id`);

try {
  // ===== 點數調整 =====
  {
    const r = await api(`/platform/tenants/${tid}/credits`, { method: "POST", body: JSON.stringify({ delta: 50, reason: "測試贈點" }) });
    check("贈點成功且回傳新餘額", r.status === 200 && r.json?.aiCredits === 60, `${r.status} ${JSON.stringify(r.json)}`);
    const tx = await db.query(`SELECT delta, balance_after, reason FROM credit_transactions WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, [tid]);
    check("credit_transactions 有人工調整紀錄", tx.rows[0]?.delta === 50 && tx.rows[0]?.balance_after === 60 && tx.rows[0]?.reason.includes("人工調整"), JSON.stringify(tx.rows[0]));
    const bad = await api(`/platform/tenants/${tid}/credits`, { method: "POST", body: JSON.stringify({ delta: -999, reason: "扣太多" }) });
    check("扣至負數被擋 400", bad.status === 400, `${bad.status}`);
    const noReason = await api(`/platform/tenants/${tid}/credits`, { method: "POST", body: JSON.stringify({ delta: 5 }) });
    check("缺原因被擋 400", noReason.status === 400, `${noReason.status}`);
  }

  // ===== 試用期限 / 免收費 =====
  {
    const r = await api(`/platform/tenants/${tid}`, { method: "PATCH", body: JSON.stringify({ trialEndsAt: "2027-01-31T23:59:59.000Z", isExempt: true }) });
    check("PATCH 試用期限與免收費成功", r.status === 200 && r.json?.isExempt === true && r.json?.trialEndsAt?.startsWith("2027-01-31"), `${r.status} ${JSON.stringify(r.json)}`);
    const row = (await db.query(`SELECT is_exempt, trial_ends_at FROM tenants WHERE id=$1`, [tid])).rows[0];
    check("DB 已更新", row.is_exempt === true && row.trial_ends_at != null, JSON.stringify(row));
  }

  // ===== 稽核紀錄 =====
  {
    const audits = await db.query(`SELECT count(*)::int AS n FROM audit_logs WHERE module='Platform' AND document_id=$1`, [tid]);
    check("每次成功變更都有 Platform 稽核紀錄（2 筆）", audits.rows[0].n === 2, `n=${audits.rows[0].n}`);
  }

  // ===== 稽核寫入失敗 → 整筆 rollback =====
  {
    await db.query(`CREATE OR REPLACE FUNCTION t93_block_platform_audit() RETURNS trigger AS $$
      BEGIN IF NEW.module = 'Platform' THEN RAISE EXCEPTION 'audit blocked (test)'; END IF; RETURN NEW; END;
      $$ LANGUAGE plpgsql`);
    await db.query(`CREATE TRIGGER t93_block_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION t93_block_platform_audit()`);
    try {
      const before = (await db.query(`SELECT ai_credits FROM tenants WHERE id=$1`, [tid])).rows[0].ai_credits;
      const txBefore = (await db.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE tenant_id=$1`, [tid])).rows[0].n;
      const r = await api(`/platform/tenants/${tid}/credits`, { method: "POST", body: JSON.stringify({ delta: 5, reason: "應被 rollback" }) });
      check("稽核失敗時點數調整回 500", r.status === 500, `${r.status} ${JSON.stringify(r.json)}`);
      const after = (await db.query(`SELECT ai_credits FROM tenants WHERE id=$1`, [tid])).rows[0].ai_credits;
      const txAfter = (await db.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE tenant_id=$1`, [tid])).rows[0].n;
      check("餘額未變（rollback）", after === before, `${before} -> ${after}`);
      check("credit_transactions 未新增（rollback）", txAfter === txBefore, `${txBefore} -> ${txAfter}`);
      const p = await api(`/platform/tenants/${tid}`, { method: "PATCH", body: JSON.stringify({ isExempt: false }) });
      check("稽核失敗時 PATCH 回 500", p.status === 500, `${p.status}`);
      const still = (await db.query(`SELECT is_exempt FROM tenants WHERE id=$1`, [tid])).rows[0];
      check("isExempt 未變（rollback）", still.is_exempt === true, JSON.stringify(still));
    } finally {
      await db.query(`DROP TRIGGER IF EXISTS t93_block_audit ON audit_logs`);
      await db.query(`DROP FUNCTION IF EXISTS t93_block_platform_audit()`);
    }
  }
} finally {
  await db.query(`DELETE FROM credit_transactions WHERE tenant_id=$1`, [tid]);
  await db.query(`DELETE FROM audit_logs WHERE module='Platform' AND document_id=$1`, [tid]);
  await db.query(`DELETE FROM tenants WHERE id=$1`, [tid]);
  await db.end();
}

console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
process.exit(failures ? 1 : 0);
