import { and, eq, inArray, sql } from "drizzle-orm";
import {
  customersTable, itemsTable, salesOrdersTable, orderTemplatesTable, integrationSourcesTable, integrationMappingsTable, integrationItemMapsTable,
  integrationEventsTable, storedValueLedgerTable, type IntegrationEvent, type IntegrationResult, type IntegrationSource,
} from "@workspace/erp-db";
import { itemUnitCost, postAutoJournal, round2 } from "./inventory-journal";
import { cashLineAccount, leafAccount } from "./cash-accounts";
import { activeChannels, addReceivable, receivableAccount, splitByChannel } from "./payment-channels";
import { logStockMovement } from "./stock-ledger";
import { logger } from "./logger";
import { processAssetMovement, processExpense, processPayout, processRefund } from "./integration-process-more";
import { KIND_LABEL, STORED_VALUE_METHOD, SUPPORTED_KINDS, allocateLines, paymentSplit, taxOf, type EventKind, type AssetMovementData, type ExpenseData, type OrderData, type Party, type PayoutData, type RefundData, type StoredValueData } from "./integration-format";

/**
 * 把收件匣裡的一筆外部單據變成 ERP 的單據與分錄。
 * 一筆單據的所有動作在同一個交易裡完成：任何一步失敗就整筆不算，收件匣留著原因等人處理後重試。
 */

/** 這種單據還沒開放自動入帳：不是錯誤，留在「待處理」 */
export class NotSupportedYet extends Error {}

async function findOrCreateCustomer(tx: any, party: Party): Promise<{ id: number; name: string }> {
  // 先用 Email 找，再用電話找；都找不到才建新客戶，同一個人不會重複建檔
  for (const [column, value] of [[customersTable.email, party.email], [customersTable.phone, party.phone]] as const) {
    if (!value) continue;
    const [found] = await tx.select({ id: customersTable.id, name: customersTable.name }).from(customersTable)
      .where(sql`lower(${column}) = ${String(value).toLowerCase()}`).orderBy(customersTable.id).limit(1);
    if (found) return found;
  }
  const [created] = await tx.insert(customersTable).values({
    name: party.name, email: party.email ?? null, phone: party.phone ?? null, taxId: party.taxId ?? null,
  }).returning({ id: customersTable.id, name: customersTable.name });
  return created;
}

/** 會員目前的儲值餘額（明細加總） */
export async function storedValueBalance(tx: any, sourceId: number, customerId: number): Promise<number> {
  const result = await tx.execute(sql`SELECT COALESCE(SUM(amount), 0)::float AS balance FROM stored_value_ledger WHERE source_id = ${sourceId} AND customer_id = ${customerId}`);
  return round2(Number((result.rows ?? result)[0]?.balance) || 0);
}

