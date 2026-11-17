import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db, paymentChannelsTable, channelReceivablesTable, channelPayoutsTable, accountsTable, projectsTable, departmentsTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { isRealDate, leafAccount, listCashAccounts } from "../lib/cash-accounts";
import {
  CHANNEL_PRESETS, convertLegacyOrders, legacyOrders, normalizeMethod, openReceivables, parsePayoutText, payoutBalanceProblem, payoutInputProblem, planPayout, postPayout, voidPayout,
  type PayoutInput, type PayoutLineInput,
} from "../lib/payment-channels";
import { pgErrorCode } from "../lib/pg-error";
import { logger } from "../lib/logger";

/**
 * 金流通路：各通路還欠公司多少、撥款進來時逐筆沖銷。
 * 掛在「外部串接」底下，權限跟外部串接的設定一樣（管理與財務角色）。
 */
const router: IRouter = Router();
router.use(["/integrations/channels", "/integrations/channel-payouts"], requireAuth, requireRole("owner", "admin", "finance_admin", "accountant"));

const parseId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const optionalId = (value: unknown): number | null => (value === null || value === undefined || value === "" ? null : parseId(value));
const actorOf = (req: Request): string => req.session?.user?.username || "api";
/** 給使用者看的錯誤：中文訊息原樣回，其他的不外洩細節 */
const userMessage = (err: any, fallback: string): string => (/[㐀-鿿]/.test(err?.message || "") ? String(err.message).slice(0, 600) : fallback);

router.get("/integrations/channels", async (_req, res): Promise<void> => {
  const receivable = sql`ra`, fee = sql`fa`, bank = sql`ba`;
  const result = await db.execute(sql`
    SELECT c.id, c.code, c.name, c.methods, c.receivable_account_id AS "receivableAccountId", c.fee_account_id AS "feeAccountId",
           c.bank_account_id AS "bankAccountId", c.start_date AS "startDate", c.is_active AS "isActive", c.note,
           ${receivable}.account_name AS "receivableAccountName", ${fee}.account_name AS "feeAccountName", ${bank}.account_name AS "bankAccountName",
           COALESCE(o.outstanding, 0)::float AS outstanding, COALESCE(o.open_count, 0)::int AS "openCount", o.oldest AS "oldestDate"
    FROM payment_channels c
    LEFT JOIN accounts ra ON ra.id = c.receivable_account_id
    LEFT JOIN accounts fa ON fa.id = c.fee_account_id
    LEFT JOIN accounts ba ON ba.id = c.bank_account_id
    LEFT JOIN (
      SELECT channel_id, SUM(amount) AS outstanding, COUNT(*) AS open_count, MIN(entry_date) AS oldest
      FROM channel_receivables WHERE payout_id IS NULL GROUP BY channel_id
    ) o ON o.channel_id = c.id
    ORDER BY c.id`);
  res.json({ channels: result.rows ?? result, presets: CHANNEL_PRESETS });
});

async function readChannel(body: any): Promise<Record<string, unknown>> {
  const code = typeof body?.code === "string" ? body.code.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(code)) throw new Error("通路代號只能用小寫英數與連字號，例如 newebpay");
  if (!name) throw new Error("請填寫通路名稱");
  const rawMethods: unknown[] = Array.isArray(body?.methods) ? body.methods : String(body?.methods ?? "").split(/[,，、\n]/);
  const methods = [...new Set(rawMethods.map(normalizeMethod).filter(Boolean))].slice(0, 20);
  if (methods.length === 0) throw new Error("請填外部訂單的付款方式會寫成什麼字（例如 newebpay），系統才知道哪些訂單是這個通路收的");
  const receivableAccountId = parseId(body?.receivableAccountId);
  if (!receivableAccountId) throw new Error("請選通路欠款要記在哪個科目（例如「應收帳款-綠界」）");
  await leafAccount(db, receivableAccountId, "通路欠款科目", ["Asset"]);
  if ((await listCashAccounts(db)).some(a => a.id === receivableAccountId)) throw new Error("通路欠款科目不能是現金或銀行存款：錢還沒進公司帳戶，才需要掛在這個科目");
  const feeAccountId = optionalId(body?.feeAccountId);
  if (feeAccountId) await leafAccount(db, feeAccountId, "手續費科目", ["Expense"]);
  const bankAccountId = optionalId(body?.bankAccountId);
  if (bankAccountId && !(await listCashAccounts(db)).some(a => a.id === bankAccountId)) throw new Error("撥款帳戶必須是現金或銀行存款的明細科目");
  const startDate = body?.startDate === null || body?.startDate === undefined || body?.startDate === "" ? null : String(body.startDate);
  if (startDate !== null && !isRealDate(startDate)) throw new Error("啟用日的格式不正確");
  return {
    code, name, methods, receivableAccountId, feeAccountId, bankAccountId, startDate,
    isActive: body?.isActive !== false, note: typeof body?.note === "string" ? body.note.trim().slice(0, 300) || null : null,
  };
}

