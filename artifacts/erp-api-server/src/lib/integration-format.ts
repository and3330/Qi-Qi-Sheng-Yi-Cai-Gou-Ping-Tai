/**
 * 外部系統送資料進來的標準格式（純檢查與整理，不碰資料庫）。
 * 所有網站都用這一種格式，ERP 才不用為每個網站各寫一套。
 */

export const EVENT_KINDS = ["order", "stored_value", "refund", "expense", "payout", "asset_movement"] as const;
export type EventKind = typeof EVENT_KINDS[number];
/** 會自動入帳的單據 */
export const SUPPORTED_KINDS: readonly EventKind[] = ["order", "stored_value", "refund", "expense", "payout", "asset_movement"];

export const KIND_LABEL: Record<EventKind, string> = {
  order: "訂單", stored_value: "儲值", refund: "退款", expense: "費用", payout: "人員報酬", asset_movement: "資產異動",
};

export interface Party { externalId?: string; name: string; email?: string; phone?: string; taxId?: string }
export interface OrderLine { sku?: string; name: string; quantity: number; unitPrice: number; amount: number }
export interface OrderPayment { method: string; amount: number }
export interface OrderData {
  orderNumber?: string;
  type: string;
  buyer: Party;
  lines: OrderLine[];
  shippingFee: number;
  discount: number;
  total: number;
  taxType: "taxable" | "zero_rated" | "exempt";
  payments: OrderPayment[];
  /** 金流手續費：金流商先扣掉、沒有真的進到銀行的部分 */
  paymentFee?: number;
  invoiceNumber?: string;
  note?: string;
}
export interface StoredValueData { action: "topup" | "refund"; member: Party; amount: number; paymentMethod?: string; note?: string }
/** 人員報酬（講師費、派遣費）：只送應付金額，代扣稅款與補充保費由 ERP 算 */
export interface PayoutData {
  type: string;
  payee: { kind: "teacher" | "employee"; name: string; externalId?: string; employeeNumber?: string; idNumber?: string; email?: string; phone?: string; bankName?: string; bankAccountName?: string; bankAccountNumber?: string };
  serviceDate: string;
  description?: string;
  hours?: number;
  rate?: number;
  amount: number;
  incomeType: string;
  orderExternalId?: string;
}
/** 退款：退哪一張訂單、退多少、退到哪裡（刷退或退回儲值餘額）、哪些商品退回倉庫 */
export interface RefundData { orderExternalId: string; amount: number; refundTo: OrderPayment[]; restock: Array<{ sku: string; quantity: number }>; reason?: string }
export interface ExpenseData { type: string; description: string; amount: number; taxAmount: number; paid: boolean; payee?: string }
export interface AssetMovementData { assetNumber?: string; serialNumber?: string; action: "checkout" | "return" | "transfer"; holder?: string; location?: string; note?: string }

export interface NormalizedEvent {
  source: string;
  kind: EventKind;
  externalId: string;
  occurredAt: string;
  amount: number;
  summary: string;
  data: OrderData | StoredValueData | PayoutData | RefundData | ExpenseData | AssetMovementData;
}

export const STORED_VALUE_METHOD = "stored_value";
const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
const text = (value: unknown, max = 200): string => (typeof value === "string" ? value.trim().slice(0, max) : typeof value === "number" ? String(value) : "");
const isDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

function party(raw: any, label: string): Party | string {
  const name = text(raw?.name, 100);
  if (!name) return `${label}的姓名（name）必填`;
  const email = text(raw?.email, 200).toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return `${label}的 Email 格式不正確`;
  return { name, ...(email ? { email } : {}), ...(text(raw?.phone, 40) ? { phone: text(raw.phone, 40) } : {}), ...(text(raw?.externalId, 100) ? { externalId: text(raw.externalId, 100) } : {}), ...(text(raw?.taxId, 20) ? { taxId: text(raw.taxId, 20) } : {}) };
}

