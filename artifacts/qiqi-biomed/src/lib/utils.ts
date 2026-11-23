import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(price: number | undefined | null) {
  if (price == null) return "NT$0";
  return `NT$${price.toLocaleString("zh-TW")}`;
}

export function classNames(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

export function getTierName(tier: string | undefined | null) {
  switch (tier) {
    case 'hospital': return '醫院會員';
    case 'clinic': return '診所藥局會員';
    case 'consumer': return '一般會員';
    default: return '一般會員';
  }
}

/** 常用貨運公司（後台填出貨資訊時的選項；也可以自己打） */
export const SHIPPING_CARRIERS = ["黑貓宅急便", "新竹物流", "宅配通", "郵局", "順豐速運", "自行配送"];

/** 貨運公司的查件網頁；不認得的貨運公司回傳 null */
export function getCarrierTrackingUrl(carrier: string | null | undefined, trackingNo: string | null | undefined) {
  const name = carrier ?? "";
  const no = encodeURIComponent((trackingNo ?? "").trim());
  if (/黑貓|宅急便|t-?cat/i.test(name)) return `https://www.t-cat.com.tw/Inquire/Trace.aspx?no=${no}`;
  if (/新竹|hct/i.test(name)) return "https://www.hct.com.tw/Search/SearchGoods_n.aspx";
  if (/宅配通|e-?can/i.test(name)) return "https://www.e-can.com.tw/search_Goods.aspx";
  if (/郵局|中華郵政/.test(name)) return "https://postserv.post.gov.tw/pstmail/main_mail.html";
  return null;
}

export function getOrderStatusName(status: string) {
  switch (status) {
    case 'pending': return '待付款';
    case 'paid': return '已付款';
    case 'shipped': return '已出貨';
    case 'completed': return '已完成';
    case 'cancelled': return '已取消';
    default: return status;
  }
}

export function getPaymentMethodName(method: string) {
  switch (method) {
    case 'bank_transfer': return '匯款';
    case 'cod': return '貨到付款';
    case 'wallet': return '錢包扣款';
    default: return method;
  }
}
