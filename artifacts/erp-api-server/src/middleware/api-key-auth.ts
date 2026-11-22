import { Request, Response, NextFunction } from "express";

/**
 * /external 底下的端點一定要用 API 金鑰。金鑰本身已經由 optionalApiKeyAuth 驗過，
 * 並且換成金鑰綁定的使用者身分；這裡只確認真的是金鑰呼叫、而且有對應的使用者。
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  if (!(req as any).apiKeyAuth || !req.session?.user) {
    res.status(401).json({
      error: "未授權",
      message: "請提供 API Key 和 Secret。可使用 Authorization: Bearer <key>:<secret> 或 X-API-Key / X-API-Secret 標頭。",
    });
    return;
  }
  next();
}
