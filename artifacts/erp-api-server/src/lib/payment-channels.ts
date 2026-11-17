import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  paymentChannelsTable, channelReceivablesTable, channelPayoutsTable, journalEntriesTable, integrationSourcesTable, salesOrdersTable,
  type PaymentChannel, type ChannelPayout,
} from "@workspace/erp-db";
import { postAutoJournal, round2 } from "./inventory-journal";
import { cashLineAccount, leafAccount } from "./cash-accounts";
import { normalizeMethod, payoutBalanceProblem, payoutInputProblem, planPayout, type OpenReceivable, type PayoutInput, type PayoutPlan } from "./payment-channel-rules";

export * from "./payment-channel-rules";

/**
 * 金流通路欠款與撥款沖銷。
 * 訂單進來：錢還在通路手上，記「通路欠款」（全額）。
 * 撥款進來：用通路的撥款明細逐筆沖掉欠款，手續費照實際扣的金額入帳，淨額要等於銀行入帳的那一筆。
 */

// ───────── 資料庫 ─────────

export async function activeChannels(tx: any): Promise<PaymentChannel[]> {
  return tx.select().from(paymentChannelsTable).where(eq(paymentChannelsTable.isActive, true)).orderBy(paymentChannelsTable.id);
}

/** 通路欠款科目的分錄用寫法 */
export async function receivableAccount(tx: any, channel: PaymentChannel) {
  const account = await leafAccount(tx, channel.receivableAccountId, `「${channel.name}」的欠款科目`, ["Asset"]);
  return { accountId: account.accountId, accountNumber: account.accountNumber, accountName: account.accountName };
}

export async function addReceivable(tx: any, input: {
  channel: PaymentChannel; kind: "order" | "refund" | "topup"; amount: number; externalRef: string; entryDate: string;
  sourceId?: number | null; eventId?: number | null; salesOrderId?: number | null; orderNumber?: string | null;
  projectId?: number | null; departmentId?: number | null; expectedFee?: number | null;
}): Promise<void> {
  await tx.insert(channelReceivablesTable).values({
    channelId: input.channel.id, kind: input.kind, amount: String(round2(input.amount)), externalRef: input.externalRef.slice(0, 120), entryDate: input.entryDate.slice(0, 10),
    sourceId: input.sourceId ?? null, eventId: input.eventId ?? null, salesOrderId: input.salesOrderId ?? null, orderNumber: input.orderNumber ?? null,
    projectId: input.projectId ?? null, departmentId: input.departmentId ?? null,
    expectedFee: input.expectedFee && input.expectedFee > 0 ? String(round2(input.expectedFee)) : null,
  });
}

export async function openReceivables(tx: any, channelId: number, lock = false): Promise<OpenReceivable[]> {
  const query = tx.select().from(channelReceivablesTable)
    .where(and(eq(channelReceivablesTable.channelId, channelId), isNull(channelReceivablesTable.payoutId)))
    .orderBy(channelReceivablesTable.entryDate, channelReceivablesTable.id);
  const rows = await (lock ? query.for("update") : query);
  return rows.map((r: any) => ({
    id: r.id, externalRef: r.externalRef, orderNumber: r.orderNumber, amount: Number(r.amount),
    projectId: r.projectId, departmentId: r.departmentId, expectedFee: r.expectedFee === null ? null : Number(r.expectedFee),
  }));
}

