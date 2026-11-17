import { Router, type IRouter } from "express";
import { db } from "@workspace/erp-db";
import { menuPermissionsTable } from "@workspace/erp-db/schema";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { notLike } from "drizzle-orm";
import { ROLE_ROW_PREFIX, isRoleRow } from "../lib/custom-roles";

const router: IRouter = Router();

const SYSTEM_ADMIN_ROLES = ["owner", "admin"];

// 任何登入者都可讀（前端 sidebar 需要）
router.get("/menu-permissions", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db.select().from(menuPermissionsTable);
  const map: Record<string, string[]> = {};
  for (const r of rows) if (!isRoleRow(r.path)) map[r.path] = r.roles || [];
  res.json(map);
});

// 僅 SYSTEM_ADMIN_ROLES 可寫
router.put("/menu-permissions", requireAuth, requireRole(...SYSTEM_ADMIN_ROLES), async (req, res): Promise<void> => {
  const body = req.body as { overrides?: Record<string, string[]> };
  if (!body || typeof body.overrides !== "object") {
    res.status(400).json({ error: "overrides 必須為 path→roles[] 物件" });
    return;
  }
  await db.transaction(async (tx) => {
    // 平台方停用的模組（roles 含 __disabled__）不可被租戶自行還原，覆寫後強制保留
    const existing = (await tx.select().from(menuPermissionsTable)).filter((r) => !isRoleRow(r.path));
    const platformDisabled = new Set(
      existing.filter((r) => (r.roles || []).includes("__disabled__")).map((r) => r.path),
    );
    await tx.delete(menuPermissionsTable).where(notLike(menuPermissionsTable.path, `${ROLE_ROW_PREFIX}%`));
    const merged = new Map<string, string[]>();
    for (const [path, roles] of Object.entries(body.overrides!)) {
      if (!path || typeof path !== "string" || isRoleRow(path)) continue;
      merged.set(path, Array.isArray(roles) ? roles.filter((r) => typeof r === "string" && r !== "__disabled__") : []);
    }
    for (const path of platformDisabled) {
      merged.set(path, [...(merged.get(path) || []), "__disabled__"]);
    }
    if (merged.size > 0) {
      await tx.insert(menuPermissionsTable).values(
        [...merged.entries()].map(([path, roles]) => ({ path, roles })),
      );
    }
  });
  res.json({ ok: true, count: Object.keys(body.overrides).length });
});

export default router;
