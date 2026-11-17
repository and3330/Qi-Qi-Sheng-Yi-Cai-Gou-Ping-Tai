import { and, eq, inArray, sql } from "drizzle-orm";
import {
  teachersTable, employeesTable, serviceFeesTable, salesOrdersTable, itemsTable, assetsTable, assetMovementsTable,
  integrationMappingsTable, integrationItemMapsTable, integrationEventsTable, storedValueLedgerTable,
  type IntegrationEvent, type IntegrationMapping, type IntegrationResult, type IntegrationSource,
} from "@workspace/erp-db";
import { itemUnitCost, nextMovingAvgCost, postAutoJournal, round2 } from "./inventory-journal";
import { cashLineAccount, leafAccount } from "./cash-accounts";
import { activeChannels, addReceivable, receivableAccount, splitByChannel } from "./payment-channels";
import { logStockMovement } from "./stock-ledger";
import { nextDocNumber } from "./doc-number";
import { INCOME_TYPES, serviceFeeProblem, suggestWithholding } from "./service-fees";
import { STORED_VALUE_METHOD, taxOf, type AssetMovementData, type ExpenseData, type OrderData, type PayoutData, type RefundData } from "./integration-format";

/** 收件匣其餘四種單據的入帳：人員報酬、退款、費用、資產異動 */

export async function findMapping(tx: any, sourceId: number, type: string): Promise<IntegrationMapping | undefined> {
  const mappings: IntegrationMapping[] = await tx.select().from(integrationMappingsTable).where(eq(integrationMappingsTable.sourceId, sourceId));
  return mappings.find(m => m.externalType === type) ?? mappings.find(m => m.externalType === "*");
}

/** 同一個來源、已經入帳的那張訂單 */
async function processedOrder(tx: any, sourceId: number, orderExternalId: string): Promise<{ event: IntegrationEvent; order: typeof salesOrdersTable.$inferSelect } | null> {
  const [event] = await tx.select().from(integrationEventsTable).where(and(
    eq(integrationEventsTable.sourceId, sourceId), eq(integrationEventsTable.kind, "order"), eq(integrationEventsTable.externalId, orderExternalId)));
  const orderId = event?.status === "processed" ? event.result?.salesOrderId : null;
  if (!orderId) return null;
  const [order] = await tx.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, orderId));
  return order ? { event, order } : null;
}

// ───────── 人員報酬 → 服務費 ─────────
async function resolvePayee(tx: any, source: IntegrationSource, payee: PayoutData["payee"]): Promise<{ payeeType: "teacher" | "employee"; id: number; name: string; departmentId: number | null }> {
  if (payee.kind === "employee") {
    // 員工一定要先在 ERP 建檔：薪資、投保都跟員工主檔有關，不能由外部系統新增
    const conditions = [payee.employeeNumber ? eq(employeesTable.employeeId, payee.employeeNumber) : null, payee.email ? sql`lower(${employeesTable.email}) = ${payee.email}` : null].filter(Boolean);
    for (const condition of conditions) {
      const [employee] = await tx.select().from(employeesTable).where(condition as any).limit(1);
      if (employee) return { payeeType: "employee", id: employee.id, name: `${employee.firstName}${employee.lastName}`, departmentId: employee.departmentId ?? null };
    }
    throw new Error(`找不到員工「${payee.name}」${payee.employeeNumber ? `（員工編號 ${payee.employeeNumber}）` : ""}。員工要先在 ERP 建檔，請確認員工編號或 Email 是否一致`);
  }
  // 外聘講師：依身分證字號、Email、電話找；都找不到才建檔
  for (const [column, value] of [[teachersTable.idNumber, payee.idNumber], [teachersTable.email, payee.email], [teachersTable.phone, payee.phone]] as const) {
    if (!value) continue;
    const [teacher] = await tx.select().from(teachersTable).where(sql`lower(${column}) = ${String(value).toLowerCase()}`).orderBy(teachersTable.id).limit(1);
    if (teacher) return { payeeType: "teacher", id: teacher.id, name: teacher.name, departmentId: null };
  }
  if (!payee.idNumber && !payee.email && !payee.phone) {
    // 沒有任何可以辨識的資料時只能用姓名比對，同名同姓會認錯人，所以要求至少給一項
    const [sameName] = await tx.select().from(teachersTable).where(eq(teachersTable.name, payee.name)).limit(2);
    if (sameName) return { payeeType: "teacher", id: sameName.id, name: sameName.name, departmentId: null };
  }
  const [created] = await tx.insert(teachersTable).values({
    teacherId: `${source.code.toUpperCase()}-${payee.externalId || Date.now().toString().slice(-8)}`.slice(0, 50),
    name: payee.name, email: payee.email ?? null, phone: payee.phone ?? null, idNumber: payee.idNumber ?? null,
    bankName: payee.bankName ?? null, bankAccountName: payee.bankAccountName ?? null, bankAccountNumber: payee.bankAccountNumber ?? null,
    notes: `由「${source.name}」的報酬單據自動建立`,
  }).returning();
  return { payeeType: "teacher", id: created.id, name: created.name, departmentId: null };
}

