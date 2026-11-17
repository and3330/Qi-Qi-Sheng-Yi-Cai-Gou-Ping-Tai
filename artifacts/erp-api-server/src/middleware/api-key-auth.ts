import { Request, Response, NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { db, apiKeysTable } from "@workspace/erp-db";
import crypto from "crypto";

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers["authorization"];
  const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
  const apiSecretHeader = req.headers["x-api-secret"] as string | undefined;

  let keyValue: string | undefined;
  let secretValue: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const parts = token.split(":");
    if (parts.length === 2) {
      keyValue = parts[0];
      secretValue = parts[1];
    }
  } else if (apiKeyHeader && apiSecretHeader) {
    keyValue = apiKeyHeader;
    secretValue = apiSecretHeader;
  }

  if (!keyValue || !secretValue) {
    res.status(401).json({
      error: "未授權",
      message: "請提供 API Key 和 Secret。可使用 Authorization: Bearer <key>:<secret> 或 X-API-Key / X-API-Secret 標頭。",
    });
    return;
  }

  const [apiKeyRecord] = await db
    .select()
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.apiKey, keyValue), eq(apiKeysTable.isActive, true)))
    .limit(1);

  if (!apiKeyRecord) {
    res.status(401).json({ error: "未授權", message: "無效的 API Key" });
    return;
  }

  if (apiKeyRecord.secretHash !== hashSecret(secretValue)) {
    res.status(401).json({ error: "未授權", message: "API Secret 不正確" });
    return;
  }

  if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) < new Date()) {
    res.status(401).json({ error: "已過期", message: "此 API Key 已過期" });
    return;
  }

  db.update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, apiKeyRecord.id))
    .execute()
    .catch(() => {});

  (req as any).apiKey = apiKeyRecord;

  const method = req.method.toUpperCase();
  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const isDelete = method === "DELETE";
  const perms = apiKeyRecord.permissions;

  if (isWrite && perms === "read") {
    res.status(403).json({ error: "權限不足", message: "此 API Key 僅具有唯讀權限" });
    return;
  }

  if (isDelete && perms === "readwrite") {
    res.status(403).json({ error: "權限不足", message: "刪除操作需要管理員 (admin) 權限" });
    return;
  }

  next();
}
