import { useState, useRef, useEffect } from "react";
import { selectableDepartments, selectableProjects, departmentLabel, projectPickerLabel } from "@/lib/select-options";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, Send, Database, AlertTriangle, BarChart3, LineChart as LineIcon, PieChart as PieIcon, FilePlus2, Trash2, Plus, Mic, MicOff, Paperclip, Camera, ReceiptText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { ROLE_EMPLOYEE } from "@/lib/roles";
import { Link } from "wouter";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHint } from "@/components/page-hint";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip as RTooltip, Legend,
} from "recharts";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}

interface SpeechRecognitionEventLike {
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface AskResponse {
  question: string;
  intent: string;
  sql: string;
  chartType: "table" | "bar" | "line" | "pie" | "none";
  columns: string[];
  rows: any[];
  rowCount: number;
  summary: string;
}

interface ChatTurn {
  question: string;
  result?: AskResponse;
  draft?: DocumentDraft;
  reimburse?: ReimburseDraft;
  customerDraft?: CustomerDraft;
  clarify?: string[];
  error?: string;
}

interface CustomerDraft {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  taxId?: string;
  address?: string;
  possibleDuplicate: { id: number; name: string; byTaxId: boolean } | null;
}

interface ReimburseDraft {
  merchant: string;
  taxId: string;
  invoiceNumber: string;
  date: string;
  totalAmount: number;
  taxAmount: number;
  items: Array<{ description: string; amount: number }>;
  categoryCode: string;
  categoryReason?: string;
  confidence?: number;
  multiReceipt?: boolean;
  attachmentIds: number[];
  attachmentErrors: string[];
}

interface DocumentDraft {
  docType: "quotation" | "sales_order" | "delivery_note";
  customerName: string;
  customerId: number | null;
  matchedCustomerName: string | null;
  needsNewCustomer: boolean;
  projectName?: string;
  projectId: number | null;
  date: string;
  notes?: string;
  items: Array<{ name: string; qty: number; unitPrice: number; itemId: number | null; itemCode: string | null; unit: string; matchedItemName: string | null }>;
  // 匯入報價單（檔案上傳）專用欄位
  source?: "import";
  quoteNumber?: string;
  validUntil?: string;
  taxAmount?: number;
  confidence?: "high" | "medium" | "low";
  newCustomer?: { name: string; contactPerson?: string; email?: string; phone?: string; taxId?: string };
}

const SUGGESTIONS = [
  "幫宏達公司開報價單：顧問服務 2 小時，每小時 3000 元",
  "幫我開出貨單",
  "幫我建立客戶：大安文創，統編 12345678",
  "今年三月的銷售總額是多少？",
  "列出前 10 大客戶（依銷售總額）",
  "本月各部門的銷售排行",
  "最近 30 天有哪些未付的發票？",
  "庫存低於警戒水位的商品",
  "今年每月銷售趨勢",
];

const QUICK_INSIGHTS = [
  "欠款超過30天的客戶",
  "本月哪個專案最賺錢",
  "本月營收與毛利",
  "庫存快不足的品項",
  "本期預估營業稅",
];

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#06b6d4"];

function formatCell(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (typeof v === "string" && /^\d+\.\d+$/.test(v)) {
    const n = Number(v);
    return isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v;
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function inferNumericColumn(cols: string[], rows: any[]): string | null {
  for (const c of cols) {
    if (rows.length > 0) {
      const v = rows[0][c];
      if (typeof v === "number") return c;
      if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return c;
    }
  }
  return null;
}

function hasTwoColumnBarData(result: AskResponse): boolean {
  return result.columns.length === 2 && inferNumericColumn(result.columns, result.rows) !== null;
}

function ChartView({ result }: { result: AskResponse }) {
  if (result.rows.length === 0) return <div className="text-sm text-muted-foreground py-4">沒有資料</div>;

  const numCol = inferNumericColumn(result.columns, result.rows);
  const labelCol = result.columns.find((c) => c !== numCol) || result.columns[0];
  if (!numCol || !labelCol) return null;

  const data = result.rows.slice(0, 50).map((r) => ({
    label: String(r[labelCol] ?? ""),
    value: typeof r[numCol] === "string" ? Number(r[numCol]) : r[numCol],
  })).filter((d) => isFinite(d.value));

  if (result.chartType === "bar" || (["table", "none"].includes(result.chartType) && hasTwoColumnBarData(result))) {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data}>
          <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
          <YAxis tick={{ fontSize: 11 }} />
          <RTooltip formatter={(v: any) => formatCell(v)} />
          <Bar dataKey="value" fill="#3b82f6" />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (result.chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <RTooltip formatter={(v: any) => formatCell(v)} />
          <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (result.chartType === "pie") {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={90} label>
            {data.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
          </Pie>
          <RTooltip formatter={(v: any) => formatCell(v)} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  return null;
}

function TableView({ result }: { result: AskResponse }) {
  if (result.rows.length === 0) return <div className="text-sm text-muted-foreground py-4">沒有資料</div>;
  return (
    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b bg-muted/30 sticky top-0">
          <tr>{result.columns.map((c) => <th key={c} className="text-left px-2 py-1 font-medium whitespace-nowrap">{c}</th>)}</tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="border-b hover:bg-muted/20">
              {result.columns.map((c) => <td key={c} className="px-2 py-1 whitespace-nowrap">{formatCell(row[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DOC_LABEL: Record<DocumentDraft["docType"], string> = { quotation: "報價單", sales_order: "銷售訂單", delivery_note: "出貨單" };

function DocumentDraftCard({ initial }: { initial: DocumentDraft }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState(initial);
  const [customers, setCustomers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [itemMaster, setItemMaster] = useState<any[]>([]);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const isImport = initial.source === "import";
  const [step, setStep] = useState<"department" | "project" | "review">(isImport ? "department" : "review");
  const [createNewCustomer, setCreateNewCustomer] = useState(isImport && initial.needsNewCustomer && !!initial.newCustomer);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: number; number: string; customerCreated?: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/erp-api/customers`, { credentials: "include" }).then(r => r.ok ? r.json() : Promise.reject(new Error("無法載入客戶"))),
      fetch(`/erp-api/projects`, { credentials: "include" }).then(r => r.ok ? r.json() : Promise.reject(new Error("無法載入專案"))),
      fetch(`/erp-api/departments`, { credentials: "include" }).then(r => r.ok ? r.json() : Promise.reject(new Error("無法載入部門"))),
    ]).then(([c, p, dep]) => { setCustomers(c); setProjects(p); setDepartments(dep); })
      .catch(e => toast({ title: "主檔載入失敗", description: e.message, variant: "destructive" }));
    fetch(`/erp-api/items`, { credentials: "include" }).then(r => r.ok ? r.json() : []).then(setItemMaster).catch(() => setItemMaster([]));
  }, [toast]);

  const updateItem = (index: number, patch: Record<string, unknown>) =>
    setDraft(d => ({ ...d, items: d.items.map((it, i) => i === index ? { ...it, ...patch } : it) }));

  const create = async () => {
    if (!draft.customerId && !(createNewCustomer && draft.newCustomer)) {
      toast({ title: "請選擇既有客戶", description: draft.needsNewCustomer ? "找不到相符客戶，可勾選自動新建客戶，或先至客戶管理新增。" : undefined, variant: "destructive" });
      return;
    }
    if (!draft.date || draft.items.some(it => !it.name.trim() || it.qty <= 0 || it.unitPrice < 0)) {
      toast({ title: "請確認日期、品項、數量與單價", variant: "destructive" }); return;
    }
    if (draft.docType === "delivery_note" && draft.items.some(it => !it.itemId)) {
      toast({ title: "出貨單的每個品項都必須對應系統商品", description: "請在品項欄位改用下拉選擇既有商品（找不到請先至商品管理新增）。", variant: "destructive" }); return;
    }
    setCreating(true);
    try {
      const total = draft.items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
      const tax = isImport ? (draft.taxAmount ?? 0) : 0;
      const isQuotation = draft.docType === "quotation";

      if (isQuotation) {
        // 報價單：走後端交易式端點，客戶+報價單同一交易建立，失敗全部回滾（不會留下孤兒客戶）
        const wantNewCustomer = !draft.customerId && createNewCustomer && draft.newCustomer;
        const response = await fetch(`/erp-api/quotations/with-customer`, {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: draft.customerId || undefined,
            newCustomer: wantNewCustomer ? {
              name: draft.newCustomer!.name,
              contactPerson: draft.newCustomer!.contactPerson || undefined,
              email: draft.newCustomer!.email || undefined,
              phone: draft.newCustomer!.phone || undefined,
              taxId: draft.newCustomer!.taxId || undefined,
            } : undefined,
            quotation: {
              quotationDate: draft.date,
              validUntil: draft.validUntil || undefined,
              status: "Draft",
              totalAmount: total,
              taxAmount: tax,
              grandTotal: total + tax,
              notes: draft.notes || undefined,
              projectId: draft.projectId || undefined,
              departmentId: departmentId || undefined,
              items: draft.items.map(it => ({
                code: it.itemCode || "", name: it.name, qty: it.qty, unit: it.unit || "個",
                unitPrice: it.unitPrice, amount: it.qty * it.unitPrice,
              })),
            },
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
        const createdCustomerName = json.customerCreated ? json.customer?.name : undefined;
        setCreated({ id: json.quotation.id, number: json.quotation.quotationNumber, customerCreated: createdCustomerName });
        toast({ title: "報價單已建立", description: `${json.quotation.quotationNumber}${createdCustomerName ? `（已新建客戶：${createdCustomerName}）` : ""}` });
        return;
      }

      // 銷售訂單：需要時先自動建立客戶
      let customerId = draft.customerId;
      let createdCustomerName: string | undefined;
      if (!customerId && createNewCustomer && draft.newCustomer) {
        const cRes = await fetch(`/erp-api/customers`, {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.newCustomer.name,
            contactPerson: draft.newCustomer.contactPerson || undefined,
            email: draft.newCustomer.email || undefined,
            phone: draft.newCustomer.phone || undefined,
            taxId: draft.newCustomer.taxId || undefined,
          }),
        });
        const cJson = await cRes.json().catch(() => ({}));
        if (!cRes.ok) throw new Error(cJson.error || `建立客戶失敗 (HTTP ${cRes.status})`);
        customerId = cJson.id;
        createdCustomerName = cJson.name;
        // 客戶已建立：綁回草稿，若後續建單失敗，重試不會重複建客戶
        setDraft(d => ({ ...d, customerId: cJson.id, needsNewCustomer: false }));
        setCreateNewCustomer(false);
      }

      if (draft.docType === "delivery_note") {
        const response = await fetch(`/erp-api/delivery-notes`, {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId,
            deliveryDate: draft.date,
            projectId: draft.projectId || undefined,
            remarks: draft.notes || undefined,
            items: draft.items.map(it => ({ itemId: it.itemId, quantity: it.qty, rate: it.unitPrice })),
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
        setCreated({ id: json.id, number: json.noteNumber, customerCreated: createdCustomerName });
        toast({ title: "出貨單已建立（草稿）", description: `${json.noteNumber}，至出貨單頁面送出後才會扣庫存` });
        return;
      }

      const payload = {
        customerId,
        orderDate: draft.date,
        projectId: draft.projectId || undefined,
        orderSource: "ai-assistant",
        items: draft.items.map(it => ({
          itemId: it.itemId, code: it.itemCode, itemName: it.name, quantity: it.qty,
          unit: it.unit || "個", rate: it.unitPrice, amount: it.qty * it.unitPrice,
        })),
      };
      const response = await fetch(`/erp-api/sales-orders`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
      setCreated({ id: json.id, number: json.orderNumber, customerCreated: createdCustomerName });
      toast({ title: "銷售訂單已建立", description: `${json.orderNumber}${createdCustomerName ? `（已新建客戶：${createdCustomerName}）` : ""}` });
    } catch (e: any) {
      toast({ title: "建立失敗", description: e.message, variant: "destructive" });
    } finally { setCreating(false); }
  };

  if (created) return (
    <Card className="border-green-300"><CardContent className="p-4 text-sm">
      {created.customerCreated && <div className="mb-1">已新建客戶：<span className="font-medium">{created.customerCreated}</span></div>}
      已建立 {DOC_LABEL[draft.docType]}：
      <Link href={draft.docType === "quotation" ? "/sales/quotations" : draft.docType === "delivery_note" ? "/sales/delivery-notes" : `/sales/orders/${created.id}`} className="ml-2 text-primary font-medium hover:underline">{created.number}</Link>
      {draft.docType === "delivery_note" && <span className="ml-1 text-muted-foreground">（草稿，送出後才會扣庫存）</span>}
    </CardContent></Card>
  );

  // 匯入流程：先問部門
  if (step === "department") return (
    <Card className="border-primary/40"><CardContent className="p-4 space-y-3">
      <div className="font-medium flex items-center gap-2"><FilePlus2 className="h-4 w-4" />報價單辨識完成（{draft.items.length} 個品項{draft.quoteNumber ? `，原單號 ${draft.quoteNumber}` : ""}）</div>
      <div className="text-sm">請問這張報價單屬於哪一個<span className="font-medium">部門</span>？</div>
      <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={departmentId || ""} onChange={e => setDepartmentId(Number(e.target.value) || null)} data-testid="select-import-department">
        <option value="">請選擇部門</option>
        {selectableDepartments(departments, departmentId).map(d => <option key={d.id} value={d.id}>{departmentLabel(d)}</option>)}
      </LookupSelect>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setStep("project")}>略過</Button>
        <Button size="sm" disabled={!departmentId} onClick={() => setStep("project")}>下一步</Button>
      </div>
    </CardContent></Card>
  );

  // 匯入流程：再問專案
  if (step === "project") return (
    <Card className="border-primary/40"><CardContent className="p-4 space-y-3">
      <div className="font-medium flex items-center gap-2"><FilePlus2 className="h-4 w-4" />選擇歸屬專案</div>
      <div className="text-sm">請問要歸在哪一個<span className="font-medium">專案</span>？{draft.projectName && !draft.projectId && <span className="text-muted-foreground">（報價單上寫的是「{draft.projectName}」，系統找不到相符專案）</span>}</div>
      <select className="w-full border rounded-md px-3 py-2 text-sm" value={draft.projectId || ""} onChange={e => setDraft(d => ({ ...d, projectId: Number(e.target.value) || null }))} data-testid="select-import-project">
        <option value="">無（不歸專案）</option>
        {selectableProjects(projects, draft.projectId).map(p => <option key={p.id} value={p.id}>{projectPickerLabel(p)}</option>)}
      </select>
      <div className="flex justify-between">
        <Button variant="outline" size="sm" onClick={() => setStep("department")}>上一步</Button>
        <Button size="sm" onClick={() => setStep("review")}>下一步</Button>
      </div>
    </CardContent></Card>
  );

  return (
    <Card className="border-primary/40"><CardContent className="p-4 space-y-4">
      <div className="font-medium flex items-center gap-2"><FilePlus2 className="h-4 w-4" />AI 開單草稿（尚未儲存）{isImport && draft.confidence && draft.confidence !== "high" && <span className="text-xs text-amber-700 font-normal">辨識信心：{draft.confidence === "medium" ? "中" : "低"}，請仔細核對</span>}</div>
      {draft.needsNewCustomer && !draft.newCustomer && <div className="text-sm text-amber-700">找不到「{draft.customerName}」，請選擇既有客戶，或先至客戶管理新增。</div>}
      {draft.needsNewCustomer && draft.newCustomer && (
        <div className="text-sm space-y-2 border border-amber-300 bg-amber-50 rounded-md p-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={createNewCustomer} onChange={e => { setCreateNewCustomer(e.target.checked); if (e.target.checked) setDraft(d => ({ ...d, customerId: null })); }} data-testid="checkbox-create-customer" />
            <span>系統找不到「{draft.customerName}」，確認建立時<span className="font-medium">自動新建這個客戶</span></span>
          </label>
          {createNewCustomer && (
            <div className="grid md:grid-cols-2 gap-2">
              <div><Label className="text-xs">客戶名稱</Label><Input value={draft.newCustomer.name} onChange={e => setDraft(d => ({ ...d, newCustomer: { ...d.newCustomer!, name: e.target.value } }))} /></div>
              <div><Label className="text-xs">聯絡人</Label><Input value={draft.newCustomer.contactPerson || ""} onChange={e => setDraft(d => ({ ...d, newCustomer: { ...d.newCustomer!, contactPerson: e.target.value } }))} /></div>
              <div><Label className="text-xs">Email</Label><Input value={draft.newCustomer.email || ""} onChange={e => setDraft(d => ({ ...d, newCustomer: { ...d.newCustomer!, email: e.target.value } }))} /></div>
              <div><Label className="text-xs">電話</Label><Input value={draft.newCustomer.phone || ""} onChange={e => setDraft(d => ({ ...d, newCustomer: { ...d.newCustomer!, phone: e.target.value } }))} /></div>
            </div>
          )}
          {!createNewCustomer && <div className="text-xs text-muted-foreground">或在下方「客戶」欄選擇既有客戶。</div>}
        </div>
      )}
      <div className="grid md:grid-cols-3 gap-3">
        <div><Label>單據類型</Label><select className="w-full border rounded-md px-3 py-2 text-sm" value={draft.docType} onChange={e => setDraft(d => ({ ...d, docType: e.target.value as DocumentDraft["docType"] }))}><option value="quotation">報價單</option><option value="sales_order">銷售訂單</option><option value="delivery_note">出貨單</option></select></div>
        <div><Label>客戶</Label><LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={draft.customerId || ""} onChange={e => { const id = Number(e.target.value) || null; setDraft(d => ({ ...d, customerId: id })); if (id) setCreateNewCustomer(false); }}><option value="">{createNewCustomer ? `（自動新建：${draft.newCustomer?.name}）` : "請選擇"}</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</LookupSelect></div>
        <div><Label>日期</Label><Input type="date" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} /></div>
        {isImport && <div><Label>有效期限</Label><Input type="date" value={draft.validUntil || ""} onChange={e => setDraft(d => ({ ...d, validUntil: e.target.value }))} /></div>}
        {isImport && <div><Label>部門</Label><LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={departmentId || ""} onChange={e => setDepartmentId(Number(e.target.value) || null)}><option value="">無</option>{selectableDepartments(departments, departmentId).map(d => <option key={d.id} value={d.id}>{departmentLabel(d)}</option>)}</LookupSelect></div>}
        <div className={isImport ? "" : "md:col-span-3"}><Label>專案</Label><select className="w-full border rounded-md px-3 py-2 text-sm" value={draft.projectId || ""} onChange={e => setDraft(d => ({ ...d, projectId: Number(e.target.value) || null }))}><option value="">無</option>{selectableProjects(projects, draft.projectId).map(p => <option key={p.id} value={p.id}>{projectPickerLabel(p)}</option>)}</select></div>
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_80px_120px_36px] gap-2 text-xs text-muted-foreground"><span>品項</span><span>數量</span><span>單價</span><span /></div>
        {draft.items.map((it, i) => <div key={i} className="grid grid-cols-[1fr_80px_120px_36px] gap-2">
          {draft.docType === "delivery_note" ? (
            <LookupSelect
              className={`w-full border rounded-md px-3 py-2 text-sm ${!it.itemId ? "border-amber-400" : ""}`}
              value={it.itemId || ""}
              onChange={e => {
                const id = Number(e.target.value) || null;
                const m = itemMaster.find((x: any) => x.id === id);
                updateItem(i, { itemId: id, name: m?.itemName || it.name, itemCode: m?.itemCode || null, unit: m?.unit || "個", unitPrice: it.unitPrice || Number(m?.sellingPrice || 0) });
              }}
              data-testid={`select-dn-item-${i}`}
            >
              <option value="">{it.name ? `請對應「${it.name}」到系統商品` : "請選擇商品"}</option>
              {itemMaster.map((m: any) => <option key={m.id} value={m.id}>{m.itemName}{m.itemCode ? `（${m.itemCode}）` : ""}</option>)}
            </LookupSelect>
          ) : (
            <Input value={it.name} onChange={e => updateItem(i, { name: e.target.value, itemId: null, itemCode: null })} />
          )}
          <Input type="number" min="0.01" value={it.qty} onChange={e => updateItem(i, { qty: Number(e.target.value) })} />
          <Input type="number" min="0" value={it.unitPrice} onChange={e => updateItem(i, { unitPrice: Number(e.target.value) })} />
          <Button variant="ghost" size="icon" disabled={draft.items.length === 1} onClick={() => setDraft(d => ({ ...d, items: d.items.filter((_, idx) => idx !== i) }))}><Trash2 className="h-4 w-4" /></Button>
        </div>)}
        <Button variant="outline" size="sm" onClick={() => setDraft(d => ({ ...d, items: [...d.items, { name: "", qty: 1, unitPrice: 0, itemId: null, itemCode: null, unit: "個", matchedItemName: null }] }))}><Plus className="h-3 w-3 mr-1" />新增品項</Button>
      </div>
      <div><Label>備註</Label><Textarea value={draft.notes || ""} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} /></div>
      {isImport && (
        <div className="text-sm text-right space-y-0.5">
          {(() => { const sub = draft.items.reduce((s, it) => s + it.qty * it.unitPrice, 0); const tax = draft.taxAmount ?? 0; return (<>
            <div>合計：NT$ {sub.toLocaleString()}</div>
            <div className="flex items-center justify-end gap-2">營業稅：NT$ <Input type="number" min="0" className="w-28 h-7 text-right" value={tax} onChange={e => setDraft(d => ({ ...d, taxAmount: Number(e.target.value) || 0 }))} /></div>
            <div className="font-medium">總計：NT$ {(sub + tax).toLocaleString()}</div>
          </>); })()}
        </div>
      )}
      <div className="flex justify-end"><Button onClick={create} disabled={creating} data-testid="button-confirm-create">{creating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}確認建立</Button></div>
    </CardContent></Card>
  );
}

function CustomerDraftCard({ initial }: { initial: CustomerDraft }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState(initial);
  const [useExisting, setUseExisting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: number; name: string } | null>(null);

  if (created) return (
    <Card className="border-green-300"><CardContent className="p-4 text-sm" data-testid="customer-created">
      已建立客戶：<Link href="/sales/customers" className="text-primary font-medium hover:underline">{created.name}</Link>
    </CardContent></Card>
  );

  if (useExisting) return (
    <Card><CardContent className="p-4 text-sm">
      好的，沿用既有客戶「{draft.possibleDuplicate?.name}」，未建立新客戶。
    </CardContent></Card>
  );

  const create = async () => {
    if (!draft.name.trim()) { toast({ title: "客戶名稱為必填", variant: "destructive" }); return; }
    if (draft.taxId && !/^\d{8}$/.test(draft.taxId)) { toast({ title: "統一編號需為 8 碼數字", variant: "destructive" }); return; }
    setCreating(true);
    try {
      const res = await fetch(`/erp-api/customers`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          contactPerson: draft.contactPerson || undefined,
          phone: draft.phone || undefined,
          email: draft.email || undefined,
          taxId: draft.taxId || undefined,
          address: draft.address || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setCreated({ id: json.id, name: json.name });
      toast({ title: "客戶已建立", description: json.name });
    } catch (e: any) {
      toast({ title: "建立客戶失敗", description: e.message, variant: "destructive" });
    } finally { setCreating(false); }
  };

  return (
    <Card className="border-primary/40"><CardContent className="p-4 space-y-3">
      <div className="font-medium flex items-center gap-2"><FilePlus2 className="h-4 w-4" />AI 客戶建檔草稿（尚未儲存）</div>
      {draft.possibleDuplicate && (
        <div className="text-sm border border-amber-300 bg-amber-50 rounded-md p-3 space-y-2">
          <div>系統已有{draft.possibleDuplicate.byTaxId ? "相同統編" : "名稱相近"}的客戶：<span className="font-medium">{draft.possibleDuplicate.name}</span>，確定要另外新建嗎？</div>
          <Button variant="outline" size="sm" onClick={() => setUseExisting(true)} data-testid="button-use-existing-customer">沿用既有客戶，不新建</Button>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-2">
        <div><Label className="text-xs">客戶名稱 *</Label><Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} data-testid="input-cust-name" /></div>
        <div><Label className="text-xs">聯絡人</Label><Input value={draft.contactPerson || ""} onChange={e => setDraft(d => ({ ...d, contactPerson: e.target.value }))} /></div>
        <div><Label className="text-xs">電話</Label><Input value={draft.phone || ""} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} /></div>
        <div><Label className="text-xs">Email</Label><Input value={draft.email || ""} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} /></div>
        <div><Label className="text-xs">統一編號</Label><Input value={draft.taxId || ""} onChange={e => setDraft(d => ({ ...d, taxId: e.target.value }))} /></div>
        <div><Label className="text-xs">地址</Label><Input value={draft.address || ""} onChange={e => setDraft(d => ({ ...d, address: e.target.value }))} /></div>
      </div>
      <div className="flex justify-end"><Button onClick={create} disabled={creating} data-testid="button-confirm-create-customer">{creating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}確認建立客戶</Button></div>
    </CardContent></Card>
  );
}

interface ExpenseCategory { code: string; name: string; group: string; accountNumber: string; accountName: string }

function ReimbursementCard({ initial }: { initial: ReimburseDraft }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isEmployee = user?.role === ROLE_EMPLOYEE;
  const [draft, setDraft] = useState(initial);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [employeeId, setEmployeeId] = useState<number | null>(isEmployee ? (user?.employeeId ?? null) : null);
  const [step, setStep] = useState<"department" | "project" | "payer" | "review">("department");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{
    voucherNumber: string; entryNumber: string | null; invoiceNumber: string | null; requestNumber: string; pendingApproval: boolean;
  } | null>(null);

  useEffect(() => {
    fetch(`/erp-api/reimbursement/categories`, { credentials: "include" })
      .then(r => r.ok ? r.json() : []).then(setCategories).catch(() => setCategories([]));
    fetch(`/erp-api/reimbursement/masters`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { departments: [], projects: [], suppliers: [] })
      .then((m) => { setDepartments(m.departments || []); setProjects(m.projects || []); setSuppliers(m.suppliers || []); })
      .catch(() => { setDepartments([]); setProjects([]); setSuppliers([]); });
    if (!isEmployee) {
      fetch(`/erp-api/employees`, { credentials: "include" }).then(r => r.ok ? r.json() : []).then(setEmployees).catch(() => setEmployees([]));
    }
  }, [isEmployee]);

  // 依統編／商家名稱自動比對供應商
  useEffect(() => {
    if (supplierId || suppliers.length === 0) return;
    const normalize = (v: unknown) => String(v || "").replace(/[\s()（）股份有限公司企業社]/g, "").toLowerCase();
    const taxId = String(draft.taxId || "").trim();
    const merchant = normalize(draft.merchant);
    const matched = suppliers.find((s: any) =>
      (taxId && String(s.taxId || "").trim() === taxId) ||
      (merchant && (normalize(s.name).includes(merchant) || merchant.includes(normalize(s.name))))
    );
    if (matched) setSupplierId(matched.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliers]);

  const category = categories.find(c => c.code === draft.categoryCode);
  const itemSum = draft.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const sumMismatch = Math.round(itemSum * 100) !== Math.round(draft.totalAmount * 100);

  const updateItem = (i: number, patch: Partial<{ description: string; amount: number }>) =>
    setDraft(d => ({ ...d, items: d.items.map((it, idx) => idx === i ? { ...it, ...patch } : it) }));

  const confirm = async () => {
    if (!supplierId) { toast({ title: "請選擇供應商（付款對象）", variant: "destructive" }); return; }
    if (!draft.date || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) { toast({ title: "請確認日期", variant: "destructive" }); return; }
    if (draft.items.some(it => !it.description.trim() || !(it.amount > 0))) {
      toast({ title: "每筆明細都需要說明與正數金額", variant: "destructive" }); return;
    }
    if (sumMismatch) { toast({ title: "明細合計與總金額不一致", description: "請調整明細金額或總金額", variant: "destructive" }); return; }
    setCreating(true);
    try {
      const res = await fetch(`/erp-api/reimbursement/confirm`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: draft.date,
          description: [draft.merchant, draft.invoiceNumber].filter(Boolean).join(" / "),
          merchant: draft.merchant,
          invoiceNumber: draft.invoiceNumber,
          taxId: draft.taxId,
          totalAmount: draft.totalAmount,
          taxAmount: draft.taxAmount || 0,
          categoryCode: draft.categoryCode,
          departmentId,
          projectId,
          employeeId,
          supplierId,
          attachmentIds: draft.attachmentIds,
          items: draft.items,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setCreated({
        voucherNumber: json.voucher.voucherNumber,
        entryNumber: json.journalEntry?.entryNumber ?? null,
        invoiceNumber: json.invoice?.invoiceNumber ?? null,
        requestNumber: json.paymentRequest.requestNumber,
        pendingApproval: json.pendingApproval === true,
      });
      toast({ title: "報銷已送出", description: json.pendingApproval ? `${json.voucher.voucherNumber}，簽核通過後自動入帳` : `${json.voucher.voucherNumber}，付款申請待簽核` });
    } catch (e: any) {
      toast({ title: "報銷送出失敗", description: e.message, variant: "destructive" });
    } finally { setCreating(false); }
  };

  if (created) return (
    <Card className="border-green-300"><CardContent className="p-4 text-sm space-y-1" data-testid="reimburse-created">
      <div className="font-medium">報銷已完成，已建立以下單據：</div>
      {isEmployee ? (
        <ul className="list-disc pl-5 space-y-0.5">
          <li>請款單 {created.voucherNumber}</li>
          <li>付款申請 {created.requestNumber}（待主管簽核）</li>
          {created.pendingApproval && <li className="text-muted-foreground">簽核通過後系統會自動入帳（建立會計分錄與發票）</li>}
        </ul>
      ) : (
        <ul className="list-disc pl-5 space-y-0.5">
          <li>請款單 <Link href="/accounting/reimbursement" className="text-primary hover:underline">{created.voucherNumber}</Link></li>
          {created.entryNumber && <li>會計分錄 <Link href="/accounting/journal" className="text-primary hover:underline">{created.entryNumber}</Link></li>}
          {created.invoiceNumber && <li>採購發票 <Link href="/purchasing/invoices" className="text-primary hover:underline">{created.invoiceNumber}</Link></li>}
          <li>付款申請 <Link href="/accounting/payment-requests" className="text-primary hover:underline">{created.requestNumber}</Link>（待簽核）</li>
          {created.pendingApproval && <li className="text-muted-foreground">簽核通過後系統會自動入帳</li>}
        </ul>
      )}
    </CardContent></Card>
  );

  const summary = (
    <div className="text-sm space-y-1 border rounded-md p-3 bg-muted/30">
      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        <span>商家：<span className="font-medium">{draft.merchant || "—"}</span></span>
        {draft.invoiceNumber && <span>發票號碼：{draft.invoiceNumber}</span>}
        <span>日期：{draft.date || "—"}</span>
        <span>總額：NT$ {draft.totalAmount.toLocaleString()}</span>
        {draft.taxAmount > 0 && <span>稅額：NT$ {draft.taxAmount.toLocaleString()}</span>}
      </div>
      {category && <div className="text-xs text-muted-foreground">分類：{category.code} {category.name}（{category.accountNumber} {category.accountName}）{draft.categoryReason ? ` — ${draft.categoryReason}` : ""}</div>}
    </div>
  );

  if (step === "department") return (
    <Card className="border-primary/40"><CardContent className="p-4 space-y-3">
      <div className="font-medium flex items-center gap-2"><ReceiptText className="h-4 w-4" />發票辨識完成</div>
      {draft.multiReceipt && <div className="text-xs text-amber-700 border border-amber-300 bg-amber-50 rounded-md p-2">偵測到照片中可能包含多筆不同的報帳，這次只處理第一筆。其餘請一張一張分開上傳。</div>}
      {draft.attachmentErrors.length > 0 && <div className="text-xs text-amber-700">部分照片存檔失敗（{draft.attachmentErrors.join("、")}），確認送出前建議重新上傳。</div>}
      {summary}
      <div className="text-sm">請問這筆費用屬於哪一個<span className="font-medium">部門</span>？</div>
      <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={departmentId || ""} onChange={e => setDepartmentId(Number(e.target.value) || null)} data-testid="select-reimburse-department">
        <option value="">請選擇部門</option>
        {selectableDepartments(departments, departmentId).map(d => <option key={d.id} value={d.id}>{departmentLabel(d)}</option>)}
      </LookupSelect>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setStep("project")}>略過</Button>
        <Button size="sm" disabled={!departmentId} onClick={() => setStep("project")} data-testid="button-reimburse-dept-next">下一步</Button>
      </div>
    </CardContent></Card>
  );

  if (step === "project") return (
    <Card className="border-primary/40"><CardContent className="p-4 space-y-3">
      <div className="font-medium flex items-center gap-2"><ReceiptText className="h-4 w-4" />選擇歸屬專案</div>
      <div className="text-sm">請問要歸在哪一個<span className="font-medium">專案</span>？（可跳過）</div>
      <select className="w-full border rounded-md px-3 py-2 text-sm" value={projectId || ""} onChange={e => setProjectId(Number(e.target.value) || null)} data-testid="select-reimburse-project">
        <option value="">無（不歸專案）</option>
        {selectableProjects(projects, projectId).map(p => <option key={p.id} value={p.id}>{projectPickerLabel(p)}</option>)}
      </select>
      <div className="flex justify-between">
        <Button variant="outline" size="sm" onClick={() => setStep("department")}>上一步</Button>
        <Button size="sm" onClick={() => setStep("payer")}>下一步</Button>
      </div>
    </CardContent></Card>
  );

  if (step === "payer") return (
    <Card className="border-primary/40"><CardContent className="p-4 space-y-3">
      <div className="font-medium flex items-center gap-2"><ReceiptText className="h-4 w-4" />付款對象與報銷人</div>
      <div>
        <Label className="text-xs">供應商（付款對象，必選）</Label>
        <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={supplierId || ""} onChange={e => setSupplierId(Number(e.target.value) || null)} data-testid="select-reimburse-supplier">
          <option value="">請選擇供應商</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.taxId ? `（${s.taxId}）` : ""}</option>)}
        </LookupSelect>
        {!supplierId && <div className="text-xs text-muted-foreground mt-1">找不到「{draft.merchant}」？請先到採購管理新增供應商。</div>}
      </div>
      {isEmployee ? (
        <div className="text-xs text-muted-foreground">報銷人：您本人（自動帶入）</div>
      ) : (
        <div>
          <Label className="text-xs">報銷人（員工，可跳過）</Label>
          <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={employeeId || ""} onChange={e => setEmployeeId(Number(e.target.value) || null)} data-testid="select-reimburse-employee">
            <option value="">無</option>
            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </LookupSelect>
        </div>
      )}
      <div className="flex justify-between">
        <Button variant="outline" size="sm" onClick={() => setStep("project")}>上一步</Button>
        <Button size="sm" disabled={!supplierId} onClick={() => setStep("review")} data-testid="button-reimburse-payer-next">下一步</Button>
      </div>
    </CardContent></Card>
  );

  return (
    <Card className="border-primary/40"><CardContent className="p-4 space-y-4">
      <div className="font-medium flex items-center gap-2"><ReceiptText className="h-4 w-4" />報銷內容確認（尚未送出）
        {typeof draft.confidence === "number" && draft.confidence < 0.8 && <span className="text-xs text-amber-700 font-normal">辨識信心較低，請仔細核對</span>}
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <div><Label className="text-xs">商家</Label><Input value={draft.merchant} onChange={e => setDraft(d => ({ ...d, merchant: e.target.value }))} /></div>
        <div><Label className="text-xs">發票號碼</Label><Input value={draft.invoiceNumber} onChange={e => setDraft(d => ({ ...d, invoiceNumber: e.target.value }))} /></div>
        <div><Label className="text-xs">日期</Label><Input type="date" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} /></div>
        <div><Label className="text-xs">總金額（含稅）</Label><Input type="number" min="0" value={draft.totalAmount} onChange={e => setDraft(d => ({ ...d, totalAmount: Number(e.target.value) || 0 }))} data-testid="input-reimburse-total" /></div>
        <div><Label className="text-xs">稅額</Label><Input type="number" min="0" value={draft.taxAmount} onChange={e => setDraft(d => ({ ...d, taxAmount: Number(e.target.value) || 0 }))} /></div>
        <div>
          <Label className="text-xs">報帳分類</Label>
          <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={draft.categoryCode} onChange={e => setDraft(d => ({ ...d, categoryCode: e.target.value }))} data-testid="select-reimburse-category">
            {categories.map(c => <option key={c.code} value={c.code}>{c.code} {c.name}（{c.accountNumber} {c.accountName}）</option>)}
          </LookupSelect>
        </div>
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_140px_36px] gap-2 text-xs text-muted-foreground"><span>費用明細</span><span>金額</span><span /></div>
        {draft.items.map((it, i) => <div key={i} className="grid grid-cols-[1fr_140px_36px] gap-2">
          <Input value={it.description} onChange={e => updateItem(i, { description: e.target.value })} />
          <Input type="number" min="0" value={it.amount} onChange={e => updateItem(i, { amount: Number(e.target.value) })} />
          <Button variant="ghost" size="icon" disabled={draft.items.length === 1} onClick={() => setDraft(d => ({ ...d, items: d.items.filter((_, idx) => idx !== i) }))}><Trash2 className="h-4 w-4" /></Button>
        </div>)}
        <Button variant="outline" size="sm" onClick={() => setDraft(d => ({ ...d, items: [...d.items, { description: "", amount: 0 }] }))}><Plus className="h-3 w-3 mr-1" />新增明細</Button>
      </div>
      <div className={`text-sm text-right ${sumMismatch ? "text-destructive" : "text-muted-foreground"}`}>
        明細合計：NT$ {itemSum.toLocaleString()}{sumMismatch && ` ≠ 總金額 NT$ ${draft.totalAmount.toLocaleString()}，請調整`}
      </div>
      <div className="text-xs text-muted-foreground">
        部門：{departments.find(d => d.id === departmentId)?.name || "無"}｜專案：{projects.find(p => p.id === projectId)?.name || "無"}｜供應商：{suppliers.find(s => s.id === supplierId)?.name || "未選"}
      </div>
      <div className="flex justify-between">
        <Button variant="outline" size="sm" onClick={() => setStep("payer")}>上一步</Button>
        <Button onClick={confirm} disabled={creating || sumMismatch} data-testid="button-reimburse-confirm">{creating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}確認送出報銷</Button>
      </div>
    </CardContent></Card>
  );
}

export default function AiAssistantPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isEmployee = user?.role === ROLE_EMPLOYEE;
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [isListening, setIsListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechPrefixRef = useRef("");
  const SpeechRecognitionApi = typeof window === "undefined"
    ? undefined
    : (window as Window & { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;

  // 追問流程：AI 回覆缺少資料時，記住原始需求，下一句補充會與原需求合併重新解析
  const pendingClarifyRef = useRef<{ kind: "doc" | "customer"; text: string } | null>(null);

  const ask = useMutation({
    mutationFn: async (q: string): Promise<{ result?: AskResponse; draft?: DocumentDraft; customerDraft?: CustomerDraft; clarify?: string[] }> => {
      const pending = pendingClarifyRef.current;
      const customerIntent = !pending && /(新增|建立|新建|加一?個|幫我建)[^，。]{0,6}客戶/.test(q);
      const documentIntent = !pending && !customerIntent && /(報價|銷售訂單|開單|出貨|(開|建立?).{0,4}(報價|訂單|出貨))/.test(q);
      const kind: "doc" | "customer" | null = pending ? pending.kind : customerIntent ? "customer" : documentIntent ? "doc" : null;
      const text = pending ? `${pending.text}\n補充：${q}` : q;
      const endpoint = kind === "customer" ? "customer-draft" : kind === "doc" ? "document-draft" : "ask";
      const res = await fetch(`/erp-api/ai/${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind ? { text } : { question: q }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (!kind) return { result: json };
      if (json.clarify?.questions?.length) {
        pendingClarifyRef.current = { kind, text };
        return { clarify: json.clarify.questions as string[] };
      }
      pendingClarifyRef.current = null;
      return kind === "customer" ? { customerDraft: json.customerDraft } : { draft: json.draft };
    },
    onSuccess: (result, q) => {
      setHistory((h) => [...h, { question: q, ...result }]);
    },
    onError: (e: Error, q) => {
      setHistory((h) => [...h, { question: q, error: e.message }]);
      toast({ title: "查詢失敗", description: e.message, variant: "destructive" });
    },
  });

  const importQuotation = useMutation({
    mutationFn: async (file: File): Promise<{ draft: DocumentDraft; fileName: string }> => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/erp-api/ai/quotation-import`, { method: "POST", credentials: "include", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return { draft: json.draft, fileName: file.name };
    },
    onSuccess: ({ draft, fileName }) => {
      setHistory((h) => [...h, { question: `📎 上傳報價單：${fileName}`, draft }]);
    },
    onError: (e: Error, file) => {
      setHistory((h) => [...h, { question: `📎 上傳報價單：${file.name}`, error: e.message }]);
      toast({ title: "報價單辨識失敗", description: e.message, variant: "destructive" });
    },
  });

  const scanReceipts = useMutation({
    mutationFn: async (files: File[]): Promise<{ reimburse: ReimburseDraft; label: string }> => {
      const fd = new FormData();
      files.forEach(f => fd.append("files", f));
      const res = await fetch(`/erp-api/reimbursement/scan`, { method: "POST", credentials: "include", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const p = json.parsed || {};
      const items = (Array.isArray(p.items) && p.items.length > 0)
        ? p.items.map((it: any) => ({ description: String(it.description || ""), amount: Number(it.amount || 0) }))
        : [{ description: String(p.merchant || "費用"), amount: Number(p.total_amount || 0) }];
      const attachments = Array.isArray(json.attachments) ? json.attachments : [];
      return {
        label: `📷 拍照報銷（${files.length} 張）`,
        reimburse: {
          merchant: String(p.merchant || ""),
          taxId: String(p.tax_id || ""),
          invoiceNumber: String(p.invoice_number || ""),
          date: p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : new Date().toISOString().slice(0, 10),
          totalAmount: Number(p.total_amount || 0),
          taxAmount: Number(p.tax_amount || 0),
          items,
          categoryCode: String(json.category?.code || "19"),
          categoryReason: p.category_reason,
          confidence: typeof p.confidence === "number" ? p.confidence : undefined,
          multiReceipt: p.multi_receipt === true,
          attachmentIds: attachments.filter((a: any) => a && a.id).map((a: any) => a.id),
          attachmentErrors: attachments.filter((a: any) => a && a.error).map((a: any) => String(a.fileName || "")),
        },
      };
    },
    onSuccess: ({ reimburse, label }) => {
      setHistory(h => [...h, { question: label, reimburse }]);
    },
    onError: (e: Error) => {
      setHistory(h => [...h, { question: "📷 拍照報銷", error: e.message }]);
      toast({ title: "發票辨識失敗", description: e.message, variant: "destructive" });
    },
  });

  const onReceiptsSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0 || scanReceipts.isPending) return;
    scanReceipts.mutate(files);
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || importQuotation.isPending) return;
    importQuotation.mutate(file);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history.length, ask.isPending, importQuotation.isPending]);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  const sendQuestion = (value: string) => {
    const q = value.trim();
    if (!q || ask.isPending) return;
    recognitionRef.current?.stop();
    setQuestion("");
    ask.mutate(q);
  };

  const submit = () => {
    sendQuestion(question);
  };

  const toggleSpeech = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    if (!SpeechRecognitionApi || ask.isPending) return;

    const recognition = new SpeechRecognitionApi();
    speechPrefixRef.current = question.trimEnd();
    recognition.lang = "zh-TW";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      const separator = speechPrefixRef.current && transcript ? " " : "";
      setQuestion(`${speechPrefixRef.current}${separator}${transcript}`);
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-5xl" data-testid="page-ai-assistant">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Sparkles className="h-6 w-6 text-primary" /> {isEmployee ? "AI 拍照報銷" : "AI 智能查詢助理"} <PageHint hintKey="ai-assistant">{isEmployee ? "把發票或收據拍照上傳，AI 會自動讀取內容並幫你分類，確認後即完成報銷送簽。金額與內容請務必核對後再送出。" : "這裡可以用日常中文查詢系統資料，也能先產生報價單或銷售訂單草稿，或上傳發票照片一鍵報銷。輸入完整的期間、對象與想看的數字，確認結果後再採取行動。小提醒：AI 可能誤解問題，金額與草稿內容請務必人工核對後再儲存。"}</PageHint></h1>
          <p className="text-sm text-muted-foreground mt-1">{isEmployee ? "拍下發票或收據，AI 自動辨識並完成報銷申請；送出前都可以修改。" : "用中文查詢資料、產生報價單／銷售訂單草稿，或上傳發票照片一鍵報銷；確認前不會寫入系統。"}</p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pr-2">
        {history.length === 0 && isEmployee && (
          <Card>
            <CardContent className="p-6 text-center space-y-3">
              <Camera className="h-10 w-10 mx-auto text-primary" />
              <div className="text-sm text-muted-foreground">按下方相機按鈕拍照或選擇發票照片，AI 會自動辨識並幫你完成報銷。</div>
              <Button onClick={() => receiptInputRef.current?.click()} disabled={scanReceipts.isPending} data-testid="button-employee-scan">
                <Camera className="h-4 w-4 mr-2" />拍照報銷
              </Button>
            </CardContent>
          </Card>
        )}
        {history.length === 0 && !isEmployee && (
          <Card>
            <CardContent className="p-4">
              <div className="text-sm font-medium mb-2">試試這些問題：</div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setQuestion(s); }}
                    className="text-xs px-3 py-1.5 rounded-full border hover:bg-muted transition-colors"
                    data-testid={`suggestion-${s.slice(0, 10)}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {history.map((turn, i) => (
          <div key={i} className="space-y-2" data-testid={`turn-${i}`}>
            <div className="flex justify-end">
              <div className="bg-primary text-primary-foreground rounded-lg px-4 py-2 max-w-[80%] text-sm">
                {turn.question}
              </div>
            </div>

            {turn.error && (
              <Card className="border-destructive/50">
                <CardContent className="p-3 text-sm flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div className="text-destructive">{turn.error}</div>
                </CardContent>
              </Card>
            )}

            {turn.result && (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Database className="h-3 w-3" /> {turn.result.intent} · {turn.result.rowCount} 筆
                    {turn.result.chartType === "bar" && <BarChart3 className="h-3 w-3 ml-2" />}
                    {turn.result.chartType === "line" && <LineIcon className="h-3 w-3 ml-2" />}
                    {turn.result.chartType === "pie" && <PieIcon className="h-3 w-3 ml-2" />}
                  </div>

                  <div className="text-sm leading-relaxed">{turn.result.summary}</div>

                  {(turn.result.chartType !== "table" && turn.result.chartType !== "none") || hasTwoColumnBarData(turn.result) ? (
                    <ChartView result={turn.result} />
                  ) : null}

                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">資料表格</summary>
                    <div className="mt-2"><TableView result={turn.result} /></div>
                  </details>

                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">SQL</summary>
                    <pre className="mt-2 p-2 bg-muted rounded text-[11px] overflow-x-auto whitespace-pre-wrap">{turn.result.sql}</pre>
                  </details>
                </CardContent>
              </Card>
            )}
            {turn.clarify && (
              <Card className="border-primary/40">
                <CardContent className="p-4 text-sm space-y-2" data-testid={`clarify-${i}`}>
                  <div className="font-medium">我還需要以下資訊才能開單：</div>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {turn.clarify.map((question, qi) => <li key={qi}>{question}</li>)}
                  </ul>
                  <div className="text-xs text-muted-foreground">請直接在下方輸入補充（可以一次回答多題），我會接著處理。</div>
                </CardContent>
              </Card>
            )}
            {turn.customerDraft && <CustomerDraftCard initial={turn.customerDraft} />}
            {turn.draft && <DocumentDraftCard initial={turn.draft} />}
            {turn.reimburse && <ReimbursementCard initial={turn.reimburse} />}
          </div>
        ))}

        {(ask.isPending || importQuotation.isPending || scanReceipts.isPending) && (
          <Card>
            <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {scanReceipts.isPending ? "AI 正在辨識發票..." : importQuotation.isPending ? "AI 正在辨識報價單..." : "AI 正在解析內容..."}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="border-t pt-3 mt-3">
        <input ref={receiptInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={onReceiptsSelected} data-testid="input-receipt-files" />
        {isEmployee ? (
          <div className="flex justify-center">
            <Button onClick={() => receiptInputRef.current?.click()} disabled={scanReceipts.isPending} className="w-full max-w-md" data-testid="button-scan-receipt">
              {scanReceipts.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Camera className="h-4 w-4 mr-2" />}拍照報銷（可多張同一筆發票）
            </Button>
          </div>
        ) : (
        <>
        <div className="mb-2">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">常用問題</div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_INSIGHTS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => sendQuestion(suggestion)}
                disabled={ask.isPending}
                className="text-xs px-2.5 py-1 rounded-full border bg-background hover:bg-muted transition-colors disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="可查詢資料、開報價單／銷售訂單／出貨單，或說「幫我建立客戶：ＸＸ公司」"
            className="resize-none min-h-[44px] max-h-32"
            disabled={ask.isPending}
            data-testid="input-question"
          />
          <input ref={fileInputRef} type="file" accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif" className="hidden" onChange={onFileSelected} data-testid="input-quotation-file" />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => receiptInputRef.current?.click()}
                  disabled={scanReceipts.isPending}
                  aria-label="拍照報銷"
                  data-testid="button-scan-receipt"
                >
                  <Camera className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>拍照報銷：上傳發票／收據照片，AI 自動辨識入帳</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={ask.isPending || importQuotation.isPending}
                  aria-label="上傳報價單"
                  data-testid="button-upload-quotation"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>上傳報價單（PDF 或照片），AI 自動建檔</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {SpeechRecognitionApi ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={isListening ? "destructive" : "outline"}
                    size="icon"
                    onClick={toggleSpeech}
                    disabled={ask.isPending}
                    aria-label={isListening ? "停止語音輸入" : "開始語音輸入"}
                    data-testid="button-microphone"
                  >
                    {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isListening ? "停止語音輸入" : "按下開始語音輸入"}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <span className="sr-only" title="此瀏覽器不支援語音輸入">此瀏覽器不支援語音輸入</span>
          )}
          <Button onClick={submit} disabled={!question.trim() || ask.isPending} data-testid="button-send">
            {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
