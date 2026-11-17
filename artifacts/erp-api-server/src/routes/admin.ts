import { Router, type IRouter } from "express";
import { pgErrorCode } from "../lib/pg-error";
import { eq, and, sql } from "drizzle-orm";
import { db, pool, sessionPool, adminUsersTable, employeesTable, runtimeDatabaseProvider } from "@workspace/erp-db";
import { verifyPassword, hashPassword } from "../lib/auth";
import { requireAuth, requireRole, sessionOnly } from "../middleware/require-auth";
import { loginRateLimit, sensitiveRateLimit } from "../middleware/rate-limit";
import { reqTenantId } from "../middleware/tenant-context";
import accountRecoveryRouter from "./account-recovery";
import { createLockedAuth } from "../lib/locked-auth";
import { companyCode, accountName } from "../lib/company-identity";
import { loadCustomRoles } from "../lib/custom-roles";
import { authConnectionTimeoutMs } from "../lib/auth-diagnostics";

const router: IRouter = Router();
const lockedAuth = createLockedAuth({
  pool, hashPassword, verifyPassword,
  connectionTimeoutMs: authConnectionTimeoutMs(runtimeDatabaseProvider()),
});
router.use(accountRecoveryRouter);
router.use("/admin", sessionOnly);

router.post("/admin/login", loginRateLimit, async (req, res): Promise<void> => {
  const { username, password } = req.body ?? {};
  const code = companyCode(req.body?.companyCode);
  if (!code || !accountName(username) || typeof password !== "string" || !password) { res.status(401).json({ error: "公司編碼、帳號或密碼錯誤" }); return; }
  try {
    const user = await lockedAuth.login(code, username, password, async (user) => {
      await new Promise<void>((resolve, reject) => req.session.regenerate((err) => err ? reject(err) : resolve()));
      req.session.user = { id: user.id, username: user.username, displayName: user.display_name, role: user.role, employeeId: user.employee_id, tenantId: user.tenant_id, companyCode: user.company_code };
      await new Promise<void>((resolve, reject) => req.session.save((err) => err ? reject(err) : resolve()));
    }, async () => {
      const sid = req.sessionID;
      if (req.session) await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
      // Explicit fallback for partial/failed store saves, on a fresh connection.
      await sessionPool.query("DELETE FROM user_sessions WHERE sid=$1", [sid]);
    }, (failure) => {
      req.log.error({ event: "auth_login_failure", requestId: req.id, ...failure }, "Login could not complete");
    });
    if (!user) { res.status(401).json({ error: "公司編碼、帳號或密碼錯誤" }); return; }
    res.json({ id: user.id, username: user.username, displayName: user.display_name, role: user.role, employeeId: user.employee_id, tenantId: user.tenant_id, companyCode: user.company_code });
  } catch {
    res.clearCookie("erp.sid");
    res.status(503).json({ error: "登入暫時無法完成，請稍後再試" });
  }
});

router.post("/admin/logout", (req, res): void => {
  req.session.destroy((err) => {
    if (err) {
      (req as any).log?.error({ err }, "session destroy failed");
      res.status(500).json({ error: "登出失敗" });
      return;
    }
    res.clearCookie("erp.sid");
    res.json({ ok: true });
  });
});

/** 「我的頁面」常用功能：只收站內選單路徑，去重、最多 40 個 */
export function cleanShortcuts(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p !== "string" || !/^\/[a-z0-9/_-]{1,120}$/i.test(p) || p.startsWith("//") || out.includes(p)) continue;
    out.push(p);
    if (out.length >= 40) break;
  }
  return out;
}

router.get("/admin/me/shortcuts", requireAuth, async (req, res): Promise<void> => {
  const user = req.session!.user!;
  const [row] = await db.select({ homeShortcuts: adminUsersTable.homeShortcuts }).from(adminUsersTable)
    .where(and(eq(adminUsersTable.id, user.id), eq(adminUsersTable.tenantId, reqTenantId(req))));
  res.json({ paths: Array.isArray(row?.homeShortcuts) ? row!.homeShortcuts : [] });
});

router.put("/admin/me/shortcuts", requireAuth, async (req, res): Promise<void> => {
  const user = req.session!.user!;
  const paths = cleanShortcuts(req.body?.paths);
  if (!paths) { res.status(400).json({ error: "格式不對，要傳 paths 陣列" }); return; }
  await db.update(adminUsersTable).set({ homeShortcuts: paths })
    .where(and(eq(adminUsersTable.id, user.id), eq(adminUsersTable.tenantId, reqTenantId(req))));
  res.json({ paths });
});

