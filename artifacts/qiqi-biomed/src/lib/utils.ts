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
