import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, apiKeysTable, projectsTable, adminUsersTable } from "@workspace/erp-db";
import crypto from "crypto";
import { requireRole, sessionOnly } from "../middleware/require-auth";
import { reqTenantId } from "../middleware/tenant-context";
import { canBindKeyTo } from "../lib/api-key-user";
import { ROLE_LABEL } from "../lib/role-defaults";

function generateApiKey(): string {
  return "erpk_" + crypto.randomBytes(24).toString("hex");
}

function generateApiSecret(): string {
  return "erps_" + crypto.randomBytes(32).toString("hex");
}

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/**
 * API 金鑰：每一把都代表一個使用者，權限跟著那個人目前的角色走，金鑰沒有自己的權限（老闆 2026-11-19）。
 * 金鑰本身只設定：名稱、代表誰、所屬專案、有效期限、要不要開放給 AI 助理（MCP）連線。
 */
const router: IRouter = Router();
router.use("/api-keys", sessionOnly, requireRole("owner", "admin"));

/** 只保留「開放給 AI 助理」這個開關；舊的身分與動作設定已不再使用 */
const agentFlag = (raw: unknown) => ({ enabled: !!(raw && typeof raw === "object" && (raw as any).enabled === true) });

/** 檢查要綁定的使用者：同一家公司、啟用中，而且不能綁給比自己權限大的人 */
async function checkBindable(req: Request, res: Response, rawUserId: unknown): Promise<number | null> {
  const userId = Number(rawUserId);
  if (!Number.isSafeInteger(userId) || userId <= 0) { res.status(400).json({ error: "請選擇這把金鑰代表哪一個使用者" }); return null; }
  const [target] = await db.select({ id: adminUsersTable.id, role: adminUsersTable.role, isActive: adminUsersTable.isActive })
    .from(adminUsersTable).where(and(eq(adminUsersTable.id, userId), eq(adminUsersTable.tenantId, reqTenantId(req)))).limit(1);
  if (!target) { res.status(400).json({ error: "找不到這個使用者" }); return null; }
  if (!target.isActive) { res.status(400).json({ error: "這個使用者已停用，不能綁定金鑰" }); return null; }
  if (!canBindKeyTo(req.session?.user?.role, target.role)) {
    res.status(403).json({ error: "不能把金鑰綁給權限比自己大的人" }); return null;
  }
  return userId;
}

/** 系統管理員不能動代表老闆的金鑰（改、重新產生、刪除都不行；重新產生等於拿到老闆的權限） */
async function mayManageKey(req: Request, res: Response, id: number): Promise<boolean> {
  const [current] = await db.select({ role: adminUsersTable.role }).from(apiKeysTable)
    .leftJoin(adminUsersTable, eq(adminUsersTable.id, apiKeysTable.userId))
    .where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.tenantId, reqTenantId(req)))).limit(1);
  if (!current) { res.status(404).json({ error: "Not found" }); return false; }
  if (current.role && !canBindKeyTo(req.session?.user?.role, current.role)) {
    res.status(403).json({ error: "這把金鑰代表權限比你大的人，不能修改" }); return false;
  }
  return true;
}

router.get("/api-keys", async (req, res): Promise<void> => {
  const keys = await db
    .select({
      id: apiKeysTable.id,
      keyName: apiKeysTable.keyName,
      apiKey: apiKeysTable.apiKey,
      projectId: apiKeysTable.projectId,
      userId: apiKeysTable.userId,
      userName: adminUsersTable.displayName,
      username: adminUsersTable.username,
      userRole: adminUsersTable.role,
      userActive: adminUsersTable.isActive,
      agentConfig: apiKeysTable.agentConfig,
      isActive: apiKeysTable.isActive,
      lastUsedAt: apiKeysTable.lastUsedAt,
      expiresAt: apiKeysTable.expiresAt,
      createdAt: apiKeysTable.createdAt,
    })
    .from(apiKeysTable)
    .leftJoin(adminUsersTable, eq(adminUsersTable.id, apiKeysTable.userId))
    .where(eq(apiKeysTable.tenantId, reqTenantId(req)))
    .orderBy(apiKeysTable.createdAt);

  const projects = await db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable);
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  res.json(keys.map((k) => ({
    ...k,
    agentConfig: agentFlag(k.agentConfig),
    userRoleLabel: k.userRole ? ROLE_LABEL[k.userRole] || k.userRole : null,
    projectName: k.projectId ? projectMap[k.projectId] || "未知專案" : "全域",
    maskedKey: k.apiKey.substring(0, 10) + "..." + k.apiKey.substring(k.apiKey.length - 4),
  })));
});

