import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, accountingSettingsTable, activitiesTable, changeRequestsTable } from "@workspace/erp-db";
import { registerChangeHandler, submitChangeRequest } from "../lib/change-requests";
import { isUnlock, lockLabel } from "../lib/period-lock";
import { isRealDate } from "../lib/cash-accounts";
import { todayTaipei } from "../lib/inventory-journal";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/accounting-settings", requireAuth);

// 取得會計設定（關帳日）
router.get("/accounting-settings", async (_req, res): Promise<void> => {
  const [row] = await db.select().from(accountingSettingsTable).limit(1);
  // 正在審核中的解鎖申請：畫面上顯示「解鎖審核中」
  const [pending] = await db.select({ requestNumber: changeRequestsTable.requestNumber, payload: changeRequestsTable.payload, requestedBy: changeRequestsTable.requestedBy })
    .from(changeRequestsTable).where(and(eq(changeRequestsTable.targetType, "period"), eq(changeRequestsTable.kind, "unlock"), eq(changeRequestsTable.status, "Pending"))).limit(1);
  res.json({ lockDate: row?.lockDate || null, pendingUnlock: pending ? { requestNumber: pending.requestNumber, lockDate: (pending.payload as any)?.lockDate ?? null, requestedBy: pending.requestedBy } : null });
});

/** 解鎖核准後才真的把關帳日往回改；這期間如果已經有人再往後鎖，就以申請的日期為準往回 */
registerChangeHandler("period", "unlock", async (tx, cr) => {
  const target = ((cr.payload as any)?.lockDate as string | null) ?? null;
  const [existing] = await tx.select().from(accountingSettingsTable).limit(1);
  if (existing) await tx.update(accountingSettingsTable).set({ lockDate: target });
  else await tx.insert(accountingSettingsTable).values({ lockDate: target });
  await tx.insert(activitiesTable).values({ type: "update", title: "修改關帳日", module: "Accounting", description: `${cr.requestNumber} 核准解鎖：${existing?.lockDate || "未設定"} → ${target || "取消關帳"}` });
  return `關帳日改為 ${lockLabel(target)}`;
});

// 更新關帳日（僅財務/管理員）
router.put("/accounting-settings", requireRole("owner", "admin", "finance_admin", "accountant"), async (req, res): Promise<void> => {
  const lockDate = req.body?.lockDate;
  if (lockDate != null && lockDate !== "" && !isRealDate(String(lockDate))) {
    res.status(400).json({ error: "關帳日格式須為 YYYY-MM-DD" }); return;
  }
  const value = lockDate ? String(lockDate) : null;
  if (value && value > todayTaipei()) { res.status(400).json({ error: "關帳日不能設在未來，否則今天之後的單據都無法入帳" }); return; }
  const [existing] = await db.select().from(accountingSettingsTable).limit(1);
  // 往回改（解鎖）要先送審：財務或超級管理員其一核准；財務送的給超級管理員（老闆 2026-11-16）
  if (isUnlock(existing?.lockDate ?? null, value)) {
    const user = req.session?.user;
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
    try {
      const { changeRequest, autoApplied } = await db.transaction(tx => submitChangeRequest(tx, {
        kind: "unlock", targetType: "period", targetId: null, targetNumber: null,
        title: `解鎖月份：關帳 ${lockLabel(existing?.lockDate ?? null)} → ${lockLabel(value)}`,
        payload: { lockDate: value }, original: { lockDate: existing?.lockDate ?? null }, reason,
      }, { username: user?.username || "API", role: user?.role ?? null }));
      if (autoApplied) res.json({ lockDate: value, applied: true, requestNumber: changeRequest.requestNumber, message: autoApplied });
      else res.status(202).json({ lockDate: existing?.lockDate ?? null, pending: true, requestNumber: changeRequest.requestNumber });
    } catch (err: any) {
      res.status(Number(err?.status) || 400).json({ error: err?.message || "送出解鎖申請失敗" });
    }
    return;
  }
  // 關帳日是帳務的總開關，誰在什麼時候改的要留紀錄
  await db.insert(activitiesTable).values({
    type: "update", title: "修改關帳日", module: "Accounting",
    description: `${req.session?.user?.username || "API"}：${existing?.lockDate || "未設定"} → ${value || "取消關帳"}`,
  });
  if (existing) {
    await db.update(accountingSettingsTable).set({ lockDate: value });
  } else {
    await db.insert(accountingSettingsTable).values({ lockDate: value });
  }
  res.json({ lockDate: value });
});

export default router;
