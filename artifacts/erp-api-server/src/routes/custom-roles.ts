import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, adminUsersTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { reqTenantId } from "../middleware/tenant-context";
import {
  ALL_MENU_PATHS, BASE_ROLES, PERMISSION_ACTIONS, loadCustomRoles, saveCustomRole, deleteCustomRole, newRoleId,
  loadBuiltinOverrides, saveBuiltinOverride, resetBuiltinOverride,
  type CustomRole, type PermissionAction,
} from "../lib/custom-roles";
import {
  EDITABLE_BUILTIN_ROLES, ROLE_DESCRIPTION, ROLE_LABEL, cleanPermissions, defaultRolePermissions, isEditableBuiltinRole, INVOICE_ACTION_PATHS,
} from "../lib/role-defaults";

const router: IRouter = Router();
router.use("/roles", requireAuth);

// 角色決定每個人能做什麼，只有老闆與系統管理員能改
const canManageRoles = requireRole("owner", "admin");
/** 這些帳號擁有全部權限或另有專屬規則，不能套用受限的自訂角色 */
const UNASSIGNABLE_USER_ROLES = ["owner", "admin", "super_admin", "employee"];
const MAX_ROLES = 50;

/** 整理並檢查送進來的角色內容；有問題回傳 error */
function readRoleInput(body: any): { data?: Omit<CustomRole, "id">; error?: string } {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "請填寫角色名稱" };
  if (name.length > 30) return { error: "角色名稱最多 30 個字" };
  const baseRole = body?.baseRole;
  if (!(BASE_ROLES as readonly string[]).includes(baseRole)) return { error: "請選擇基礎角色" };
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 200) : "";

  const permissions: Record<string, PermissionAction[]> = {};
  const raw = body?.permissions && typeof body.permissions === "object" ? body.permissions : {};
  const entries = Object.entries(raw);
  if (entries.length > 400) return { error: "權限項目過多" };
  for (const [path, actions] of entries) {
    if (typeof path !== "string" || !path.startsWith("/") || path.length > 120 || !Array.isArray(actions)) continue;
    if ((Object.values(INVOICE_ACTION_PATHS) as string[]).includes(path)) {
      permissions[path] = actions.includes("view") ? ["view"] : [];
      continue;
    }
    const clean = PERMISSION_ACTIONS.filter((a) => actions.includes(a));
    // 沒有檢視權限就不可能做其他動作，一律補上
    if (clean.length > 0 && !clean.includes("view")) clean.unshift("view");
    if (clean.length > 0) permissions[path] = clean;
  }

  const userIds = Array.isArray(body?.userIds)
    ? [...new Set<number>(body.userIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))]
    : [];
  return { data: { name, description, baseRole, permissions, userIds } };
}

/** 確認要套用的帳號都是本公司的、而且可以套用；回傳錯誤訊息或 null */
async function assignableError(tenantId: number, userIds: number[]): Promise<string | null> {
  if (userIds.length === 0) return null;
  const users = await db.select({ id: adminUsersTable.id, role: adminUsersTable.role, displayName: adminUsersTable.displayName })
    .from(adminUsersTable)
    .where(and(eq(adminUsersTable.tenantId, tenantId), inArray(adminUsersTable.id, userIds)));
  if (users.length !== userIds.length) return "有帳號不存在或不屬於本公司";
  const blocked = users.find((u) => UNASSIGNABLE_USER_ROLES.includes(u.role));
  if (blocked) return `「${blocked.displayName}」是老闆、系統管理員或員工自助帳號，不能套用自訂角色`;
  return null;
}

/** 存檔並同步帳號：一個帳號只能有一個自訂角色，帳號的內建角色跟著基礎角色走 */
async function persistRole(tenantId: number, role: CustomRole): Promise<void> {
  await db.transaction(async (tx) => {
    const others = (await loadCustomRoles(tenantId, tx, true)).filter((r) => r.id !== role.id);
    for (const other of others) {
      const remaining = other.userIds.filter((id) => !role.userIds.includes(id));
      if (remaining.length !== other.userIds.length) await saveCustomRole(tenantId, { ...other, userIds: remaining }, tx);
    }
    await saveCustomRole(tenantId, role, tx);
    if (role.userIds.length > 0) {
      await tx.update(adminUsersTable).set({ role: role.baseRole })
        .where(and(eq(adminUsersTable.tenantId, tenantId), inArray(adminUsersTable.id, role.userIds)));
    }
  });
}

