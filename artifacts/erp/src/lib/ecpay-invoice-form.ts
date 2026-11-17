export type InvoiceType = "personal" | "company" | "donation";
export type InvoiceCarrierType = "" | "phone_barcode" | "citizen_certificate" | "ecpay_carrier";

export interface EcpayInvoiceForm {
  invoiceType: InvoiceType;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddr: string;
  taxId: string;
  companyTitle: string;
  carrierType: InvoiceCarrierType;
  carrierNum: string;
  loveCode: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_BARCODE_PATTERN = /^\/[0-9A-Z.+-]{7}$/;
const CITIZEN_CERTIFICATE_PATTERN = /^[A-Z]{2}\d{14}$/;
const LOVE_CODE_PATTERN = /^\d{3,7}$/;

export function getEcpayInvoiceFormErrors(form: EcpayInvoiceForm): string[] {
  const errors: string[] = [];
  const customerName = form.customerName.trim();
  const customerEmail = form.customerEmail.trim();
  const customerPhone = form.customerPhone.trim();
  const customerAddr = form.customerAddr.trim();
  const companyTitle = form.companyTitle.trim();
  const taxId = form.taxId.trim();
  const loveCode = form.loveCode.trim();
  const carrierNum = form.carrierNum.trim();

  if (form.customerName !== customerName) errors.push("買方姓名（請移除前後空白）");
  if (form.customerEmail !== customerEmail) errors.push("Email（請移除前後空白）");
  if (form.customerPhone !== customerPhone) errors.push("聯絡電話／手機（請移除前後空白）");
  if (form.customerAddr !== customerAddr) errors.push("買方地址（請移除前後空白）");
  if (form.taxId !== taxId) errors.push("統一編號（請移除前後空白）");
  if (form.companyTitle !== companyTitle) errors.push("公司抬頭（請移除前後空白）");
  if (form.carrierNum !== carrierNum) errors.push("載具號碼（請移除前後空白）");
  if (form.loveCode !== loveCode) errors.push("愛心碼（請移除前後空白）");

  if (form.invoiceType !== "company" && !customerName) errors.push("買方姓名（必填）");
  if (form.invoiceType === "company" && !companyTitle) errors.push("公司抬頭（必填）");
  if (!customerAddr) errors.push("買方地址（必填）");
  if (!customerPhone) errors.push("聯絡電話／手機（必填）");
  if (!customerEmail) {
    errors.push("Email（必填）");
  } else if (!EMAIL_PATTERN.test(customerEmail)) {
    errors.push("Email（格式不正確）");
  }

  if (form.invoiceType === "company" && !/^\d{8}$/.test(taxId)) {
    errors.push("統一編號（需為 8 碼數字）");
  }

  if (form.invoiceType === "donation") {
    if (!loveCode) {
      errors.push("愛心碼（必填）");
    } else if (!LOVE_CODE_PATTERN.test(loveCode)) {
      errors.push("愛心碼（需為 3–7 碼數字）");
    }
    if (form.carrierType) errors.push("捐贈發票不可使用載具");
  }

  if (form.invoiceType === "personal" && form.carrierType === "phone_barcode" && !PHONE_BARCODE_PATTERN.test(carrierNum)) {
    errors.push("手機條碼載具（格式不正確）");
  }
  if (form.invoiceType === "personal" && form.carrierType === "citizen_certificate" && !CITIZEN_CERTIFICATE_PATTERN.test(carrierNum)) {
    errors.push("自然人憑證載具（需為 2 碼大寫英文加 14 碼數字）");
  }

  return errors;
}