function orderData(raw: any): OrderData | string {
  const type = text(raw?.type, 50);
  if (!type) return "訂單類型（type）必填，例如 product、course、service、ticket";
  const buyer = party(raw?.buyer, "買家");
  if (typeof buyer === "string") return buyer;
  if (!Array.isArray(raw?.lines) || raw.lines.length === 0) return "訂單至少要有一筆明細（lines）";
  const lines: OrderLine[] = [];
  for (const [index, line] of raw.lines.entries()) {
    const name = text(line?.name, 200);
    const quantity = Number(line?.quantity), unitPrice = Number(line?.unitPrice);
    if (!name) return `第 ${index + 1} 筆明細缺少品名（name）`;
    if (!Number.isFinite(quantity) || quantity <= 0) return `第 ${index + 1} 筆明細的數量必須大於 0`;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return `第 ${index + 1} 筆明細的單價不能是負數`;
    const amount = line?.amount !== undefined ? Number(line.amount) : quantity * unitPrice;
    if (!Number.isFinite(amount) || amount < 0) return `第 ${index + 1} 筆明細的金額不正確`;
    lines.push({ name, quantity, unitPrice: round2(unitPrice), amount: round2(amount), ...(text(line?.sku, 100) ? { sku: text(line.sku, 100) } : {}) });
  }
  const shippingFee = round2(raw?.shippingFee ?? 0), discount = round2(raw?.discount ?? 0), total = round2(raw?.total);
  if (shippingFee < 0 || discount < 0) return "運費與折扣不能是負數";
  if (!Number.isFinite(Number(raw?.total)) || total <= 0) return "訂單總額（total）必須大於 0";
  const expected = round2(lines.reduce((sum, l) => sum + l.amount, 0) + shippingFee - discount);
  if (Math.abs(expected - total) > 1) return `訂單總額 ${total} 跟「明細合計 ＋ 運費 − 折扣」${expected} 對不起來`;
  const taxType = raw?.taxType === undefined ? "taxable" : raw.taxType;
  if (!["taxable", "zero_rated", "exempt"].includes(taxType)) return "稅別（taxType）只能是 taxable、zero_rated、exempt";
  if (!Array.isArray(raw?.payments) || raw.payments.length === 0) return "請提供付款方式（payments），外部訂單必須是已付款的";
  const payments: OrderPayment[] = [];
  for (const payment of raw.payments) {
    const method = text(payment?.method, 40), amount = round2(payment?.amount);
    if (!method) return "付款方式（method）必填，用餘額付款請填 stored_value";
    if (!(amount > 0)) return "每一筆付款金額必須大於 0";
    payments.push({ method, amount });
  }
  const paid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
  if (Math.abs(paid - total) > 0.01) return `付款合計 ${paid} 不等於訂單總額 ${total}`;
  const paymentFee = round2(raw?.paymentFee ?? 0);
  const paidInCash = round2(payments.filter(p => p.method !== STORED_VALUE_METHOD).reduce((sum, p) => sum + p.amount, 0));
  if (paymentFee < 0 || (paymentFee > 0 && paymentFee >= paidInCash)) return "金流手續費（paymentFee）不能是負數，也不能大於或等於實際收款金額";
  return {
    type, buyer, lines, shippingFee, discount, total, taxType, payments,
    ...(paymentFee > 0 ? { paymentFee } : {}),
    ...(text(raw?.orderNumber, 60) ? { orderNumber: text(raw.orderNumber, 60) } : {}),
    ...(text(raw?.invoiceNumber, 30) ? { invoiceNumber: text(raw.invoiceNumber, 30) } : {}),
    ...(text(raw?.note, 300) ? { note: text(raw.note, 300) } : {}),
  };
}

function storedValueData(raw: any): StoredValueData | string {
  const action = raw?.action === undefined ? "topup" : raw.action;
  if (action !== "topup" && action !== "refund") return "儲值動作（action）只能是 topup（儲值）或 refund（退還儲值金）";
  const member = party(raw?.member, "會員");
  if (typeof member === "string") return member;
  const amount = round2(raw?.amount);
  if (!(amount > 0)) return "儲值金額必須大於 0（贈送的點數不是收到的錢，不要算進來）";
  return { action, member, amount, ...(text(raw?.paymentMethod, 40) ? { paymentMethod: text(raw.paymentMethod, 40) } : {}), ...(text(raw?.note, 300) ? { note: text(raw.note, 300) } : {}) };
}

