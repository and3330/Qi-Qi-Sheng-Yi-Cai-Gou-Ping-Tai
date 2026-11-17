import { useState } from "react";
import { PaymentTermField, InvoiceSchedulePanel, paymentTermPayload } from "@/components/shared/payment-term";
import { ProjectField } from "@/components/shared/project-field";
import { useListInvoices, useCreateInvoice, useUpdateInvoice, useDeleteInvoice, useListCustomers, useListItems } from "@workspace/erp-api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ExternalLink } from "lucide-react";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { PrintButton } from "@/components/shared/print-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocWindow, DocStatus, statusTone, DocFields, DocNote, DocSection, DocRelated } from "@/components/shared/doc-window";
import { RelatedDocs, useOpenFromUrl } from "@/components/shared/related-docs";
import { InvoiceCreateDialog, InvoiceEditDialog } from "@/components/accounting/invoice-doc";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Ban, HandCoins, FileX2, Undo2 } from "lucide-react";
import { InvoiceReceiptDialog } from "@/components/shared/invoice-receipt-dialog";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { SearchableSelect } from "@/components/shared/searchable-select";

const statusMap: Record<string, string> = { Draft: "草稿", Submitted: "已提交", Unpaid: "未付款", Overdue: "逾期", Paid: "已付款", Cancelled: "已取消", WrittenOff: "呆帳" };
const statusOptions = ["Draft", "Unpaid", "Paid", "Cancelled"];

type LineItem = { itemId: number; quantity: number; rate: number };
type TaxType = "taxable" | "zero_rated" | "exempt" | "unclassified";
const taxOptions = [{ value: "taxable", label: "應稅 5%" }, { value: "zero_rated", label: "零稅率" }, { value: "exempt", label: "免稅" }];

