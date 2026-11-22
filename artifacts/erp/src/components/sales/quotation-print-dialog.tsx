import { useEffect, useRef, useState } from "react";
import { DocWindow } from "@/components/shared/doc-window";
import { Button } from "@/components/ui/button";
import { Printer, Download, Settings2 } from "lucide-react";
import { useLocation } from "wouter";
import { fetchDefaultLayout, renderPrintHtml, defaultLayout, PRINT_DOC_TYPES, type PrintData, type PrintDocType, type PrintLayout } from "@/lib/print-layout";

/**
 * 單據上「我方公司」的資料一律來自系統設定裡的「品牌／公司」，程式裡不寫死任何公司。
 * 單據有指定就用指定的；沒指定用預設的那一家（啟用中、最早建立的）。
 */
export interface CompanyInfo { name: string; taxId: string; address: string; contact: string; tel: string }
export const COMPANY_INFO: CompanyInfo = { name: "", taxId: "", address: "", contact: "", tel: "" };

export function defaultBrand(brands: any[] | null | undefined): any | null {
  const list = (Array.isArray(brands) ? brands : []).filter(b => b && b.isActive !== false);
  return list.length ? [...list].sort((a, b) => Number(a.id) - Number(b.id))[0] : null;
}
export function companyOf(brand: any | null | undefined): CompanyInfo {
  return { name: brand?.name || "", taxId: brand?.taxId || "", address: brand?.address || "", contact: brand?.contactPerson || "", tel: brand?.tel || "" };
}

const parseItems = (raw: unknown): any[] => Array.isArray(raw) ? raw : (() => { try { return JSON.parse(String(raw || "[]")); } catch { return []; } })();

/** 報價單 → 列印資料 */
export function quotationPrintData(q: any, customer: any | null, brand: any | null): PrintData {
  const items = parseItems(q.items).map((it: any) => ({
    code: it.code, name: it.name || it.itemName || "", qty: Number(it.qty ?? it.quantity) || 0, unit: it.unit,
    unitPrice: Number(it.unitPrice ?? it.rate) || 0, amount: Number(it.amount) || 0, summary: it.summary,
  }));
  return {
    docNumber: q.quotationNumber || "",
    title: q.title || (q.notes || "").split("\n")[0] || "",
    customer: { name: q.customerName || customer?.name, taxId: customer?.taxId, phone: customer?.phone || customer?.mobile, address: customer?.address },
    company: {
      name: brand?.name || COMPANY_INFO.name, taxId: brand?.taxId || COMPANY_INFO.taxId, address: brand?.address || COMPANY_INFO.address,
      contact: q.quoterName || brand?.contactPerson || COMPANY_INFO.contact, tel: q.quoterPhone || brand?.tel || COMPANY_INFO.tel,
    },
    fields: { date: q.quotationDate, validUntil: q.validUntil, project: q.projectName },
    items,
    totals: { subtotal: Number(q.totalAmount) || 0, tax: Number(q.taxAmount) || 0, grand: Number(q.grandTotal) || 0, taxIncluded: q.taxIncluded === true },
    terms: q.terms || "",
    extraRows: Array.isArray(q.extraFieldRows) ? q.extraFieldRows : [],
  };
}

/** 通用的單據列印預覽：版面來自「系統管理 › 列印模板」設為預設的那份 */
export function DocumentPrintDialog({ open, onClose, docType, data }: { open: boolean; onClose: () => void; docType: PrintDocType; data: PrintData | null }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [layout, setLayout] = useState<PrintLayout>(() => defaultLayout(docType));
  const [, navigate] = useLocation();
  useEffect(() => { if (open) fetchDefaultLayout(docType).then(setLayout); }, [open, docType]);
  if (!data) return null;
  const html = renderPrintHtml(docType, data, layout);
  const label = PRINT_DOC_TYPES.find(d => d.value === docType)?.label || "";
  const handlePrint = () => { const win = iframeRef.current?.contentWindow; if (win) { win.focus(); win.print(); } };

  return (
    // 印的是 iframe 裡的那一頁（自己帶列印樣式），外框換成共用的單據視窗不影響印出來的樣子
    <DocWindow
      open={open} onClose={onClose} wide name={`${label}預覽`} number={data.docNumber}
      footer={<>
        <Button variant="ghost" className="mr-auto" onClick={() => { onClose(); navigate("/system/print-templates"); }} title="調整印出來的樣子"><Settings2 className="h-4 w-4 mr-1" />調整版面</Button>
        <Button variant="outline" onClick={handlePrint} title="在列印視窗選「另存為 PDF」"><Download className="h-4 w-4 mr-1" />下載 PDF</Button>
        <Button onClick={handlePrint}><Printer className="h-4 w-4 mr-1" />列印</Button>
        <Button variant="outline" onClick={onClose}>關閉</Button>
      </>}
    >
      <iframe ref={iframeRef} title={`${label}預覽`} srcDoc={html} className="h-[64dvh] w-full rounded-md border bg-white" />
    </DocWindow>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  quotation: any | null;
  customer?: any | null;
  brand?: any | null;
}

export function QuotationPrintDialog({ open, onClose, quotation, customer, brand }: Props) {
  return <DocumentPrintDialog open={open} onClose={onClose} docType="Quotation" data={quotation ? quotationPrintData(quotation, customer || null, brand || null) : null} />;
}
