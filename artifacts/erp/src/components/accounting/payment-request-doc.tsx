import { useRef, useState, type ReactNode } from "react";
import { departmentLabel, projectPickerLabel, selectableDepartments, selectableProjects } from "@/lib/select-options";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { call, money, post, selectClass, todayText } from "@/lib/call";
import { DocWindow, DocFields, DocLines, DocNote, DocSection, DocFormRows, DocFormRow } from "@/components/shared/doc-window";
import { RelatedDocs } from "@/components/shared/related-docs";
import { PayeePicker, type PayeeChoice } from "@/components/shared/payee-picker";
import { Plus, Trash2, Copy, CheckCircle2, Clock, XCircle, Ban, Banknote, Paperclip, FileText, X, RotateCcw } from "lucide-react";

/**
 * 付款申請這張單的「同一個畫面」（老闆 2026-11-16：一種單據只有一個表單，全系統共用）。
 * 「我的申請」和「付款申請」開的都是這裡的表單和檢視畫面，欄位位置一樣；
 * 差別只在權限：財務多看到付款方式、銀行帳號、到期日、關聯發票，以及申請人。
 */
export interface Attachment { id: number; fileName: string; fileType: string | null; fileSize: number | null; uploadedBy: string | null }
export interface RequestApproval { status: string; currentStep: number; totalSteps: number; stepLabels: string[]; comments: string | null; history: Array<{ name: string; action: string; step: number; at: string; comments: string | null }> }
export interface RequestLine { payee: string; summary: string; amount: number; self?: boolean }
export interface RequestDoc {
  id: number; requestNumber: string; requestDate: string; amount: number; status: string; remarks: string | null;
  payeeName?: string | null; supplierName?: string | null; customerName?: string | null;
  projectName?: string | null; departmentName?: string | null; requestedBy?: string | null;
  dueDate?: string | null; paymentMethod?: string | null; bankAccount?: string | null;
  category?: string | null; memo?: string | null;
  approval?: RequestApproval | null; lines?: RequestLine[] | null;
}
interface Options { me: { username: string; displayName: string }; categories: string[]; projects: Array<{ id: number; name: string; parentId: number | null; isActive?: boolean; startDate?: string | null; endDate?: string | null }>; departments: Array<{ id: number; name: string; isActive?: boolean }>; payees: Array<{ id: number; name: string }>; finance?: boolean }
interface InvoiceOption { id: number; invoiceNumber: string; invoiceType: string; outstandingAmount: string | number; customerId: number | null; supplierId: number | null; customerName?: string | null; supplierName?: string | null }

const MAX_FILES = 10;
const ACCEPT = "image/*,application/pdf";
export const PAYMENT_METHODS = ["銀行轉帳", "支票", "現金"];

export const REQUEST_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Clock }> = {
  Draft: { label: "草稿", variant: "outline", icon: Clock },
  Pending: { label: "審批中", variant: "secondary", icon: Clock },
  Approved: { label: "已核准，等付款", variant: "default", icon: CheckCircle2 },
  Paid: { label: "已付款", variant: "default", icon: Banknote },
  Rejected: { label: "已退回", variant: "destructive", icon: XCircle },
  Cancelled: { label: "已撤回", variant: "outline", icon: Ban },
  Voided: { label: "已作廢", variant: "outline", icon: Ban },
};
export function RequestStatusBadge({ status }: { status: string }) {
  const s = REQUEST_STATUS[status] ?? { label: status, variant: "outline" as const, icon: Clock };
  const Icon = s.icon;
  return <Badge variant={s.variant}><Icon className="mr-1 h-3 w-3" />{s.label}</Badge>;
}

/** 付給誰：一個人就寫名字，好幾個人寫「某某 等 N 人」 */
export function payeesText(request: RequestDoc): string {
  const names = request.lines?.length ? [...new Set(request.lines.map(l => l.payee))] : [request.payeeName || request.supplierName || request.customerName || "—"];
  return names.length > 1 ? `${names[0]} 等 ${names.length} 人` : names[0];
}

