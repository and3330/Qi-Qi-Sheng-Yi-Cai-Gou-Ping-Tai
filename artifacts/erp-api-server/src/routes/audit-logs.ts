import { Router, type IRouter } from "express";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/audit-logs", requireAuth, requireRole("owner", "admin"));

router.get("/audit-logs", async (req, res): Promise<void> => {
  const conditions: any[] = [];
  if (req.query.module) conditions.push(eq(auditLogsTable.module, req.query.module as string));
  if (req.query.action) conditions.push(eq(auditLogsTable.action, req.query.action as string));
  if (req.query.documentType) conditions.push(eq(auditLogsTable.documentType, req.query.documentType as string));
  if (req.query.userName) conditions.push(eq(auditLogsTable.userName, req.query.userName as string));
  if (req.query.startDate) conditions.push(gte(auditLogsTable.createdAt, new Date(req.query.startDate as string)));
  if (req.query.endDate) conditions.push(lte(auditLogsTable.createdAt, new Date(req.query.endDate as string)));

  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const rows = await db.select().from(auditLogsTable).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(auditLogsTable.createdAt)).limit(limit);
  res.json(rows);
});

// 稽核紀錄由系統在每次新增、修改、刪除時自動寫入（middleware/audit-logger）。
// 原本這裡有一個可以自己寫紀錄的端點，任何登入的人都能偽造「誰做了什麼」，已移除。

export default router;
