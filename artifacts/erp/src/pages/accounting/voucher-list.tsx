import { useState, useMemo, useRef, useEffect } from "react";
import { departmentLabel, projectPickerLabel, selectableDepartments, selectableProjects } from "@/lib/select-options";
import { ChangeRequestDialog } from "@/components/accounting/change-request-dialog";
import { useListVouchers, useCreateVoucher, useDeleteVoucher, useListProjects, useListDepartments, useListCustomers, useListEmployees } from "@workspace/erp-api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { call, money, selectClass } from "@/lib/call";
import { PageHeader } from "@/components/shared/page-header";
import { PageHint } from "@/components/page-hint";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DocWindow, DocStatus, DocFields, DocLines, DocNote, DocSection, DocFormRows, DocFormRow, statusTone } from "@/components/shared/doc-window";
import { AttachmentsPanel } from "@/components/shared/attachments-panel";
import type { VoucherTemplate } from "@/pages/accounting/voucher-templates";
import { RelatedDocs } from "@/components/shared/related-docs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Search, Camera, Loader2, Sparkles, X, Ban, History, Pencil, Paperclip, FileText, RotateCcw } from "lucide-react";
import { VoucherHistoryDialog } from "@/components/accounting/voucher-history-dialog";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { TablePagination } from "@/components/shared/table-pagination";
import { Link } from "wouter";

