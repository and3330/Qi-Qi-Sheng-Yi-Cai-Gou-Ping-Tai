import { Router, type IRouter } from "express";
import { db, auditLogsTable } from "@workspace/erp-db";
import { requireAuth, requireRole, sessionOnly } from "../middleware/require-auth";
import { ensureFoundation, getFoundationStatus } from "../lib/foundation";
import { loadSetupReminders, notifySetupReminders } from "../lib/setup-reminders";

const router: IRouter = Router();
const SETUP_ROLES = ["owner", "admin"] as const;

router.use("/setup", requireAuth);

/** 基礎資料檢查：哪些連動需要的資料還沒建好 */
router.get("/setup/status", requireRole(...SETUP_ROLES), async (_req, res): Promise<void> => {
  res.json(await getFoundationStatus(db));
});

/** 上線前設定清單：到職日、假日、班制、職級、虛擬品項、期初餘額等還沒設定的項目 */
router.get("/setup/reminders", requireRole(...SETUP_ROLES), async (_req, res): Promise<void> => {
  const reminders = await loadSetupReminders(db);
  // 順便確保老闆與管理員各有一則通知（每人最多一則未讀）；通知失敗不影響清單
  await notifySetupReminders(db).catch(() => {});
  res.json(reminders);
});

/** 一鍵補齊本公司缺少的基礎資料（只新增，不覆蓋既有資料） */
router.post("/setup/ensure", sessionOnly, requireRole(...SETUP_ROLES), async (req, res): Promise<void> => {
  const user = req.session?.user;
  const tenantId = Number(user?.tenantId);
  if (!user || !Number.isInteger(tenantId) || tenantId <= 0) { res.status(401).json({ error: "請先登入" }); return; }

  const result = await db.transaction(async (tx) => {
    const ensured = await ensureFoundation(tx, tenantId);
    if (ensured.accountsInserted > 0 || ensured.warehouseCreated || ensured.accountingSettingsCreated) {
      await tx.insert(auditLogsTable).values({
        tenantId,
        action: "create",
        module: "system",
        documentType: "foundation_setup",
        userId: String(user.id),
        userName: user.displayName,
        ipAddress: req.ip,
        newValues: ensured,
        description: "補齊基礎資料",
      });
    }
    return { ensured, status: await getFoundationStatus(tx) };
  });
  res.json(result);
});

export default router;
