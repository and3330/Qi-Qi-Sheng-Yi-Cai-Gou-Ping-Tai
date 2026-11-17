import { Router, type IRouter } from "express";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { buildCatalog } from "../lib/api-catalog";
import { endpointCatalog } from "../mcp/admin-tools";

/**
 * API 目錄：給「系統管理 › API 文件」頁用。
 * 端點是從實際掛上的路由讀出來的，所以文件永遠跟程式一致，不用手動維護清單。
 */
const router: IRouter = Router();

router.get("/api-catalog", requireAuth, requireRole("owner", "admin"), async (_req, res): Promise<void> => {
  const endpoints = await endpointCatalog();
  res.json(buildCatalog(endpoints));
});

export default router;
