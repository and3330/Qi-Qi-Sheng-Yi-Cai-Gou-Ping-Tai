import { useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { call, money, post, selectClass, todayText } from "@/lib/call";
import { DocWindow, DocFields, DocLines, DocNote, DocSection } from "@/components/shared/doc-window";
import { RelatedDocs } from "@/components/shared/related-docs";
import { Plus, Trash2, Copy, CheckCircle2, Clock, XCircle, Ban, Banknote, Paperclip, FileText, X } from "lucide-react";

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
interface Options { me: { username: string; displayName: string }; categories: string[]; projects: Array<{ id: number; name: string; parentId: number | null }>; departments: Array<{ id: number; name: string }>; payees: Array<{ id: number; name: string }>; finance?: boolean }
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
          { header: "付給", cell: l => `${l.payee}${l.self ? "（先墊）" : ""}` },
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

// 每一行：付給誰（空白＝我自己先墊的）、摘要、金額。跟 Ecount 付款單一樣，一張單可以付給好幾個人
const emptyLine = { payee: "", summary: "", amount: "" };
const emptyForm = () => ({ category: "專案雜費", projectId: "", departmentId: "", requestDate: todayText(), memo: "", lines: [{ ...emptyLine }], dueDate: "", paymentMethod: "", bankAccount: "", invoiceId: "" });

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
  const setLine = (i: number, key: "payee" | "summary" | "amount", value: string) => setForm(f => ({ ...f, lines: f.lines.map((line, idx) => idx === i ? { ...line, [key]: value } : line) }));
  const myName = options?.me.displayName || "";
  /** 這一行要付給誰：空白或寫自己＝付給我自己（先墊的錢）；名單裡有的帶編號；沒有的用名字新增 */
  const payTarget = (payee: string) => {
    const name = payee.trim();
    if (!name || name === myName || name === "我自己") return { payTo: "self" };
    const hit = (options?.payees ?? []).find(p => p.name === name);
    return hit ? { payTo: "other", payeeId: hit.id } : { payTo: "other", payeeName: name };
  };
  // 專案：主專案在前，子專案縮排
  const projects = options?.projects ?? [];
  const projectOptions = [...projects.filter(p => !p.parentId).flatMap(parent => [parent, ...projects.filter(c => c.parentId === parent.id)]), ...projects.filter(p => p.parentId && !projects.some(x => x.id === p.parentId))];

  const reset = () => { setForm(emptyForm()); setFiles([]); };
  const pickInvoice = (id: string) => {
    const inv = openInvoices.find(x => String(x.id) === id);
    // 選了發票：對象就是發票上的客戶／供應商，金額先帶還沒付完的金額，一張發票一行
    setForm(f => ({ ...f, invoiceId: id, lines: inv ? [{ payee: inv.supplierName || inv.customerName || "", summary: f.lines[0]?.summary || `發票 ${inv.invoiceNumber}`, amount: String(Number(inv.outstandingAmount)) }] : f.lines }));
  };

  const submit = async () => {
    if (!form.projectId) { toast({ title: "請選擇專案", description: "每一筆支出都要歸屬到專案", variant: "destructive" }); return; }
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
          memo: form.memo, lines: lines.map(line => ({ ...payTarget(line.payee), summary: line.summary, amount: Number(line.amount) })),
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
    <DocWindow
      open={open}
      onClose={() => onOpenChange(false)}
      name="新增付款申請"
      description="送出後會進到主管與財務的審批，核准後由財務付款。金額與對象送出後不能自己改，寫錯請撤回重送。"
      wide
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button onClick={submit} disabled={saving || !(total > 0)} data-testid="button-submit-request">{saving ? "送出中…" : `送出審批（${money(total)}）`}</Button>
      </>}
    >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="req-category">申請類型</Label>
              <select id="req-category" className={selectClass} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {(options?.categories ?? []).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-date">日期</Label>
              <Input id="req-date" type="date" value={form.requestDate} max={todayText()} onChange={e => setForm(f => ({ ...f, requestDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-project">專案 <span className="text-destructive">*</span></Label>
              <select id="req-project" className={selectClass} value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))} data-testid="select-request-project">
                <option value="">請選擇這筆錢算哪個專案</option>
                {projectOptions.map(p => <option key={p.id} value={p.id}>{p.parentId ? "　└ " : ""}{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-dept">部門</Label>
              <select id="req-dept" className={selectClass} value={form.departmentId} onChange={e => setForm(f => ({ ...f, departmentId: e.target.value }))}>
                <option value="">（不指定）</option>
                {(options?.departments ?? []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label>摘要</Label>{!invoice && <Button type="button" variant="outline" size="sm" onClick={() => setForm(f => ({ ...f, lines: [...f.lines, { ...emptyLine }] }))}><Plus className="h-3 w-3 mr-1" />加一行</Button>}</div>
            <p className="text-xs text-muted-foreground">{invoice ? `對著發票 ${invoice.invoiceNumber} 付款：對象是發票上的${invoice.supplierName || invoice.customerName || "對象"}，付款後會沖這張發票。` : "一行一筆：付給誰、摘要、金額。付給不同的人（例如好幾位講師）就一人一行；「付給」空白就是付給我自己（我先墊的錢）。每一行的摘要會原樣顯示在日記帳。"}</p>
            <datalist id="req-payees">{myName && <option value={myName}>我自己（先墊）</option>}{(options?.payees ?? []).map(p => <option key={p.id} value={p.name} />)}</datalist>
            {form.lines.map((line, i) => (
              <div key={i} className="grid grid-cols-[1fr_7rem_auto] gap-2 rounded-md border p-2 md:grid-cols-[10rem_1fr_7rem_auto] md:border-0 md:p-0">
                <Input className="col-span-3 md:col-span-1" list="req-payees" value={line.payee} disabled={!!invoice} onChange={e => setLine(i, "payee", e.target.value)} placeholder={`付給（空白＝${myName || "我自己"}）`} aria-label={`第 ${i + 1} 行付給誰`} data-testid={`input-request-payee-${i}`} />
                <Input value={line.summary} onChange={e => setLine(i, "summary", e.target.value)} placeholder="摘要，例如 115(上)昌平材料費" aria-label={`第 ${i + 1} 行摘要`} data-testid={`input-request-summary-${i}`} />
                <Input className="text-right" type="number" inputMode="decimal" min="0" value={line.amount} onChange={e => setLine(i, "amount", e.target.value)} placeholder="金額" aria-label={`第 ${i + 1} 行金額`} data-testid={`input-request-amount-${i}`} />
                <div className="flex">
                  {!invoice && <Button type="button" variant="ghost" size="icon" onClick={() => setForm(f => ({ ...f, lines: [...f.lines.slice(0, i + 1), { ...line }, ...f.lines.slice(i + 1)] }))} aria-label={`複製第 ${i + 1} 行`} title="複製這一行"><Copy className="h-4 w-4" /></Button>}
                  {!invoice && form.lines.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }))} aria-label={`刪除第 ${i + 1} 行`}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                </div>
              </div>
            ))}
            <p className="text-right text-sm">合計 <span className="font-semibold tabular-nums">{money(total)}</span></p>
          </div>

          {finance && (
            <fieldset className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-xs text-muted-foreground">財務欄位（只有財務看得到，選填）</legend>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="req-invoice">關聯發票</Label>
                  <select id="req-invoice" className={selectClass} value={form.invoiceId} onChange={e => pickInvoice(e.target.value)} data-testid="select-request-invoice">
                    <option value="">（不對發票，直接申請付款）</option>
                    {openInvoices.map(inv => <option key={inv.id} value={inv.id}>{inv.invoiceNumber}・{inv.supplierName || inv.customerName || ""}・未付 {money(inv.outstandingAmount)}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="req-due">到期日</Label>
                  <Input id="req-due" type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="req-method">付款方式</Label>
                  <select id="req-method" className={selectClass} value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}>
                    <option value="">（還沒決定）</option>
                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="req-bank">銀行帳號</Label>
                  <Input id="req-bank" value={form.bankAccount} onChange={e => setForm(f => ({ ...f, bankAccount: e.target.value }))} placeholder="對方的收款帳號" />
                </div>
              </div>
            </fieldset>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="req-desc">備註（怎麼算的、哪一堂課、哪張收據；只留在這張單上）</Label>
            <Textarea id="req-desc" rows={3} value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder={"例如：\n樂善國小 一次課 1000，15 次課共 15000\n二重國中車馬費 72×12＝864"} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>收據／發票照片</Label>
              <input ref={fileInput} type="file" accept={ACCEPT} multiple className="hidden" onChange={e => { const picked = Array.from(e.target.files ?? []); setFiles(f => [...f, ...picked].slice(0, MAX_FILES)); e.target.value = ""; }} data-testid="input-new-request-files" />
              <Button type="button" variant="outline" size="sm" disabled={files.length >= MAX_FILES} onClick={() => fileInput.current?.click()}><Paperclip className="h-3 w-3 mr-1" />拍照或選檔案</Button>
            </div>
            {files.length === 0 ? <p className="text-xs text-muted-foreground">選填，最多 {MAX_FILES} 個，照片或 PDF。有附收據審批比較快。</p> : (
              <ul className="space-y-1 text-sm">
                {files.map((file, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFiles(f => f.filter((_, idx) => idx !== i))} aria-label={`移除 ${file.name}`}><X className="h-4 w-4" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
    </DocWindow>
  );
}