/** 同一個付款方式不能同時屬於兩個通路，不然不知道要掛誰的欠款 */
async function assertMethodsFree(methods: string[], exceptId: number | null): Promise<void> {
  const others = await db.select({ id: paymentChannelsTable.id, name: paymentChannelsTable.name, methods: paymentChannelsTable.methods }).from(paymentChannelsTable);
  for (const other of others) {
    if (other.id === exceptId) continue;
    const clash = (Array.isArray(other.methods) ? other.methods : []).map(normalizeMethod).find(m => methods.includes(m));
    if (clash) throw new Error(`付款方式「${clash}」已經設在「${other.name}」，同一個付款方式只能屬於一個通路`);
  }
}

router.post("/integrations/channels", async (req, res): Promise<void> => {
  try {
    const values = await readChannel(req.body);
    await assertMethodsFree(values.methods as string[], null);
    const [created] = await db.insert(paymentChannelsTable).values(values as any).returning();
    res.status(201).json(created);
  } catch (err: any) {
    if (pgErrorCode(err) === "23505") { res.status(409).json({ error: "這個通路代號已經有了" }); return; }
    res.status(400).json({ error: userMessage(err, "通路沒有建立成功") });
  }
});

router.put("/integrations/channels/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "通路編號不正確" }); return; }
  try {
    const [existing] = await db.select().from(paymentChannelsTable).where(eq(paymentChannelsTable.id, id));
    if (!existing) { res.status(404).json({ error: "找不到這個通路" }); return; }
    const values = await readChannel({ ...req.body, code: existing.code });
    await assertMethodsFree(values.methods as string[], id);
    // 已經有欠款掛在原本的科目上，換科目會讓帳上兩邊各剩一半
    if (values.receivableAccountId !== existing.receivableAccountId) {
      const [{ count }] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(channelReceivablesTable)
        .where(and(eq(channelReceivablesTable.channelId, id), isNull(channelReceivablesTable.payoutId)));
      if (count > 0) throw new Error(`這個通路還有 ${count} 筆欠款沒沖完，要等全部沖完才能換欠款科目`);
    }
    const [updated] = await db.update(paymentChannelsTable).set(values as any).where(eq(paymentChannelsTable.id, id)).returning();
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: userMessage(err, "通路沒有更新成功") });
  }
});

router.delete("/integrations/channels/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "通路編號不正確" }); return; }
  const [{ count }] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(channelReceivablesTable).where(eq(channelReceivablesTable.channelId, id));
  if (count > 0) { res.status(409).json({ error: "這個通路已經有帳款紀錄，不能刪除；不再使用的話請改成停用" }); return; }
  await db.delete(paymentChannelsTable).where(eq(paymentChannelsTable.id, id));
  res.json({ ok: true });
});