import { LookupSelect } from "@/components/shared/lookup-select";
import { CashAccountSelect, LedgerAccountSelect } from "@/components/shared/ledger-account-select";
import { DateRangePresets } from "@/components/shared/date-range-presets";
import { PaymentRequestForm } from "@/components/accounting/payment-request-doc";
const statusColor: Record<string, string> = {
  "Draft": "bg-gray-100 text-gray-700",
  "Submitted": "bg-blue-100 text-blue-700",
  "Approved": "bg-green-100 text-green-700",
  "Rejected": "bg-red-100 text-red-700",
  "Posted": "bg-emerald-100 text-emerald-700",
  "Cancelled": "bg-red-100 text-red-700",
  "已過帳": "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

const statusLabel: Record<string, string> = {
  "Draft": "草稿",
  "Submitted": "已送出",
  "Approved": "已核准",
  "Rejected": "已駁回",
  "Posted": "已過帳",
  "Cancelled": "已取消",
};

/**
 * 新增表單下面那張表格的一行（老闆 2026-11-18：照 Ecount，一張單一個對象，每一行是科目、金額、手續費、摘要）。
 * 沖發票或核對訂單的行，科目一定是應收／應付，所以不用選。
 */
interface VoucherLine { description: string; amount: number; fee: number; accountId: string; invoiceId?: number; orderId?: number }
const blankLine = (): VoucherLine => ({ description: "", amount: 0, fee: 0, accountId: "" });
/** 跟 Ecount 一樣，表格一開始就有三行空白可以直接打 */
const START_ROWS = 3;
const padLines = (lines: VoucherLine[]): VoucherLine[] => lines.length >= START_ROWS ? lines : [...lines, ...Array.from({ length: START_ROWS - lines.length }, blankLine)];
const MAX_FILES = 10;
/** 表格裡的輸入框：電腦、手機都至少 40px 高，手指點得到 */
const cellClass = "h-10 md:h-10";

interface VoucherListProps {
  voucherType: string;
  title: string;
  description: string;
}

export default function VoucherList({ voucherType, title, description }: VoucherListProps) {
  const { data: vouchers, isLoading, refetch } = useListVouchers({ voucherType });
  const { data: projects } = useListProjects();
  const { data: departments } = useListDepartments();
  const { data: customers } = useListCustomers();
  const { data: employees } = useListEmployees();
  const queryClient = useQueryClient();
  const createVoucher = useCreateVoucher();
  const deleteVoucher = useDeleteVoucher();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  // 員工請款：手動填的請款跟「我的申請」是同一件事，用同一張付款申請表單（送審批 → 核准 → 付款才入帳）
  const [showRequest, setShowRequest] = useState(false);
  // 收款單、付款單：可以一行一行加的叫「摘要」（會變成日記帳的摘要），表頭那一格叫「備註」；「H」看這張單的操作紀錄
  const isCashSlip = voucherType === "收款單" || voucherType === "付款單";
  const [historyFor, setHistoryFor] = useState<{ id: number; number: string } | null>(null);
  const [deleteFor, setDeleteFor] = useState<any | null>(null);
  // 修改：備註、專案、部門；已入帳的送審（金額、日期、科目要改請刪除後重開）
  const [editFor, setEditFor] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ description: "", projectId: "", departmentId: "", reason: "" });
  const [editSaving, setEditSaving] = useState(false);
  const openVoucherEdit = (v: any) => { setEditFor(v); setEditForm({ description: v.description || "", projectId: v.projectId ? String(v.projectId) : "", departmentId: v.departmentId ? String(v.departmentId) : "", reason: "" }); };
  const submitVoucherEdit = async () => {
    if (!editFor) return;
    setEditSaving(true);
    try {
      const r = await fetch(`/erp-api/vouchers/${editFor.id}/edit-request`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editForm) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "送出失敗");
      toast(j.applied ? { title: `已直接執行（${j.requestNumber}）`, description: "公司裡沒有其他可以審核的人，系統已直接執行並留下紀錄" } : { title: `修改申請 ${j.requestNumber} 已送出`, description: "財務或超級管理員核准後才會改，可以到審批中心看進度" });
      setEditFor(null);
    } catch (e: any) { toast({ title: "送出失敗", description: e.message, variant: "destructive" }); }
    finally { setEditSaving(false); }
  };
  // 從日記帳「開啟原單」連過來會帶 ?search=單號：直接找那張，日期不限
  const linkedSearch = useMemo(() => new URLSearchParams(window.location.search).get("search") ?? "", []);
  const [search, setSearch] = useState(linkedSearch);

  const defaultRange = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return { from: `${y}-${m}-01`, to: `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}` };
  }, []);
  const [dateFrom, setDateFrom] = useState(linkedSearch ? "" : defaultRange.from);
  const [dateTo, setDateTo] = useState(linkedSearch ? "" : defaultRange.to);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // 錢進出哪個帳戶（收款單、付款單）；請款單記到哪個費用科目
  const [cashAccountId, setCashAccountId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const needsCashAccount = voucherType === "收款單" || voucherType === "付款單";
  // 外幣發票：收付當天的匯率（發票編號 → 匯率），和發票匯率的差額會記成兌換損益
  const [paymentRates, setPaymentRates] = useState<Record<number, string>>({});
  // 實際進出的台幣（外幣貨款換匯去付，和帳上金額不同）：差額記兌換損益
  const [actualCash, setActualCash] = useState("");
  // 收付款單模板：選了就帶出預設的帳戶、專案、摘要行，並多出模板的自訂欄位
  const templateType = voucherType === "收款單" ? "Receipt" : voucherType === "付款單" ? "Payment" : "";
  const { data: voucherTemplates = [] } = useQuery({ queryKey: ["/voucher-templates", templateType], queryFn: () => call<VoucherTemplate[]>(`voucher-templates?voucherType=${templateType}`), enabled: !!templateType, staleTime: 60_000 });
  const { data: allVoucherTemplates = [] } = useQuery({ queryKey: ["/voucher-templates", "all"], queryFn: () => call<VoucherTemplate[]>("voucher-templates?all=1"), enabled: !!templateType, staleTime: 60_000 });
  const [templateId, setTemplateId] = useState("");
  const [extraFields, setExtraFields] = useState<Record<string, string>>({});
  const template = voucherTemplates.find(t => String(t.id) === templateId) ?? null;
  const applyTemplate = (id: string) => {
    setTemplateId(id); setExtraFields({});
    const t = voucherTemplates.find(x => String(x.id) === id);
    if (!t) return;
    const c = t.config;
    setForm(f => ({
      ...f,
      description: c.description || f.description,
      projectId: c.projectId ? String(c.projectId) : f.projectId,
      departmentId: c.departmentId ? String(c.departmentId) : f.departmentId,
      items: c.lines?.length ? padLines(c.lines.map(l => ({ ...blankLine(), description: l.description, amount: Number(l.amount) || 0 }))) : f.items,
    }));
    if (c.cashAccountId) setCashAccountId(String(c.cashAccountId));
  };
  const [form, setForm] = useState({
    voucherDate: new Date().toISOString().split("T")[0],
    description: "",
    projectId: "",
    departmentId: "",
    customerId: "",
    supplierId: "",
    employeeId: "",
    items: padLines([]),
  });
  // 手續費記到哪個費用科目（有填手續費才用得到；沒選時先帶科目表裡名稱有「手續費」的那一個）
  const [feeAccountId, setFeeAccountId] = useState("");
  // 收款單、付款單新增時一起附上的檔案：單存好之後才上傳
  const [files, setFiles] = useState<File[]>([]);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const { data: ledgerAccounts = [] } = useQuery({ queryKey: ["/accounts"], queryFn: () => call<Array<{ id: number; accountNumber: string; accountName: string; accountType: string; isGroup: boolean }>>("accounts"), enabled: isCashSlip, staleTime: 60_000 });
  const allAccountTypes = useMemo(() => [...new Set(ledgerAccounts.map(a => a.accountType))], [ledgerAccounts]);
  const [openInvoices, setOpenInvoices] = useState<any[]>([]);
  // 還沒收（付）完的訂單：可直接核對訂單，用於還沒開發票就先收、先付的訂金
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  // 收款單：選了客戶後抓未結銷貨發票；付款單：選了供應商後抓未結採購發票
  const fetchOpenInvoices = async (partyId: string) => {
    if (!partyId || (voucherType !== "收款單" && voucherType !== "付款單")) { setOpenInvoices([]); setOpenOrders([]); return; }
    const orderUrl = voucherType === "收款單" ? `/erp-api/sales-orders?customerId=${partyId}` : `/erp-api/purchase-orders?supplierId=${partyId}`;
    fetch(orderUrl)
      .then(r => (r.ok ? r.json() : []))
      .then((rows: any[]) => setOpenOrders((Array.isArray(rows) ? rows : []).filter(o => o.status !== "Draft" && o.status !== "Cancelled" && Number(o.outstandingAmount) > 0)))
      .catch(() => setOpenOrders([]));
    setLoadingInvoices(true);
    try {
      const url = voucherType === "收款單" ? `/erp-api/customers/${partyId}/open-invoices` : `/erp-api/suppliers/${partyId}/open-invoices`;
      const r = await fetch(url);
      if (r.ok) setOpenInvoices(await r.json()); else setOpenInvoices([]);
    } catch { setOpenInvoices([]); }
    finally { setLoadingInvoices(false); }
  };

  const isReceipt = voucherType === "收款單";
  const invoiceText = (inv: any) => `沖銷發票 ${inv.invoiceNumber}`;
  const orderText = (order: any) => `${isReceipt ? "銷貨單" : "採購單"} ${order.orderNumber} ${isReceipt ? "收款" : "付款"}`;
  /** 這一行要沖哪一張單（"inv:發票編號"、"ord:訂單編號"，空字串＝不沖單）：帶出還沒收（付）完的金額和預設摘要 */
  const pickLink = (index: number, value: string) => {
    setForm(f => ({
      ...f,
      items: f.items.map((it, idx) => {
        if (idx !== index) return it;
        const oldInvoice = it.invoiceId ? openInvoices.find(x => x.id === it.invoiceId) : null;
        const oldOrder = it.orderId ? openOrders.find(x => x.id === it.orderId) : null;
        const autoText = oldInvoice ? invoiceText(oldInvoice) : oldOrder ? orderText(oldOrder) : "";
        // 系統自動帶的摘要跟著換；自己打的摘要留著
        const typed = it.description && it.description !== autoText ? it.description : "";
        const base: VoucherLine = { ...it, invoiceId: undefined, orderId: undefined, description: typed };
        if (value.startsWith("inv:")) {
          const inv = openInvoices.find(x => x.id === Number(value.slice(4)));
          return inv ? { ...base, accountId: "", invoiceId: inv.id, amount: Number(inv.outstandingAmount) || 0, description: typed || invoiceText(inv) } : base;
        }
        if (value.startsWith("ord:")) {
          const order = openOrders.find(x => x.id === Number(value.slice(4)));
          return order ? { ...base, accountId: "", orderId: order.id, amount: Number(order.outstandingAmount) || 0, description: typed || orderText(order) } : base;
        }
        return base;
      }),
    }));
  };
  /** 換對象：原本沖的發票、訂單是上一個對象的，要拿掉；自己打的一般行留著 */
  const changeParty = (key: "customerId" | "supplierId", value: string) => {
    setForm(f => ({ ...f, [key]: value, items: padLines(f.items.filter(it => !it.invoiceId && !it.orderId)) }));
    setPaymentRates({});
    setActualCash("");
    fetchOpenInvoices(value);
  };
  const [aiCategory, setAiCategory] = useState<{ code: string; name: string; group: string; accountNumber: string; accountName: string } | null>(null);
  const [aiInfo, setAiInfo] = useState<{ merchant?: string; invoiceNumber?: string; taxId?: string; tax?: number; reason?: string; confidence?: number } | null>(null);
  const [pendingAttachmentIds, setPendingAttachmentIds] = useState<number[]>([]);
  const [aiCategories, setAiCategories] = useState<Array<{ code: string; name: string; group: string; accountNumber: string; accountName: string }>>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [confirmingAi, setConfirmingAi] = useState(false);
  const [lastAiCreated, setLastAiCreated] = useState<{
    voucherId: number; voucherNumber: string; journalEntryId: number; entryNumber: string;
    invoiceId: number; invoiceNumber: string; paymentRequestId: number; requestNumber: string;
  } | null>(null);
  const [scanning, setScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (voucherType !== "請款單" && voucherType !== "付款單") return;
    if (voucherType === "請款單") {
      fetch(`/erp-api/reimbursement/categories`)
        .then(r => r.ok ? r.json() : Promise.reject(new Error("分類載入失敗")))
        .then(setAiCategories)
        .catch(() => setAiCategories([]));
    }
    fetch(`/erp-api/suppliers`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error("供應商載入失敗")))
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, [voucherType]);

  const resetForm = () => {
    setForm({ voucherDate: new Date().toISOString().split("T")[0], description: "", projectId: "", departmentId: "", customerId: "", supplierId: "", employeeId: "", items: padLines([]) });
    setAiCategory(null);
    setAiInfo(null);
    setPendingAttachmentIds([]);
    setSupplierId("");
    setOpenInvoices([]);
    setOpenOrders([]);
    setPaymentRates({});
    setActualCash("");
    setFeeAccountId("");
    setFiles([]);
    setTemplateId(""); setExtraFields({});
  };

  const handleAiScan = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setScanning(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append("files", f));
      const resp = await fetch(`/erp-api/reimbursement/scan`, { method: "POST", body: fd });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const p = data.parsed || {};
      const cat = data.category;

      const items = (p.items && p.items.length > 0)
        ? p.items.map((it: any) => ({ ...blankLine(), description: String(it.description || ""), amount: Number(it.amount || 0) }))
        : [{ ...blankLine(), description: p.merchant || "", amount: Number(p.total_amount || 0) }];

      const datePart = p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : form.voucherDate;
      const desc = [p.merchant, p.invoice_number].filter(Boolean).join(" / ");

      setForm(f => ({
        ...f,
        voucherDate: datePart,
        description: desc || f.description,
        items,
      }));
      setAiCategory(cat);
      setAiInfo({
        merchant: p.merchant,
        invoiceNumber: p.invoice_number,
        taxId: p.tax_id,
        tax: p.tax_amount,
        reason: p.category_reason,
        confidence: p.confidence,
      });
      const normalize = (value: unknown) => String(value || "").replace(/[\s()（）股份有限公司企業社]/g, "").toLowerCase();
      const taxId = String(p.tax_id || "").trim();
      const merchant = normalize(p.merchant);
      const matchedSupplier = suppliers.find((s: any) =>
        (taxId && String(s.taxId || "").trim() === taxId) ||
        (merchant && (normalize(s.name).includes(merchant) || merchant.includes(normalize(s.name))))
      );
      setSupplierId(matchedSupplier ? String(matchedSupplier.id) : "");
      const attIds = (data.attachments || []).filter((a: any) => a && a.id).map((a: any) => a.id);
      setPendingAttachmentIds(prev => [...prev, ...attIds]);
      toast({ title: "AI 識別完成", description: `已分類為 ${cat.code} ${cat.name}（${cat.accountNumber} ${cat.accountName}）` });
    } catch (err: any) {
      toast({ title: "AI 識別失敗", description: err?.message || "請重試", variant: "destructive" });
    } finally {
      setScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, blankLine()] }));
  const removeItem = (i: number) => setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  const updateItem = (i: number, field: string, val: any) => {
    setForm(f => ({
      ...f,
      items: f.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item),
    }));
  };

  const handleCreate = async () => {
    if (!form.projectId) {
      toast({ title: "請選擇專案", description: "每一筆收入與支出都必須歸屬到專案", variant: "destructive" });
      return;
    }
    const missing = template?.config.fields?.find(f => f.required && !String(extraFields[f.name] ?? "").trim());
    if (missing) { toast({ title: `請填「${missing.label}」`, description: `模板「${template!.name}」規定這一欄要填`, variant: "destructive" }); return; }
    if (needsCashAccount && !cashAccountId) {
      toast({ title: `請選擇${voucherType === "收款單" ? "收款" : "付款"}帳戶`, description: "要知道錢進出哪個帳戶，銀行存款的帳才會對", variant: "destructive" });
      return;
    }
    // 請款單不再手動直接入帳：沒有掃描憑證的請款，請用「新增請款（送審批）」，才會有人審、有人付
    if (voucherType === "請款單" && !aiCategory) {
      toast({ title: "請先掃描發票或收據", description: "沒有憑證要掃的請款，請關掉這個視窗，改按「新增請款（送審批）」", variant: "destructive" });
      return;
    }
    // 收款單、付款單：有金額的行都要存；漏填的先擋下來，不會默默少記一行
    if (isCashSlip) {
      const problem = (title: string, description: string) => { toast({ title, description, variant: "destructive" }); };
      for (const [i, it] of form.items.entries()) {
        const n = i + 1;
        if (it.fee < 0 || it.amount < 0) { problem(`第 ${n} 行的金額、手續費不能是負數`, "要沖回或折讓請用作廢或其他單據"); return; }
        if (it.fee > 0 && !(it.amount > 0)) { problem(`第 ${n} 行有手續費但沒有金額`, "請填這一行的金額，或把手續費清掉"); return; }
        if (it.amount > 0 && !it.description.trim()) { problem(`第 ${n} 行請填摘要`, "摘要會顯示在日記帳，這一行有金額所以要填"); return; }
        if (isReceipt && it.fee > 0 && it.fee >= it.amount) { problem(`第 ${n} 行手續費不能大於或等於金額`, "收款的手續費是對方匯款時被扣掉的，一定比金額小"); return; }
      }
      if (!form.items.some(it => it.amount > 0)) { problem("請至少填一行金額", "下面的表格每一行填摘要和金額"); return; }
      if (feeTotal > 0 && !feeAccountValue) { problem("請選擇手續費要記到哪個科目", "表格下面「手續費科目」那一格"); return; }
    }
    try {
      const items = form.items.filter(it => it.description.trim() && it.amount > 0).map(it => ({
        description: it.description.trim(),
        amount: it.amount,
        ...(isCashSlip && !it.invoiceId && !it.orderId && it.accountId ? { accountId: Number(it.accountId) } : {}),
        ...(isCashSlip && it.fee > 0 ? { fee: it.fee } : {}),
        ...(it.invoiceId && Number(it.invoiceId) > 0 ? { invoiceId: Number(it.invoiceId) } : {}),
        ...(it.invoiceId && Number(paymentRates[Number(it.invoiceId)]) > 0 ? { exchangeRate: Number(paymentRates[Number(it.invoiceId)]) } : {}),
        ...(it.orderId && Number(it.orderId) > 0 ? (voucherType === "收款單" ? { salesOrderId: Number(it.orderId) } : { purchaseOrderId: Number(it.orderId) }) : {}),
        ...(aiCategory ? { categoryCode: aiCategory.code, accountNumber: aiCategory.accountNumber } : {}),
      }));
      if (voucherType === "請款單" && aiCategory) {
        setConfirmingAi(true);
        const response = await fetch(`/erp-api/reimbursement/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: form.voucherDate,
            description: form.description,
            merchant: aiInfo?.merchant,
            invoiceNumber: aiInfo?.invoiceNumber,
            taxId: aiInfo?.taxId,
            totalAmount: items.reduce((sum, it) => sum + it.amount, 0),
            taxAmount: aiInfo?.tax || 0,
            categoryCode: aiCategory.code,
            projectId: form.projectId ? Number(form.projectId) : null,
            departmentId: form.departmentId ? Number(form.departmentId) : null,
            employeeId: form.employeeId ? Number(form.employeeId) : null,
            supplierId: supplierId ? Number(supplierId) : null,
            attachmentIds: pendingAttachmentIds,
            items,
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
        setLastAiCreated({
          voucherId: json.voucher.id,
          voucherNumber: json.voucher.voucherNumber,
          journalEntryId: json.journalEntry.id,
          entryNumber: json.journalEntry.entryNumber,
          invoiceId: json.invoice.id,
          invoiceNumber: json.invoice.invoiceNumber,
          paymentRequestId: json.paymentRequest.id,
          requestNumber: json.paymentRequest.requestNumber,
        });
        toast({ title: "憑證已確認入帳", description: `${json.voucher.voucherNumber} / ${json.journalEntry.entryNumber}` });
        setShowCreate(false);
        resetForm();
        refetch();
        return;
      }
      const created = await createVoucher.mutateAsync({
        data: {
          voucherType,
          voucherDate: form.voucherDate,
          description: form.description || undefined,
          projectId: form.projectId ? Number(form.projectId) : undefined,
          departmentId: form.departmentId ? Number(form.departmentId) : undefined,
          customerId: form.customerId ? Number(form.customerId) : undefined,
          supplierId: form.supplierId ? Number(form.supplierId) : undefined,
          employeeId: form.employeeId ? Number(form.employeeId) : undefined,
          items,
          ...(needsCashAccount && cashAccountId ? { cashAccountId: Number(cashAccountId) } : {}),
          ...(isCashSlip && feeTotal > 0 ? { feeAccountId: Number(feeAccountValue) } : {}),
          ...(template ? { templateId: template.id, extraFields } : {}),
          ...(needsCashAccount && Number(actualCash) > 0 && items.some(it => "invoiceId" in it || "salesOrderId" in it || "purchaseOrderId" in it) ? { actualCashAmount: Number(actualCash) } : {}),
          ...(voucherType === "請款單" && expenseAccountId ? { expenseAccountId: Number(expenseAccountId) } : {}),
        } as any,
      });

      // 把先前 AI scan 上傳但 documentId=0 的附件，串到剛建立的請款單
      const createdId = (created as any)?.id as number | undefined;
      const createdNumber = (created as any)?.voucherNumber as string | undefined;
      if (pendingAttachmentIds.length > 0 && createdId) {
        await Promise.all(pendingAttachmentIds.map(aid =>
          fetch(`/erp-api/attachments/${aid}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              documentType: voucherType,
              documentId: createdId,
              description: `${aiInfo?.merchant ?? ""} / 請款單 ${createdNumber ?? createdId}`,
            }),
          }).catch(() => null)
        ));
      }

      // 單已經存好；附件另外傳，傳失敗也不影響這張單，點開這張單可以再補
      let uploadNote = "";
      if (isCashSlip && files.length > 0 && createdId) {
        const results = await Promise.all(files.map(file => {
          const body = new FormData();
          body.append("file", file);
          body.append("module", "accounting");
          body.append("documentType", voucherType);
          body.append("documentId", String(createdId));
          return fetch(`/erp-api/attachments`, { method: "POST", credentials: "include", body }).then(r => r.ok).catch(() => false);
        }));
        const failed = results.filter(ok => !ok).length;
        uploadNote = failed > 0 ? `有 ${failed} 個附件沒傳上去，點開這張單可以補傳` : `已附上 ${files.length} 個檔案`;
        if (failed > 0) toast({ title: `${title}已儲存，但附件沒有全部傳上去`, description: uploadNote, variant: "destructive" });
      }

      toast({ title: `${title}已儲存`, description: [createdNumber, uploadNote].filter(Boolean).join("・") || undefined });
      setShowCreate(false);
      resetForm();
      refetch();
    } catch (err: any) {
      toast({ title: "建立失敗", description: err?.message, variant: "destructive" });
    } finally { setConfirmingAi(false); }
  };

  // 已入帳的傳票不能刪除，只能作廢：系統會開一張沖銷分錄，並取消對發票、訂單的沖帳
  const handleVoid = async (v: any) => {
    const reason = window.prompt(`確定作廢 ${v.voucherNumber}？\n系統會自動開沖銷分錄，原紀錄會保留。\n\n作廢原因（選填）：`, "");
    if (reason === null) return;
    try {
      const response = await fetch(`/erp-api/vouchers/${v.id}/void`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "作廢失敗");
      toast({ title: "已作廢", description: `${v.voucherNumber} 已作廢並開立沖銷分錄` });
      refetch();
    } catch (err: any) {
      toast({ title: "作廢失敗", description: err.message, variant: "destructive" });
    }
  };

  const totalAmount = form.items.reduce((sum, it) => sum + (it.amount || 0), 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const feeTotal = isCashSlip ? round2(form.items.reduce((sum, it) => sum + (it.amount > 0 ? it.fee || 0 : 0), 0)) : 0;
  const feeAccountValue = feeAccountId || String(ledgerAccounts.find(a => !a.isGroup && a.accountType === "Expense" && /手續費/.test(a.accountName))?.id ?? "");
  const feeAccountName = ledgerAccounts.find(a => String(a.id) === feeAccountValue)?.accountName ?? "";
  const cashAccountName = ledgerAccounts.find(a => String(a.id) === cashAccountId)?.accountName ?? "";
  // 外幣發票的行填的是外幣金額：換成台幣（有填今天匯率用今天的，沒填用發票入帳的匯率）才知道帳戶實際進出多少
  const foreignInvoice = (it: VoucherLine) => { const inv = it.invoiceId ? openInvoices.find(x => x.id === it.invoiceId) : null; return inv && inv.currency && inv.currency !== "TWD" ? inv : null; };
  const hasForeign = form.items.some(it => it.amount > 0 && !!foreignInvoice(it));
  const bookedCash = round2(form.items.reduce((sum, it) => {
    const inv = foreignInvoice(it);
    const rate = inv ? (Number(paymentRates[inv.id]) > 0 ? Number(paymentRates[inv.id]) : Number(inv.exchangeRate) || 1) : 1;
    return sum + (it.amount || 0) * rate;
  }, 0));
  const hasInvoiceLine = form.items.some(it => Number(it.invoiceId || 0) > 0);
  const actualCashValue = hasInvoiceLine && Number(actualCash) > 0 ? Number(actualCash) : 0;
  // 帳戶實際進出：收款＝金額 − 手續費；付款＝金額 ＋ 手續費；有填「實際收到／付出的台幣」就以那個數字為準
  const netCash = actualCashValue > 0 ? actualCashValue : round2(isReceipt ? bookedCash - feeTotal : bookedCash + feeTotal);
  const partyId = isReceipt ? form.customerId : form.supplierId;
  const hasFormInput = !!(form.description || form.projectId || form.departmentId || form.customerId || form.supplierId || form.employeeId || files.length || aiCategory || form.items.some(it => it.description || it.amount || it.fee || it.accountId));

  // 申請修改視窗上半部顯示這張單現在的內容：明細只列看得懂的行（Ecount 搬來的歷史單沒有明細）
  const editLines: Array<{ description: string; amount: number; fee: number }> = editFor && editFor.legacy !== true && Array.isArray(editFor.items)
    ? (editFor.items as any[]).filter(it => it && typeof it.description === "string" && Number(it.amount) > 0).map(it => ({ description: it.description, amount: Number(it.amount), fee: Number(it.fee) || 0 }))
    : [];
  const editFeeTotal = editLines.reduce((sum, l) => sum + l.fee, 0);
  const partyLabel = voucherType === "請款單" ? "請款人" : voucherType === "付款單" ? "供應商" : "客戶";
  // 狀態徽章顏色照共用規則；這裡的狀態有中文的（已過帳、已作廢），另外對應
  const voucherTone = (s: string) => s === "已作廢" ? "destructive" as const : s === "已過帳" ? "default" as const : statusTone(s);

  const filtered = useMemo(() => {
    return (vouchers || []).filter((v: any) => {
      if (dateFrom && v.voucherDate < dateFrom) return false;
      if (dateTo && v.voucherDate > dateTo) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(v.voucherNumber.toLowerCase().includes(q) ||
          (v.description || "").toLowerCase().includes(q) ||
          (v.projectName || "").toLowerCase().includes(q) ||
          (v.departmentName || "").toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [vouchers, dateFrom, dateTo, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

  const batch = useBatchSelection(paged);

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        hint={voucherType === "請款單" ? <PageHint hintKey="reimbursement-scan">這裡處理員工代墊費用。一般的請款按「新增請款（送審批）」，跟「我的申請」是同一張表單，核准、付款後才入帳。手上有發票或收據要直接入帳的，按「掃描憑證入帳」：上傳憑證 → 核對辨識結果與費用分類 → 補上專案或部門 → 確認入帳。小提醒：掃描結果可能有誤，發票號碼、金額與稅額一定要對照原始憑證。</PageHint> : undefined}
      >
        {voucherType === "請款單" ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setShowRequest(true)} size="sm" data-testid="button-new-reimbursement-request"><Plus className="h-4 w-4 mr-1" />新增請款（送審批）</Button>
            <Button onClick={() => setShowCreate(true)} size="sm" variant="outline">掃描憑證入帳</Button>
          </div>
        ) : (
          <Button onClick={() => setShowCreate(true)} size="sm"><Plus className="h-4 w-4 mr-1" />新增{title}</Button>
        )}
      </PageHeader>
      {voucherType === "請款單" && <PaymentRequestForm open={showRequest} onOpenChange={setShowRequest} />}
      {lastAiCreated && (
        <Card className="border-green-300 bg-green-50/40">
          <CardContent className="py-3 text-sm">
            憑證已入帳：<Link href="/accounting/reimbursement" className="text-primary font-medium hover:underline">{lastAiCreated.voucherNumber}</Link>
            <span className="mx-2">／</span>
            <Link href="/accounting/journal" className="text-primary font-medium hover:underline">{lastAiCreated.entryNumber}</Link>
            <span className="mx-2">／</span>
            <Link href="/accounting/invoices" className="text-primary font-medium hover:underline">{lastAiCreated.invoiceNumber}</Link>
            <span className="mx-2">／</span>
            <Link href="/accounting/payment-requests" className="text-primary font-medium hover:underline">{lastAiCreated.requestNumber}</Link>
          </CardContent>
        </Card>
      )}

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName={title}
          entityEndpoint="vouchers"
          ids={batch.ids}
          onClear={batch.clearSelection}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ["/erp-api/vouchers"] })}
        />
      )}

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
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">搜尋</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="搜尋單號、說明、專案、部門..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="text-sm text-muted-foreground pb-2">共 {filtered.length} 筆</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                  <th className="text-left px-4 py-3 font-medium">單號</th>
                  <th className="text-left px-4 py-3 font-medium">日期</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">{isCashSlip ? "備註" : "說明"}</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">專案</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">部門</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">{voucherType === "請款單" ? "請款人" : voucherType === "付款單" ? "供應商" : "客戶"}</th>
                  {needsCashAccount && <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">{voucherType === "收款單" ? "收款帳戶" : "付款帳戶"}</th>}
                  <th className="text-right px-4 py-3 font-medium">金額</th>
                  <th className="text-center px-4 py-3 font-medium">狀態</th>
                  <th className="text-center px-4 py-3 font-medium w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={11} className="text-center py-8 text-gray-400">載入中...</td></tr>
                ) : !filtered?.length ? (
                  <tr><td colSpan={11} className="text-center py-8 text-gray-400">尚無資料</td></tr>
                ) : paged.map(v => (
                  <tr key={v.id} className="border-b hover:bg-gray-50 cursor-pointer" title="點一下看這張單的內容"
                    onClick={(e) => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; openVoucherEdit(v); }}>
                    <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(v.id)} onChange={() => batch.toggle(v.id)} /></td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{v.voucherNumber}{(v as any).legacy === true && <span className="ml-1.5 inline-block rounded border px-1 font-sans text-[10px] font-normal text-muted-foreground align-middle" title="從舊系統 Ecount 搬過來的歷史紀錄，只能查看">歷史</span>}</td>
                    <td className="px-4 py-3">{v.voucherDate}</td>
                    <td className="px-4 py-3 hidden sm:table-cell max-w-[200px] truncate">{v.description || "-"}</td>
                    <td className="px-4 py-3 hidden md:table-cell">{v.projectName || "-"}</td>
                    <td className="px-4 py-3 hidden md:table-cell">{v.departmentName || "-"}</td>
                    <td className="px-4 py-3 hidden lg:table-cell">{v.employeeName || v.customerName || (v as any).supplierName || "-"}</td>
                    {needsCashAccount && <td className="px-4 py-3 hidden lg:table-cell">{(v as any).cashAccountName || "-"}</td>}
                    <td className="px-4 py-3 text-right font-mono">${Number(v.totalAmount).toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${v.status === "已作廢" ? "bg-gray-200 text-gray-600 line-through" : statusColor[v.status] || "bg-gray-100"}`}>{statusLabel[v.status] || v.status}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex gap-1 justify-center">
                        {isCashSlip && (
                          <Button variant="ghost" size="sm" onClick={() => setHistoryFor({ id: v.id, number: v.voucherNumber })} title="H：這張單的操作紀錄（誰、什麼時候新增、修改、作廢）" aria-label="操作紀錄" data-testid={`button-history-voucher-${v.id}`}>
                            <History className="h-4 w-4" />
                          </Button>
                        )}
                        {isCashSlip && (
                          <Button variant="ghost" size="sm" onClick={() => openVoucherEdit(v)} title="修改備註、專案、部門（已入帳的要送審）" aria-label="修改" data-testid={`button-edit-voucher-${v.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {isCashSlip && (
                          <Button variant="ghost" size="sm" onClick={() => setDeleteFor(v)} title="刪除：已入帳、已作廢或 Ecount 搬來的單要送審，核准後單據和分錄一起刪" aria-label="刪除" data-testid={`button-delete-voucher-${v.id}`}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                        {v.status === "已作廢" || (v as any).legacy === true ? (
                          <span className="text-xs text-muted-foreground" title={(v as any).legacy === true ? "歷史紀錄只能查看" : undefined}>—</span>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => handleVoid(v)} title="作廢" aria-label="作廢" data-testid={`button-void-voucher-${v.id}`}>
                            <Ban className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            total={filtered.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          />
        </CardContent>
      </Card>

      <VoucherHistoryDialog voucher={historyFor} onClose={() => setHistoryFor(null)} />

      <DocWindow
        open={!!editFor} onClose={() => setEditFor(null)}
        name={title} number={editFor?.voucherNumber}
        status={editFor ? <DocStatus label={statusLabel[editFor.status] || editFor.status} tone={voucherTone(editFor.status)} /> : undefined}
        footer={<>
          <Button variant="outline" onClick={() => setEditFor(null)}>關閉</Button>
          {isCashSlip && <Button disabled={editSaving || !editForm.reason.trim()} onClick={submitVoucherEdit} data-testid="button-submit-voucher-edit">送出修改申請</Button>}
        </>}
      >
        {editFor && (
          <>
            <DocFields items={[
              ["日期", editFor.voucherDate],
              ["金額", `$${Number(editFor.totalAmount).toLocaleString()}`],
              editFeeTotal > 0 && ["手續費", `$${editFeeTotal.toLocaleString()}`],
              [partyLabel, editFor.employeeName || editFor.customerName || editFor.supplierName],
              needsCashAccount && [voucherType === "收款單" ? "收款帳戶" : "付款帳戶", editFor.cashAccountName],
              ["專案", editFor.projectName],
              ["部門", editFor.departmentName],
              ["模板", editFor.templateId ? allVoucherTemplates.find(t => t.id === editFor.templateId)?.name : null],
              ...Object.entries((editFor.extraFields ?? {}) as Record<string, unknown>).map(([key, value]) =>
                [allVoucherTemplates.find(t => t.id === editFor.templateId)?.config.fields?.find(f => f.name === key)?.label ?? key, String(value)] as [string, string]),
            ]} />
            {editLines.length > 0 && (
              <DocLines
                columns={[
                  { header: isCashSlip ? "摘要" : "項目", cell: (row: { description: string; amount: number; fee: number }) => row.description },
                  ...(editFeeTotal > 0 ? [{ header: "手續費", align: "right" as const, cell: (row: { description: string; amount: number; fee: number }) => row.fee > 0 ? `$${row.fee.toLocaleString()}` : "" }] : []),
                  { header: "金額", align: "right", cell: (row: { description: string; amount: number; fee: number }) => `$${row.amount.toLocaleString()}` },
                ]}
                rows={editLines}
                total={{ value: `$${Number(editFor.totalAmount).toLocaleString()}` }}
              />
            )}
            <DocNote label={isCashSlip ? "備註" : "說明"}>{editFor.description}</DocNote>
            {editFor.legacy !== true && <AttachmentsPanel module="accounting" documentType={voucherType} documentId={editFor.id} />}
            <RelatedDocs type="voucher" id={editFor.id} onNavigate={() => setEditFor(null)} />
          </>
        )}
        {/* 收款單、付款單可以申請修改；請款單只能看 */}
        {isCashSlip && (
        <DocSection title="申請修改">
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">可以改備註、專案、部門，要財務或超級管理員其一核准（財務提出的由超級管理員核准），審核人也可以直接調整。金額、日期、科目要改，請按刪除送審後重開一張。</p>
            <div><Label>備註</Label><Input value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} /></div>
            <div><Label>專案</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={editForm.projectId} onChange={e => setEditForm(p => ({ ...p, projectId: e.target.value }))}>
                <option value="">（不指定）</option>
                {selectableProjects(projects as any[], editForm.projectId).map((p: any) => <option key={p.id} value={p.id}>{projectPickerLabel(p)}</option>)}
              </select></div>
            <div><Label>部門</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={editForm.departmentId} onChange={e => setEditForm(p => ({ ...p, departmentId: e.target.value }))}>
                <option value="">（不指定）</option>
                {selectableDepartments(departments as any[], editForm.departmentId).map((d: any) => <option key={d.id} value={d.id}>{departmentLabel(d)}</option>)}
              </select></div>
            <div><Label>原因 *</Label><Input value={editForm.reason} onChange={e => setEditForm(p => ({ ...p, reason: e.target.value }))} placeholder="例如：專案選錯" /></div>
          </div>
        </DocSection>
        )}
      </DocWindow>
      {deleteFor && (
        <ChangeRequestDialog open onClose={() => setDeleteFor(null)} title={`申請刪除 ${deleteFor.voucherNumber}`}
          endpoint={`/erp-api/vouchers/${deleteFor.id}/delete-request`}
          description={<>要刪除 <b>{deleteFor.voucherNumber}</b>（{deleteFor.voucherDate}，${Number(deleteFor.totalAmount).toLocaleString()}）。核准後這張單、它的分錄（含作廢沖回的那筆）和沖帳紀錄會一起刪除。{deleteFor.legacy === true && " 這張是從 Ecount 搬來的，刪除後會跟 Ecount 對不上，請確認。"}</>} />
      )}
      {/* 新增表單（老闆 2026-11-18：照 Ecount 的輸入畫面）：上面一格一列的表頭（日期、對象、帳戶、專案、部門、備註、附件），
          下面一張有編號的表格（一行一筆），最下面是合計和按鈕。一張單只有一個對象、一個收付款帳戶。 */}
      <DocWindow
        open={showCreate} onClose={() => { setShowCreate(false); resetForm(); }}
        name={`新增${title}`}
        wide={isCashSlip}
        footer={<>
          <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
          <Button variant="outline" disabled={createVoucher.isPending || confirmingAi}
            onClick={() => { if (!hasFormInput || window.confirm("把這張單已經填的內容全部清掉，重新輸入？")) resetForm(); }} data-testid="button-reset-voucher">
            <RotateCcw className="mr-1 h-4 w-4" />重新輸入
          </Button>
          <Button onClick={handleCreate} disabled={createVoucher.isPending || confirmingAi || (!!aiCategory && voucherType === "請款單" && !supplierId)} data-testid="button-save-voucher">
            {createVoucher.isPending || confirmingAi ? "儲存中..." : aiCategory && voucherType === "請款單" ? "確認入帳" : "儲存"}
          </Button>
        </>}
      >
          <div className="space-y-4">
            {voucherType === "請款單" && (
              <div className="rounded-lg border-2 border-dashed border-purple-200 bg-purple-50/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-purple-600" />
                    <span className="font-medium text-purple-900">智慧報帳：拍照／上傳發票，AI 自動填單</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    capture="environment"
                    className="hidden"
                    onChange={e => handleAiScan(e.target.files)}
                  />
                  <Button type="button" size="sm" variant="default" disabled={scanning} onClick={() => fileInputRef.current?.click()}>
                    {scanning ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />識別中…</> : <><Camera className="h-4 w-4 mr-1" />拍照／上傳</>}
                  </Button>
                </div>
                {aiCategory && (
                  <div className="text-sm space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">分類 {aiCategory.code} {aiCategory.name}</Badge>
                      <Badge variant="outline">會計科目 {aiCategory.accountNumber} {aiCategory.accountName}</Badge>
                      {typeof aiInfo?.confidence === "number" && (
                        <Badge variant="outline">信心 {Math.round((aiInfo.confidence || 0) * 100)}%</Badge>
                      )}
                      {pendingAttachmentIds.length > 0 && (
                        <Badge variant="outline">已存 {pendingAttachmentIds.length} 張發票</Badge>
                      )}
                    </div>
                    {(aiInfo?.merchant || aiInfo?.invoiceNumber || aiInfo?.taxId) && (
                      <div className="text-xs text-muted-foreground">
                        {aiInfo?.merchant && <span className="mr-3">商家：{aiInfo.merchant}</span>}
                        {aiInfo?.invoiceNumber && <span className="mr-3">發票：{aiInfo.invoiceNumber}</span>}
                        {aiInfo?.taxId && <span className="mr-3">統編：{aiInfo.taxId}</span>}
                        {typeof aiInfo?.tax === "number" && aiInfo.tax > 0 && <span>稅額：${aiInfo.tax}</span>}
                      </div>
                    )}
                    {aiInfo?.reason && <div className="text-xs text-muted-foreground italic">AI 判斷：{aiInfo.reason}</div>}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                      <div>
                        <Label>費用類別</Label>
                        <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={aiCategory.code} onChange={e => {
                          const selected = aiCategories.find(c => c.code === e.target.value);
                          if (selected) setAiCategory(selected);
                        }}>
                          {aiCategories.map(c => <option key={c.code} value={c.code}>{c.code} {c.name}（{c.accountName}）</option>)}
                        </LookupSelect>
                      </div>
                      <div>
                        <Label>稅額</Label>
                        <Input type="number" min="0" value={aiInfo?.tax || ""} onChange={e => setAiInfo(info => ({ ...info, tax: Number(e.target.value) }))} />
                      </div>
                      <div className="col-span-2">
                        <Label>供應商（用於採購發票與付款申請）</Label>
                        <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                          <option value="">請選擇供應商</option>
                          {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.taxId ? `（${s.taxId}）` : ""}</option>)}
                        </LookupSelect>
                      </div>
                    </div>
                    <div className="text-xs text-amber-700">以下欄位都可自由修改。AI 結果僅供參考。</div>
                  </div>
                )}
              </div>
            )}

            {/* 表頭：一個欄位一列 */}
            <DocFormRows data-testid="voucher-header">
              {isCashSlip && voucherTemplates.length > 0 && (
                <DocFormRow label="模板" htmlFor="voucher-template" hint={template?.description || "選模板會帶出預設的帳戶、專案和摘要行，帶出來之後還是可以改。"}>
                  <select id="voucher-template" className={selectClass} value={templateId} onChange={e => applyTemplate(e.target.value)} data-testid="select-voucher-template">
                    <option value="">不使用模板</option>
                    {voucherTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </DocFormRow>
              )}
              <DocFormRow label="日期" htmlFor="voucher-date">
                <Input id="voucher-date" type="date" className="h-10 md:h-10 md:w-48" value={form.voucherDate} onChange={e => setForm(f => ({ ...f, voucherDate: e.target.value }))} />
              </DocFormRow>
              {voucherType === "請款單" ? (
                <DocFormRow label="請款人（員工）">
                  <LookupSelect className="w-full h-10" value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}>
                    <option value="">選擇員工</option>
                    {employees?.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
                  </LookupSelect>
                </DocFormRow>
              ) : voucherType === "付款單" ? (
                <DocFormRow label="供應商" hint="一張付款單只付給一個對象。選了供應商，下面表格的「沖哪一張單」才選得到他還沒付完的發票和採購單。">
                  <LookupSelect className="w-full h-10" value={form.supplierId} onChange={e => changeParty("supplierId", e.target.value)} data-testid="select-voucher-party">
                    <option value="">選擇供應商</option>
                    {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </LookupSelect>
                </DocFormRow>
              ) : (
                <DocFormRow label="客戶" hint="一張收款單只收一個客戶的錢。選了客戶，下面表格的「沖哪一張單」才選得到他還沒收完的發票和銷貨單。">
                  <LookupSelect className="w-full h-10" value={form.customerId} onChange={e => changeParty("customerId", e.target.value)} data-testid="select-voucher-party">
                    <option value="">選擇客戶</option>
                    {customers?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </LookupSelect>
                </DocFormRow>
              )}
              {needsCashAccount && (
                <DocFormRow label={isReceipt ? "收款帳戶" : "付款帳戶"} htmlFor="voucher-cash-account" required
                  hint={`錢實際${isReceipt ? "進到" : "從"}哪個帳戶${isReceipt ? "" : "出去"}（現金、零用金或哪一家銀行）。整張單用同一個帳戶。`}>
                  <CashAccountSelect id="voucher-cash-account" value={cashAccountId} onChange={setCashAccountId} />
                </DocFormRow>
              )}
              {voucherType === "請款單" && !aiCategory && (
                <DocFormRow label="費用科目" htmlFor="voucher-expense-account">
                  <LedgerAccountSelect id="voucher-expense-account" value={expenseAccountId} onChange={setExpenseAccountId} types={["Expense"]} placeholder="未指定（記到其他管理費用）" />
                </DocFormRow>
              )}
              <DocFormRow label="所屬專案" htmlFor="voucher-project" required>
                <select id="voucher-project" className={selectClass} value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}>
                  <option value="">請選擇專案</option>
                  {selectableProjects(projects as any[], form.projectId).map((p: any) => <option key={p.id} value={p.id}>{projectPickerLabel(p)}</option>)}
                </select>
              </DocFormRow>
              <DocFormRow label="所屬部門" htmlFor="voucher-department">
                <select id="voucher-department" className={selectClass} value={form.departmentId} onChange={e => setForm(f => ({ ...f, departmentId: e.target.value }))}>
                  <option value="">無</option>
                  {selectableDepartments(departments as any[], form.departmentId).map((d: any) => <option key={d.id} value={d.id}>{departmentLabel(d)}</option>)}
                </select>
              </DocFormRow>
              {template && (template.config.fields?.length ?? 0) > 0 && (
                <div className="divide-y" data-testid="voucher-template-fields">
                  {template.config.fields!.map(f => (
                    <DocFormRow key={f.name} label={f.label} htmlFor={`vtf-${f.name}`} required={!!f.required}>
                      {f.type === "select" ? (
                        <select id={`vtf-${f.name}`} className={selectClass} value={extraFields[f.name] ?? ""} onChange={e => setExtraFields(v => ({ ...v, [f.name]: e.target.value }))}>
                          <option value="">請選擇</option>
                          {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <Input id={`vtf-${f.name}`} className="h-10 md:h-10" type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={extraFields[f.name] ?? ""} onChange={e => setExtraFields(v => ({ ...v, [f.name]: e.target.value }))} />
                      )}
                    </DocFormRow>
                  ))}
                </div>
              )}
              <DocFormRow label={isCashSlip ? "備註" : "說明"} htmlFor="voucher-description" top>
                <Textarea id="voucher-description" rows={isCashSlip ? 3 : 2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder={isCashSlip ? "整張單的備註（選填），只留在這張單上" : "摘要說明"} />
              </DocFormRow>
              {isCashSlip && (
                <DocFormRow label="附件" top hint={files.length === 0 ? `選填，最多 ${MAX_FILES} 個（匯款單、存摺截圖、收據…）。存檔後一起上傳，之後點開這張單也可以再補。` : undefined}>
                  <input ref={attachInputRef} type="file" multiple className="hidden" data-testid="input-voucher-files"
                    onChange={e => { const picked = Array.from(e.target.files ?? []); setFiles(f => [...f, ...picked].slice(0, MAX_FILES)); e.target.value = ""; }} />
                  <Button type="button" variant="outline" className="min-h-10" disabled={files.length >= MAX_FILES} onClick={() => attachInputRef.current?.click()}>
                    <Paperclip className="mr-1 h-4 w-4" />選擇檔案
                  </Button>
                  {files.length > 0 && (
                    <ul className="space-y-1 text-sm">
                      {files.map((file, i) => (
                        <li key={i} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{file.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                          <Button type="button" variant="ghost" size="icon" className="h-10 w-10" onClick={() => setFiles(f => f.filter((_, idx) => idx !== i))} aria-label={`移除 ${file.name}`}><X className="h-4 w-4" /></Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </DocFormRow>
              )}
            </DocFormRows>

            {/* 輸入表格：一行一筆。欄位多，表格在自己的框裡左右捲，整個視窗不會跟著跑 */}
            <div className="max-w-full overflow-x-auto rounded-md border" data-testid="voucher-lines">
              <table className={`w-full text-sm ${isCashSlip ? "min-w-[880px]" : "min-w-[420px]"}`}>
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-9 px-2 py-2 text-center font-medium">#</th>
                    {isCashSlip && <th className="w-48 px-1 py-2 text-left font-medium">科目</th>}
                    {isCashSlip && <th className="w-56 px-1 py-2 text-left font-medium">沖哪一張單</th>}
                    {!isCashSlip && <th className="px-1 py-2 text-left font-medium">項目內容</th>}
                    <th className="w-32 px-1 py-2 text-right font-medium">金額</th>
                    {isCashSlip && <th className="w-24 px-1 py-2 text-right font-medium">手續費</th>}
                    {isCashSlip && <th className="px-1 py-2 text-left font-medium">摘要</th>}
                    <th className="w-12"><span className="sr-only">刪除這一行</span></th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((item, i) => {
                    const linked = !!item.invoiceId || !!item.orderId;
                    const foreign = foreignInvoice(item);
                    const linkedDoc = item.invoiceId ? openInvoices.find(x => x.id === item.invoiceId) : item.orderId ? openOrders.find(x => x.id === item.orderId) : null;
                    const summaryCell = (
                      <td className="px-1 py-1 align-top">
                        <Input className={cellClass} placeholder={isCashSlip ? "摘要（會顯示在日記帳）" : "項目內容"} aria-label={isCashSlip ? `第 ${i + 1} 行摘要` : `第 ${i + 1} 行項目內容`} value={item.description} onChange={e => updateItem(i, "description", e.target.value)} />
                      </td>
                    );
                    return (
                      <tr key={i} className="border-t">
                        <td className="px-2 pt-3.5 text-center align-top text-xs text-muted-foreground">{i + 1}</td>
                        {isCashSlip && (
                          <td className="px-1 py-1 align-top">
                            {linked ? (
                              <div className="flex h-10 items-center rounded-md border border-dashed bg-muted/40 px-2 text-xs text-muted-foreground" title="沖發票或核對訂單的行，科目跟著那張單走，不用選">{isReceipt && item.orderId && (linkedDoc?.status === "Draft" || linkedDoc?.status === "草稿") ? "預收款項" : isReceipt ? "應收帳款" : "應付帳款"}（跟著單走）</div>
                            ) : (
                              <LedgerAccountSelect value={item.accountId} onChange={v => updateItem(i, "accountId", v)} types={allAccountTypes} ariaLabel={`第 ${i + 1} 行科目`} placeholder={isReceipt ? "不選＝應收帳款" : "不選＝應付帳款"} />
                            )}
                          </td>
                        )}
                        {isCashSlip && (
                          <td className="px-1 py-1 align-top">
                            <select className={selectClass} disabled={!partyId} aria-label={`第 ${i + 1} 行沖哪一張單`} data-testid={`select-voucher-link-${i}`}
                              value={item.invoiceId ? `inv:${item.invoiceId}` : item.orderId ? `ord:${item.orderId}` : ""} onChange={e => pickLink(i, e.target.value)}>
                              <option value="">{!partyId ? `先選${isReceipt ? "客戶" : "供應商"}` : loadingInvoices ? "載入中…" : openInvoices.length + openOrders.length === 0 ? "沒有未結的單" : "不沖單"}</option>
                              {openInvoices.length > 0 && (
                                <optgroup label={isReceipt ? "未結發票" : "未付採購發票"}>
                                  {openInvoices.map((inv: any) => (
                                    <option key={inv.id} value={`inv:${inv.id}`} disabled={form.items.some((x, idx) => idx !== i && x.invoiceId === inv.id)}>
                                      {inv.invoiceNumber}・{isReceipt ? "未收" : "未付"} {Number(inv.outstandingAmount).toLocaleString()}{inv.currency && inv.currency !== "TWD" ? ` ${inv.currency}` : ""}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {openOrders.length > 0 && (
                                <optgroup label={isReceipt ? "未收完的銷貨單（訂金）" : "未付完的採購單（訂金）"}>
                                  {openOrders.map((order: any) => (
                                    <option key={order.id} value={`ord:${order.id}`} disabled={form.items.some((x, idx) => idx !== i && x.orderId === order.id)}>
                                      {order.orderNumber}・{isReceipt ? "未收" : "未付"} {Number(order.outstandingAmount).toLocaleString()}{isReceipt && (order.status === "Draft" || order.status === "草稿") ? "（訂單未成立，記預收訂金）" : ""}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                            {linkedDoc && (
                              <p className="mt-0.5 px-1 text-[11px] text-muted-foreground">
                                {linkedDoc.invoiceDate ?? linkedDoc.orderDate}・總額 {Number((item.orderId ? linkedDoc.totalAmountTWD : null) ?? linkedDoc.totalAmount).toLocaleString()}・{isReceipt ? "未收" : "未付"} {Number(linkedDoc.outstandingAmount).toLocaleString()}
                              </p>
                            )}
                            {foreign && (
                              <Input type="number" step="0.0001" className={`${cellClass} mt-1`} aria-label={`第 ${i + 1} 行今天的匯率`}
                                title={`${foreign.currency} 發票，入帳匯率 ${Number(foreign.exchangeRate)}。填今天實際的匯率，差額會記成兌換損益`}
                                placeholder={`今天匯率（入帳 ${Number(foreign.exchangeRate)}）`}
                                value={paymentRates[foreign.id] ?? ""} onChange={e => setPaymentRates(prev => ({ ...prev, [foreign.id]: e.target.value }))} />
                            )}
                          </td>
                        )}
                        {!isCashSlip && summaryCell}
                        <td className="px-1 py-1 align-top">
                          <Input className={`${cellClass} text-right`} type="number" inputMode="decimal" min="0" placeholder="金額" aria-label={`第 ${i + 1} 行金額`} value={item.amount || ""} onChange={e => updateItem(i, "amount", Number(e.target.value))} />
                        </td>
                        {isCashSlip && (
                          <td className="px-1 py-1 align-top">
                            <Input className={`${cellClass} text-right`} type="number" inputMode="decimal" min="0" placeholder="0" aria-label={`第 ${i + 1} 行手續費`} data-testid={`input-voucher-fee-${i}`} value={item.fee || ""} onChange={e => updateItem(i, "fee", Number(e.target.value))} />
                          </td>
                        )}
                        {isCashSlip && summaryCell}
                        <td className="px-1 py-1 align-top">
                          <Button type="button" variant="ghost" size="icon" className="h-10 w-10" disabled={form.items.length <= 1} onClick={() => removeItem(i)} aria-label={`刪除第 ${i + 1} 行`} title="刪除這一行"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/30 font-semibold">
                    <td className="px-2 py-2.5 text-right" colSpan={isCashSlip ? 3 : 2}>合計</td>
                    <td className="px-2 py-2.5 text-right tabular-nums" data-testid="voucher-total-amount">{money(totalAmount)}</td>
                    {isCashSlip && <td className="px-2 py-2.5 text-right tabular-nums" data-testid="voucher-total-fee">{money(feeTotal)}</td>}
                    {isCashSlip
                      ? <td className="px-2 py-2.5 text-right" colSpan={2}>{isReceipt ? "實收" : "實付"} <span className="tabular-nums" data-testid="voucher-net-amount">{money(netCash)}</span></td>
                      : <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="outline" className="min-h-10" onClick={addItem} data-testid="button-add-voucher-line"><Plus className="h-4 w-4 mr-1" />{isCashSlip ? "新增一行" : "新增項目"}</Button>
              {isCashSlip && partyId && !loadingInvoices && (
                <p className="text-xs text-muted-foreground">
                  {isReceipt ? "這個客戶" : "這個供應商"}有 {openInvoices.length} 張{isReceipt ? "未結發票" : "未付採購發票"}
                  <span data-testid="voucher-open-orders">{openOrders.length > 0 ? `、${openOrders.length} 張${isReceipt ? "未收完的銷貨單" : "未付完的採購單"}` : ""}</span>
                  ，要沖帳請在表格的「沖哪一張單」選：沖發票會在存檔時更新發票的{isReceipt ? "已收／未收" : "已付／未付"}；沖訂單用在還沒開發票就先{isReceipt ? "收" : "付"}的訂金，之後開發票會自動算進去。
                </p>
              )}
            </div>

            {isCashSlip && (hasInvoiceLine || feeTotal > 0) && (
              <DocFormRows>
                {feeTotal > 0 && (
                  <DocFormRow label="手續費科目" htmlFor="voucher-fee-account" required
                    hint={isReceipt ? "對方匯款時被銀行扣掉、沒有進到帳戶的錢，記成我們的費用。" : "我們另外付給銀行的匯費，記成我們的費用（從供應商貨款裡扣掉的匯費不用填）。"}>
                    <LedgerAccountSelect id="voucher-fee-account" value={feeAccountValue} onChange={setFeeAccountId} types={["Expense"]} placeholder="請選擇費用科目" />
                  </DocFormRow>
                )}
                {hasInvoiceLine && (
                  <DocFormRow label={isReceipt ? "實際收到的台幣" : "實際付出的台幣"} htmlFor="voucher-actual-cash"
                    hint={`外幣貨款換匯去付、帳戶實際${isReceipt ? "進來" : "出去"}的台幣和帳上不同時才填，差額自動記兌換損益。有手續費時，這裡填帳戶真的${isReceipt ? "進來" : "出去"}的那個數字。`}>
                    <Input id="voucher-actual-cash" type="number" inputMode="decimal" min="0" className="h-10 md:h-10 md:w-48" value={actualCash} onChange={e => setActualCash(e.target.value)} placeholder="和帳上一樣免填" data-testid="input-actual-cash" />
                  </DocFormRow>
                )}
              </DocFormRows>
            )}

            {isCashSlip && totalAmount > 0 && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm" data-testid="voucher-posting-summary">
                <p className="font-medium">存檔後會這樣入帳</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                  <li>{cashAccountName || (isReceipt ? "收款帳戶" : "付款帳戶")} {isReceipt ? "收進" : "付出"} <b className="text-foreground tabular-nums">{money(netCash)}</b>{actualCashValue > 0 ? "（照你填的實際台幣）" : feeTotal > 0 ? (isReceipt ? `（金額 ${money(bookedCash)} − 手續費 ${money(feeTotal)}）` : `（金額 ${money(bookedCash)} ＋ 手續費 ${money(feeTotal)}）`) : ""}</li>
                  {feeTotal > 0 && <li>手續費 <b className="text-foreground tabular-nums">{money(feeTotal)}</b> 記到「{feeAccountName || "還沒選科目"}」</li>}
                  <li>{isReceipt ? "應收帳款或各行選的科目" : "應付帳款或各行選的科目"}照金額全額{isReceipt ? "沖掉" : "記帳"}：<b className="text-foreground tabular-nums">{money(hasForeign ? bookedCash : totalAmount)}</b>{hasForeign ? "（外幣發票已換成台幣）" : ""}</li>
                  {actualCashValue > 0 && <li>實際台幣和帳上金額的差額，記兌換損益</li>}
                </ul>
              </div>
            )}
            {isCashSlip && <p className="text-xs text-muted-foreground">每一行的「摘要」會原樣變成日記帳、總分類帳那一行的摘要（前面帶客戶／供應商名稱）；「備註」只留在這張單上。「科目」不選就照原本的記法（{isReceipt ? "應收帳款" : "應付帳款"}）；要記成別的（例如利息、雜項收支）才選。</p>}
          </div>
      </DocWindow>
    </div>
  );
}