export async function processPayout(tx: any, source: IntegrationSource, event: IntegrationEvent, data: PayoutData): Promise<IntegrationResult> {
  if (!INCOME_TYPES[data.incomeType]) throw new Error(`所得類別「${data.incomeType}」無效，可用的有：${Object.keys(INCOME_TYPES).join("、")}`);
  const mapping = await findMapping(tx, source.id, data.type);
  let projectId = mapping?.projectId ?? source.defaultProjectId ?? null;
  let departmentId = mapping?.departmentId ?? source.defaultDepartmentId ?? null;
  // 有指定是哪一張訂單（哪個案子）的成本：掛到那張銷貨單上，並沿用它的專案
  let salesOrderId: number | null = null;
  if (data.orderExternalId) {
    const linked = await processedOrder(tx, source.id, data.orderExternalId);
    if (!linked) throw new Error(`這筆報酬指定的訂單「${data.orderExternalId}」還沒有入帳，請先處理那張訂單再重試`);
    if (linked.order.status === "Cancelled") throw new Error(`訂單「${data.orderExternalId}」已取消，不能再登錄成本`);
    salesOrderId = linked.order.id;
    projectId = linked.order.projectId ?? projectId;
    departmentId = linked.order.departmentId ?? departmentId;
  }
  if (!projectId) throw new Error(`「${source.name}」的報酬還沒設定要歸到哪個專案，請到「外部串接 → 訂單對應」設定（類型填 ${data.type}，或填 * 代表全部）`);

  const payee = await resolvePayee(tx, source, data.payee);
  departmentId = departmentId ?? payee.departmentId;
  // 代扣稅款與二代健保一律由 ERP 算，外部系統只送稅前金額
  const withholding = suggestWithholding({ incomeType: data.incomeType, amount: data.amount, payeeType: payee.payeeType });
  const problem = serviceFeeProblem({ amount: data.amount, withholdingTax: withholding.withholdingTax, nhiSupplement: withholding.nhiSupplement, hours: data.hours ?? null, rate: data.rate ?? null });
  if (problem) throw new Error(problem);

  const feeNumber = await nextDocNumber(tx, "service_fees", "fee_number", "SF", () => `SF-${String(Date.now()).slice(-8)}`, data.serviceDate);
  const [fee] = await tx.insert(serviceFeesTable).values({
    feeNumber, payeeType: payee.payeeType, payeeName: payee.name,
    teacherId: payee.payeeType === "teacher" ? payee.id : null, employeeId: payee.payeeType === "employee" ? payee.id : null,
    salesOrderId, projectId, departmentId, serviceDate: data.serviceDate,
    description: `${data.description || "報酬"}（${source.name} ${event.externalId}）`.slice(0, 500),
    hours: data.hours === undefined ? null : String(data.hours), rate: data.rate === undefined ? null : String(data.rate),
    amount: String(data.amount), incomeType: data.incomeType,
    withholdingTax: String(withholding.withholdingTax), nhiSupplement: String(withholding.nhiSupplement), netAmount: String(withholding.netAmount),
    createdBy: `integration:${source.code}`,
  }).returning();
  const journal = await postAutoJournal(tx, {
    key: `SF${fee.id}`, entryDate: data.serviceDate, action: "登錄服務費", projectId, departmentId,
    description: `自動分錄 - 服務費 ${feeNumber} ${payee.name}（${source.name}）`,
    lines: [
      { accountName: "勞務成本", debit: data.amount, credit: 0, description: `${feeNumber} ${payee.name} 服務費` },
      { accountName: "應付費用", debit: 0, credit: data.amount, description: `${feeNumber} 應付 ${payee.name}` },
    ],
  });
  await tx.update(serviceFeesTable).set({ journalEntryId: journal?.id ?? null }).where(eq(serviceFeesTable.id, fee.id));
  return {
    serviceFeeId: fee.id, serviceFeeNumber: feeNumber, ...(salesOrderId ? { salesOrderId } : {}), journalEntryNumbers: journal ? [journal.entryNumber] : [],
    summary: `服務費 ${feeNumber}：${payee.name} 應付 ${data.amount}，代扣稅 ${withholding.withholdingTax}、補充保費 ${withholding.nhiSupplement}，實付 ${withholding.netAmount}（到「服務費」付款）`,
  };
}

