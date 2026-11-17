import { Router, type IRouter, type Request } from "express";
import { pool } from "@workspace/erp-db";
import { requireRole, sessionOnly } from "../middleware/require-auth";
import { platformOperatorOnly, invalidateTenantCache } from "../middleware/saas-guard";
import { invalidateModuleCache, FOUNDATION_PATHS } from "../middleware/module-guard";
import { companyCode } from "../lib/company-identity";
import { pgErrorCode } from "../lib/pg-error";

/**
 * 平台操作稽核：寫入 tenant 1（平台方）的 audit_logs，documentId 為目標租戶。
 * 必須在與資料變更相同的 transaction 內呼叫（傳入該交易的 client）；
 * 寫入失敗會拋出例外，讓整筆變更 rollback —— 沒有稽核就沒有變更。
 */
async function writePlatformAudit(
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  req: Request, action: string, targetTenantId: number, description: string,
  oldValues?: unknown, newValues?: unknown,
): Promise<void> {
  const u = (req as any).session?.user;
  await client.query(
    `INSERT INTO audit_logs (tenant_id, action, module, document_type, document_id, user_id, user_name, old_values, new_values, description)
     VALUES (1, $1, 'Platform', 'tenant', $2, $3, $4, $5, $6, $7)`,
    [action, targetTenantId, u?.id ? String(u.id) : null, u?.displayName || u?.username || "platform",
     oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, description],
  );
}

/**
 * 平台管理後台（僅平台方 tenant 1 的 super_admin 可用）：
 * 檢視所有註冊公司、訂閱狀態、AI 點數，並可調整各公司開放的模組（選單權限）。
 * 這裡刻意使用 owner pool 跨租戶讀寫 tenants / menu_permissions（RLS 例外的平台功能）。
 */
const router: IRouter = Router();
router.use("/platform", sessionOnly, requireRole("super_admin"), platformOperatorOnly);