router.get("/admin/me", async (req, res): Promise<void> => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: "未登入" }); return; }
  let customRole: { id: string; name: string; permissions: Record<string, string[]> } | null = null;
  try {
    const tenantId = (req as any).tenantId ?? user.tenantId;
    const role = tenantId ? (await loadCustomRoles(tenantId)).find((r) => r.userIds.includes(user.id)) : null;
    if (role) customRole = { id: role.id, name: role.name, permissions: role.permissions };
  } catch (err) {
    (req as any).log?.error({ err }, "custom role lookup failed");
  }
  res.json({ ...user, customRole });
});

router.get("/admin/users", requireRole("owner", "admin"), async (_req, res): Promise<void> => {
  const users = await db
    .select({
      id: adminUsersTable.id,
      username: adminUsersTable.username,
      displayName: adminUsersTable.displayName,
      role: adminUsersTable.role,
      isActive: adminUsersTable.isActive,
      employeeId: adminUsersTable.employeeId,
      employeeCode: employeesTable.employeeId,
      employeeName: sql<string | null>`CASE WHEN ${employeesTable.id} IS NULL THEN NULL ELSE ${employeesTable.firstName} || ${employeesTable.lastName} END`,
      createdAt: adminUsersTable.createdAt,
    })
    .from(adminUsersTable)
    .leftJoin(employeesTable, eq(adminUsersTable.employeeId, employeesTable.id))
    .where(eq(adminUsersTable.tenantId, reqTenantId(_req)))
    .orderBy(adminUsersTable.username);
  const customRoles = await loadCustomRoles(reqTenantId(_req), db, true).catch(() => []);
  res.json(users.map((u) => {
    const custom = customRoles.find((r) => r.userIds.includes(u.id));
    return { ...u, customRoleId: custom?.id ?? null, customRoleName: custom?.name ?? null };
  }));
});

/** super_admin 為平台維運角色：僅平台方（tenant 1 的 super_admin）可指派，租戶不得自行升級 */
/** 系統內建的角色；角色欄只接受這些值 */
const ASSIGNABLE_ROLES = ["owner", "admin", "manager", "hr_admin", "finance_admin", "accountant", "viewer", "employee"];

function canAssignRole(req: any, role: unknown): boolean {
  if (role === undefined || role === null || role === "") return true; // 沒指定就用預設角色
  const actorRole = req.session?.user?.role;
  if (role === "super_admin") return actorRole === "super_admin" && reqTenantId(req) === 1;
  if (typeof role !== "string" || !ASSIGNABLE_ROLES.includes(role)) return false;
  // 擁有者只能由擁有者（或平台方）指派，管理員不能把人升成擁有者
  if (role === "owner") return actorRole === "owner" || actorRole === "super_admin";
  return true;
}

const MIN_PASSWORD_LENGTH = 6;

/**
 * 能不能動這個帳號：
 * - 老闆（owner）的帳號只有老闆自己或平台管理員能改、能刪，一般管理員不行
 *   （否則管理員重設老闆密碼就能接管整間公司）
 * - 不能把自己停用、降級或刪除，避免把自己鎖在外面
 * - 公司至少要留一個啟用中的老闆帳號
 */
async function accountChangeProblem(req: any, targetId: number, change: { role?: unknown; isActive?: unknown; remove?: boolean }): Promise<{ status: number; error: string } | null> {
  const me = req.session?.user;
  const [target] = await db.select().from(adminUsersTable).where(and(eq(adminUsersTable.id, targetId), eq(adminUsersTable.tenantId, reqTenantId(req))));
  if (!target) return { status: 404, error: "找不到這個帳號" };
  const actorIsOwner = me?.role === "owner" || me?.role === "super_admin";
  if (target.role === "owner" && !actorIsOwner) return { status: 403, error: "只有老闆可以修改老闆帳號" };
  const demoting = change.role !== undefined && change.role !== target.role;
  const disabling = change.isActive === false || change.isActive === "false";
  if (me?.id === targetId && (change.remove || disabling || demoting)) {
    return { status: 400, error: "不能停用、刪除自己的帳號，也不能改自己的角色" };
  }
  if (target.role === "owner" && target.isActive && (change.remove || disabling || demoting)) {
    const owners = await db.select({ id: adminUsersTable.id }).from(adminUsersTable).where(and(
      eq(adminUsersTable.tenantId, reqTenantId(req)), eq(adminUsersTable.role, "owner"), eq(adminUsersTable.isActive, true),
    ));
    if (owners.length <= 1) return { status: 400, error: "公司至少要保留一個啟用中的老闆帳號" };
  }
  return null;
}