/** 入帳一次撥款：沖掉欠款、認列手續費、記銀行存款。任何一筆對不上就整批不做 */
export async function postPayout(tx: any, channel: PaymentChannel, input: PayoutInput, actor: string): Promise<{ payout: ChannelPayout; plan: PayoutPlan }> {
  const problem = payoutInputProblem(input);
  if (problem) throw new Error(problem);
  const extraAmount = round2(Number(input.extraFee?.amount ?? 0));
  const open = await openReceivables(tx, channel.id, true);
  const plan = planPayout(open, input.lines, extraAmount);
  if (plan.problems.length > 0) {
    throw new Error(`有 ${plan.problems.length} 筆對不上，整批都沒有入帳：${plan.problems.slice(0, 5).map(p => `第 ${p.line} 筆 ${p.ref}（${p.reason}）`).join("；")}${plan.problems.length > 5 ? "…" : ""}`);
  }
  const balance = payoutBalanceProblem(plan, input.bankAmount);
  if (balance) throw new Error(balance);

  const bankAccountId = input.bankAccountId ?? channel.bankAccountId;
  if (!bankAccountId) throw new Error("請選撥款進哪個銀行帳戶");
  const bank = await cashLineAccount(tx, bankAccountId);
  const receivable = await receivableAccount(tx, channel);
  const feeAccount = channel.feeAccountId
    ? await leafAccount(tx, channel.feeAccountId, `「${channel.name}」的手續費科目`, ["Expense"]).then(a => ({ accountId: a.accountId, accountNumber: a.accountNumber, accountName: a.accountName }))
    : { accountName: "金流手續費" };

  const [{ count }] = await tx.select({ count: sql<number>`COUNT(*)::int` }).from(channelPayoutsTable);
  const payoutNumber = `CP-${input.payoutDate.replace(/-/g, "").slice(2)}-${String((count || 0) + 1).padStart(4, "0")}`;
  const [created] = await tx.insert(channelPayoutsTable).values({
    payoutNumber, channelId: channel.id, payoutDate: input.payoutDate, bankAccountId: Number(bankAccountId),
    grossAmount: String(plan.gross), feeAmount: String(plan.fee), extraFee: String(plan.extraFee), bankAmount: String(round2(input.bankAmount)),
    lineCount: plan.matched.length, reference: input.reference?.trim().slice(0, 120) || null, note: input.note?.trim().slice(0, 300) || null, createdBy: actor,
  }).returning();

  const journalIds: number[] = [];
  // 手續費：依專案、部門分組各開一張，費用才會算在對的專案上
  for (const [index, group] of plan.feeGroups.entries()) {
    const journal = await postAutoJournal(tx, {
      key: `CP${created.id}-F${index + 1}`, entryDate: input.payoutDate, action: "金流撥款沖銷", projectId: group.projectId, departmentId: group.departmentId,
      description: `自動分錄 - ${channel.name} 撥款 ${payoutNumber} 手續費`,
      lines: group.fee > 0
        ? [{ ...feeAccount, debit: group.fee, credit: 0, description: `${payoutNumber} ${channel.name} 手續費` }, { ...receivable, debit: 0, credit: group.fee, description: `${payoutNumber} 手續費從欠款扣除` }]
        : [{ ...receivable, debit: -group.fee, credit: 0, description: `${payoutNumber} 退款退回的手續費` }, { ...feeAccount, debit: 0, credit: -group.fee, description: `${payoutNumber} ${channel.name} 退回手續費` }],
    });
    if (journal) journalIds.push(journal.id);
  }
  // 錢進銀行：沖掉剩下的欠款；不屬於訂單的其他費用也在這張
  const main = await postAutoJournal(tx, {
    key: `CP${created.id}`, entryDate: input.payoutDate, action: "金流撥款沖銷",
    projectId: plan.extraFee > 0 ? input.extraFee?.projectId ?? null : null, departmentId: plan.extraFee > 0 ? input.extraFee?.departmentId ?? null : null,
    description: `自動分錄 - ${channel.name} 撥款 ${payoutNumber}（${plan.matched.length} 筆）`,
    lines: [
      { ...bank, debit: plan.net, credit: 0, description: `${payoutNumber} ${channel.name} 撥款入帳` },
      ...(plan.extraFee > 0 ? [{ ...feeAccount, debit: plan.extraFee, credit: 0, description: `${payoutNumber} ${input.extraFee?.note?.trim().slice(0, 60) || "其他費用"}` }] : []),
      { ...receivable, debit: 0, credit: round2(plan.gross - plan.fee), description: `${payoutNumber} 沖銷通路欠款` },
    ],
  });
  if (main) journalIds.push(main.id);

  const feeById = new Map(plan.matched.map(m => [m.receivableId, m.fee]));
  const now = new Date();
  for (const [receivableId, fee] of feeById) {
    await tx.update(channelReceivablesTable).set({ payoutId: created.id, settledFee: String(fee), settledAt: now }).where(eq(channelReceivablesTable.id, receivableId));
  }
  const [payout] = await tx.update(channelPayoutsTable).set({ journalEntryIds: journalIds }).where(eq(channelPayoutsTable.id, created.id)).returning();
  return { payout, plan };
}