router.get("/platform/tenants", async (_req, res): Promise<void> => {
  try {
    const { rows } = await pool.query(`
      SELECT t.id, t.name, t.company_code AS "companyCode", t.status, t.is_exempt AS "isExempt", t.trial_ends_at AS "trialEndsAt",
             t.ai_credits AS "aiCredits", t.contact_email AS "contactEmail", t.created_at AS "createdAt",
             t.stripe_subscription_id IS NOT NULL AS "hasSubscription",
             (SELECT count(*)::int FROM admin_users u WHERE u.tenant_id = t.id) AS "userCount"
      FROM tenants t ORDER BY t.id`);
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** 人工調整 AI 點數（贈點/補償/扣點），寫入 credit_transactions 保留稽核軌跡 */
router.post("/platform/tenants/:id/credits", async (req, res): Promise<void> => {
  const tenantId = parseInt(req.params.id, 10);
  if (!Number.isInteger(tenantId)) { res.status(400).json({ error: "無效的租戶 ID" }); return; }
  const delta = Number(req.body?.delta);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!Number.isInteger(delta) || delta === 0) { res.status(400).json({ error: "delta 必須為非零整數" }); return; }
  if (!reason) { res.status(400).json({ error: "請填寫調整原因" }); return; }
  const u = (req as any).session?.user;
  const operator = u?.displayName || u?.username || "platform";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(`SELECT ai_credits FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
    if (cur.rowCount === 0) { await client.query("ROLLBACK"); res.status(404).json({ error: "租戶不存在" }); return; }
    const newBalance = cur.rows[0].ai_credits + delta;
    if (newBalance < 0) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: `扣點後餘額不可為負（目前 ${cur.rows[0].ai_credits} 點）` });
      return;
    }
    await client.query(`UPDATE tenants SET ai_credits = $2 WHERE id = $1`, [tenantId, newBalance]);
    await client.query(
      `INSERT INTO credit_transactions (tenant_id, delta, balance_after, reason)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, delta, newBalance, `人工調整：${reason}（操作者：${operator}）`],
    );
    await writePlatformAudit(client, req, "update", tenantId,
      `人工調整租戶 #${tenantId} AI 點數 ${delta > 0 ? "+" : ""}${delta}：${reason}`,
      { aiCredits: cur.rows[0].ai_credits }, { aiCredits: newBalance });
    await client.query("COMMIT");
    invalidateTenantCache(tenantId);
    res.json({ ok: true, aiCredits: newBalance });
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/** 查詢租戶 AI 點數異動歷史（購買 + 人工調整），最新在前，簡單分頁 */
router.get("/platform/tenants/:id/credit-transactions", async (req, res): Promise<void> => {
  const tenantId = parseInt(req.params.id, 10);
  if (!Number.isInteger(tenantId)) { res.status(400).json({ error: "無效的租戶 ID" }); return; }
  const limitRaw = parseInt(String(req.query.limit ?? ""), 10);
  const offsetRaw = parseInt(String(req.query.offset ?? ""), 10);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
  const offset = Number.isInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
  try {
    const exists = await pool.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenantId]);
    if (exists.rowCount === 0) { res.status(404).json({ error: "租戶不存在" }); return; }
    const { rows } = await pool.query(
      `SELECT id, delta, balance_after AS "balanceAfter", reason, stripe_ref AS "stripeRef",
              created_at AS "createdAt"
       FROM credit_transactions
       WHERE tenant_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, limit + 1, offset],
    );
    const hasMore = rows.length > limit;
    res.json({ transactions: rows.slice(0, limit), hasMore });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** 修改試用期限 / 免收費標記 */
router.patch("/platform/tenants/:id", async (req, res): Promise<void> => {
  const tenantId = parseInt(req.params.id, 10);
  if (!Number.isInteger(tenantId)) { res.status(400).json({ error: "無效的租戶 ID" }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: string[] = [];
  const values: unknown[] = [tenantId];
  const changed: Record<string, unknown> = {};
  if ("trialEndsAt" in body) {
    if (body.trialEndsAt !== null && (typeof body.trialEndsAt !== "string" || isNaN(Date.parse(body.trialEndsAt)))) {
      res.status(400).json({ error: "trialEndsAt 必須為日期字串或 null" });
      return;
    }
    values.push(body.trialEndsAt);
    updates.push(`trial_ends_at = $${values.length}`);
    changed.trialEndsAt = body.trialEndsAt;
  }
  if ("isExempt" in body) {
    if (typeof body.isExempt !== "boolean") { res.status(400).json({ error: "isExempt 必須為布林值" }); return; }
    values.push(body.isExempt);
    updates.push(`is_exempt = $${values.length}`);
    changed.isExempt = body.isExempt;
  }
  if ("companyCode" in body) {
    const code = companyCode(body.companyCode);
    if (!code) { res.status(400).json({ error: "公司編碼需為 8 位數字統編" }); return; }
    values.push(code);
    updates.push(`company_code = $${values.length}`);
    changed.companyCode = code;
  }
  if (updates.length === 0) { res.status(400).json({ error: "沒有可更新的欄位" }); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const old = await client.query(
      `SELECT company_code AS "companyCode", trial_ends_at AS "trialEndsAt", is_exempt AS "isExempt" FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
    if (old.rowCount === 0) { await client.query("ROLLBACK"); res.status(404).json({ error: "租戶不存在" }); return; }
    const identityChanged = "companyCode" in changed && changed.companyCode !== old.rows[0].companyCode;
    if (identityChanged) {
      // Same lock as login/recovery, held through session invalidation.
      await client.query("SELECT id FROM admin_users WHERE tenant_id=$1 ORDER BY id FOR UPDATE", [tenantId]);
    }
    const upd = await client.query(
      `UPDATE tenants SET ${updates.join(", ")} WHERE id = $1
       RETURNING company_code AS "companyCode", trial_ends_at AS "trialEndsAt", is_exempt AS "isExempt", status`,
      values,
    );
    await writePlatformAudit(client, req, "update", tenantId,
      `更新租戶 #${tenantId} 設定：${Object.keys(changed).join("、")}`,
      old.rows[0], changed);
    if (identityChanged) {
      await client.query("DELETE FROM user_sessions WHERE sess->'user'->>'tenantId'=$1", [String(tenantId)]);
    }
    await client.query("COMMIT");
    invalidateTenantCache(tenantId);
    res.json({ ok: true, ...upd.rows[0] });
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (pgErrorCode(e) === "23505") { res.status(409).json({ error: "公司編碼已被使用" }); return; }
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.get("/platform/tenants/:id/modules", async (req, res): Promise<void> => {
  const tenantId = parseInt(req.params.id, 10);
  if (!Number.isInteger(tenantId)) { res.status(400).json({ error: "無效的租戶 ID" }); return; }
  try {
    const { rows } = await pool.query(
      `SELECT path, roles FROM menu_permissions WHERE tenant_id = $1 AND path NOT LIKE '@role/%'`, [tenantId]);
    const map: Record<string, string[]> = {};
    for (const r of rows) map[r.path] = r.roles || [];
    res.json(map);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** 全量覆寫該租戶的選單權限（path→roles[]；roles 含 "__disabled__" 表示對所有人隱藏） */
router.put("/platform/tenants/:id/modules", async (req, res): Promise<void> => {
  const tenantId = parseInt(req.params.id, 10);
  if (!Number.isInteger(tenantId)) { res.status(400).json({ error: "無效的租戶 ID" }); return; }
  const body = req.body as { overrides?: Record<string, string[]> };
  if (!body || typeof body.overrides !== "object" || body.overrides === null) {
    res.status(400).json({ error: "overrides 必須為 path→roles[] 物件" });
    return;
  }
  const entries = Object.entries(body.overrides).filter(
    ([p, r]) => p && typeof p === "string" && Array.isArray(r),
  );
  const client = await pool.connect();
  try {
    const exists = await client.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenantId]);
    if (exists.rowCount === 0) { res.status(404).json({ error: "租戶不存在" }); return; }
    await client.query("BEGIN");
    // 自訂角色（@role/…）也存在這張表，平台調整模組時不能刪掉
    await client.query(`DELETE FROM menu_permissions WHERE tenant_id = $1 AND path NOT LIKE '@role/%'`, [tenantId]);
    for (const [path, roles] of entries) {
      await client.query(
        `INSERT INTO menu_permissions (tenant_id, path, roles, updated_at) VALUES ($1, $2, $3, now())`,
        // 基礎功能頁不可停用：即使前端送來哨兵也剝除
        [tenantId, path, roles.filter((r) => typeof r === "string" && !(r === "__disabled__" && FOUNDATION_PATHS.includes(path)))],
      );
    }
    await client.query("COMMIT");
    invalidateModuleCache(tenantId);
    res.json({ ok: true, count: entries.length });
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

export default router;
