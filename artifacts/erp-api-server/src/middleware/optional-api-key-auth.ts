import { Request, Response, NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { db, apiKeysTable } from "@workspace/erp-db";
import crypto from "crypto";
import { internalActor, internalTenant } from "../lib/internal-auth";
import { actAsUser, loadKeyUser } from "../lib/api-key-user";

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/**
 * 帶了 API 金鑰就驗證金鑰；權限不看金鑰本身，而是跟著金鑰綁定的使用者目前的角色
 * （老闆 2026-11-19）。之後所有守衛看到的就是那個人，跟他自己登入操作一樣。
 */
export async function optionalApiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // 伺服器自己發出的內部呼叫（AI 助理的通用操作工具）
  const internal = internalTenant(req.headers as Record<string, unknown>);
  if (internal !== null) {
    const actor = internalActor(req.headers as Record<string, unknown>);
    if (actor.userId) {
      // 從 ERP 金鑰來的：以金鑰綁定的使用者身分執行
      const user = await loadKeyUser(internal, actor.userId);
      if (!user) { res.status(403).json({ error: "權限不足", message: "金鑰綁定的使用者已停用或不存在" }); return; }
      (req as any).apiKey = { id: actor.keyId, keyName: "AI 助理", tenantId: internal, userId: user.id };
      (req as any).apiKeyAuth = true;
      actAsUser(req, user);
    } else {
      // 環境變數設定的舊 AI 金鑰：沒有對應的使用者，維持原本的管理員等級
      (req as any).apiKey = { id: null, keyName: "AI 全權", permissions: "admin", tenantId: internal };
      (req as any).apiKeyAuth = true;
    }
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

  if (!apiKeyRecord.userId) {
    res.status(403).json({ error: "權限不足", message: "這把金鑰還沒指定使用者，請管理員到「API 金鑰」頁面指定它代表誰" });
    return;
  }
  const user = await loadKeyUser(apiKeyRecord.tenantId, apiKeyRecord.userId);
  if (!user) {
    res.status(403).json({ error: "權限不足", message: "這把金鑰綁定的使用者已停用或不存在" });
    return;
  }
  // 已經登入的瀏覽器又帶金鑰：分不清要用誰的身分，直接拒絕，也避免動到登入狀態
  if (req.session?.user) {
    res.status(400).json({ error: "請求有誤", message: "已登入時不要再帶 API 金鑰" });
    return;
  }

  db.update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, apiKeyRecord.id))
    .execute()
    .catch(() => {});

  (req as any).apiKey = apiKeyRecord;
  (req as any).apiKeyAuth = true;
  actAsUser(req, user);
  next();
}
