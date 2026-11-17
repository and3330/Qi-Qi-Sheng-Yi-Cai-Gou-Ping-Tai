import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, apiKeysTable, projectsTable } from "@workspace/erp-db";
import crypto from "crypto";

function generateApiKey(): string {
  return "erpk_" + crypto.randomBytes(24).toString("hex");
}

function generateApiSecret(): string {
  return "erps_" + crypto.randomBytes(32).toString("hex");
}

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

import { requireRole, sessionOnly } from "../middleware/require-auth";
import { reqTenantId } from "../middleware/tenant-context";

const router: IRouter = Router();
router.use("/api-keys", sessionOnly, requireRole("owner", "admin"));

router.get("/api-keys", async (_req, res): Promise<void> => {
  const keys = await db
    .select({
      id: apiKeysTable.id,
      keyName: apiKeysTable.keyName,
      apiKey: apiKeysTable.apiKey,
      projectId: apiKeysTable.projectId,
      permissions: apiKeysTable.permissions,
      isActive: apiKeysTable.isActive,
      lastUsedAt: apiKeysTable.lastUsedAt,
      expiresAt: apiKeysTable.expiresAt,
      createdAt: apiKeysTable.createdAt,
    })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.tenantId, reqTenantId(_req)))
    .orderBy(apiKeysTable.createdAt);

  const projects = await db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable);
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  const result = keys.map((k) => ({
    ...k,
    projectName: k.projectId ? projectMap[k.projectId] || "未知專案" : "全域",
    maskedKey: k.apiKey.substring(0, 10) + "..." + k.apiKey.substring(k.apiKey.length - 4),
  }));

  res.json(result);
});

router.post("/api-keys", async (req, res): Promise<void> => {
  const { keyName, projectId, permissions, expiresAt } = req.body;
  if (!keyName) {
    res.status(400).json({ error: "金鑰名稱為必填" });
    return;
  }
  const validPermissions = ["read", "readwrite", "admin"];
  if (permissions && !validPermissions.includes(permissions)) {
    res.status(400).json({ error: "權限值必須為 read、readwrite 或 admin" });
    return;
  }

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
      permissions: permissions || "read",
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })
    .returning();

  res.status(201).json({
    id: record.id,
    keyName: record.keyName,
    apiKey,
    apiSecret,
    projectId: record.projectId,
    permissions: record.permissions,
    isActive: record.isActive,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    _notice: "請妥善保存 API Secret，此為唯一一次顯示。",
  });
});

router.patch("/api-keys/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const validPermissions = ["read", "readwrite", "admin"];
  const updates: Record<string, unknown> = {};
  if (req.body.keyName !== undefined) updates.keyName = req.body.keyName;
  if (req.body.permissions !== undefined) {
    if (!validPermissions.includes(req.body.permissions)) {
      res.status(400).json({ error: "權限值必須為 read、readwrite 或 admin" });
      return;
    }
    updates.permissions = req.body.permissions;
  }
  if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
  if (req.body.projectId !== undefined) updates.projectId = req.body.projectId || null;
  if (req.body.expiresAt !== undefined) updates.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;

  const [record] = await db.update(apiKeysTable).set(updates).where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.tenantId, reqTenantId(req)))).returning();
  if (!record) { res.status(404).json({ error: "Not found" }); return; }

  res.json({
    id: record.id,
    keyName: record.keyName,
    apiKey: record.apiKey,
    projectId: record.projectId,
    permissions: record.permissions,
    isActive: record.isActive,
    expiresAt: record.expiresAt,
  });
});

router.post("/api-keys/:id/regenerate", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const newApiKey = generateApiKey();
  const newSecret = generateApiSecret();
  const secretHash = hashSecret(newSecret);

  const [record] = await db
    .update(apiKeysTable)
    .set({ apiKey: newApiKey, secretHash })
    .where(eq(apiKeysTable.id, id))
    .returning();

  if (!record) { res.status(404).json({ error: "Not found" }); return; }

  res.json({
    id: record.id,
    keyName: record.keyName,
    apiKey: newApiKey,
    apiSecret: newSecret,
    _notice: "金鑰已重新產生，請妥善保存新的 API Secret。",
  });
});

router.delete("/api-keys/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [record] = await db.delete(apiKeysTable).where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.tenantId, reqTenantId(req)))).returning();
  if (!record) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
