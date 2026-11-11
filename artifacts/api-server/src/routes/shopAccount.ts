import { Router, type IRouter } from "express";
import { createHash, randomBytes } from "node:crypto";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  db,
  membersTable,
  ordersTable,
  orderItemsTable,
  passwordResetTokensTable,
  shopSettingsTable,
} from "@workspace/db";
import {
  ChangePasswordBody,
  ForgotPasswordBody,
  ResetPasswordBody,
  ReportOrderRemittanceBody,
  UpdateShopPaymentInfoBody,
} from "@workspace/api-zod";
import { requireMember, requireAdmin } from "../middlewares/requireMember";
import { resendConfigured, sendEmail } from "../lib/newsletter";
import { applyOrderStatusChange } from "./adminOrders";
import { serializeOrder } from "./orders";
import { reindex } from "../lib/aiIndex";
import { logger } from "../lib/logger";

/**
 * 商城會員自助功能：改密碼、忘記密碼、匯款帳號與回報後五碼、自行取消待付款訂單。
 */
const router: IRouter = Router();

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "嘗試次數過多，請稍後再試" },
});

const RESET_TTL_MS = 30 * 60 * 1000;
const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

function publicBaseUrl(req: { protocol: string; get(name: string): string | undefined }) {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  return configured || `${req.protocol}://${req.get("host")}`;
}

// ── 改密碼（已登入）──────────────────────────────────────────
router.post("/auth/change-password", passwordLimiter, requireMember, async (req, res) => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "新密碼至少 8 碼" });
    return;
  }
  const { currentPassword, newPassword } = parsed.data;
  const ok = await bcrypt.compare(currentPassword, req.member!.passwordHash);
  if (!ok) {
    res.status(400).json({ error: "目前的密碼不正確" });
    return;
  }
  await db
    .update(membersTable)
    .set({ passwordHash: await bcrypt.hash(newPassword, 10) })
    .where(eq(membersTable.id, req.member!.id));
  res.json({ ok: true });
});

// ── 忘記密碼：寄出重設連結 ───────────────────────────────────
// 不論帳號是否存在、有沒有 Email，一律回同樣的訊息，避免被用來探測帳號。
router.post("/auth/forgot-password", passwordLimiter, async (req, res) => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  const generic = {
    ok: true,
    message: "若此帳號有設定 Email，重設密碼的連結已寄出，30 分鐘內有效。沒有收到請聯繫客服。",
  };
  if (!parsed.success) {
    res.json(generic);
    return;
  }
  try {
    const [member] = await db
      .select()
      .from(membersTable)
      .where(eq(membersTable.username, parsed.data.username.trim().toLowerCase()))
      .limit(1);
    if (member && member.isActive && member.email && resendConfigured()) {
      const raw = randomBytes(32).toString("hex");
      await db.insert(passwordResetTokensTable).values({
        memberId: member.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      });
      const link = `${publicBaseUrl(req)}/reset-password?token=${raw}`;
      await sendEmail({
        from: process.env.MAIL_FROM?.trim() || "onboarding@resend.dev",
        to: member.email,
        subject: "七期生醫採購平台：重設密碼",
        html: `<p>${member.name || member.username} 您好，</p>
<p>我們收到重設密碼的申請。請在 30 分鐘內點選下方連結設定新密碼：</p>
<p><a href="${link}">${link}</a></p>
<p>如果不是您本人申請，請忽略這封信，密碼不會變更。</p>`,
      });
    }
  } catch (err) {
    logger.error({ err }, "forgot-password mail failed");
  }
  res.json(generic);
});

router.post("/auth/reset-password", passwordLimiter, async (req, res) => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "新密碼至少 8 碼" });
    return;
  }
  const { token, newPassword } = parsed.data;
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const done = await db.transaction(async (tx) => {
    // 條件式更新：同一個連結只會成功一次
    const [claimed] = await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokensTable.tokenHash, hashToken(token)),
          isNull(passwordResetTokensTable.usedAt),
          gt(passwordResetTokensTable.expiresAt, new Date()),
        ),
      )
      .returning({ memberId: passwordResetTokensTable.memberId });
    if (!claimed) return false;
    await tx
      .update(membersTable)
      .set({ passwordHash })
      .where(eq(membersTable.id, claimed.memberId));
    return true;
  });
  if (!done) {
    res.status(400).json({ error: "連結已失效或已使用過，請重新申請" });
    return;
  }
  res.json({ ok: true });
});