router.post("/api-keys", async (req, res): Promise<void> => {
  const { keyName, projectId, expiresAt, agentConfig } = req.body ?? {};
  if (!keyName) {
    res.status(400).json({ error: "金鑰名稱為必填" });
    return;
  }
  // 沒指定就代表建立的人自己
  const userId = await checkBindable(req, res, req.body?.userId ?? req.session?.user?.id);
  if (userId === null) return;

  const apiKey = generateApiKey();
  const apiSecret = generateApiSecret();
  const secretHash = hashSecret(apiSecret);

  const [record] = await db
    .insert(apiKeysTable)
    .values({
      keyName,
      tenantId: reqTenantId(req),
      apiKey,
      secretHash,
      projectId: projectId || null,
      userId,
      agentConfig: agentFlag(agentConfig),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })
    .returning();

  res.status(201).json({
    id: record.id,
    keyName: record.keyName,
    apiKey,
    apiSecret,
    projectId: record.projectId,
    userId: record.userId,
    agentConfig: agentFlag(record.agentConfig),
    isActive: record.isActive,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    _notice: "請妥善保存 API Secret，此為唯一一次顯示。",
  });
});

router.patch("/api-keys/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updates: Record<string, unknown> = {};
  if (req.body.keyName !== undefined) updates.keyName = req.body.keyName;
  if (req.body.userId !== undefined) {
    const userId = await checkBindable(req, res, req.body.userId);
    if (userId === null) return;
    updates.userId = userId;
  }
  if (req.body.agentConfig !== undefined) updates.agentConfig = agentFlag(req.body.agentConfig);
  if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
  if (req.body.projectId !== undefined) updates.projectId = req.body.projectId || null;
  if (req.body.expiresAt !== undefined) updates.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "沒有要修改的欄位" }); return; }

  if (!(await mayManageKey(req, res, id))) return;

  const [record] = await db.update(apiKeysTable).set(updates).where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.tenantId, reqTenantId(req)))).returning();
  if (!record) { res.status(404).json({ error: "Not found" }); return; }

  res.json({
    id: record.id,
    keyName: record.keyName,
    apiKey: record.apiKey,
    projectId: record.projectId,
    userId: record.userId,
    agentConfig: agentFlag(record.agentConfig),
    isActive: record.isActive,
    expiresAt: record.expiresAt,
  });
});

router.post("/api-keys/:id/regenerate", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await mayManageKey(req, res, id))) return;

  const newApiKey = generateApiKey();
  const newSecret = generateApiSecret();
  const secretHash = hashSecret(newSecret);

  const [record] = await db
    .update(apiKeysTable)
    .set({ apiKey: newApiKey, secretHash })
    .where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.tenantId, reqTenantId(req))))
    .returning();

  if (!record) { res.status(404).json({ error: "Not found" }); return; }

  res.json({
    id: record.id,
    keyName: record.keyName,
    apiKey: newApiKey,
    apiSecret: newSecret,
    agentConfig: agentFlag(record.agentConfig),
    _notice: "金鑰已重新產生，請妥善保存新的 API Secret。",
  });
});

router.delete("/api-keys/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await mayManageKey(req, res, id))) return;

  const [record] = await db.delete(apiKeysTable).where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.tenantId, reqTenantId(req)))).returning();
  if (!record) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
