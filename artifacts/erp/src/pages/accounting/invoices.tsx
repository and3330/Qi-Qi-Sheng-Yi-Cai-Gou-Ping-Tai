import { useState, useMemo } from "react";
import { PaymentTermField, InvoiceSchedulePanel, paymentTermPayload } from "@/components/shared/payment-term";
import { ProjectField } from "@/components/shared/project-field";
import { useListInvoices, useCreateInvoice, useUpdateInvoice, useDeleteInvoice, useListCustomers, useListItems } from "@workspace/erp-api-client-react";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { PageHint } from "@/components/page-hint";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocStatus, DocWindow } from "@/components/shared/doc-window";
import { useOpenFromUrl } from "@/components/shared/related-docs";
import { InvoiceCreateDialog, InvoiceEditDialog } from "@/components/accounting/invoice-doc";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, Ban, HandCoins, FileX2, Undo2, Mail, FileText, RefreshCw } from "lucide-react";
import { SendEmailDialog } from "@/components/email/send-email-dialog";
import { InvoiceReceiptDialog } from "@/components/shared/invoice-receipt-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExportMenu } from "@/components/shared/export-menu";
import type { ExportOptions } from "@/lib/export-utils";
import { Link } from "wouter";

import { LookupSelect } from "@/components/shared/lookup-select";
import { DateRangePresets } from "@/components/shared/date-range-presets";
const BASE_URL = import.meta.env.BASE_URL;
const api = (path: string) => `/erp-api/${path}`;

const statusMap: Record<string, string> = { Draft: "草稿", Submitted: "已提交", Unpaid: "未付款", Overdue: "逾期", Paid: "已付款", Cancelled: "已取消", WrittenOff: "呆帳" };
const invoiceTypeMap: Record<string, string> = { Sales: "銷售", Purchase: "採購", "Credit Note": "銷貨折讓", "Debit Note": "採購扣項" };
const statusOptions = ["Draft", "Unpaid", "Paid", "Cancelled", "WrittenOff"];
const statusTransitions: Record<string, string[]> = {
  Draft: ["Draft", "Submitted", "Unpaid", "Cancelled"],
  Submitted: ["Submitted", "Unpaid", "Overdue", "Cancelled"],
  Unpaid: ["Unpaid", "Overdue", "Cancelled"],
  Overdue: ["Overdue", "Unpaid", "Cancelled"],
  Paid: ["Paid"],
  Cancelled: ["Cancelled"],
  WrittenOff: ["WrittenOff"],
};
const typeOptions = ["Sales", "Purchase"];

type LineItem = { itemId: number; quantity: number; rate: number };
type AllowanceItem = { name: string; count: number; unitPrice: number; amount: number; word?: string };
type EcpayAllowance = { id: number | string; allowanceNumber?: string; allowanceDate: string; amount: number; items: unknown; reason: string; notifyType: string; status: string; voidReason?: string; voidedAt?: string; accountingEffect: "none" };
type TaxType = "taxable" | "zero_rated" | "exempt" | "unclassified";
const taxOptions = [
  { value: "taxable", label: "應稅 5%" },
  { value: "zero_rated", label: "零稅率" },
  { value: "exempt", label: "免稅" },
];

function getMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}` };
}

export default function AllInvoicesPage() {
  const { data: invoices, isLoading } = useListInvoices();
  const { data: customers } = useListCustomers();
  const { data: suppliers = [] } = useQuery({
    queryKey: ["/erp-api/suppliers"],
    queryFn: () => fetch(api("suppliers")).then(r => r.json()),
  });
  const { data: items } = useListItems();
  const queryClient = useQueryClient();
  const deleteMut = useDeleteInvoice();
  const { toast } = useToast();

  const { from: defaultFrom, to: defaultTo } = useMemo(() => getMonthRange(), []);
  // 帶發票號碼連過來時不限日期，不然別的月份的發票會被本月篩掉
  const linked = useMemo(() => !!new URLSearchParams(window.location.search).get("search"), []);
  const [dateFrom, setDateFrom] = useState(linked ? "" : defaultFrom);
  const [dateTo, setDateTo] = useState(linked ? "" : defaultTo);
  // 從總分類帳的「來源單據」連過來時帶 ?search=發票號碼，直接篩出那張
  const [searchText, setSearchText] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [receiptInvoice, setReceiptInvoice] = useState<any>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [emailInvoiceId, setEmailInvoiceId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [ecpayInvoice, setEcpayInvoice] = useState<any>(null);
  const [ecpayRemoteStatus, setEcpayRemoteStatus] = useState<string | null>(null);
  const [ecpayOpen, setEcpayOpen] = useState(false);
  const [allowanceItems, setAllowanceItems] = useState<AllowanceItem[]>([{ name: "", count: 1, unitPrice: 0, amount: 0 }]);
  const [allowanceNotify, setAllowanceNotify] = useState<"N" | "E" | "S" | "A">("N");
  const [allowanceEmail, setAllowanceEmail] = useState("");
  const [allowancePhone, setAllowancePhone] = useState("");
  const [allowanceReason, setAllowanceReason] = useState("");
  const [allowanceKey, setAllowanceKey] = useState("");
  const [ecpayPending, setEcpayPending] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ kind: "invoice" | "allowance"; id?: number | string; number: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const allowanceQuery = useQuery<EcpayAllowance[]>({
    queryKey: ["/erp-api/invoices", ecpayInvoice?.id, "ecpay-allowances"],
    queryFn: async () => {
      const res = await fetch(api(`invoices/${ecpayInvoice.id}/ecpay-allowances`));
      if (!res.ok) throw new Error("無法讀取折讓紀錄");
      return res.json();
    },
    enabled: !!ecpayInvoice?.id,
  });

  const invoiceList = useMemo(() => (Array.isArray(invoices) ? invoices : []), [invoices]);

  const filtered = useMemo(() => {
    return invoiceList.filter((inv: any) => {
      if (dateFrom && inv.invoiceDate < dateFrom) return false;
      if (dateTo && inv.invoiceDate > dateTo) return false;
      if (statusFilter && inv.status !== statusFilter) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        const match = (inv.invoiceNumber || "").toLowerCase().includes(q)
          || (inv.customerName || "").toLowerCase().includes(q)
          || (inv.supplierName || "").toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [invoiceList, dateFrom, dateTo, searchText, statusFilter]);

  const buildExport = (): ExportOptions => ({
    title: "發票清單",
    subtitle: `日期：${dateFrom || "不限"} 至 ${dateTo || "不限"}`,
    fileName: `發票清單_${dateFrom || "不限"}_${dateTo || "不限"}`,
    headers: ["發票號碼", "類型", "對象", "日期", "金額", "稅額", "狀態"],
    columnKeys: ["invoiceNumber", "type", "party", "date", "amount", "tax", "status"],
    rows: filtered.map((inv: any) => ({
      invoiceNumber: inv.invoiceNumber || "",
      type: invoiceTypeMap[inv.invoiceType] || inv.invoiceType || "",
      party: inv.customerName || inv.supplierName || "-",
      date: inv.invoiceDate || "",
      amount: `NT$ ${Number(inv.totalAmount).toLocaleString()}`,
      tax: `NT$ ${Number(inv.taxAmount || 0).toLocaleString()}`,
      status: statusMap[inv.status] || inv.status || "",
    })),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const openCreate = () => setCreateOpen(true);
  const openEdit = (inv: any) => setEditing(inv);
  // 從別張單的「關聯單據」連過來時帶 ?open=發票 id，直接打開那張
  useOpenFromUrl(invoices as any[], row => setEditing(row));

  const handleDelete = async (inv: any) => {
    if (!confirm(`確定刪除發票「${inv.invoiceNumber}」？`)) return;
    try {
      await deleteMut.mutateAsync({ id: inv.id });
      toast({ title: "發票已刪除" });
    } catch (err: any) {
      toast({ title: "刪除失敗", description: err.message, variant: "destructive" });
    }
  };

  const newAllowanceKey = () => {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  };
  const openEcpayManager = (inv: any) => {
    setEcpayInvoice(inv);
    setEcpayRemoteStatus(null);
    setAllowanceItems([{ name: "", count: 1, unitPrice: 0, amount: 0 }]);
    setAllowanceNotify("N");
    setAllowanceEmail(inv.ecpayBuyerEmail || inv.customerEmail || inv.email || "");
    setAllowancePhone(inv.ecpayBuyerPhone || inv.customerPhone || inv.phone || "");
    setAllowanceReason("");
    setAllowanceKey(newAllowanceKey());
    setVoidTarget(null);
    setVoidReason("");
    setEcpayOpen(true);
  };

  const invalidateEcpay = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/erp-api/invoices"] }),
      queryClient.invalidateQueries({ queryKey: ["/erp-api/invoices", ecpayInvoice?.id, "ecpay-allowances"] }),
    ]);
  };

  const handleSyncEcpay = async () => {
    if (!ecpayInvoice) return;
    setEcpayPending(true);
    try {
      const res = await fetch(api(`invoices/${ecpayInvoice.id}/ecpay-sync`), { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "同步失敗");
      setEcpayInvoice((current: any) => ({ ...current, ...(data.invoice || {}), ecpayStatus: data.invoice?.ecpayStatus || current.ecpayStatus }));
      setEcpayRemoteStatus(data.invoice?.ecpayStatus || null);
      toast({ title: "綠界狀態已同步" });
      await invalidateEcpay();
    } catch (err: any) {
      toast({ title: "同步失敗", description: err.message, variant: "destructive" });
    } finally {
      setEcpayPending(false);
    }
  };

  const updateAllowanceItem = (index: number, field: "name" | "count" | "unitPrice", value: string | number) => {
    setAllowanceItems(current => current.map((item, i) => {
      if (i !== index) return item;
      const next = { ...item, [field]: value };
      return { ...next, amount: Number(next.count) * Number(next.unitPrice) };
    }));
  };

  const handleCreateAllowance = async () => {
    if (!ecpayInvoice) return;
    const validItems = allowanceItems.filter(item => item.name.trim() && Number(item.count) > 0 && Number(item.unitPrice) >= 0);
    const amount = validItems.reduce((sum, item) => sum + Number(item.amount), 0);
    const allowedAmount = (allowanceQuery.data || [])
      .filter(item => !["Voided", "Failed"].includes(item.status))
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const remaining = Math.max(0, Number(ecpayInvoice.totalAmount || 0) - allowedAmount);
    if (validItems.length !== allowanceItems.length || amount <= 0) {
      toast({ title: "請填寫有效的折讓品項、數量與單價", variant: "destructive" }); return;
    }
    if (amount > remaining) {
      toast({ title: "折讓金額超過剩餘可折讓金額", variant: "destructive" }); return;
    }
    if (!allowanceReason.trim()) {
      toast({ title: "請填寫折讓原因", variant: "destructive" }); return;
    }
    if ((allowanceNotify === "E" || allowanceNotify === "A") && !allowanceEmail.trim()) {
      toast({ title: "請填寫通知 Email", variant: "destructive" }); return;
    }
    if ((allowanceNotify === "S" || allowanceNotify === "A") && !allowancePhone.trim()) {
      toast({ title: "請填寫通知手機", variant: "destructive" }); return;
    }
    setEcpayPending(true);
    try {
      const res = await fetch(api(`invoices/${ecpayInvoice.id}/ecpay-allowances`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": allowanceKey },
        body: JSON.stringify({ idempotencyKey: allowanceKey, amount, reason: allowanceReason.trim(), items: validItems, notify: allowanceNotify, notifyEmail: allowanceEmail || undefined, notifyPhone: allowancePhone || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.retryable) setAllowanceKey(newAllowanceKey());
        throw new Error(data.error || "建立折讓失敗");
      }
      toast({ title: "綠界折讓單已開立", description: data.allowance?.allowanceNumber ? `折讓單號：${data.allowance.allowanceNumber}` : undefined });
      setAllowanceItems([{ name: "", count: 1, unitPrice: 0, amount: 0 }]);
      setAllowanceReason("");
      setAllowanceKey(newAllowanceKey());
      await invalidateEcpay();
    } catch (err: any) {
      toast({ title: "建立折讓失敗", description: err.message, variant: "destructive" });
    } finally {
      setEcpayPending(false);
    }
  };

  const handleReconcileAllowance = async (allowance: EcpayAllowance) => {
    if (!ecpayInvoice) return;
    const allowanceNumber = prompt("請輸入綠界後台顯示的 16 碼折讓單號：", "");
    if (allowanceNumber === null) return;
    if (!/^\d{16}$/.test(allowanceNumber.trim())) {
      toast({ title: "折讓單號必須為 16 碼數字", variant: "destructive" }); return;
    }
    setEcpayPending(true);
    try {
      const res = await fetch(api(`invoices/${ecpayInvoice.id}/ecpay-allowances/${allowance.id}/reconcile`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowanceNumber: allowanceNumber.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "確認折讓失敗");
      toast({ title: "已連結並確認綠界折讓單" });
      await invalidateEcpay();
    } catch (err: any) {
      toast({ title: "確認失敗", description: err.message, variant: "destructive" });
    } finally {
      setEcpayPending(false);
    }
  };

  const handleVoidEcpay = async () => {
    if (!ecpayInvoice || !voidTarget || !voidReason.trim()) {
      toast({ title: "請輸入作廢原因", variant: "destructive" }); return;
    }
    setEcpayPending(true);
    try {
      const endpoint = voidTarget.kind === "invoice"
        ? `invoices/${ecpayInvoice.id}/void-ecpay`
        : `invoices/${ecpayInvoice.id}/ecpay-allowances/${voidTarget.id}/void`;
      const res = await fetch(api(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: voidReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "作廢失敗");
      if (data.verifiedActive) {
        toast({ title: "綠界折讓仍有效", description: data.message });
        setVoidTarget(null);
        setVoidReason("");
        await invalidateEcpay();
        return;
      }
      toast({ title: voidTarget.kind === "invoice" ? "綠界發票已作廢" : "綠界折讓單已作廢" });
      setVoidTarget(null);
      setVoidReason("");
      await invalidateEcpay();
    } catch (err: any) {
      toast({ title: "作廢失敗", description: err.message, variant: "destructive" });
    } finally {
      setEcpayPending(false);
    }
  };

  const handleConfirmAllowanceNotIssued = async (allowance: EcpayAllowance) => {
    if (!ecpayInvoice || !confirm("系統會先向綠界核對剩餘可折讓金額；只有確認綠界未開立這筆折讓時，才會解除 ERP 保留額度。確定繼續？")) return;
    setEcpayPending(true);
    try {
      const res = await fetch(api(`invoices/${ecpayInvoice.id}/ecpay-allowances/${allowance.id}/confirm-not-issued`), { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "確認失敗");
      toast({ title: "已確認綠界未開立，折讓額度已解除保留" });
      setAllowanceKey(newAllowanceKey());
      await invalidateEcpay();
    } catch (err: any) {
      toast({ title: "無法解除保留", description: err.message, variant: "destructive" });
    } finally {
      setEcpayPending(false);
    }
  };

  const handleWriteOff = async (inv: any) => {
    const outstanding = Number(inv.outstandingAmount ?? (Number(inv.totalAmount) - Number(inv.paidAmount)));
    const reason = prompt(
      `確定將發票「${inv.invoiceNumber}」的未收餘額 NT$ ${outstanding.toLocaleString()} 轉列呆帳？\n\n系統會自動建立分錄（借：呆帳損失／貸：應收帳款）。\n請輸入呆帳原因（選填）：`,
      "",
    );
    if (reason === null) return;
    try {
      const res = await fetch(api(`invoices/${inv.id}/write-off`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "轉呆帳失敗");
      toast({ title: "已轉呆帳", description: `分錄 ${data.journalEntryNumber} 已自動建立` });
      queryClient.invalidateQueries({ queryKey: ["/erp-api/invoices"] });
    } catch (err: any) {
      toast({ title: "轉呆帳失敗", description: err.message, variant: "destructive" });
    }
  };

  const handleCancelWriteOff = async (inv: any) => {
    if (!confirm(`確定取消發票「${inv.invoiceNumber}」的呆帳？\n呆帳分錄會刪除，發票將恢復為未付款，可再進行收款。`)) return;
    try {
      const res = await fetch(api(`invoices/${inv.id}/cancel-write-off`), { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "取消呆帳失敗");
      toast({ title: "呆帳已取消", description: "發票已恢復為未收款狀態" });
      queryClient.invalidateQueries({ queryKey: ["/erp-api/invoices"] });
    } catch (err: any) {
      toast({ title: "取消呆帳失敗", description: err.message, variant: "destructive" });
    }
  };


  return (
    <div className="space-y-6">
      <PageHeader title="所有發票" description="完整發票登記簿" hint={<PageHint hintKey="accounting-invoices">這裡集中查看銷項與進項發票，方便追蹤開立、收取及付款狀態。一般先由出貨或進貨流程帶入，再核對日期、金額與稅額。小提醒：發票號碼與稅別填錯會影響營業稅申報，送出前務必核對憑證。</PageHint>}>
        <div className="flex items-center gap-2">
          <ExportMenu getExportOptions={buildExport} />
          <Button onClick={openCreate}><Plus size={16} className="mr-1" />登記發票（不送綠界）</Button>
        </div>
      </PageHeader>

      <p role="note" className="text-sm text-muted-foreground">
        此處新增的是 ERP 發票登記，不會自動向綠界開票。要開立電子發票，請到「銷貨單」使用「開立綠界電子發票」；只有取得綠界發票號碼才代表成功。
      </p>

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs text-muted-foreground">起始日期</Label>
              <Input type="date" className="w-40" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">結束日期</Label>
              <Input type="date" className="w-40" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <DateRangePresets from={dateFrom} to={dateTo} onChange={(r) => { setDateFrom(r.from); setDateTo(r.to); }} />
            <div>
              <Label className="text-xs text-muted-foreground">狀態</Label>
              <select className="flex h-10 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">全部</option>
                {statusOptions.map(s => <option key={s} value={s}>{statusMap[s]}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">搜尋</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="發票編號、對象名稱..." value={searchText} onChange={e => setSearchText(e.target.value)} />
              </div>
            </div>
            <div className="text-sm text-muted-foreground pb-2">共 {filtered.length} 筆</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={filtered}
            onRowClick={(r: any) => openEdit(r)}
            columns={[
              { header: "發票編號", accessor: "invoiceNumber" },
              {
                header: "綠界發票",
                accessor: (r) => r.ecpayInvoiceNumber ? (
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs">{r.ecpayInvoiceNumber}</span>
                    {r.ecpayVoidedAt && <Badge variant="destructive" className="text-xs">已作廢</Badge>}
                  </div>
                ) : <span className="text-muted-foreground text-xs">—</span>,
                className: "hidden md:table-cell",
              },
              { header: "類型", accessor: (r) => <Badge variant="outline">{invoiceTypeMap[r.invoiceType] || r.invoiceType}</Badge> },
              { header: "對象", accessor: (r) => r.customerName || r.supplierName || "-", className: "hidden sm:table-cell" },
              { header: "日期", accessor: "invoiceDate", className: "hidden md:table-cell" },
              {
                header: "狀態",
                accessor: (r) => (
                  <Badge variant={r.status === "Paid" ? "default" : r.status === "Cancelled" ? "destructive" : "secondary"}>
                    {statusMap[r.status] || r.status}
                  </Badge>
                ),
              },
              { header: "總額", accessor: (r) => `NT$ ${Number(r.totalAmount).toLocaleString()}`, className: "text-right" },
              {
                header: "操作",
                accessor: (r) => (
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    {(r.invoiceType === "Sales" || r.invoiceType === "Sales Invoice") && r.status !== "Paid" && r.status !== "Cancelled" && r.status !== "WrittenOff" && !r.ecpayVoidedAt && Number(r.totalAmount) > Number(r.paidAmount) && (
                      <Button variant="ghost" size="icon" onClick={() => { setReceiptInvoice(r); setReceiptOpen(true); }} title="收款">
                        <HandCoins size={14} className="text-emerald-600" />
                      </Button>
                    )}
                    {(r.invoiceType === "Sales" || r.invoiceType === "Sales Invoice") && ["Unpaid", "Overdue", "Submitted"].includes(r.status) && Number(r.totalAmount) > Number(r.paidAmount) && (
                      <Button variant="ghost" size="icon" onClick={() => handleWriteOff(r)} title="轉呆帳（自動建立分錄）">
                        <FileX2 size={14} className="text-red-600" />
                      </Button>
                    )}
                    {r.status === "WrittenOff" && (
                      <Button variant="ghost" size="icon" onClick={() => handleCancelWriteOff(r)} title="取消呆帳">
                        <Undo2 size={14} className="text-blue-600" />
                      </Button>
                    )}
                    {(r.invoiceType === "Sales" || r.invoiceType === "Sales Invoice") && r.ecpayInvoiceNumber && (
                      <Button variant="ghost" size="icon" onClick={() => openEcpayManager(r)} title="管理綠界發票與折讓" data-testid={`button-manage-ecpay-${r.id}`}>
                        <FileText size={14} className="text-orange-600" />
                      </Button>
                    )}
                    {(r.invoiceType === "Sales" || r.invoiceType === "Sales Invoice") && (
                      <Button variant="ghost" size="icon" onClick={() => setEmailInvoiceId(r.id)} title="寄送發票通知" data-testid={`button-email-invoice-${r.id}`}>
                        <Mail size={14} className="text-blue-600" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil size={14} /></Button>
                    {(r.invoiceType === "Credit Note" || r.invoiceType === "Debit Note") ? (
                      <Link
                        href={r.invoiceType === "Credit Note" ? "/sales/returns" : "/purchasing/returns"}
                        className="inline-flex h-8 items-center rounded-md px-2 text-xs text-muted-foreground hover:bg-muted"
                        title="自動折讓／扣項單須由原退貨單取消"
                      >
                        至原退貨單取消
                      </Link>
                    ) : !r.ecpayInvoiceNumber && (
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(r)} title="刪除發票"><Trash2 size={14} className="text-destructive" /></Button>
                    )}
                  </div>
                ),
                className: "w-28",
              },
            ]}
          />
        </CardContent>
      </Card>

      <InvoiceReceiptDialog
        invoice={receiptInvoice}
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/erp-api/invoices"] })}
      />

      <SendEmailDialog docType="invoice" docId={emailInvoiceId} open={emailInvoiceId != null} onOpenChange={(v) => !v && setEmailInvoiceId(null)} />

      <DocWindow
        open={ecpayOpen}
        onClose={() => { setEcpayOpen(false); setVoidTarget(null); }}
        name="綠界電子發票管理"
        number={ecpayInvoice?.invoiceNumber}
        status={ecpayInvoice?.ecpayVoidedAt ? <DocStatus label="已作廢" tone="destructive" /> : undefined}
        wide
        footer={<Button variant="outline" onClick={() => setEcpayOpen(false)}>關閉</Button>}
      >
          <div className="space-y-5">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><span className="text-muted-foreground">綠界發票號碼：</span><span className="font-mono font-medium" data-testid="text-ecpay-invoice-number">{ecpayInvoice?.ecpayInvoiceNumber}</span></div>
                <Button variant="outline" size="sm" onClick={handleSyncEcpay} disabled={ecpayPending} data-testid="button-sync-ecpay"><RefreshCw size={14} className="mr-1" />同步狀態</Button>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                <div><span className="text-muted-foreground">本機狀態：</span>{ecpayInvoice?.ecpayStatus || "—"}</div>
                <div><span className="text-muted-foreground">綠界遠端狀態：</span>{ecpayRemoteStatus || "尚未同步"}</div>
                <div><span className="text-muted-foreground">最後同步：</span>{ecpayInvoice?.ecpayLastSyncedAt ? new Date(ecpayInvoice.ecpayLastSyncedAt).toLocaleString() : "尚未同步"}</div>
                <div><span className="text-muted-foreground">發票總額：</span>NT$ {Number(ecpayInvoice?.totalAmount || 0).toLocaleString()}</div>
              </div>
            </div>

            {allowanceQuery.isLoading ? <div className="py-3 text-center text-sm text-muted-foreground">讀取折讓紀錄中...</div> : allowanceQuery.isError ? (
              <div className="rounded border border-destructive/30 p-3 text-sm text-destructive">無法讀取折讓紀錄，請稍後重試。</div>
            ) : (() => {
              const allowances = allowanceQuery.data || [];
              const activeAllowances = allowances.filter(a => !["Voided", "Failed"].includes(a.status));
              const allowed = activeAllowances.reduce((sum, a) => sum + Number(a.amount), 0);
              const remaining = Math.max(0, Number(ecpayInvoice?.totalAmount || 0) - allowed);
              const formAmount = allowanceItems.reduce((sum, item) => sum + Number(item.amount), 0);
              return <>
                <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
                  <div><div className="text-muted-foreground">累計有效折讓</div><div className="font-bold" data-testid="text-ecpay-allowed-amount">NT$ {allowed.toLocaleString()}</div></div>
                  <div><div className="text-muted-foreground">剩餘可折讓</div><div className="font-bold text-emerald-600" data-testid="text-ecpay-remaining-amount">NT$ {remaining.toLocaleString()}</div></div>
                </div>

                {!ecpayInvoice?.ecpayVoidedAt && remaining > 0 && <div className="border-t pt-4">
                  <div className="mb-2 flex items-center justify-between"><Label className="text-base font-semibold">建立部分折讓</Label><Button type="button" variant="outline" size="sm" onClick={() => setAllowanceItems(p => [...p, { name: "", count: 1, unitPrice: 0, amount: 0 }])} data-testid="button-add-allowance-item"><Plus size={14} className="mr-1" />新增品項</Button></div>
                  <div className="space-y-2">
                    {allowanceItems.map((item, index) => <div key={index} className="grid grid-cols-2 gap-2 rounded-md border p-2 md:grid-cols-12 md:border-0 md:p-0">
                      <Input className="col-span-2 md:col-span-5" placeholder="品項名稱" value={item.name} onChange={e => updateAllowanceItem(index, "name", e.target.value)} data-testid={`input-allowance-name-${index}`} />
                      <Input className="md:col-span-2" type="number" min="0.01" step="0.01" placeholder="數量" value={item.count} onChange={e => updateAllowanceItem(index, "count", Number(e.target.value))} data-testid={`input-allowance-count-${index}`} />
                      <Input className="md:col-span-2" type="number" min="0" step="0.01" placeholder="單價" value={item.unitPrice} onChange={e => updateAllowanceItem(index, "unitPrice", Number(e.target.value))} data-testid={`input-allowance-price-${index}`} />
                      <div className="flex items-center justify-end text-sm font-medium md:col-span-2">NT$ {Number(item.amount).toLocaleString()}</div>
                      <Button type="button" variant="ghost" size="icon" className="md:col-span-1" disabled={allowanceItems.length === 1} onClick={() => setAllowanceItems(p => p.filter((_, i) => i !== index))} data-testid={`button-remove-allowance-item-${index}`}><Trash2 size={14} className="text-destructive" /></Button>
                    </div>)}
                  </div>
                  <div className={`mt-2 text-right text-sm font-medium ${formAmount > remaining ? "text-destructive" : ""}`}>本次折讓：NT$ {formAmount.toLocaleString()} ／剩餘可折讓：NT$ {remaining.toLocaleString()}</div>
                  <div className="mt-3"><Label>折讓原因 *</Label><Input value={allowanceReason} onChange={e => setAllowanceReason(e.target.value)} maxLength={200} placeholder="例如：商品退回、金額更正" data-testid="input-allowance-reason" /></div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div><Label>通知方式</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={allowanceNotify} onChange={e => setAllowanceNotify(e.target.value as "N" | "E" | "S" | "A")} data-testid="select-allowance-notify"><option value="N">不通知</option><option value="E">Email</option><option value="S">簡訊</option><option value="A">Email 與簡訊</option></select></div>
                    <div><Label>Email</Label><Input type="email" value={allowanceEmail} onChange={e => setAllowanceEmail(e.target.value)} data-testid="input-allowance-email" /></div>
                    <div><Label>手機</Label><Input value={allowancePhone} onChange={e => setAllowancePhone(e.target.value)} data-testid="input-allowance-phone" /></div>
                  </div>
                  <Button className="mt-3" onClick={handleCreateAllowance} disabled={ecpayPending || formAmount <= 0 || formAmount > remaining || !allowanceReason.trim()} data-testid="button-create-allowance">{ecpayPending ? "處理中..." : "建立折讓單"}</Button>
                </div>}

                <div className="border-t pt-4"><Label className="text-base font-semibold">折讓紀錄</Label>
                  {allowances.length === 0 ? <div className="mt-2 text-sm text-muted-foreground">尚無折讓紀錄</div> : <div className="mt-2 divide-y rounded-md border">
                    {allowances.map(allowance => <div key={allowance.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                      <span className="font-mono font-medium">{allowance.allowanceNumber || "尚未取得單號"}</span><span>NT$ {Number(allowance.amount).toLocaleString()}</span><span className="text-muted-foreground">{String(allowance.allowanceDate || "").slice(0, 10)}</span>
                      <Badge variant={allowance.voidedAt ? "destructive" : "secondary"}>{allowance.voidedAt ? "已作廢" : allowance.status || "已開立"}</Badge>
                      <span className="text-muted-foreground">折讓原因：{allowance.reason}</span>
                      {allowance.voidReason && <span className="text-muted-foreground">原因：{allowance.voidReason}</span>}
                      {["Pending", "IssueReconcileRequired"].includes(allowance.status) && <>
                        <Button variant="outline" size="sm" className="ml-auto" onClick={() => handleReconcileAllowance(allowance)} disabled={ecpayPending} data-testid={`button-reconcile-allowance-${allowance.id}`}>連結綠界單號</Button>
                        <Button variant="ghost" size="sm" onClick={() => handleConfirmAllowanceNotIssued(allowance)} disabled={ecpayPending} data-testid={`button-confirm-allowance-not-issued-${allowance.id}`}>確認未開立</Button>
                      </>}
                      {["VoidPending", "VoidReconcileRequired"].includes(allowance.status) && allowance.allowanceNumber && <Button variant="outline" size="sm" className="ml-auto" onClick={() => { setVoidTarget({ kind: "allowance", id: allowance.id, number: allowance.allowanceNumber! }); setVoidReason(allowance.voidReason || "確認折讓作廢結果"); }} disabled={ecpayPending} data-testid={`button-reconcile-void-allowance-${allowance.id}`}>查詢作廢結果</Button>}
                      {allowance.status === "Issued" && allowance.allowanceNumber && <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={() => { setVoidTarget({ kind: "allowance", id: allowance.id, number: allowance.allowanceNumber! }); setVoidReason(""); }} data-testid={`button-void-allowance-${allowance.id}`}><Ban size={14} className="mr-1" />作廢</Button>}
                    </div>)}
                  </div>}
                </div>
              </>;
            })()}
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">綠界折讓僅影響稅務發票，不會自動異動 ERP 收款或會計帳務；庫存與會計請依既有銷貨退回／折讓單流程處理。</div>
            {!ecpayInvoice?.ecpayVoidedAt && <Button variant="outline" className="text-destructive" disabled={(allowanceQuery.data || []).some(a => !["Voided", "Failed"].includes(a.status))} onClick={() => { setVoidTarget({ kind: "invoice", number: ecpayInvoice?.ecpayInvoiceNumber || "" }); setVoidReason(""); }} data-testid="button-void-ecpay-invoice"><Ban size={14} className="mr-1" />作廢整張綠界發票</Button>}
            {voidTarget && <div className="rounded-md border border-destructive/40 p-3"><Label>作廢原因（必填）— {voidTarget.number}</Label><Input className="mt-2" value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="請說明作廢原因" data-testid="input-ecpay-void-reason" /><div className="mt-2 flex gap-2"><Button variant="destructive" size="sm" onClick={handleVoidEcpay} disabled={ecpayPending || !voidReason.trim()} data-testid="button-confirm-ecpay-void">{ecpayPending ? "處理中..." : "確認作廢"}</Button><Button variant="outline" size="sm" onClick={() => setVoidTarget(null)}>取消</Button></div></div>}
          </div>
      </DocWindow>

      {/* 新增、編輯發票：全系統同一個視窗（components/accounting/invoice-doc） */}
      <InvoiceCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <InvoiceEditDialog invoice={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