// ───────── 內建角色（財務長、會計、主管、業務、倉管、人資、一般職員）的勾選表 ─────────
async function builtinRoleList(tenantId: number) {
  const overrides = await loadBuiltinOverrides(tenantId, db, true);
  const users = await db.select({ role: adminUsersTable.role }).from(adminUsersTable).where(eq(adminUsersTable.tenantId, tenantId));
  return EDITABLE_BUILTIN_ROLES.map((role) => ({
    role, name: ROLE_LABEL[role] || role, description: ROLE_DESCRIPTION[role] || "",
    customized: Boolean(overrides[role]),
    userCount: users.filter((u) => u.role === role).length,
    permissions: overrides[role] ?? defaultRolePermissions(role, ALL_MENU_PATHS),
  }));
}

router.get("/roles/builtin", canManageRoles, async (req, res): Promise<void> => {
  res.json({ roles: await builtinRoleList(reqTenantId(req)), menuPaths: ALL_MENU_PATHS });
});

router.put("/roles/builtin/:role", canManageRoles, async (req, res): Promise<void> => {
  const role = String(req.params.role);
  if (!isEditableBuiltinRole(role)) { res.status(400).json({ error: "這個角色不能修改（老闆、系統管理員是全部權限，員工自助另有規則）" }); return; }
  const permissions = cleanPermissions(req.body?.permissions, ALL_MENU_PATHS);
  const actor = (req as any).session?.user?.displayName || (req as any).session?.user?.username || "";
  await saveBuiltinOverride(reqTenantId(req), role, permissions, String(actor));
  res.json((await builtinRoleList(reqTenantId(req))).find((r) => r.role === role));
});

router.delete("/roles/builtin/:role", canManageRoles, async (req, res): Promise<void> => {
  const role = String(req.params.role);
  if (!isEditableBuiltinRole(role)) { res.status(400).json({ error: "這個角色不能修改" }); return; }
  await resetBuiltinOverride(reqTenantId(req), role);
  res.json((await builtinRoleList(reqTenantId(req))).find((r) => r.role === role));
});

router.get("/roles", canManageRoles, async (req, res): Promise<void> => {
  res.json({ baseRoles: BASE_ROLES, actions: PERMISSION_ACTIONS, roles: await loadCustomRoles(reqTenantId(req), db, true) });
});

router.post("/roles", canManageRoles, async (req, res): Promise<void> => {
  const tenantId = reqTenantId(req);
  const { data, error } = readRoleInput(req.body);
  if (!data) { res.status(400).json({ error }); return; }
  const existing = await loadCustomRoles(tenantId, db, true);
  if (existing.length >= MAX_ROLES) { res.status(400).json({ error: `自訂角色最多 ${MAX_ROLES} 個` }); return; }
  if (existing.some((r) => r.name === data.name)) { res.status(409).json({ error: `已經有「${data.name}」這個角色` }); return; }
  const assignErr = await assignableError(tenantId, data.userIds);
  if (assignErr) { res.status(400).json({ error: assignErr }); return; }
  const role: CustomRole = { id: newRoleId(), ...data };
  await persistRole(tenantId, role);
  res.status(201).json(role);
});

router.patch("/roles/:id", canManageRoles, async (req, res): Promise<void> => {
  const tenantId = reqTenantId(req);
  const id = String(req.params.id);
  const existing = await loadCustomRoles(tenantId, db, true);
  if (!existing.some((r) => r.id === id)) { res.status(404).json({ error: "找不到這個角色" }); return; }
  const { data, error } = readRoleInput(req.body);
  if (!data) { res.status(400).json({ error }); return; }
  if (existing.some((r) => r.id !== id && r.name === data.name)) { res.status(409).json({ error: `已經有「${data.name}」這個角色` }); return; }
  const assignErr = await assignableError(tenantId, data.userIds);
  if (assignErr) { res.status(400).json({ error: assignErr }); return; }
  const role: CustomRole = { id, ...data };
  await persistRole(tenantId, role);
  res.json(role);
});

router.delete("/roles/:id", canManageRoles, async (req, res): Promise<void> => {
  const tenantId = reqTenantId(req);
  const id = String(req.params.id);
  const role = (await loadCustomRoles(tenantId, db, true)).find((r) => r.id === id);
  if (!role) { res.status(404).json({ error: "找不到這個角色" }); return; }
  // 還有人在用就不刪，避免那些帳號突然回到基礎角色的完整權限
  if (role.userIds.length > 0) {
    res.status(409).json({ error: `還有 ${role.userIds.length} 個帳號套用這個角色，請先改掉他們的角色再刪除` }); return;
  }
  await deleteCustomRole(tenantId, id);
  res.status(204).send();
});

export default router;