async function processOrder(tx: any, source: IntegrationSource, event: IntegrationEvent, data: OrderData): Promise<IntegrationResult> {
  const mappings = await tx.select().from(integrationMappingsTable).where(eq(integrationMappingsTable.sourceId, source.id));
  const mapping = mappings.find((m: { externalType: string }) => m.externalType === data.type) ?? mappings.find((m: { externalType: string }) => m.externalType === "*");
  // 這一類訂單指定的銷貨訂單模組（居家、活動、課程…）：停用或已刪除的模組不套
  const [template] = mapping?.templateId
    ? await tx.select().from(orderTemplatesTable).where(and(eq(orderTemplatesTable.id, mapping.templateId), eq(orderTemplatesTable.isActive, true)))
    : [];
  // 專案：對應表指定的優先，其次是模組綁定的專案，最後才是來源的預設專案
  const projectId = mapping?.projectId ?? template?.projectId ?? source.defaultProjectId;
  const departmentId = mapping?.departmentId ?? source.defaultDepartmentId ?? null;
  if (!projectId) throw new Error(`「${source.name}」的「${data.type}」訂單還沒設定要歸到哪個專案，請到「外部串接 → 訂單對應」設定`);

  // 明細對到 ERP 品項：有商品編號就查品項對應，查不到用這類訂單的預設品項
  const lines = allocateLines(data);
  const skus = [...new Set(lines.map(l => l.sku).filter((s): s is string => !!s))];
  const itemMaps = skus.length > 0
    ? await tx.select().from(integrationItemMapsTable).where(and(eq(integrationItemMapsTable.sourceId, source.id), inArray(integrationItemMapsTable.externalSku, skus)))
    : [];
  const itemIdBySku = new Map<string, number>(itemMaps.map((m: { externalSku: string; itemId: number }) => [m.externalSku, m.itemId]));
  const unmapped = lines.filter(l => !l.isShipping && !(l.sku && itemIdBySku.has(l.sku)) && !mapping?.defaultItemId);
  if (unmapped.length > 0) {
    throw new Error(`有商品還沒對應到 ERP 的品項：${unmapped.map(l => `${l.name}${l.sku ? `（${l.sku}）` : "（沒有商品編號）"}`).join("、")}。請到「外部串接 → 品項對應」設定，或替這類訂單設定預設品項`);
  }
  const itemIds = [...new Set(lines.map(l => (l.sku && itemIdBySku.get(l.sku)) || mapping?.defaultItemId).filter((id): id is number => !!id))];
  const itemRows = itemIds.length > 0
    ? await tx.select().from(itemsTable).where(inArray(itemsTable.id, itemIds)).orderBy(itemsTable.id).for("update")
    : [];
  const itemById = new Map<number, typeof itemsTable.$inferSelect>(itemRows.map((i: typeof itemsTable.$inferSelect) => [i.id, i]));

  const customer = await findOrCreateCustomer(tx, data.buyer);
  const orderItems = lines.map(line => {
    const itemId = (line.sku && itemIdBySku.get(line.sku)) || (line.isShipping ? null : mapping?.defaultItemId) || null;
    const item = itemId ? itemById.get(itemId) : undefined;
    if (itemId && !item) throw new Error(`對應的品項已經不存在（${line.name}），請重新設定品項對應`);
    // 實體商品才扣庫存：必須是用商品編號明確對到的品項，預設品項只當分類用
    const physical = !!item && !item.isVirtual && !!line.sku && itemIdBySku.has(line.sku);
    return {
      itemId, itemName: item ? item.itemName : line.name, quantity: line.quantity, rate: line.unitPrice, amount: line.amount,
      isVirtual: !physical, summary: item && item.itemName !== line.name ? line.name : null, physical, unitCost: physical ? itemUnitCost(item) : 0,
    };
  });

  // 訂單：外部系統已經收款、已經成立，進來就是完成狀態
  const orderNumber = `${source.code.toUpperCase()}-${data.orderNumber || event.externalId}`.slice(0, 60);
  const [order] = await tx.insert(salesOrdersTable).values({
    orderNumber, customerId: customer.id, orderDate: event.occurredAt, status: "Completed",
    totalAmount: String(data.total), projectId, departmentId, orderSource: source.code, templateId: template?.id ?? null,
    items: orderItems.map(({ physical: _physical, ...item }) => item),
    remarks: data.note ?? null,
    extraFields: { integrationEventId: event.id, externalType: data.type, externalOrderNumber: data.orderNumber ?? event.externalId, payments: data.payments, invoiceNumber: data.invoiceNumber ?? null, taxType: data.taxType },
  }).returning({ id: salesOrdersTable.id, orderNumber: salesOrdersTable.orderNumber });

  // 收入分錄：實際收到的錢進銀行，用餘額付的部分沖掉預收款項；收入記未稅，稅額另記
  const { storedValue, cash } = paymentSplit(data.payments);
  const { net, tax } = taxOf(data.total, data.taxType);
  const fee = round2(data.paymentFee ?? 0);
  const customerBalance = storedValue > 0 ? await storedValueBalance(tx, source.id, customer.id) : 0;
  if (storedValue > customerBalance + 0.01) {
    throw new Error(`「${customer.name}」用餘額付了 ${storedValue}，但帳上的儲值餘額只有 ${customerBalance}。請確認儲值紀錄是不是還沒送進來`);
  }
  const cashAccount = await cashLineAccount(tx, source.defaultCashAccountId ?? undefined);
  // 經過金流通路收的錢還在通路手上：先掛通路欠款（全額），等撥款進銀行再沖掉、認列實際的手續費
  const viaChannel = splitByChannel(await activeChannels(tx), data.payments.filter(p => p.method !== STORED_VALUE_METHOD), event.occurredAt);
  const onChannel = viaChannel.byChannel.length > 0;
  const directCash = onChannel ? viaChannel.direct : cash;
  const directFee = onChannel ? 0 : fee;
  const channelLines = [];
  for (const part of viaChannel.byChannel) {
    channelLines.push({ ...(await receivableAccount(tx, part.channel)), debit: part.amount, credit: 0, description: `${orderNumber} 收款（${part.channel.name}待撥款）` });
  }
  const physicalAmount = round2(orderItems.filter(i => i.physical).reduce((sum, i) => sum + i.amount, 0));
  const goodsNet = data.total > 0 ? round2(net * (physicalAmount / data.total)) : 0;
  const revenueLines = mapping?.revenueAccountId
    ? [{ ...(await leafAccount(tx, mapping.revenueAccountId, "收入科目", ["Income"])), debit: 0, credit: net, description: `${orderNumber} 收入（未稅）` }]
    : [
      ...(goodsNet > 0 ? [{ accountName: "銷貨收入", debit: 0, credit: goodsNet, description: `${orderNumber} 商品收入（未稅）` }] : []),
      ...(round2(net - goodsNet) > 0 ? [{ accountName: "勞務收入", debit: 0, credit: round2(net - goodsNet), description: `${orderNumber} 服務收入（未稅）` }] : []),
    ];
  const journals: string[] = [];
  const revenueJournal = await postAutoJournal(tx, {
    key: `INT${event.id}`, entryDate: event.occurredAt, action: "外部訂單入帳", projectId, departmentId,
    description: `自動分錄 - ${source.name} 訂單 ${orderNumber}（${customer.name}）`,
    lines: [
      ...channelLines,
      ...(round2(directCash - directFee) > 0 ? [{ ...cashAccount, debit: round2(directCash - directFee), credit: 0, description: `${orderNumber} 收款${directFee > 0 ? "（已扣金流手續費）" : ""}` }] : []),
      ...(directFee > 0 ? [{ accountName: "金流手續費", debit: directFee, credit: 0, description: `${orderNumber} 金流手續費` }] : []),
      ...(storedValue > 0 ? [{ accountName: "預收款項", debit: storedValue, credit: 0, description: `${orderNumber} 以儲值餘額付款` }] : []),
      ...revenueLines,
      ...(tax > 0 ? [{ accountName: "銷項稅額", debit: 0, credit: tax, description: `${orderNumber} 銷項稅額` }] : []),
    ],
  });
  if (revenueJournal) {
    journals.push(revenueJournal.entryNumber);
    // 掛在銷貨單上，之後系統就知道這張單已經入過帳，不會再認列一次
    await tx.update(salesOrdersTable).set({ journalEntryId: revenueJournal.id }).where(eq(salesOrdersTable.id, order.id));
  }
  if (storedValue > 0) {
    await tx.insert(storedValueLedgerTable).values({ sourceId: source.id, customerId: customer.id, amount: String(-storedValue), entryType: "spend", eventId: event.id, entryDate: event.occurredAt, note: `訂單 ${orderNumber}` });
  }
  for (const [index, part] of viaChannel.byChannel.entries()) {
    await addReceivable(tx, {
      channel: part.channel, kind: "order", amount: part.amount, externalRef: data.orderNumber || event.externalId, entryDate: event.occurredAt,
      sourceId: source.id, eventId: event.id, salesOrderId: order.id, orderNumber, projectId, departmentId,
      // 來源網站回報的手續費只留著比對，實際扣多少以撥款明細為準
      expectedFee: index === 0 ? fee : null,
    });
  }

  // 實體商品：扣庫存並認列銷貨成本
  const physicalQty = new Map<number, number>();
  for (const item of orderItems) if (item.physical && item.itemId) physicalQty.set(item.itemId, (physicalQty.get(item.itemId) || 0) + item.quantity);
  let cogs = 0;
  for (const [itemId, quantity] of [...physicalQty].sort(([a], [b]) => a - b)) {
    const item = itemById.get(itemId)!;
    const stock = Number(item.currentStock || 0);
    if (stock + 0.0001 < quantity) throw new Error(`「${item.itemName}」庫存只有 ${stock}，不夠出 ${quantity}。請先補進貨或盤點，再按「重試」`);
    const unitCost = itemUnitCost(item);
    cogs = round2(cogs + quantity * unitCost);
    await tx.update(itemsTable).set({ currentStock: String(round2(stock - quantity)) }).where(eq(itemsTable.id, itemId));
    await logStockMovement(tx, { direction: -1, itemId, quantity, rate: unitCost, remarks: `${source.name} 訂單 ${orderNumber} 出貨`, source: "delivery", projectId });
  }
  const cogsJournal = await postAutoJournal(tx, {
    key: `INT${event.id}-C`, entryDate: event.occurredAt, action: "外部訂單出貨", projectId, departmentId,
    description: `自動分錄 - ${source.name} 訂單 ${orderNumber} 銷貨成本`,
    lines: [
      { accountName: "銷貨成本", debit: cogs, credit: 0, description: `${orderNumber} 出貨成本` },
      { accountName: "存貨", debit: 0, credit: cogs, description: `${orderNumber} 存貨減少` },
    ],
  });
  if (cogsJournal) journals.push(cogsJournal.entryNumber);

  // 有商品編號卻沒設定品項對應的明細：用預設品項入帳但不會扣庫存，在結果裡提醒
  const notDeducted = lines.filter(l => !l.isShipping && l.sku && !itemIdBySku.has(l.sku)).length;
  return {
    salesOrderId: order.id, salesOrderNumber: order.orderNumber, customerId: customer.id, journalEntryNumbers: journals,
    ...(storedValue > 0 ? { storedValueBalance: round2(customerBalance - storedValue) } : {}),
    summary: `銷貨單 ${order.orderNumber}，收入 ${net}${tax > 0 ? `、稅 ${tax}` : ""}${cogs > 0 ? `、成本 ${cogs}` : ""}${onChannel ? `；${viaChannel.byChannel.map(p => `${p.channel.name}待撥款 ${p.amount}`).join("、")}` : ""}${notDeducted > 0 ? `；有 ${notDeducted} 筆帶商品編號的明細沒有對到品項，沒有扣庫存` : ""}`,
  };
}