router.post("/admin/users", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const { username, password, displayName, role, employeeId } = req.body;
  if (!accountName(username) || !password || !displayName) {
    res.status(400).json({ error: "帳號、密碼和顯示名稱為必填" });
    return;
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `密碼至少 ${MIN_PASSWORD_LENGTH} 個字元` });
    return;
  }
  if (!canAssignRole(req, role)) {
    res.status(403).json({ error: "無權指派此角色" });
    return;
  }
  try {
    const [user] = await db.insert(adminUsersTable).values({
      username: accountName(username)!,
      tenantId: reqTenantId(req),
      passwordHash: await hashPassword(password),
      displayName,
      role: role || "viewer",
      employeeId: employeeId ? Number(employeeId) : null,
    }).returning();
    res.status(201).json({
      id: user.id, username: user.username, displayName: user.displayName, role: user.role, isActive: user.isActive, employeeId: user.employeeId,
    });
  } catch (e: unknown) {
    {
      const code = pgErrorCode(e);
      if (code === "23505") {
        res.status(409).json({ error: "帳號或員工綁定已存在" });
        return;
      }
    }
    throw e;
  }
});

router.patch("/admin/users/:id", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Record<string, unknown> = {};
  if (req.body.displayName !== undefined) updates.displayName = req.body.displayName;
  if (req.body.role !== undefined) {
    if (!canAssignRole(req, req.body.role)) { res.status(403).json({ error: "無權指派此角色" }); return; }
    updates.role = req.body.role;
  }
  if (req.body.isActive !== undefined) updates.isActive = req.body.isActive === true || req.body.isActive === "true";
  if (req.body.employeeId !== undefined) updates.employeeId = req.body.employeeId === null || req.body.employeeId === "" ? null : Number(req.body.employeeId);
  if (req.body.password) {
    if (typeof req.body.password !== "string" || req.body.password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: `密碼至少 ${MIN_PASSWORD_LENGTH} 個字元` }); return;
    }
    updates.passwordHash = await hashPassword(req.body.password);
  }
  const problem = await accountChangeProblem(req, id, { role: req.body.role, isActive: req.body.isActive });
  if (problem) { res.status(problem.status).json({ error: problem.error }); return; }
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "沒有要更新的內容" }); return; }
  try {
    const [user] = await db.update(adminUsersTable).set(updates).where(and(eq(adminUsersTable.id, id), eq(adminUsersTable.tenantId, reqTenantId(req)))).returning();
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ id: user.id, username: user.username, displayName: user.displayName, role: user.role, isActive: user.isActive, employeeId: user.employeeId });
  } catch (e: unknown) {
    if (pgErrorCode(e) === "23505") {
      res.status(409).json({ error: "此員工已綁定其他帳號" });
      return;
    }
    throw e;
  }
});

router.delete("/admin/users/:id", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const problem = await accountChangeProblem(req, id, { remove: true });
  if (problem) { res.status(problem.status).json({ error: problem.error }); return; }
  const [user] = await db.delete(adminUsersTable).where(and(eq(adminUsersTable.id, id), eq(adminUsersTable.tenantId, reqTenantId(req)))).returning();
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

// 變更自己密碼（任何登入用戶皆可）
router.post("/admin/me/change-password", requireAuth, sensitiveRateLimit, async (req, res): Promise<void> => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) { res.status(400).json({ error: "舊密碼與新密碼為必填" }); return; }
  if (String(newPassword).length < 6) { res.status(400).json({ error: "新密碼至少 6 字元" }); return; }
  if (typeof oldPassword !== "string" || typeof newPassword !== "string") { res.status(400).json({ error: "密碼格式錯誤" }); return; }
  try {
    const user = req.session!.user!;
    if (!await lockedAuth.changePassword(user.id, reqTenantId(req), oldPassword, newPassword)) {
      res.status(401).json({ error: "舊密碼錯誤" }); return;
    }
    res.json({ ok: true });
  } catch { res.status(503).json({ error: "服務暫時無法使用，請稍後再試。" }); }
});

export default router;