/** 某個通路的欠款明細：status=open 還沒撥款（預設）、settled 已沖銷 */
router.get("/integrations/channels/:id/receivables", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "通路編號不正確" }); return; }
  const settled = req.query.status === "settled";
  const rows = await db.select({
    row: channelReceivablesTable, projectName: projectsTable.name, departmentName: departmentsTable.name, payoutNumber: channelPayoutsTable.payoutNumber,
  }).from(channelReceivablesTable)
    .leftJoin(projectsTable, eq(projectsTable.id, channelReceivablesTable.projectId))
    .leftJoin(departmentsTable, eq(departmentsTable.id, channelReceivablesTable.departmentId))
    .leftJoin(channelPayoutsTable, eq(channelPayoutsTable.id, channelReceivablesTable.payoutId))
    .where(and(eq(channelReceivablesTable.channelId, id), settled ? isNotNull(channelReceivablesTable.payoutId) : isNull(channelReceivablesTable.payoutId)))
    .orderBy(settled ? desc(channelReceivablesTable.settledAt) : channelReceivablesTable.entryDate, channelReceivablesTable.id)
    .limit(1000);
  const today = Date.now();
  res.json(rows.map(r => ({
    ...r.row, amount: Number(r.row.amount), expectedFee: r.row.expectedFee === null ? null : Number(r.row.expectedFee), settledFee: r.row.settledFee === null ? null : Number(r.row.settledFee),
    projectName: r.projectName, departmentName: r.departmentName, payoutNumber: r.payoutNumber,
    daysOpen: settled ? null : Math.max(0, Math.floor((today - new Date(`${r.row.entryDate}T00:00:00+08:00`).getTime()) / 86400000)),
  })));
});

/** 啟用日之前用這個通路收款、當時直接記成銀行收款的訂單（還沒轉成通路欠款的） */
router.get("/integrations/channels/:id/legacy-orders", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "通路編號不正確" }); return; }
  const [channel] = await db.select().from(paymentChannelsTable).where(eq(paymentChannelsTable.id, id));
  if (!channel) { res.status(404).json({ error: "找不到這個通路" }); return; }
  const from = typeof req.query.from === "string" && isRealDate(req.query.from) ? req.query.from : null;
  res.json({ startDate: channel.startDate, orders: await legacyOrders(db, channel, from) });
});

/** 把選到的舊訂單轉成通路欠款（只轉通路還沒撥款的那些） */
router.post("/integrations/channels/:id/legacy-orders/convert", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "通路編號不正確" }); return; }
  const eventIds: number[] = Array.isArray(req.body?.eventIds) ? req.body.eventIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
  if (eventIds.length === 0) { res.status(400).json({ error: "請勾選要轉入的訂單" }); return; }
  if (eventIds.length > 2000) { res.status(400).json({ error: "一次最多轉 2,000 筆，請分批" }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      const [channel] = await tx.select().from(paymentChannelsTable).where(eq(paymentChannelsTable.id, id)).for("update");
      if (!channel) throw new Error("找不到這個通路");
      return convertLegacyOrders(tx, channel, eventIds);
    });
    res.status(201).json(result);
  } catch (err: any) {
    if (!/[㐀-鿿]/.test(err?.message || "")) logger.warn({ err: err?.message, channelId: id }, "legacy order convert failed");
    res.status(400).json({ error: userMessage(err, "沒有轉入成功，請稍後再試") });
  }
});

function readPayout(body: any): PayoutInput {
  const lines: PayoutLineInput[] = Array.isArray(body?.lines)
    ? body.lines.map((l: any) => ({ ref: String(l?.ref ?? ""), amount: l?.amount === "" ? null : l?.amount ?? null, fee: l?.fee === "" ? 0 : l?.fee ?? 0 }))
    : parsePayoutText(typeof body?.text === "string" ? body.text : "");
  const extraAmount = Number(body?.extraFee?.amount ?? 0);
  return {
    payoutDate: String(body?.payoutDate ?? ""), bankAmount: Number(body?.bankAmount), bankAccountId: optionalId(body?.bankAccountId),
    reference: typeof body?.reference === "string" ? body.reference : null, note: typeof body?.note === "string" ? body.note : null, lines,
    extraFee: extraAmount > 0 ? { amount: extraAmount, projectId: optionalId(body.extraFee.projectId), departmentId: optionalId(body.extraFee.departmentId), note: typeof body.extraFee.note === "string" ? body.extraFee.note : null } : null,
  };
}