/** 審批進度：一關一關列出來，走到哪一關 */
export function approvalSteps(a: RequestApproval | null | undefined): ReactNode {
  if (!a) return null;
  const active = a.status === "Pending" || a.status === "In Progress";
  return a.stepLabels.map((label, i) => {
    const done = a.status === "Approved" || i + 1 < a.currentStep;
    return <span key={i} className={done ? "text-emerald-700" : active && i + 1 === a.currentStep ? "font-medium text-foreground" : "text-muted-foreground"}>{i > 0 ? " → " : ""}{done ? "✓ " : ""}{label}{active && i + 1 === a.currentStep ? "（審批中）" : ""}</span>;
  });
}

/** 上傳收據照片到自己送的申請（一次可以多張） */
async function uploadFiles(requestId: number, files: File[]): Promise<Attachment[]> {
  const body = new FormData();
  files.forEach(file => body.append("files", file));
  const response = await fetch(`/erp-api/my-requests/${requestId}/attachments`, { method: "POST", credentials: "include", body });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "上傳失敗");
  return json as Attachment[];
}

/**
 * 一張申請的附件：縮圖、打開；申請人自己在核准前可以補、可以刪。
 * source：申請人從「我的申請」看自己的（my-requests）；財務從「付款申請」看每一張（payment-requests，只能看）。
 */
