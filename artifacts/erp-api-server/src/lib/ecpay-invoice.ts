import crypto from "node:crypto";
import { logger } from "./logger";

const REVISION = "3.0.0";
const PRODUCTION_URL = "https://einvoice.ecpay.com.tw";
const STAGE_URL = "https://einvoice-stage.ecpay.com.tw";

export interface EcpayInvoiceConfig {
  merchantId: string;
  hashKey: string;
  hashIV: string;
  apiUrl: string;
  isTest: boolean;
}

type FetchLike = typeof fetch;
type LogLike = Pick<typeof logger, "info" | "warn" | "error">;

export interface EcpayClientOptions {
  config?: EcpayInvoiceConfig;
  fetch?: FetchLike;
  log?: LogLike;
  now?: () => number;
}

export function getInvoiceConfig(env: NodeJS.ProcessEnv = process.env): EcpayInvoiceConfig {
  const merchantId = env.ECPAY_INVOICE_MERCHANT_ID || env.ECPAY_MERCHANT_ID;
  const hashKey = env.ECPAY_INVOICE_HASH_KEY;
  const hashIV = env.ECPAY_INVOICE_HASH_IV;
  if (!merchantId || !hashKey || !hashIV) {
    throw new Error(
      "ECPay 電子發票尚未設定：必須設定 ECPAY_INVOICE_MERCHANT_ID、ECPAY_INVOICE_HASH_KEY、ECPAY_INVOICE_HASH_IV",
    );
  }
  if (Buffer.byteLength(hashKey, "utf8") !== 16 || Buffer.byteLength(hashIV, "utf8") !== 16) {
    throw new Error("ECPay 電子發票 HashKey 與 HashIV 必須各為 16 bytes");
  }
  const isTest = ["stage", "sandbox", "test"].includes(
    String(env.ECPAY_INVOICE_ENV || "").toLowerCase(),
  );
  return {
    merchantId,
    hashKey,
    hashIV,
    apiUrl: env.ECPAY_INVOICE_API_URL || (isTest ? STAGE_URL : PRODUCTION_URL),
    isTest,
  };
}

export function aesEncrypt(data: string, key: string, iv: string): string {
  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    Buffer.from(key, "utf8"),
    Buffer.from(iv, "utf8"),
  );
  return cipher.update(aesUrlEncode(data), "utf8", "base64") + cipher.final("base64");
}

export function aesDecrypt(data: string, key: string, iv: string): string {
  const decipher = crypto.createDecipheriv(
    "aes-128-cbc",
    Buffer.from(key, "utf8"),
    Buffer.from(iv, "utf8"),
  );
  const decoded = decipher.update(data, "base64", "utf8") + decipher.final("utf8");
  return decodeURIComponent(decoded.replace(/\+/g, "%20"));
}

export function aesUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/~/g, "%7E")
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