async function processStoredValue(tx: any, source: IntegrationSource, event: IntegrationEvent, data: StoredValueData): Promise<IntegrationResult> {
  const customer = await findOrCreateCustomer(tx, data.member);
  const projectId = source.defaultProjectId ?? null;
  const cashAccount = await cashLineAccount(tx, source.defaultCashAccountId ?? undefined);
  const balance = await storedValueBalance(tx, source.id, customer.id);
  const topup = data.action === "topup";
  if (!topup && data.amount > balance + 0.01) throw new Error(`「${customer.name}」要退 ${data.amount}，但帳上的儲值餘額只有 ${balance}`);
  // 儲值不是收入：收到的錢記成預收款項（欠會員的），會員消費時才轉成收入
  const channel = splitByChannel(await activeChannels(tx), data.paymentMethod ? [{ method: data.paymentMethod, amount: data.amount }] : [], event.occurredAt).byChannel[0]?.channel ?? null;
  const moneyAccount = channel ? await receivableAccount(tx, channel) : cashAccount;
  const journal = await postAutoJournal(tx, {
    key: `INT${event.id}`, entryDate: event.occurredAt, action: topup ? "會員儲值入帳" : "退還儲值金", projectId, departmentId: source.defaultDepartmentId ?? null,
    description: `自動分錄 - ${source.name} ${customer.name} ${topup ? "儲值" : "退還儲值金"} ${data.amount}`,
    lines: topup
      ? [{ ...moneyAccount, debit: data.amount, credit: 0, description: channel ? `會員儲值收款（${channel.name}待撥款）` : "會員儲值收款" }, { accountName: "預收款項", debit: 0, credit: data.amount, description: `${customer.name} 儲值金` }]
      : [{ accountName: "預收款項", debit: data.amount, credit: 0, description: `${customer.name} 退還儲值金` }, { ...moneyAccount, debit: 0, credit: data.amount, description: channel ? `退還儲值金（從${channel.name}撥款扣回）` : "退還儲值金" }],
  });
  if (channel) {
    await addReceivable(tx, {
      channel, kind: topup ? "topup" : "refund", amount: topup ? data.amount : -data.amount, externalRef: event.externalId, entryDate: event.occurredAt,
      sourceId: source.id, eventId: event.id, projectId, departmentId: source.defaultDepartmentId ?? null,
    });
  }
  await tx.insert(storedValueLedgerTable).values({
    sourceId: source.id, customerId: customer.id, amount: String(topup ? data.amount : -data.amount), entryType: topup ? "topup" : "refund",
    eventId: event.id, entryDate: event.occurredAt, note: data.note ?? null,
  });
  const newBalance = round2(balance + (topup ? data.amount : -data.amount));
  return { customerId: customer.id, journalEntryNumbers: journal ? [journal.entryNumber] : [], storedValueBalance: newBalance, summary: `${customer.name} 儲值餘額 ${balance} → ${newBalance}` };
}

