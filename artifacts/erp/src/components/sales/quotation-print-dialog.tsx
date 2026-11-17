import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Download, X, Settings2 } from "lucide-react";
import { useLocation } from "wouter";
import { fetchDefaultLayout, renderPrintHtml, defaultLayout, PRINT_DOC_TYPES, type PrintData, type PrintDocType, type PrintLayout } from "@/lib/print-layout";

export const COMPANY_INFO = {
  name: "詠勝教育文化事業有限公司",
  taxId: "",
  address: "新北市板橋區南亞東路8號9樓之32",
  contact: "蘇秉浤",
  tel: "02-23680623",
};

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
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="md:max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <DialogTitle className="text-base">{label}預覽 — {data.docNumber}</DialogTitle>
          <div className="flex flex-wrap gap-2 mr-8">
            <Button size="sm" variant="ghost" onClick={() => { onClose(); navigate("/system/print-templates"); }} title="調整印出來的樣子"><Settings2 className="h-4 w-4 mr-1" />調整版面</Button>
            <Button size="sm" onClick={handlePrint}><Printer className="h-4 w-4 mr-1" />列印</Button>
            <Button size="sm" variant="outline" onClick={handlePrint} title="在列印視窗選「另存為 PDF」"><Download className="h-4 w-4 mr-1" />下載 PDF</Button>
            <Button size="sm" variant="ghost" onClick={onClose} aria-label="關閉"><X className="h-4 w-4" /></Button>
          </div>
        </DialogHeader>
        <iframe ref={iframeRef} title={`${label}預覽`} srcDoc={html} className="flex-1 w-full bg-white" />
      </DialogContent>
    </Dialog>
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