// ───────── 退款 ─────────
export async function processRefund(tx: any, source: IntegrationSource, event: IntegrationEvent, data: RefundData): Promise<IntegrationResult> {
  const original = await processedOrder(tx, source.id, data.orderExternalId);
  if (!original) throw new Error(`找不到已入帳的訂單「${data.orderExternalId}」。要先有訂單才能退款，請確認訂單是否還在收件匣沒處理`);
  const order = original.order, orderData = original.event.payload as OrderData;
  // 這張訂單之前已經退過多少（只算已入帳的退款）
  const previous = await tx.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::float AS refunded FROM integration_events
    WHERE source_id = ${source.id} AND kind = 'refund' AND status = 'processed' AND payload->>'orderExternalId' = ${data.orderExternalId} AND id <> ${event.id}`);
  const refundedBefore = round2(Number((previous.rows ?? previous)[0]?.refunded) || 0);
  const orderTotal = Number(order.totalAmount);
  if (refundedBefore + data.amount > orderTotal + 0.01) {
    throw new Error(`訂單 ${order.orderNumber} 金額 ${orderTotal}，已退 ${refundedBefore}，不能再退 ${data.amount}`);
  }

  const mapping = await findMapping(tx, source.id, orderData.type);
  const projectId = order.projectId, departmentId = order.departmentId;
  const { net, tax } = taxOf(data.amount, orderData.taxType);
  const toBalance = round2(data.refundTo.filter(p => p.method === STORED_VALUE_METHOD).reduce((sum, p) => sum + p.amount, 0));
  const toCash = round2(data.amount - toBalance);
  // 收入照原訂單「商品／服務」的比例沖回
  const orderItems = (Array.isArray(order.items) ? order.items : []) as Array<{ itemId: number | null; amount: number; isVirtual?: boolean; quantity: number; unitCost?: number }>;
  const physicalAmount = round2(orderItems.filter(i => i.isVirtual === false).reduce((sum, i) => sum + (Number(i.amount) || 0), 0));
  const goodsNet = orderTotal > 0 ? round2(net * (physicalAmount / orderTotal)) : 0;
  const revenueLines = mapping?.revenueAccountId
    ? [{ ...(await leafAccount(tx, mapping.revenueAccountId, "收入科目", ["Income"])), debit: net, credit: 0, description: `${order.orderNumber} 退款沖回收入` }]
    : [
      ...(goodsNet > 0 ? [{ accountName: "銷貨收入", debit: goodsNet, credit: 0, description: `${order.orderNumber} 退款沖回商品收入` }] : []),
      ...(round2(net - goodsNet) > 0 ? [{ accountName: "勞務收入", debit: round2(net - goodsNet), credit: 0, description: `${order.orderNumber} 退款沖回服務收入` }] : []),
    ];
  const cashAccount = await cashLineAccount(tx, source.defaultCashAccountId ?? undefined);
  // 經過金流通路退的錢，通路會從之後的撥款扣回：記成通路欠款減少（負數），撥款時一起沖
  const viaChannel = splitByChannel(await activeChannels(tx), data.refundTo.filter(p => p.method !== STORED_VALUE_METHOD), event.occurredAt);
  const directRefund = round2(toCash - viaChannel.byChannel.reduce((sum, part) => sum + part.amount, 0));
  const channelLines = [];
  for (const part of viaChannel.byChannel) {
    channelLines.push({ ...(await receivableAccount(tx, part.channel)), debit: 0, credit: part.amount, description: `${order.orderNumber} 退款（從${part.channel.name}撥款扣回）` });
  }
  const journals: string[] = [];
  const refundJournal = await postAutoJournal(tx, {
    key: `INT${event.id}`, entryDate: event.occurredAt, action: "外部訂單退款", projectId, departmentId,
    description: `自動分錄 - ${source.name} 訂單 ${order.orderNumber} 退款 ${data.amount}${data.reason ? `（${data.reason}）` : ""}`.slice(0, 300),
    lines: [
      ...revenueLines,
      ...(tax > 0 ? [{ accountName: "銷項稅額", debit: tax, credit: 0, description: `${order.orderNumber} 退款沖回銷項稅額` }] : []),
      ...channelLines,
      ...(directRefund > 0 ? [{ ...cashAccount, debit: 0, credit: directRefund, description: `${order.orderNumber} 退款` }] : []),
      ...(toBalance > 0 ? [{ accountName: "預收款項", debit: 0, credit: toBalance, description: `${order.orderNumber} 退回儲值餘額` }] : []),
    ],
  });
  if (refundJournal) journals.push(refundJournal.entryNumber);
  for (const part of viaChannel.byChannel) {
    await addReceivable(tx, {
      channel: part.channel, kind: "refund", amount: -part.amount, externalRef: (orderData.orderNumber as string | undefined) || data.orderExternalId, entryDate: event.occurredAt,
      sourceId: source.id, eventId: event.id, salesOrderId: order.id, orderNumber: order.orderNumber, projectId, departmentId,
    });
  }
  if (toBalance > 0) {
    await tx.insert(storedValueLedgerTable).values({ sourceId: source.id, customerId: order.customerId, amount: String(toBalance), entryType: "adjust", eventId: event.id, entryDate: event.occurredAt, note: `訂單 ${order.orderNumber} 退款退回餘額` });
  }

  // 退回倉庫的商品：照當初出貨的成本入庫，並把那筆銷貨成本轉回存貨
  let restockCost = 0;
  if (data.restock.length > 0) {
    const maps = await tx.select().from(integrationItemMapsTable).where(and(eq(integrationItemMapsTable.sourceId, source.id), inArray(integrationItemMapsTable.externalSku, data.restock.map(r => r.sku))));
    const itemIdBySku = new Map<string, number>(maps.map((m: { externalSku: string; itemId: number }) => [m.externalSku, m.itemId]));
    for (const line of data.restock) {
      const itemId = itemIdBySku.get(line.sku);
      const sold = orderItems.find(i => i.itemId === itemId && i.isVirtual === false);
      if (!itemId || !sold) throw new Error(`商品「${line.sku}」不在訂單 ${order.orderNumber} 出貨的實體商品裡，不能退回倉庫`);
      if (line.quantity > Number(sold.quantity) + 0.0001) throw new Error(`商品「${line.sku}」當初只出了 ${sold.quantity}，不能退回 ${line.quantity}`);
      const [item] = await tx.select().from(itemsTable).where(eq(itemsTable.id, itemId)).for("update");
      if (!item) throw new Error(`商品「${line.sku}」對應的品項已經不存在`);
      const unitCost = Number(sold.unitCost) || itemUnitCost(item);
      const cost = round2(line.quantity * unitCost);
      restockCost = round2(restockCost + cost);
      const stock = Number(item.currentStock || 0);
      await tx.update(itemsTable).set({
        currentStock: String(round2(stock + line.quantity)),
        ...(cost > 0 ? { movingAvgCost: nextMovingAvgCost(stock, Number(item.movingAvgCost || 0), line.quantity, cost).toFixed(4) } : {}),
      }).where(eq(itemsTable.id, itemId));
      await logStockMovement(tx, { direction: 1, itemId, quantity: line.quantity, rate: unitCost, remarks: `${source.name} 訂單 ${order.orderNumber} 退貨入庫`, source: "return", projectId });
    }
    const stockJournal = await postAutoJournal(tx, {
      key: `INT${event.id}-C`, entryDate: event.occurredAt, action: "外部訂單退貨", projectId, departmentId,
      description: `自動分錄 - ${source.name} 訂單 ${order.orderNumber} 退貨入庫`,
      lines: [
        { accountName: "存貨", debit: restockCost, credit: 0, description: `${order.orderNumber} 退貨入庫` },
        { accountName: "銷貨成本", debit: 0, credit: restockCost, description: `${order.orderNumber} 沖回銷貨成本` },
      ],
    });
    if (stockJournal) journals.push(stockJournal.entryNumber);
  }
  const refundedTotal = round2(refundedBefore + data.amount);
  await tx.update(salesOrdersTable).set({ remarks: `${order.remarks ? order.remarks + "；" : ""}已退款 ${data.amount}（累計 ${refundedTotal}）`.slice(0, 500) }).where(eq(salesOrdersTable.id, order.id));
  return {
    salesOrderId: order.id, salesOrderNumber: order.orderNumber, customerId: order.customerId, journalEntryNumbers: journals,
    summary: `訂單 ${order.orderNumber} 退款 ${data.amount}（累計 ${refundedTotal} / ${orderTotal}）${toBalance > 0 ? `，其中 ${toBalance} 退回儲值餘額` : ""}${restockCost > 0 ? `，退貨入庫成本 ${restockCost}` : ""}`,
  };
}

// ───────── 費用 ─────────
export async function processExpense(tx: any, source: IntegrationSource, event: IntegrationEvent, data: ExpenseData): Promise<IntegrationResult> {
  const mapping = await findMapping(tx, source.id, data.type);
  const projectId = mapping?.projectId ?? source.defaultProjectId ?? null;
  const departmentId = mapping?.departmentId ?? source.defaultDepartmentId ?? null;
  if (!projectId) throw new Error(`「${source.name}」的「${data.type}」費用還沒設定要歸到哪個專案，請到「外部串接 → 訂單對應」設定`);
  if (!mapping?.expenseAccountId) throw new Error(`「${source.name}」的「${data.type}」費用還沒設定要記到哪個費用科目，請到「外部串接 → 訂單對應」新增類型「${data.type}」並選費用科目`);
  const expenseAccount = await leafAccount(tx, mapping.expenseAccountId, "費用科目", ["Expense"]);
  const net = round2(data.amount - data.taxAmount);
  const journal = await postAutoJournal(tx, {
    key: `INT${event.id}`, entryDate: event.occurredAt, action: "外部費用入帳", projectId, departmentId,
    description: `自動分錄 - ${source.name} 費用：${data.description}${data.payee ? `（${data.payee}）` : ""}`.slice(0, 300),
    lines: [
      { ...expenseAccount, debit: net, credit: 0, description: data.description },
      ...(data.taxAmount > 0 ? [{ accountName: "進項稅額", debit: data.taxAmount, credit: 0, description: `${data.description} 進項稅額` }] : []),
      data.paid
        ? { ...(await cashLineAccount(tx, source.defaultCashAccountId ?? undefined)), debit: 0, credit: data.amount, description: `${data.description} 付款` }
        : { accountName: "應付帳款", debit: 0, credit: data.amount, description: `${data.description} 應付` },
    ],
  });
  return { journalEntryNumbers: journal ? [journal.entryNumber] : [], summary: `${expenseAccount.accountName} ${net}${data.taxAmount > 0 ? `、進項稅 ${data.taxAmount}` : ""}（${data.paid ? "已付款" : "記應付帳款"}）` };
}

// ───────── 資產異動（租借、歸還、換地點）─────────
export async function processAssetMovement(tx: any, source: IntegrationSource, event: IntegrationEvent, data: AssetMovementData): Promise<IntegrationResult> {
  const candidates = await tx.select().from(assetsTable).where(data.assetNumber ? eq(assetsTable.assetNumber, data.assetNumber) : eq(assetsTable.serialNumber, data.serialNumber!)).for("update");
  if (candidates.length === 0) throw new Error(`ERP 找不到${data.assetNumber ? `資產編號「${data.assetNumber}」` : `序號「${data.serialNumber}」`}的資產。請先在「資產管理」建檔，或確認兩邊的編號一致`);
  if (candidates.length > 1) throw new Error(`序號「${data.serialNumber}」對到 ${candidates.length} 項資產，請改用資產編號`);
  const asset = candidates[0];
  if (asset.status === "Scrapped" || asset.status === "Sold") throw new Error(`資產「${asset.name}」已經報廢或出售，不能再異動`);
  const toLocation = data.action === "checkout"
    ? `借出：${data.holder}${data.location ? `／${data.location}` : ""}`
    : data.action === "return" ? (data.location || "已歸還") : data.location!;
  const label = { checkout: "借出", return: "歸還", transfer: "換地點" }[data.action];
  await tx.insert(assetMovementsTable).values({
    assetId: asset.id, fromDepartmentId: asset.departmentId, toDepartmentId: asset.departmentId,
    fromLocation: asset.location, toLocation: toLocation.slice(0, 200), movementDate: event.occurredAt,
    reason: `${label}（${source.name} ${event.externalId}）${data.note ? "：" + data.note : ""}`.slice(0, 300), performedBy: source.name,
  });
  await tx.update(assetsTable).set({ location: toLocation.slice(0, 200) }).where(eq(assetsTable.id, asset.id));
  return { assetId: asset.id, summary: `${asset.name}（${asset.assetNumber}）${label}：${asset.location || "未填"} → ${toLocation}` };
}