/** 試算：只告訴你這份撥款明細對得上哪些、對不上哪些、淨額多少，不寫入任何東西 */
router.post("/integrations/channels/:id/payouts/preview", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "通路編號不正確" }); return; }
  const input = readPayout(req.body);
  if (input.lines.length === 0) { res.status(400).json({ error: "請貼上撥款明細（至少一筆）" }); return; }
  const plan = planPayout(await openReceivables(db, id), input.lines, Number(input.extraFee?.amount ?? 0));
  const bankGiven = Number.isFinite(input.bankAmount);
  res.json({
    ...plan,
    balanceProblem: plan.problems.length === 0 && bankGiven ? payoutBalanceProblem(plan, input.bankAmount) : null,
    inputProblem: payoutInputProblem(input),
    // 來源網站回報的手續費跟這次實際扣的差很多時提醒一下
    feeWarnings: plan.matched.filter(m => m.expectedFee !== null && Math.abs(m.expectedFee - m.fee) > 1).slice(0, 20).map(m => ({ ref: m.ref, expected: m.expectedFee, actual: m.fee })),
  });
});

router.post("/integrations/channels/:id/payouts", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "通路編號不正確" }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      const [channel] = await tx.select().from(paymentChannelsTable).where(eq(paymentChannelsTable.id, id));
      if (!channel) throw new Error("找不到這個通路");
      return postPayout(tx, channel, readPayout(req.body), actorOf(req));
    });
    res.status(201).json({ payout: result.payout, gross: result.plan.gross, fee: result.plan.fee, extraFee: result.plan.extraFee, net: result.plan.net, count: result.plan.matched.length });
  } catch (err: any) {
    if (!/[㐀-鿿]/.test(err?.message || "")) logger.warn({ err: err?.message, channelId: id }, "channel payout failed");
    res.status(400).json({ error: userMessage(err, "撥款沒有入帳成功，請稍後再試") });
  }
});

router.get("/integrations/channel-payouts", async (req, res): Promise<void> => {
  const channelId = optionalId(req.query.channelId);
  const rows = await db.select({ payout: channelPayoutsTable, channelName: paymentChannelsTable.name, bankAccountName: accountsTable.accountName })
    .from(channelPayoutsTable)
    .leftJoin(paymentChannelsTable, eq(paymentChannelsTable.id, channelPayoutsTable.channelId))
    .leftJoin(accountsTable, eq(accountsTable.id, channelPayoutsTable.bankAccountId))
    .where(channelId ? eq(channelPayoutsTable.channelId, channelId) : undefined)
    .orderBy(desc(channelPayoutsTable.payoutDate), desc(channelPayoutsTable.id)).limit(300);
  res.json(rows.map(r => ({
    ...r.payout, grossAmount: Number(r.payout.grossAmount), feeAmount: Number(r.payout.feeAmount), extraFee: Number(r.payout.extraFee), bankAmount: Number(r.payout.bankAmount),
    channelName: r.channelName, bankAccountName: r.bankAccountName,
  })));
});

router.get("/integrations/channel-payouts/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "撥款編號不正確" }); return; }
  const [payout] = await db.select().from(channelPayoutsTable).where(eq(channelPayoutsTable.id, id));
  if (!payout) { res.status(404).json({ error: "找不到這筆撥款" }); return; }
  const lines = await db.select({ row: channelReceivablesTable, projectName: projectsTable.name }).from(channelReceivablesTable)
    .leftJoin(projectsTable, eq(projectsTable.id, channelReceivablesTable.projectId))
    .where(eq(channelReceivablesTable.payoutId, id)).orderBy(channelReceivablesTable.entryDate, channelReceivablesTable.id);
  res.json({
    ...payout, grossAmount: Number(payout.grossAmount), feeAmount: Number(payout.feeAmount), extraFee: Number(payout.extraFee), bankAmount: Number(payout.bankAmount),
    lines: lines.map(l => ({ ...l.row, amount: Number(l.row.amount), settledFee: l.row.settledFee === null ? null : Number(l.row.settledFee), projectName: l.projectName })),
  });
});

/** 作廢撥款（沖錯時用）：分錄反向沖回，那一批欠款重新變成還沒撥款 */
router.post("/integrations/channel-payouts/:id/void", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "撥款編號不正確" }); return; }
  try {
    const payout = await db.transaction(tx => voidPayout(tx, id, actorOf(req)));
    res.json(payout);
  } catch (err: any) {
    if (!/[㐀-鿿]/.test(err?.message || "")) logger.warn({ err: err?.message, payoutId: id }, "channel payout void failed");
    res.status(400).json({ error: userMessage(err, "作廢沒有成功，請稍後再試") });
  }
});

export default router;