export function RequestAttachments({ requestId, editable, source }: { requestId: number; editable: boolean; source: "my-requests" | "payment-requests" }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = editable && source === "my-requests";
  const key = [`/${source}`, requestId, "attachments"];
  const { data: list = [], isLoading } = useQuery({ queryKey: key, queryFn: () => call<Attachment[]>(`${source}/${requestId}/attachments`) });
  const add = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    try { await uploadFiles(requestId, files); toast({ title: `已附上 ${files.length} 個檔案` }); }
    catch (e) { toast({ title: "沒有上傳成功", description: e instanceof Error ? e.message : "請再試一次", variant: "destructive" }); }
    finally { setBusy(false); if (input.current) input.current.value = ""; await queryClient.invalidateQueries({ queryKey: key }); }
  };
  const remove = async (a: Attachment) => {
    if (!confirm(`刪掉「${a.fileName}」？`)) return;
    try { await call(`my-requests/${requestId}/attachments/${a.id}`, { method: "DELETE" }); await queryClient.invalidateQueries({ queryKey: key }); }
    catch (e) { toast({ title: "沒有刪掉", description: e instanceof Error ? e.message : "請再試一次", variant: "destructive" }); }
  };
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium">收據／發票（{list.length}）</p>
        {canEdit && list.length < MAX_FILES && (
          <>
            <input ref={input} type="file" accept={ACCEPT} multiple className="hidden" onChange={e => add(Array.from(e.target.files ?? []).slice(0, MAX_FILES - list.length))} data-testid="input-request-attachments" />
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}><Paperclip className="mr-1 h-3.5 w-3.5" />{busy ? "上傳中…" : "補附件"}</Button>
          </>
        )}
      </div>
      {isLoading ? <p className="text-xs text-muted-foreground">讀取中…</p> : list.length === 0 ? (
        <p className="text-xs text-muted-foreground">{canEdit ? "還沒有附件。有收據或發票請拍照附上，審批比較快。" : "沒有附件。"}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {list.map(a => {
            const href = `/erp-api/${source}/${requestId}/attachments/${a.id}`;
            return (
              <div key={a.id} className="relative overflow-hidden rounded-md border bg-muted/30">
                <a href={href} target="_blank" rel="noopener noreferrer" title={a.fileName}>
                  {/^image\//.test(a.fileType || "") ? <img src={href} alt={a.fileName} loading="lazy" className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center"><FileText className="h-6 w-6 text-muted-foreground" /></div>}
                  <p className="truncate px-1.5 py-1 text-[11px] text-muted-foreground">{a.fileName}</p>
                </a>
                {canEdit && <button type="button" onClick={() => remove(a)} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-background/90 shadow" aria-label={`刪掉 ${a.fileName}`}><X className="h-4 w-4" /></button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 檢視一張付款申請：不管從「我的申請」還是「付款申請」點開，內容和排法都一樣。
 * 由上到下：表頭欄位 → 明細（一行一筆）→ 備註 → 附件 → 審批進度。
 */
export function PaymentRequestView({ request, source, attachmentsEditable = false }: { request: RequestDoc; source: "my-requests" | "payment-requests"; attachmentsEditable?: boolean }) {
  // 有明細的單，備註只放申請人自己寫的說明（每一行的內容已經在表格裡）；舊單沒有明細就整段顯示
  const note = request.lines?.length ? request.memo : request.remarks;
  return (
    <>
      <DocFields items={[
        ["日期", request.requestDate], ["金額", money(request.amount)],
        ["付給", payeesText(request)], ["申請人", request.requestedBy],
        ["專案", request.projectName], ["部門", request.departmentName],
        ["申請類型", request.category], ["到期日", request.dueDate],
        ["付款方式", request.paymentMethod], ["銀行帳號", request.bankAccount],
      ]} />
      {request.lines?.length ? (
        <DocLines rows={request.lines} total={{ value: money(request.amount) }} columns={[
          // 現在一張單只有一個對象（在表頭）；以前一張單付給好幾個人的舊單才需要這一欄
          ...(new Set(request.lines.map(l => l.payee)).size > 1 ? [{ header: "付給", cell: (l: RequestLine) => `${l.payee}${l.self ? "（先墊）" : ""}` }] : []),
          { header: "摘要", cell: l => l.summary },
          { header: "金額", cell: l => money(l.amount), align: "right" },
        ]} />
      ) : null}
      <DocNote>{note}</DocNote>
      <RequestAttachments requestId={request.id} editable={attachmentsEditable} source={source} />
      {source === "payment-requests" && <RelatedDocs type="payment_request" id={request.id} />}
      {request.approval && (
        <DocSection title="審批進度">
          <div className="rounded-md border px-3 py-2">
            <p className="text-xs">{approvalSteps(request.approval)}</p>
            {request.approval.history.map((h, i) => <p key={i} className="mt-1 text-xs text-muted-foreground">第 {h.step} 關・{h.name}・{h.action === "Approved" ? "核准" : h.action === "Rejected" ? "退回" : h.action}{h.at ? `・${h.at.slice(0, 10)}` : ""}{h.comments ? `：${h.comments}` : ""}</p>)}
            {request.status === "Rejected" && request.approval.comments && <p className="mt-1 text-xs text-destructive">退回原因：{request.approval.comments}</p>}
          </div>
        </DocSection>
      )}
    </>
  );
}

// 老闆 2026-11-17：一張付款申請只能付給一個對象（跟付款單一樣，對象在表頭）；下面每一行只有摘要和金額
const emptyLine = { summary: "", amount: "" };
/** 跟 Ecount 一樣，表格一開始就有三行空白可以直接打；沒填的空白行送出時會略過 */
const START_ROWS = 3;
const emptyForm = () => ({ payee: null as PayeeChoice | null, category: "專案雜費", projectId: "", departmentId: "", requestDate: todayText(), memo: "", lines: Array.from({ length: START_ROWS }, () => ({ ...emptyLine })), dueDate: "", paymentMethod: "", bankAccount: "", invoiceId: "" });

/**
 * 新增付款申請的表單。員工和財務用的是同一張，送出後一樣進審批；
 * 財務多一區「財務欄位」（到期日、付款方式、銀行帳號、關聯發票）。
 */
export function PaymentRequestForm({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated?: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: options } = useQuery({ queryKey: ["/my-requests/options"], queryFn: () => call<Options>("my-requests/options"), staleTime: 5 * 60 * 1000 });
  const finance = !!options?.finance;
  const { data: invoices = [] } = useQuery({ queryKey: ["/invoices", "for-payment-request"], queryFn: () => call<InvoiceOption[]>("invoices"), enabled: finance && open, staleTime: 60 * 1000 });
  // 可以對它申請付款的發票：還有沒付完的金額
  const openInvoices = invoices.filter(inv => Number(inv.outstandingAmount) > 0);
  const invoice = openInvoices.find(inv => String(inv.id) === form.invoiceId) ?? null;

  const total = form.lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const setLine = (i: number, key: "summary" | "amount", value: string) => setForm(f => ({ ...f, lines: f.lines.map((line, idx) => idx === i ? { ...line, [key]: value } : line) }));
  const myName = options?.me.displayName || "";
  /** 這張單付給誰：選「我自己」＝我先墊的錢；供應商帶編號；其他（員工、老師、客戶、手打的名字）用名字 */
  const payTarget = () => {
    const who = form.payee;
    if (!who || who.kind === "self" || who.name === myName) return { payTo: "self" };
    return who.kind === "supplier" && who.id ? { payTo: "other", payeeId: who.id } : { payTo: "other", payeeName: who.name };
  };
  // 專案：主專案在前，子專案縮排
  // 已結束、停用的專案不列出（目前選的那一個除外）
  const projects = selectableProjects(options?.projects ?? [], form.projectId);
  const projectOptions = [...projects.filter(p => !p.parentId).flatMap(parent => [parent, ...projects.filter(c => c.parentId === parent.id)]), ...projects.filter(p => p.parentId && !projects.some(x => x.id === p.parentId))];

  const reset = () => { setForm(emptyForm()); setFiles([]); };
  /** 已經填了東西：按「重新輸入」前先問一次 */
  const dirty = !!(form.payee || form.projectId || form.departmentId || form.memo || form.invoiceId || form.dueDate || form.paymentMethod || form.bankAccount || files.length || form.lines.some(l => l.summary || l.amount));
  const pickInvoice = (id: string) => {
    const inv = openInvoices.find(x => String(x.id) === id);
    // 選了發票：對象就是發票上的客戶／供應商，金額先帶還沒付完的金額，一張發票一行
    setForm(f => ({ ...f, invoiceId: id, payee: inv ? { name: inv.supplierName || inv.customerName || "", kind: inv.supplierId ? "supplier" : "customer", id: inv.supplierId ?? inv.customerId ?? undefined } : f.payee, lines: inv ? [{ summary: f.lines[0]?.summary || `發票 ${inv.invoiceNumber}`, amount: String(Number(inv.outstandingAmount)) }] : f.lines }));
  };

  const submit = async () => {
    if (!form.projectId) { toast({ title: "請選擇專案", description: "每一筆支出都要歸屬到專案", variant: "destructive" }); return; }
    if (!form.payee && !invoice) { toast({ title: "請選擇付給誰", description: "一張付款申請只能付給一個對象；自己先墊的錢請選「付給我自己」", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const lines = form.lines.filter(line => line.summary.trim() || line.amount);
      let made: { id: number; requestNumber: string; amount: number };
      if (invoice) {
        // 對著發票付款：付款後要沖這張發票，所以對象和金額跟著發票走
        const customer = invoice.invoiceType === "Sales" || invoice.invoiceType === "Credit Note";
        const created = await post<{ id: number; requestNumber: string; amount: number }>("payment-requests", {
          partyType: customer ? "Customer" : "Supplier", customerId: customer ? invoice.customerId : null, supplierId: customer ? null : invoice.supplierId,
          invoiceId: invoice.id, requestDate: form.requestDate, dueDate: form.dueDate || null, amount: total,
          paymentMethod: form.paymentMethod || null, bankAccount: form.bankAccount || null,
          remarks: [`${form.category}｜申請人 ${myName}`, ...lines.map(l => `・${l.summary}　${Number(l.amount).toLocaleString()}`), form.memo].filter(Boolean).join("\n"),
          departmentId: form.departmentId ? Number(form.departmentId) : null, projectId: Number(form.projectId),
        });
        await post(`payment-requests/${created.id}`, { status: "Pending" }, "PATCH");
        made = { id: created.id, requestNumber: created.requestNumber, amount: total };
      } else {
        made = await post<{ id: number; requestNumber: string; amount: number }>("my-requests", {
          category: form.category,
          projectId: Number(form.projectId), departmentId: form.departmentId ? Number(form.departmentId) : undefined, requestDate: form.requestDate,
          memo: form.memo, lines: lines.map(line => ({ ...payTarget(), summary: line.summary, amount: Number(line.amount) })),
          ...(finance ? { dueDate: form.dueDate || undefined, paymentMethod: form.paymentMethod || undefined, bankAccount: form.bankAccount || undefined } : {}),
        });
      }
      // 單已經送出；照片另外傳，傳失敗也不影響這張單，可以到單裡補
      let uploadNote = "";
      if (files.length > 0) {
        try { await uploadFiles(made.id, files); uploadNote = `，附上 ${files.length} 個檔案`; }
        catch (e) { toast({ title: "申請已送出，但附件沒傳上去", description: `${e instanceof Error ? e.message : "請再試一次"}。點開這張申請可以補附件。`, variant: "destructive" }); }
      }
      toast({ title: "已送出，等待審批", description: `${made.requestNumber}・${money(made.amount)}${uploadNote}` });
      onOpenChange(false); reset();
      onCreated?.();
    } catch (e) {
      toast({ title: "沒有送出", description: e instanceof Error ? e.message : "請稍後再試", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    // 老闆 2026-11-18：畫面照 Ecount 的輸入畫面——上面一個欄位一列（日期、對象、專案、部門、備註、附件），
    // 下面一張有編號的表格（一行一筆：摘要、金額），最下面合計。規則不變：一張申請只付給一個對象。
    <DocWindow
      open={open}
      onClose={() => onOpenChange(false)}
      name="新增付款申請"
      description="送出後會進到主管與財務的審批，核准後由財務付款。金額與對象送出後不能自己改，寫錯請撤回重送。"
      wide
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button variant="outline" disabled={saving} onClick={() => { if (!dirty || window.confirm("把這張申請已經填的內容全部清掉，重新輸入？")) reset(); }} data-testid="button-reset-request"><RotateCcw className="mr-1 h-4 w-4" />重新輸入</Button>
        <Button onClick={submit} disabled={saving || !(total > 0)} data-testid="button-submit-request">{saving ? "送出中…" : `送出審批（${money(total)}）`}</Button>
      </>}
    >
        <div className="space-y-4">
          <DocFormRows data-testid="request-header">
            <DocFormRow label="日期" htmlFor="req-date">
              <Input id="req-date" type="date" className="h-10 md:h-10 md:w-48" value={form.requestDate} max={todayText()} onChange={e => setForm(f => ({ ...f, requestDate: e.target.value }))} />
            </DocFormRow>
            <DocFormRow label="付給誰" required
              hint={invoice ? `對著發票 ${invoice.invoiceNumber} 付款：對象是發票上的${invoice.supplierName || invoice.customerName || "對象"}，付款後會沖這張發票。` : "一張申請只能付給一個對象。要付給不同的人，請一人送一張。"}>
              <PayeePicker value={form.payee} onChange={payee => setForm(f => ({ ...f, payee }))} selfName={myName || undefined} disabled={!!invoice}
                placeholder="點這裡選擇：員工、供應商、老師、客戶" fallbackSuppliers={options?.payees} testId="input-request-payee" />
            </DocFormRow>
            <DocFormRow label="申請類型" htmlFor="req-category">
              <select id="req-category" className={selectClass} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {(options?.categories ?? []).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </DocFormRow>
            <DocFormRow label="專案" htmlFor="req-project" required>
              <select id="req-project" className={selectClass} value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))} data-testid="select-request-project">
                <option value="">請選擇這筆錢算哪個專案</option>
                {projectOptions.map(p => <option key={p.id} value={p.id}>{p.parentId ? "　└ " : ""}{projectPickerLabel(p)}</option>)}
              </select>
            </DocFormRow>
            <DocFormRow label="部門" htmlFor="req-dept">
              <select id="req-dept" className={selectClass} value={form.departmentId} onChange={e => setForm(f => ({ ...f, departmentId: e.target.value }))}>
                <option value="">（不指定）</option>
                {selectableDepartments(options?.departments ?? [], form.departmentId).map(d => <option key={d.id} value={d.id}>{departmentLabel(d)}</option>)}
              </select>
            </DocFormRow>
            {/* 財務欄位：只有財務看得到，選填 */}
            {finance && (
              <>
                <DocFormRow label="關聯發票" htmlFor="req-invoice" hint="只有財務看得到，選填。選了發票，對象和金額會跟著發票走。">
                  <select id="req-invoice" className={selectClass} value={form.invoiceId} onChange={e => pickInvoice(e.target.value)} data-testid="select-request-invoice">
                    <option value="">（不對發票，直接申請付款）</option>
                    {openInvoices.map(inv => <option key={inv.id} value={inv.id}>{inv.invoiceNumber}・{inv.supplierName || inv.customerName || ""}・未付 {money(inv.outstandingAmount)}</option>)}
                  </select>
                </DocFormRow>
                <DocFormRow label="到期日" htmlFor="req-due" hint="希望什麼時候以前付款（只有財務看得到，選填）。">
                  <Input id="req-due" type="date" className="h-10 md:h-10 md:w-48" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
                </DocFormRow>
                <DocFormRow label="付款方式" htmlFor="req-method">
                  <select id="req-method" className={selectClass} value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}>
                    <option value="">（還沒決定）</option>
                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </DocFormRow>
                <DocFormRow label="銀行帳號" htmlFor="req-bank">
                  <Input id="req-bank" className="h-10 md:h-10" value={form.bankAccount} onChange={e => setForm(f => ({ ...f, bankAccount: e.target.value }))} placeholder="對方的收款帳號" />
                </DocFormRow>
              </>
            )}
            <DocFormRow label="備註" htmlFor="req-desc" top hint="怎麼算的、哪一堂課、哪張收據；只留在這張單上。">
              <Textarea id="req-desc" rows={3} value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder={"例如：\n樂善國小 一次課 1000，15 次課共 15000\n二重國中車馬費 72×12＝864"} />
            </DocFormRow>
            <DocFormRow label="附件" top hint={files.length === 0 ? `收據／發票照片。選填，最多 ${MAX_FILES} 個，照片或 PDF。有附收據審批比較快。` : undefined}>
              <input ref={fileInput} type="file" accept={ACCEPT} multiple className="hidden" onChange={e => { const picked = Array.from(e.target.files ?? []); setFiles(f => [...f, ...picked].slice(0, MAX_FILES)); e.target.value = ""; }} data-testid="input-new-request-files" />
              <Button type="button" variant="outline" className="min-h-10" disabled={files.length >= MAX_FILES} onClick={() => fileInput.current?.click()}><Paperclip className="h-4 w-4 mr-1" />拍照或選檔案</Button>
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
          </DocFormRows>

          {/* 輸入表格：一行一筆。手機上表格在自己的框裡左右捲，整個視窗不會跟著跑 */}
          <div className="max-w-full overflow-x-auto rounded-md border" data-testid="request-lines">
            <table className="w-full min-w-[460px] text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="w-9 px-2 py-2 text-center font-medium">#</th>
                  <th className="px-1 py-2 text-left font-medium">摘要</th>
                  <th className="w-32 px-1 py-2 text-right font-medium">金額</th>
                  <th className="w-24"><span className="sr-only">複製或刪除這一行</span></th>
                </tr>
              </thead>
              <tbody>
                {form.lines.map((line, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 text-center text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-1 py-1"><Input className="h-10 md:h-10" value={line.summary} onChange={e => setLine(i, "summary", e.target.value)} placeholder="摘要，例如 115(上)昌平材料費" aria-label={`第 ${i + 1} 行摘要`} data-testid={`input-request-summary-${i}`} /></td>
                    <td className="px-1 py-1"><Input className="h-10 text-right md:h-10" type="number" inputMode="decimal" min="0" value={line.amount} onChange={e => setLine(i, "amount", e.target.value)} placeholder="金額" aria-label={`第 ${i + 1} 行金額`} data-testid={`input-request-amount-${i}`} /></td>
                    <td className="whitespace-nowrap px-1 py-1">
                      {!invoice && <Button type="button" variant="ghost" size="icon" className="h-10 w-10" onClick={() => setForm(f => ({ ...f, lines: [...f.lines.slice(0, i + 1), { ...line }, ...f.lines.slice(i + 1)] }))} aria-label={`複製第 ${i + 1} 行`} title="複製這一行"><Copy className="h-4 w-4" /></Button>}
                      {!invoice && form.lines.length > 1 && <Button type="button" variant="ghost" size="icon" className="h-10 w-10" onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }))} aria-label={`刪除第 ${i + 1} 行`}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 bg-muted/30 font-semibold">
                  <td className="px-2 py-2.5 text-right" colSpan={2}>合計</td>
                  <td className="px-2 py-2.5 text-right tabular-nums" data-testid="request-total">{money(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {!invoice ? <Button type="button" variant="outline" className="min-h-10" onClick={() => setForm(f => ({ ...f, lines: [...f.lines, { ...emptyLine }] }))} data-testid="button-add-request-line"><Plus className="h-4 w-4 mr-1" />加一行</Button> : <span />}
            <p className="text-xs text-muted-foreground">一行一筆：摘要、金額。每一行的摘要會原樣顯示在日記帳；沒填的空白行不會送出。</p>
          </div>
        </div>
    </DocWindow>
  );
}