/** 作廢一次撥款：把分錄反向沖回，欠款重新變成還沒撥款。用在沖錯的時候 */
export async function voidPayout(tx: any, payoutId: number, actor: string): Promise<ChannelPayout> {
  const [payout] = await tx.select().from(channelPayoutsTable).where(eq(channelPayoutsTable.id, payoutId)).for("update");
  if (!payout) throw new Error("找不到這筆撥款");
  if (payout.status === "Voided") throw new Error("這筆撥款已經作廢過了");
  const ids = Array.isArray(payout.journalEntryIds) ? payout.journalEntryIds : [];
  const journals = ids.length > 0 ? await tx.select().from(journalEntriesTable).where(inArray(journalEntriesTable.id, ids)).orderBy(journalEntriesTable.id) : [];
  for (const [index, journal] of journals.entries()) {
    const lines = (Array.isArray(journal.lines) ? journal.lines : []) as Array<{ accountId?: number; accountNumber?: string; accountName: string; debit: number; credit: number; description?: string }>;
    await postAutoJournal(tx, {
      key: `CP${payout.id}-V${index + 1}`, entryDate: payout.payoutDate, action: "作廢金流撥款", projectId: journal.projectId, departmentId: journal.departmentId,
      description: `自動分錄 - 作廢撥款 ${payout.payoutNumber}（沖回 ${journal.entryNumber}）`,
      lines: lines.map(l => ({ accountId: l.accountId, accountNumber: l.accountNumber, accountName: l.accountName, debit: Number(l.credit) || 0, credit: Number(l.debit) || 0, description: `作廢 ${payout.payoutNumber}` })),
    });
  }
  await tx.update(channelReceivablesTable).set({ payoutId: null, settledFee: null, settledAt: null }).where(eq(channelReceivablesTable.payoutId, payout.id));
  const [updated] = await tx.update(channelPayoutsTable).set({ status: "Voided", voidedBy: actor, voidedAt: new Date() }).where(eq(channelPayoutsTable.id, payout.id)).returning();
  return updated;
}

// ───────── 啟用日之前的舊訂單 ─────────

export interface LegacyOrder { eventId: number; sourceId: number; sourceName: string | null; ref: string; orderNumber: string | null; salesOrderId: number | null; entryDate: string; amount: number; fee: number }

/**
 * 啟用日之前、用這個通路收款的訂單：當時是照舊記法直接記成銀行收款。
 * 通路還沒撥款的那些，要先轉成通路欠款，之後的撥款明細才對得到。已經轉過的不會再列出來。
 */