/**
 * 處理一筆收件匣的單據。成功回傳更新後的紀錄；失敗把原因寫回收件匣（不拋錯）。
 * runInTransaction 由呼叫端提供，讓這裡不用知道資料庫連線怎麼來。
 */
export async function processEvent(
  database: { transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>; update: any },
  eventId: number,
  actor: string,
): Promise<IntegrationEvent> {
  try {
    return await database.transaction(async (tx) => {
      const [event] = await tx.select().from(integrationEventsTable).where(eq(integrationEventsTable.id, eventId)).for("update");
      if (!event) throw new Error("找不到這筆單據");
      if (event.status === "processed") return event;
      if (event.status === "ignored") throw new Error("這筆單據已經標成略過，請先取消略過");
      const [source] = await tx.select().from(integrationSourcesTable).where(eq(integrationSourcesTable.id, event.sourceId));
      if (!source) throw new Error("這筆單據的來源已經被刪除");
      if (!SUPPORTED_KINDS.includes(event.kind as EventKind)) {
        throw new NotSupportedYet(`「${KIND_LABEL[event.kind as EventKind] ?? event.kind}」已經收到，自動入帳的功能還沒開放，先留在收件匣`);
      }
      let result: IntegrationResult;
      switch (event.kind as EventKind) {
        case "order": result = await processOrder(tx, source, event, event.payload as OrderData); break;
        case "stored_value": result = await processStoredValue(tx, source, event, event.payload as StoredValueData); break;
        case "payout": result = await processPayout(tx, source, event, event.payload as PayoutData); break;
        case "refund": result = await processRefund(tx, source, event, event.payload as RefundData); break;
        case "expense": result = await processExpense(tx, source, event, event.payload as ExpenseData); break;
        default: result = await processAssetMovement(tx, source, event, event.payload as AssetMovementData);
      }
      const [updated] = await tx.update(integrationEventsTable).set({
        status: "processed", error: null, result, attempts: event.attempts + 1, processedAt: new Date(), processedBy: actor,
      }).where(eq(integrationEventsTable.id, eventId)).returning();
      return updated;
    });
  } catch (err: any) {
    const waiting = err instanceof NotSupportedYet;
    if (!waiting) logger.warn({ eventId, err: err?.message }, "integration event processing failed");
    const message = /[㐀-鿿]/.test(err?.message || "") ? String(err.message).slice(0, 500) : "系統處理時發生錯誤，請稍後重試；一直失敗的話請回報";
    const [updated] = await database.update(integrationEventsTable).set({
      status: waiting ? "pending" : "failed", error: message, attempts: sql`${integrationEventsTable.attempts} + 1`,
    }).where(and(eq(integrationEventsTable.id, eventId), sql`${integrationEventsTable.status} NOT IN ('processed', 'ignored')`)).returning();
    if (!updated) throw err;
    return updated;
  }
}