export function sanitizeEcpayResponse(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const allowed = [
    "RtnCode", "RtnMsg", "InvoiceNo", "InvoiceDate", "RandomNumber",
    "AllowanceNo", "AllowanceAmount", "InvoiceStatus", "IIS_Invalid_Status",
    "IA_Allow_Status", "TaxAmount", "SalesAmount", "IIS_Number",
    "IIS_Relate_Number", "IIS_Create_Date", "IIS_Issue_Status",
    "IIS_Random_Number", "IIS_Sales_Amount", "IIS_Remain_Allowance_Amt",
  ];
  return Object.fromEntries(allowed.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

interface EcpayResult {
  success: boolean;
  message?: string;
  rawResponse?: Record<string, unknown> | null;
  isTest?: boolean;
  outcomeUnknown?: boolean;
}

interface InternalEcpayResult extends EcpayResult {
  data?: Record<string, unknown>;
}

async function request(
  endpoint: string,
  data: Record<string, unknown>,
  options: EcpayClientOptions = {},
): Promise<InternalEcpayResult> {
  let config: EcpayInvoiceConfig;
  try {
    // 每家公司用自己的綠界商店代號開發票（系統管理 › 串接金鑰）；平台那一組只給指定的那一家用
    config = options.config || await (await import("./tenant-integrations")).tenantEcpayConfig();
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "ECPay 設定無效" };
  }
  const fetchImpl = options.fetch || globalThis.fetch;
  const log = options.log || logger;
  const body = {
    MerchantID: config.merchantId,
    RqHeader: {
      Timestamp: Math.floor((options.now ? options.now() : Date.now()) / 1000),
      Revision: REVISION,
    },
    Data: aesEncrypt(
      JSON.stringify({ MerchantID: config.merchantId, ...data }),
      config.hashKey,
      config.hashIV,
    ),
  };
  try {
    const response = await fetchImpl(`${config.apiUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      log.warn({ endpoint, statusCode: response.status }, "ECPay invoice HTTP request failed");
      return { success: false, message: `ECPay HTTP ${response.status}`, isTest: config.isTest, outcomeUnknown: true };
    }
    let envelope: Record<string, unknown>;
    try {
      envelope = await response.json() as Record<string, unknown>;
    } catch {
      return { success: false, message: "ECPay 回傳格式不是有效 JSON", isTest: config.isTest, outcomeUnknown: true };
    }
    log.info(
      { endpoint, transCode: envelope.TransCode },
      "ECPay invoice response received",
    );
    if (envelope.TransCode == null || !Number.isFinite(Number(envelope.TransCode))) {
      return { success: false, message: "ECPay 回應缺少有效 TransCode", isTest: config.isTest, outcomeUnknown: true };
    }
    if (Number(envelope.TransCode) !== 1) {
      return {
        success: false,
        message: String(envelope.TransMsg || "ECPay 請求失敗"),
        isTest: config.isTest,
      };
    }
    if (typeof envelope.Data !== "string") {
      return { success: false, message: "ECPay 成功回應缺少加密資料", isTest: config.isTest, outcomeUnknown: true };
    }
    let decoded: Record<string, unknown>;
    try {
      decoded = JSON.parse(aesDecrypt(envelope.Data, config.hashKey, config.hashIV));
    } catch {
      log.error({ endpoint }, "ECPay invoice response decryption failed");
      return { success: false, message: "ECPay 回傳解密失敗", isTest: config.isTest, outcomeUnknown: true };
    }
    const safe = sanitizeEcpayResponse(decoded);
    if (decoded.RtnCode == null || !Number.isFinite(Number(decoded.RtnCode))) {
      return {
        success: false,
        message: "ECPay 回應缺少有效 RtnCode",
        rawResponse: safe,
        isTest: config.isTest,
        outcomeUnknown: true,
      };
    }
    if (Number(decoded.RtnCode) !== 1) {
      return {
        success: false,
        message: String(decoded.RtnMsg || "ECPay 業務處理失敗"),
        rawResponse: safe,
        isTest: config.isTest,
      };
    }
    return {
      success: true,
      message: typeof decoded.RtnMsg === "string" ? decoded.RtnMsg : undefined,
      rawResponse: safe,
      isTest: config.isTest,
      data: decoded,
    };
  } catch (error) {
    log.error({ endpoint, err: error instanceof Error ? error.message : String(error) }, "ECPay invoice request failed");
    return {
      success: false,
      message: error instanceof Error ? error.message : "ECPay 請求失敗",
      isTest: config.isTest,
      outcomeUnknown: true,
    };
  }
}

export interface InvoiceIssueOptions {
  relateNumber: string;
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  customerAddr?: string;
  invoiceType: "personal" | "company" | "donation";
  carrierType?: string;
  carrierNum?: string;
  loveCode?: string;
  taxId?: string;
  companyTitle?: string;
  salesAmount: number;
  items: { name: string; count: number; unitPrice: number; amount: number }[];
}

export interface InvoiceIssueResult extends EcpayResult {
  invoiceNumber?: string;
  invoiceDate?: string;
  randomNumber?: string;
}

/** 取得綠界官方一小時效期的列印頁，不開票、不寫入帳務。 */
export async function printInvoice(invoiceNumber: string, invoiceDate: string, client?: EcpayClientOptions, printStyle: 1 | 4 = 1) {
  if (!/^[A-Z]{2}\d{8}$/.test(invoiceNumber) || !/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(invoiceDate)) {
    return { success: false, message: "綠界發票號碼或開立日期不完整" };
  }
  const result = await request("/B2CInvoice/InvoicePrint", {
    InvoiceNo: invoiceNumber, InvoiceDate: invoiceDate, PrintStyle: printStyle, IsShowingDetail: 1,
  }, client);
  if (!result.success) return { success: false, message: result.message || "綠界列印連結取得失敗" };
  try {
    const url = new URL(String(result.data?.InvoiceHtml || ""));
    if (url.protocol !== "https:" || !url.hostname.endsWith(".ecpay.com.tw") || url.username || url.password) throw new Error("invalid URL");
    return { success: true, url: url.href };
  } catch {
    return { success: false, message: "綠界回傳的列印網址無效" };
  }
}

export async function issueInvoice(options: InvoiceIssueOptions, client?: EcpayClientOptions): Promise<InvoiceIssueResult> {
  if (options.salesAmount <= 0) return { success: false, message: "發票金額必須大於 0" };
  if (!options.customerEmail && !options.customerPhone) return { success: false, message: "買方 Email 和手機號碼至少需填一項" };
  if (options.customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.customerEmail)) {
    return { success: false, message: "買方 Email 格式不正確" };
  }
  if (!options.items.length || options.items.some((item) =>
    !item.name || !Number.isFinite(item.count) || item.count <= 0 ||
    !Number.isFinite(item.unitPrice) || item.unitPrice < 0 ||
    !Number.isFinite(item.amount) || item.amount <= 0
  )) {
    return { success: false, message: "發票品項格式不正確" };
  }
  if (Math.round(options.items.reduce((sum, item) => sum + item.amount, 0)) !== options.salesAmount) {
    return { success: false, message: "發票品項金額合計必須等於發票總額" };
  }
  const company = options.invoiceType === "company";
  const donation = options.invoiceType === "donation";
  if (company && !/^\d{8}$/.test(options.taxId || "")) return { success: false, message: "公司發票需填寫 8 碼統一編號" };
  if (donation && !options.loveCode) return { success: false, message: "捐贈發票需填寫愛心碼" };
  if (company && !(options.companyTitle || options.customerName) ) return { success: false, message: "公司發票需填寫買方名稱" };
  if (company && !options.customerAddr) return { success: false, message: "公司紙本發票需填寫買方地址" };
  if (donation && options.carrierType) return { success: false, message: "捐贈發票不可同時使用載具" };
  if (options.carrierType === "phone_barcode" && !/^\/[0-9A-Z.+-]{7}$/.test(options.carrierNum || "")) {
    return { success: false, message: "手機條碼載具格式不正確" };
  }
  if (options.carrierType === "citizen_certificate" && !/^[A-Z]{2}\d{14}$/.test(options.carrierNum || "")) {
    return { success: false, message: "自然人憑證載具需為 2 碼大寫英文加 14 碼數字" };
  }
  const carrierMap: Record<string, string> = { phone_barcode: "3", citizen_certificate: "2", ecpay_carrier: "1" };
  const carrierType = carrierMap[options.carrierType || ""] || "";
  const result = await request("/B2CInvoice/Issue", {
    RelateNumber: options.relateNumber.substring(0, 30),
    CustomerID: "",
    CustomerIdentifier: company ? options.taxId : "",
    CustomerName: company ? options.companyTitle || options.customerName || "" : options.customerName || "",
    CustomerAddr: options.customerAddr || "",
    CustomerPhone: options.customerPhone || "",
    CustomerEmail: options.customerEmail || "",
    ClearanceMark: "",
    Print: company ? "1" : "0",
    Donation: donation ? "1" : "0",
    LoveCode: donation ? options.loveCode : "",
    CarrierType: carrierType,
    CarrierNum: carrierType === "1" ? "" : options.carrierNum || "",
    TaxType: "1",
    SalesAmount: options.salesAmount,
    InvoiceRemark: "",
    Items: options.items.map((item, index) => ({
      ItemSeq: index + 1, ItemName: (item.name || "商品").substring(0, 100),
      ItemCount: item.count, ItemWord: "式", ItemPrice: item.unitPrice,
      ItemTaxType: "1", ItemAmount: item.amount,
    })),
    InvType: "07",
    vat: "1",
  }, client);
  const { data: responseData, ...publicResult } = result;
  const invoiceNumber = typeof responseData?.InvoiceNo === "string" ? responseData.InvoiceNo : undefined;
  if (publicResult.success && !invoiceNumber) {
    return { ...publicResult, success: false, outcomeUnknown: true, message: "ECPay 成功回應缺少發票號碼" };
  }
  return {
    ...publicResult,
    invoiceNumber,
    invoiceDate: typeof responseData?.InvoiceDate === "string" ? responseData.InvoiceDate : undefined,
    randomNumber: typeof responseData?.RandomNumber === "string" ? responseData.RandomNumber : undefined,
  };
}

export interface InvoiceVoidResult extends EcpayResult {}
export async function voidInvoice(invoiceNumber: string, invoiceDate: string, reason = "訂單取消", client?: EcpayClientOptions): Promise<InvoiceVoidResult> {
  const { data: _data, ...result } = await request("/B2CInvoice/Invalid", { InvoiceNo: invoiceNumber, InvoiceDate: invoiceDate, Reason: reason }, client);
  return result;
}

export interface InvoiceQueryResult extends EcpayResult {
  invoiceNumber?: string;
  invoiceDate?: string;
  randomNumber?: string;
  invoiceStatus?: string;
  relateNumber?: string;
  salesAmount?: number;
  remainingAllowanceAmount?: number;
}
async function queryInvoiceData(data: Record<string, unknown>, client?: EcpayClientOptions): Promise<InvoiceQueryResult> {
  const result = await request("/B2CInvoice/GetIssue", data, client);
  const { data: responseData, ...publicResult } = result;
  const invoiceNumber = String(responseData?.InvoiceNo ?? responseData?.IIS_Number ?? "") || undefined;
  if (publicResult.success && !invoiceNumber) {
    return { ...publicResult, success: false, outcomeUnknown: true, message: "ECPay 查詢成功但缺少發票號碼" };
  }
  return {
    ...publicResult,
    invoiceNumber,
    invoiceDate: String(responseData?.InvoiceDate ?? responseData?.IIS_Create_Date ?? "").slice(0, 10) || undefined,
    randomNumber: String(responseData?.RandomNumber ?? responseData?.IIS_Random_Number ?? "") || undefined,
    relateNumber: String(responseData?.RelateNumber ?? responseData?.IIS_Relate_Number ?? "") || undefined,
    salesAmount: Number.isFinite(Number(responseData?.SalesAmount ?? responseData?.IIS_Sales_Amount))
      ? Number(responseData?.SalesAmount ?? responseData?.IIS_Sales_Amount)
      : undefined,
    remainingAllowanceAmount: Number.isFinite(Number(responseData?.IIS_Remain_Allowance_Amt))
      ? Number(responseData?.IIS_Remain_Allowance_Amt)
      : undefined,
    invoiceStatus: String(responseData?.IIS_Invalid_Status ?? "") === "1"
      ? "Voided"
      : String(responseData?.InvoiceStatus ?? responseData?.IIS_Issue_Status ?? "") === "1"
        ? "Issued"
        : String(responseData?.InvoiceStatus ?? responseData?.IIS_Issue_Status ?? "") || "Issued",
  };
}

export function queryInvoice(invoiceNumber: string, invoiceDate: string, client?: EcpayClientOptions): Promise<InvoiceQueryResult> {
  return queryInvoiceData({ InvoiceNo: invoiceNumber, InvoiceDate: invoiceDate }, client);
}

export function queryInvoiceByRelateNumber(relateNumber: string, client?: EcpayClientOptions): Promise<InvoiceQueryResult> {
  return queryInvoiceData({ RelateNumber: relateNumber }, client);
}

export interface AllowanceItem {
  name: string;
  count: number;
  unitPrice: number;
  amount: number;
  word?: string;
}
export interface AllowanceResult extends EcpayResult {
  allowanceNumber?: string;
  allowanceAmount?: number;
}
export async function issueAllowance(options: {
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  customerName?: string;
  reason?: string;
  notify: "E" | "S" | "A" | "N";
  notifyEmail?: string;
  notifyPhone?: string;
  items: AllowanceItem[];
}, client?: EcpayClientOptions): Promise<AllowanceResult> {
  if (!Number.isInteger(options.amount) || options.amount <= 0) {
    return { success: false, message: "折讓金額必須為正整數（新台幣元）" };
  }
  if (options.items.length === 0 || options.items.some((item) =>
    !item.name || !Number.isFinite(item.count) || item.count <= 0 ||
    !Number.isFinite(item.unitPrice) || item.unitPrice < 0 ||
    !Number.isFinite(item.amount) || item.amount <= 0
  )) {
    return { success: false, message: "折讓品項格式不正確" };
  }
  if (Math.round(options.items.reduce((sum, item) => sum + item.amount, 0)) !== options.amount) {
    return { success: false, message: "折讓品項金額合計必須等於折讓總額" };
  }
  if ((options.notify === "E" || options.notify === "A") && !options.notifyEmail) {
    return { success: false, message: "Email 通知必須提供 notifyEmail" };
  }
  if ((options.notify === "S" || options.notify === "A") && !options.notifyPhone) {
    return { success: false, message: "簡訊通知必須提供 notifyPhone" };
  }
  const result = await request("/B2CInvoice/Allowance", {
    InvoiceNo: options.invoiceNumber,
    InvoiceDate: options.invoiceDate,
    AllowanceNotify: options.notify,
    CustomerName: options.customerName || "",
    NotifyMail: options.notifyEmail || "",
    NotifyPhone: options.notifyPhone || "",
    AllowanceAmount: options.amount,
    Reason: options.reason || "",
    Items: options.items.map((item, index) => ({
      ItemSeq: index + 1, ItemName: item.name.substring(0, 100), ItemCount: item.count,
      ItemWord: item.word || "式", ItemPrice: item.unitPrice,
      ItemTaxType: "1", ItemAmount: item.amount,
    })),
  }, client);
  const { data: responseData, ...publicResult } = result;
  const allowanceNumber = typeof responseData?.AllowanceNo === "string" ? responseData.AllowanceNo : undefined;
  if (publicResult.success && !allowanceNumber) {
    return { ...publicResult, success: false, outcomeUnknown: true, message: "ECPay 成功回應缺少折讓單號" };
  }
  return {
    ...publicResult,
    allowanceNumber,
    allowanceAmount: Number(responseData?.AllowanceAmount ?? options.amount),
  };
}

export async function voidAllowance(invoiceNumber: string, allowanceNumber: string, reason: string, client?: EcpayClientOptions): Promise<AllowanceResult> {
  const { data: _data, ...result } = await request("/B2CInvoice/AllowanceInvalid", { InvoiceNo: invoiceNumber, AllowanceNo: allowanceNumber, Reason: reason }, client);
  return result;
}

export async function queryAllowance(invoiceNumber: string, allowanceNumber: string, client?: EcpayClientOptions): Promise<AllowanceResult> {
  const result = await request("/B2CInvoice/GetAllowance", { InvoiceNo: invoiceNumber, AllowanceNo: allowanceNumber }, client);
  const { data: responseData, ...publicResult } = result;
  const allowanceAmount = Number(responseData?.AllowanceAmount);
  if (publicResult.success && (!Number.isFinite(allowanceAmount) || allowanceAmount <= 0)) {
    return { ...publicResult, success: false, outcomeUnknown: true, message: "ECPay 折讓查詢成功但缺少有效金額" };
  }
  return {
    ...publicResult,
    allowanceNumber: typeof responseData?.AllowanceNo === "string" ? responseData.AllowanceNo : allowanceNumber,
    allowanceAmount,
  };
}

export async function queryVoidedAllowance(invoiceNumber: string, allowanceNumber: string, client?: EcpayClientOptions): Promise<AllowanceResult> {
  const result = await request("/B2CInvoice/GetAllowanceInvalid", { InvoiceNo: invoiceNumber, AllowanceNo: allowanceNumber }, client);
  const { data: responseData, ...publicResult } = result;
  return {
    ...publicResult,
    allowanceNumber: typeof responseData?.AllowanceNo === "string" ? responseData.AllowanceNo : allowanceNumber,
    allowanceAmount: Number(responseData?.AllowanceAmount ?? 0),
  };
}