export default function SalesInvoicesPage() {
  const qc = useQueryClient();
  const { data: allInvoices, isLoading } = useListInvoices();
  const { data: customers } = useListCustomers();
  const { data: items } = useListItems();
  const invoices = Array.isArray(allInvoices) ? allInvoices.filter((inv) => inv.invoiceType === "Sales" || inv.invoiceType === "Sales Invoice") : [];

  // 舊系統（Ecount）開過的發票：只供查看，排在新系統的發票後面
  const [, navigate] = useLocation();
  const { data: legacyInvoices } = useQuery<any[]>({
    queryKey: ["/erp-api/invoices/legacy"],
    queryFn: async () => { const r = await fetch("/erp-api/invoices/legacy"); return r.ok ? r.json() : []; },
    staleTime: 5 * 60 * 1000,
  });
  const legacyRows = Array.isArray(legacyInvoices) ? legacyInvoices.map((row) => ({ ...row, id: `legacy-${row.legacyDocumentId}` })) : [];
  const tableRows: any[] = [...invoices, ...legacyRows];

  // 點一張發票：看內容，以及它跟哪張銷貨單相關
  const [viewing, setViewing] = useState<any>(null);
  useOpenFromUrl(invoices as any[], row => setViewing(row));

  const batch = useBatchSelection(invoices);
  const invoiceBatchFields: BatchField[] = [
    {key:"status",label:"狀態",type:"select",options:[{value:"Draft",label:"草稿"},{value:"Submitted",label:"已提交"},{value:"Paid",label:"已付款"},{value:"Cancelled",label:"已取消"}]},
  ];

  const deleteMut = useDeleteInvoice();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [receiptInvoice, setReceiptInvoice] = useState<any>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const openCreate = () => setCreateOpen(true);
  const openEdit = (inv: any) => setEditing(inv);

  const handleDelete = async (inv: any) => {
    if (!confirm(`確定刪除發票「${inv.invoiceNumber}」？`)) return;
    try {
      await deleteMut.mutateAsync({ id: inv.id });
      toast({ title: "發票已刪除" });
    } catch (err: any) {
      toast({ title: "刪除失敗", description: err.message, variant: "destructive" });
    }
  };

  const BASE_URL = import.meta.env.BASE_URL;
  const apiUrl = (path: string) => `/erp-api/${path}`;

  const handleWriteOff = async (inv: any) => {
    const outstanding = Number(inv.outstandingAmount ?? (Number(inv.totalAmount) - Number(inv.paidAmount)));
    const reason = prompt(
      `確定將發票「${inv.invoiceNumber}」的未收餘額 NT$ ${outstanding.toLocaleString()} 轉列呆帳？\n\n系統會自動建立分錄（借：呆帳損失／貸：應收帳款）。\n請輸入呆帳原因（選填）：`,
      "",
    );
    if (reason === null) return;
    try {
      const res = await fetch(apiUrl(`invoices/${inv.id}/write-off`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "轉呆帳失敗");
      toast({ title: "已轉呆帳", description: `分錄 ${data.journalEntryNumber} 已自動建立` });
      qc.invalidateQueries({ queryKey: ["/erp-api/invoices"] });
    } catch (err: any) {
      toast({ title: "轉呆帳失敗", description: err.message, variant: "destructive" });
    }
  };

  const handleCancelWriteOff = async (inv: any) => {
    if (!confirm(`確定取消發票「${inv.invoiceNumber}」的呆帳？\n呆帳分錄會刪除，發票將恢復為未付款，可再進行收款。`)) return;
    try {
      const res = await fetch(apiUrl(`invoices/${inv.id}/cancel-write-off`), { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "取消呆帳失敗");
      toast({ title: "呆帳已取消", description: "發票已恢復為未收款狀態" });
      qc.invalidateQueries({ queryKey: ["/erp-api/invoices"] });
    } catch (err: any) {
      toast({ title: "取消呆帳失敗", description: err.message, variant: "destructive" });
    }
  };

  const handleVoidEcpay = async (inv: any) => {
    const reason = prompt(`確定作廢綠界發票「${inv.ecpayInvoiceNumber}」？\n\n請輸入作廢原因（選填）：`, "");
    if (reason === null) return;
    try {
      const res = await fetch(apiUrl(`invoices/${inv.id}/void-ecpay`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || "客戶要求作廢" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "作廢失敗");
      toast({ title: "綠界發票已作廢" });
      qc.invalidateQueries({ queryKey: ["/erp-api/invoices"] });
    } catch (err: any) {
      toast({ title: "作廢失敗", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="銷售發票" description="營收追蹤" />
        <div className="flex gap-2">
          <PrintButton title="銷售發票清單" contentId="invoices-table" />
          <Button onClick={openCreate}><Plus size={16} className="mr-1" />新增銷售發票</Button>
        </div>
      </div>

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="發票"
          entityEndpoint="invoices"
          ids={batch.ids}
          allowDelete={false}
          batchFields={invoiceBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => qc.invalidateQueries({ queryKey: ["/erp-api/invoices"] })}
        />
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto" id="invoices-table">
          <DataTable
            isLoading={isLoading}
            data={tableRows as any}
            onRowClick={(row: any) => setViewing(row)}
            columns={[
              {
                header: () => <CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} />,
                accessor: (r: any) => r.legacy ? null : <span onClick={(e) => e.stopPropagation()}><CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} /></span>,
                className: "w-10",
              },
              {
                header: "發票編號",
                accessor: (r: any) => r.legacy ? (
                  <div>
                    <span className="font-mono whitespace-nowrap">{r.invoiceNumber}<span className="ml-1.5 inline-block rounded border px-1 font-sans text-[10px] font-normal text-muted-foreground align-middle" title="在舊系統 Ecount 開的發票，只能查看">歷史</span></span>
                    {r.detail && <div className="max-w-[260px] truncate text-xs text-muted-foreground" title={r.detail}>{r.detail}</div>}
                  </div>
                ) : r.invoiceNumber,
              },
              {
                header: "綠界發票",
                accessor: (r: any) => r.legacy ? <span className="text-xs text-muted-foreground">{r.einvoiceType || "—"}</span> : r.ecpayInvoiceNumber ? (
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs">{r.ecpayInvoiceNumber}</span>
                    {r.ecpayVoidedAt && <Badge variant="destructive" className="text-xs">已作廢</Badge>}
                  </div>
                ) : <span className="text-muted-foreground text-xs">—</span>,
                className: "hidden md:table-cell",
              },
              { header: "客戶", accessor: (r) => r.customerName || "-", className: "hidden sm:table-cell" },
              { header: "日期", accessor: "invoiceDate" },
              {
                header: "狀態",
                accessor: (r: any) => r.legacy ? (
                  <Badge variant={r.status === "已開立" ? "secondary" : "destructive"}>{r.status}</Badge>
                ) : (
                  <Badge variant={r.status === "Paid" ? "default" : r.status === "Cancelled" ? "destructive" : "secondary"}>
                    {statusMap[r.status] || r.status}
                  </Badge>
                ),
              },
              { header: "已付", accessor: (r: any) => r.legacy ? "—" : `NT$ ${Number(r.paidAmount).toLocaleString()}`, className: "text-right hidden md:table-cell" },
              { header: "總額", accessor: (r) => `NT$ ${Number(r.totalAmount).toLocaleString()}`, className: "text-right" },
              {
                header: "操作",
                accessor: (r: any) => r.legacy ? (
                  r.salesOrderId
                    ? <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); navigate(`/sales/orders/${r.salesOrderId}`); }} title={`這張發票的銷貨單 ${r.salesOrderNumber}`}><ExternalLink size={12} className="mr-1" />銷貨單</Button>
                    : <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    {r.status !== "Paid" && r.status !== "Cancelled" && r.status !== "WrittenOff" && !r.ecpayVoidedAt && Number(r.totalAmount) > Number(r.paidAmount) && (
                      <Button variant="ghost" size="icon" onClick={() => { setReceiptInvoice(r); setReceiptOpen(true); }} title="收款">
                        <HandCoins size={14} className="text-emerald-600" />
                      </Button>
                    )}
                    {["Unpaid", "Overdue", "Submitted"].includes(r.status) && Number(r.totalAmount) > Number(r.paidAmount) && (
                      <Button variant="ghost" size="icon" onClick={() => handleWriteOff(r)} title="轉呆帳（自動建立分錄）">
                        <FileX2 size={14} className="text-red-600" />
                      </Button>
                    )}
                    {r.status === "WrittenOff" && (
                      <Button variant="ghost" size="icon" onClick={() => handleCancelWriteOff(r)} title="取消呆帳">
                        <Undo2 size={14} className="text-blue-600" />
                      </Button>
                    )}
                    {r.ecpayInvoiceNumber && !r.ecpayVoidedAt && (
                      <Button variant="ghost" size="icon" onClick={() => handleVoidEcpay(r)} title="作廢綠界發票">
                        <Ban size={14} className="text-orange-600" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil size={14} /></Button>
                    {!r.ecpayInvoiceNumber && <Button variant="ghost" size="icon" onClick={() => handleDelete(r)}><Trash2 size={14} className="text-destructive" /></Button>}
                  </div>
                ),
                className: "w-28",
              },
            ]}
          />
        </CardContent>
      </Card>


      {/* 點開一張發票：跟其他單據同一種視窗（components/shared/doc-window） */}
      <DocWindow
        open={viewing !== null}
        onClose={() => setViewing(null)}
        name="發票"
        number={viewing?.invoiceNumber}
        status={viewing && (viewing.legacy ? (
          <>
            <DocStatus label={viewing.status} tone={viewing.status === "已開立" ? "secondary" : "destructive"} />
            <DocStatus label="歷史" tone="outline" />
          </>
        ) : <DocStatus label={statusMap[viewing.status] || viewing.status} tone={statusTone(viewing.status)} />)}
        description={viewing?.legacy ? "這是在舊系統 Ecount 開的發票，只供查看；不列入現在的應收帳款與營業稅報表。" : undefined}
        footer={<Button variant="outline" onClick={() => setViewing(null)}>關閉</Button>}
      >
        {viewing && (
          <>
            <DocFields items={[
              ["客戶", viewing.customerName],
              ["開立日期", viewing.invoiceDate],
              ["發票類型", viewing.legacy ? viewing.einvoiceType : null],
              ["綠界發票號碼", viewing.legacy ? null : viewing.ecpayInvoiceNumber],
              ["未稅金額", viewing.netAmount != null && Number(viewing.netAmount) !== 0 ? `NT$ ${Number(viewing.netAmount).toLocaleString()}` : null],
              ["營業稅", viewing.taxAmount != null && Number(viewing.taxAmount) !== 0 ? `NT$ ${Number(viewing.taxAmount).toLocaleString()}` : null],
              ["合計", `NT$ ${Number(viewing.totalAmount).toLocaleString()}`],
              ["已收", viewing.legacy ? null : `NT$ ${Number(viewing.paidAmount).toLocaleString()}`],
            ]} />
            <DocNote label="明細">{viewing.legacy ? viewing.detail : null}</DocNote>
            {!viewing.legacy ? (
              <RelatedDocs type="invoice" id={Number(viewing.id)} onNavigate={() => setViewing(null)} />
            ) : viewing.salesOrderId ? (
              <div className="space-y-1">
                <DocRelated
                  onNavigate={() => setViewing(null)}
                  items={[{
                    label: `銷貨單${viewing.legacy && viewing.legacySalesNumber ? `（Ecount ${viewing.legacySalesNumber}）` : ""}`,
                    number: viewing.salesOrderNumber || `#${viewing.salesOrderId}`,
                    href: `/sales/orders/${viewing.salesOrderId}`,
                  }]}
                />
                {viewing.legacy && viewing.linkMethod ? <p className="text-xs text-muted-foreground">怎麼對到的：{viewing.linkMethod}</p> : null}
              </div>
            ) : (
              <DocSection title="關聯單據">
                <p className="text-muted-foreground">{viewing.legacy ? "這張歷史發票找不到對應的銷貨單（舊系統的稅務明細裡沒有它，或同一個號碼的銷貨單客戶不同，所以沒有連）。" : "這張發票是直接開的，沒有掛在銷貨單底下。"}</p>
              </DocSection>
            )}
          </>
        )}
      </DocWindow>

      <InvoiceReceiptDialog
        invoice={receiptInvoice}
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ["/erp-api/invoices"] })}
      />

      {/* 新增、編輯發票：全系統同一個視窗（components/accounting/invoice-doc） */}
      <InvoiceCreateDialog open={createOpen} onOpenChange={setCreateOpen} fixedKind="Sales" />
      <InvoiceEditDialog invoice={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