export async function legacyOrders(tx: any, channel: PaymentChannel, from?: string | null): Promise<LegacyOrder[]> {
  if (!channel.startDate) return [];
  const methods = (Array.isArray(channel.methods) ? channel.methods : []).map(normalizeMethod).filter(Boolean);
  if (methods.length === 0) return [];
  const result = await tx.execute(sql`
    SELECT e.id AS "eventId", e.source_id AS "sourceId", s.name AS "sourceName", e.external_id AS "externalId", e.occurred_at AS "occurredAt", e.payload, e.result
    FROM integration_events e LEFT JOIN integration_sources s ON s.id = e.source_id
    WHERE e.kind = 'order' AND e.status = 'processed' AND left(e.occurred_at, 10) < ${channel.startDate}
      ${from ? sql`AND left(e.occurred_at, 10) >= ${from}` : sql``}
      AND NOT EXISTS (SELECT 1 FROM channel_receivables r WHERE r.event_id = e.id AND r.channel_id = ${channel.id})
    ORDER BY e.occurred_at, e.id LIMIT 2000`);
  const rows: any[] = result?.rows ?? result ?? [];
  const list: LegacyOrder[] = [];
  for (const row of rows) {
    const payments: Array<{ method: string; amount: number }> = Array.isArray(row.payload?.payments) ? row.payload.payments : [];
    const amount = round2(payments.filter(p => methods.includes(normalizeMethod(p.method))).reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    if (!(amount > 0)) continue;
    list.push({
      eventId: Number(row.eventId), sourceId: Number(row.sourceId), sourceName: row.sourceName, ref: String(row.payload?.orderNumber || row.externalId),
      orderNumber: row.result?.salesOrderNumber ?? null, salesOrderId: row.result?.salesOrderId ?? null, entryDate: String(row.occurredAt).slice(0, 10), amount,
      // 舊記法已經先扣過的手續費：轉成欠款時要沖回，等撥款時再照實際的認列
      fee: round2(Number(row.payload?.paymentFee) || 0),
    });
  }
  return list;
}

/** 把選到的舊訂單轉成通路欠款：把當時提早記進銀行的錢轉回「通路欠款」，並沖回當時先扣的手續費 */
export async function convertLegacyOrders(tx: any, channel: PaymentChannel, eventIds: number[]): Promise<{ count: number; amount: number }> {
  if (!channel.startDate) throw new Error("這個通路還沒填啟用日");
  const wanted = new Set(eventIds);
  const targets = (await legacyOrders(tx, channel)).filter(o => wanted.has(o.eventId));
  if (targets.length === 0) throw new Error("沒有可以轉入的訂單（可能已經轉過了）");
  const receivable = await receivableAccount(tx, channel);
  let total = 0;
  for (const target of targets) {
    const [source] = await tx.select().from(integrationSourcesTable).where(eq(integrationSourcesTable.id, target.sourceId));
    const [order] = target.salesOrderId ? await tx.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, target.salesOrderId)) : [];
    const cash = await cashLineAccount(tx, source?.defaultCashAccountId ?? undefined);
    const fee = target.fee > 0 && target.fee < target.amount ? target.fee : 0;
    const projectId = order?.projectId ?? source?.defaultProjectId ?? null;
    const departmentId = order?.departmentId ?? source?.defaultDepartmentId ?? null;
    await postAutoJournal(tx, {
      key: `CL${target.eventId}`, entryDate: channel.startDate, action: "舊訂單轉通路欠款", projectId, departmentId,
      description: `自動分錄 - 訂單 ${target.ref} 轉為${channel.name}欠款（啟用日前收款、尚未撥款）`,
      lines: [
        { ...receivable, debit: target.amount, credit: 0, description: `${target.ref} ${channel.name}尚未撥款` },
        { ...cash, debit: 0, credit: round2(target.amount - fee), description: `${target.ref} 沖回提早記的收款` },
        ...(fee > 0 ? [{ accountName: "金流手續費", debit: 0, credit: fee, description: `${target.ref} 沖回先扣的手續費（撥款時照實際認列）` }] : []),
      ],
    });
    await addReceivable(tx, {
      channel, kind: "order", amount: target.amount, externalRef: target.ref, entryDate: target.entryDate, sourceId: target.sourceId, eventId: target.eventId,
      salesOrderId: target.salesOrderId, orderNumber: target.orderNumber, projectId, departmentId, expectedFee: fee,
    });
    total = round2(total + target.amount);
  }
  return { count: targets.length, amount: total };
}