function payoutData(raw: any, occurredAt: string): PayoutData | string {
  const kind = raw?.payee?.kind === "employee" ? "employee" : raw?.payee?.kind === "teacher" || raw?.payee?.kind === undefined ? "teacher" : null;
  if (!kind) return "對象種類（payee.kind）只能是 teacher（外聘講師）或 employee（員工）";
  const name = text(raw?.payee?.name, 100);
  if (!name) return "領款人姓名（payee.name）必填";
  const email = text(raw?.payee?.email, 200).toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "領款人的 Email 格式不正確";
  const serviceDate = text(raw?.serviceDate, 40).slice(0, 10) || occurredAt;
  if (!isDate(serviceDate)) return "服務日期（serviceDate）格式要是 YYYY-MM-DD";
  const hours = raw?.hours === undefined || raw.hours === null ? undefined : Number(raw.hours);
  const rate = raw?.rate === undefined || raw.rate === null ? undefined : Number(raw.rate);
  if (hours !== undefined && !(hours > 0)) return "時數必須大於 0";
  if (rate !== undefined && !(rate >= 0)) return "鐘點費不能是負數";
  const amount = round2(raw?.amount ?? (hours !== undefined && rate !== undefined ? hours * rate : 0));
  if (!(amount > 0)) return "應付金額（amount）必須大於 0；只送稅前的應付金額，代扣由 ERP 計算";
  const optional = (key: string, max: number) => (text(raw?.payee?.[key], max) ? { [key]: text(raw.payee[key], max) } : {});
  return {
    type: text(raw?.type, 50) || "*",
    payee: { kind, name, ...(email ? { email } : {}), ...optional("externalId", 100), ...optional("employeeNumber", 50), ...optional("idNumber", 20), ...optional("phone", 40), ...optional("bankName", 60), ...optional("bankAccountName", 60), ...optional("bankAccountNumber", 40) },
    serviceDate, amount, incomeType: text(raw?.incomeType, 4) || "50",
    ...(hours !== undefined ? { hours } : {}), ...(rate !== undefined ? { rate } : {}),
    ...(text(raw?.description, 300) ? { description: text(raw.description, 300) } : {}),
    ...(text(raw?.orderExternalId, 100) ? { orderExternalId: text(raw.orderExternalId, 100) } : {}),
  };
}

function refundData(raw: any): RefundData | string {
  const orderExternalId = text(raw?.orderExternalId, 100);
  if (!orderExternalId) return "要退哪一張訂單（orderExternalId）必填，填當初送訂單時的 externalId";
  const amount = round2(raw?.amount);
  if (!(amount > 0)) return "退款金額必須大於 0";
  const refundTo: OrderPayment[] = [];
  for (const part of Array.isArray(raw?.refundTo) && raw.refundTo.length > 0 ? raw.refundTo : [{ method: "original", amount }]) {
    const method = text(part?.method, 40), partAmount = round2(part?.amount);
    if (!method || !(partAmount > 0)) return "退款去向（refundTo）每一筆都要有 method 和大於 0 的 amount；退回儲值餘額請填 stored_value";
    refundTo.push({ method, amount: partAmount });
  }
  if (Math.abs(round2(refundTo.reduce((sum, p) => sum + p.amount, 0)) - amount) > 0.01) return "退款去向的合計不等於退款金額";
  const restock: Array<{ sku: string; quantity: number }> = [];
  for (const line of Array.isArray(raw?.restock) ? raw.restock : []) {
    const sku = text(line?.sku, 100), quantity = Number(line?.quantity);
    if (!sku || !(quantity > 0)) return "退回倉庫的商品（restock）每一筆都要有 sku 和大於 0 的數量";
    restock.push({ sku, quantity });
  }
  return { orderExternalId, amount, refundTo, restock, ...(text(raw?.reason, 300) ? { reason: text(raw.reason, 300) } : {}) };
}

function expenseData(raw: any): ExpenseData | string {
  const type = text(raw?.type, 50);
  if (!type) return "費用類別（type）必填，例如 ad、tool、rent";
  const amount = round2(raw?.amount), taxAmount = round2(raw?.taxAmount ?? 0);
  if (!(amount > 0)) return "費用金額必須大於 0（含稅）";
  if (taxAmount < 0 || taxAmount >= amount) return "進項稅額不能是負數，也不能大於或等於費用金額";
  return { type, amount, taxAmount, paid: raw?.paid !== false, description: text(raw?.description, 300) || type, ...(text(raw?.payee, 100) ? { payee: text(raw.payee, 100) } : {}) };
}

function assetMovementData(raw: any): AssetMovementData | string {
  const assetNumber = text(raw?.assetNumber, 60), serialNumber = text(raw?.serialNumber, 100);
  if (!assetNumber && !serialNumber) return "請提供資產編號（assetNumber）或序號（serialNumber）";
  const action = raw?.action;
  if (!["checkout", "return", "transfer"].includes(action)) return "動作（action）只能是 checkout（借出）、return（歸還）、transfer（換地點）";
  const holder = text(raw?.holder, 100), location = text(raw?.location, 200);
  if (action === "checkout" && !holder) return "借出時要填借用人（holder）";
  if (action === "transfer" && !location) return "換地點時要填新的地點（location）";
  return { action, ...(assetNumber ? { assetNumber } : {}), ...(serialNumber ? { serialNumber } : {}), ...(holder ? { holder } : {}), ...(location ? { location } : {}), ...(text(raw?.note, 300) ? { note: text(raw.note, 300) } : {}) };
}

