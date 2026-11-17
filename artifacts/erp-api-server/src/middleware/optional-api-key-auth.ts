import { Request, Response, NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { db, apiKeysTable } from "@workspace/erp-db";
import crypto from "crypto";
import { internalTenant } from "../lib/internal-auth";

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export async function optionalApiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // 伺服器自己發出的內部呼叫（AI 全權身分的通用操作工具）：視同管理員等級的金鑰，租戶由內部標頭決定
  const internal = internalTenant(req.headers as Record<string, unknown>);
  if (internal !== null) {
    (req as any).apiKey = { id: null, keyName: "AI 全權", permissions: "admin", tenantId: internal };
    (req as any).apiKeyAuth = true;
    next();
    return;
  }

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
    next();
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

  // 以固定時間比較防止 timing attack
  const expected = Buffer.from(apiKeyRecord.secretHash, "hex");
  const actual = Buffer.from(hashSecret(secretValue), "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
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
  (req as any).apiKeyAuth = true;

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