// ── 匯款帳號 ─────────────────────────────────────────────────
const PAYMENT_KEYS = ["bank_name", "bank_branch", "bank_account", "bank_holder", "bank_note"] as const;

async function loadPaymentInfo() {
  const rows = await db.select().from(shopSettingsTable);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    bankName: map.get("bank_name") ?? "",
    bankBranch: map.get("bank_branch") ?? "",
    bankAccount: map.get("bank_account") ?? "",
    bankHolder: map.get("bank_holder") ?? "",
    bankNote: map.get("bank_note") ?? "",
  };
}

router.get("/shop/payment-info", requireMember, async (_req, res) => {
  res.json(await loadPaymentInfo());
});

router.put("/admin/shop/payment-info", requireAdmin, async (req, res) => {
  const parsed = UpdateShopPaymentInfoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const d = parsed.data;
  const values: Record<(typeof PAYMENT_KEYS)[number], string> = {
    bank_name: d.bankName.trim(),
    bank_branch: d.bankBranch.trim(),
    bank_account: d.bankAccount.trim(),
    bank_holder: d.bankHolder.trim(),
    bank_note: d.bankNote.trim(),
  };
  for (const key of PAYMENT_KEYS) {
    await db
      .insert(shopSettingsTable)
      .values({ key, value: values[key] })
      .onConflictDoUpdate({
        target: shopSettingsTable.key,
        set: { value: values[key], updatedAt: new Date() },
      });
  }
  res.json(await loadPaymentInfo());
});

// ── 訂單：回報匯款後五碼、自行取消 ────────────────────────────
async function loadOwnOrder(orderId: number, memberId: number) {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.memberId, memberId)))
    .limit(1);
  if (!order) return null;
  const items = await db
    .select()
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, orderId));
  return { order, items };
}

router.post("/orders/:id/remittance", requireMember, async (req, res) => {
  const id = Number(req.params.id);
  const parsed = ReportOrderRemittanceBody.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: "請輸入匯款帳號的後五碼（5 位數字）" });
    return;
  }
  const [updated] = await db
    .update(ordersTable)
    .set({ remitLastFive: parsed.data.lastFive, remitReportedAt: new Date() })
    .where(
      and(
        eq(ordersTable.id, id),
        eq(ordersTable.memberId, req.member!.id),
        eq(ordersTable.status, "pending"),
        eq(ordersTable.paymentMethod, "bank_transfer"),
      ),
    )
    .returning({ id: ordersTable.id });
  if (!updated) {
    res.status(400).json({ error: "只有待付款的匯款訂單可以回報" });
    return;
  }
  reindex("order", id);
  const loaded = await loadOwnOrder(id, req.member!.id);
  res.json(serializeOrder(loaded!.order, loaded!.items));
});

router.post("/orders/:id/cancel", requireMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    // 與後台取消共用同一段邏輯（回補庫存、退回點數、同步 ERP 銷貨單）。
    // 在同一個交易內先鎖定並確認是本人的待付款訂單，避免與後台同時操作。
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select({ status: ordersTable.status })
        .from(ordersTable)
        .where(and(eq(ordersTable.id, id), eq(ordersTable.memberId, req.member!.id)))
        .for("update")
        .limit(1);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status !== "pending") throw new Error(`BAD_TRANSITION:${order.status}`);
      await applyOrderStatusChange(id, "cancelled", tx);
    });
  } catch (err) {
    if (err instanceof Error && err.message === "ORDER_NOT_FOUND") {
      res.status(404).json({ error: "找不到此訂單" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("BAD_TRANSITION:")) {
      res.status(400).json({ error: "只有待付款的訂單可以自行取消，其他狀態請聯繫客服" });
      return;
    }
    throw err;
  }
  reindex("order", id);
  const loaded = await loadOwnOrder(id, req.member!.id);
  res.json(serializeOrder(loaded!.order, loaded!.items));
});

export default router;