/** 檢查並整理一筆外部單據；格式不對回傳看得懂的原因 */
export function normalizeEvent(raw: any): { ok: true; event: NormalizedEvent } | { ok: false; error: string } {
  const source = text(raw?.source, 50).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(source)) return { ok: false, error: "來源代號（source）必填，只能用小寫英數與連字號，例如 cm-life" };
  const kind = text(raw?.kind, 30) as EventKind;
  if (!EVENT_KINDS.includes(kind)) return { ok: false, error: `單據種類（kind）只能是：${EVENT_KINDS.join("、")}` };
  const externalId = text(raw?.externalId, 100);
  if (!externalId) return { ok: false, error: "外部編號（externalId）必填，用來避免同一筆重複入帳" };
  const occurredAt = text(raw?.occurredAt, 40).slice(0, 10);
  if (!isDate(occurredAt)) return { ok: false, error: "發生日期（occurredAt）必填，格式 YYYY-MM-DD" };
  if (raw?.data === null || typeof raw?.data !== "object" || Array.isArray(raw.data)) return { ok: false, error: "單據內容（data）必填" };

  if (kind === "order") {
    const data = orderData(raw.data);
    if (typeof data === "string") return { ok: false, error: data };
    return { ok: true, event: { source, kind, externalId, occurredAt, amount: data.total, summary: `${data.buyer.name}：${data.lines.map(l => `${l.name}×${l.quantity}`).join("、")}`.slice(0, 200), data } };
  }
  if (kind === "stored_value") {
    const data = storedValueData(raw.data);
    if (typeof data === "string") return { ok: false, error: data };
    return { ok: true, event: { source, kind, externalId, occurredAt, amount: data.amount, summary: `${data.member.name} ${data.action === "topup" ? "儲值" : "退還儲值金"} ${data.amount}`, data } };
  }
  if (kind === "payout") {
    const data = payoutData(raw.data, occurredAt);
    if (typeof data === "string") return { ok: false, error: data };
    return { ok: true, event: { source, kind, externalId, occurredAt, amount: data.amount, summary: `${data.payee.name} ${data.description || "報酬"}`.slice(0, 200), data } };
  }
  if (kind === "refund") {
    const data = refundData(raw.data);
    if (typeof data === "string") return { ok: false, error: data };
    return { ok: true, event: { source, kind, externalId, occurredAt, amount: data.amount, summary: `訂單 ${data.orderExternalId} 退款${data.reason ? "：" + data.reason : ""}`.slice(0, 200), data } };
  }
  if (kind === "expense") {
    const data = expenseData(raw.data);
    if (typeof data === "string") return { ok: false, error: data };
    return { ok: true, event: { source, kind, externalId, occurredAt, amount: data.amount, summary: data.description, data } };
  }
  const data = assetMovementData(raw.data);
  if (typeof data === "string") return { ok: false, error: data };
  const actionLabel = { checkout: "借出", return: "歸還", transfer: "換地點" }[data.action];
  return { ok: true, event: { source, kind, externalId, occurredAt, amount: 0, summary: `資產 ${data.assetNumber || data.serialNumber} ${actionLabel}${data.holder ? "：" + data.holder : ""}`.slice(0, 200), data } };
}

/** 一張訂單裡用餘額付了多少、實際收到多少錢 */
export function paymentSplit(payments: OrderPayment[]): { storedValue: number; cash: number } {
  const storedValue = round2(payments.filter(p => p.method === STORED_VALUE_METHOD).reduce((sum, p) => sum + p.amount, 0));
  return { storedValue, cash: round2(payments.reduce((sum, p) => sum + p.amount, 0) - storedValue) };
}

/**
 * 把折扣與運費攤進各明細，讓每一筆明細的金額加起來剛好等於訂單總額。
 * 折扣依金額比例分攤；運費另外成一筆「運費」。最後一筆吸收尾差。
 */
export function allocateLines(data: OrderData): Array<OrderLine & { isShipping?: boolean }> {
  const lines: Array<OrderLine & { isShipping?: boolean }> = data.lines.map(l => ({ ...l }));
  if (data.shippingFee > 0) lines.push({ name: "運費", quantity: 1, unitPrice: data.shippingFee, amount: data.shippingFee, isShipping: true });
  const gross = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  if (gross <= 0) return lines;
  let remaining = data.total;
  return lines.map((line, index) => {
    const amount = index === lines.length - 1 ? round2(remaining) : round2(line.amount * (data.total / gross));
    remaining = round2(remaining - amount);
    return { ...line, amount, unitPrice: line.quantity > 0 ? round2(amount / line.quantity) : amount };
  });
}

/** 含稅金額拆成未稅與稅額（免稅、零稅率不拆） */
export function taxOf(total: number, taxType: OrderData["taxType"]): { net: number; tax: number } {
  if (taxType !== "taxable") return { net: round2(total), tax: 0 };
  const net = round2(total / 1.05);
  return { net, tax: round2(total - net) };
}
