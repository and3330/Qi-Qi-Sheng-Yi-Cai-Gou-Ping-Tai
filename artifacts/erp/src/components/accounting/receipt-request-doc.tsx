import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { call, money, post, selectClass, todayText } from "@/lib/call";
import { projectPickerLabel, selectableProjects } from "@/lib/select-options";
import { DocWindow, DocFields, DocFormRows, DocFormRow, DocNote } from "@/components/shared/doc-window";
import { FileText, Paperclip, RotateCcw, X } from "lucide-react";

/**
 * 我的申請 › 收款申請（老闆 2026-11-18）：員工收到客戶的錢，從這裡申請開收款單。
 * 送出後先不入帳，給財務確認錢真的進來了；財務核准後，系統才開收款單入帳。
 * 畫面照付款申請的樣式：上面一欄一列，下面勾這筆錢收的是哪幾張銷貨單。
 */
export interface ReceiptRequest {
  id: number; requestNumber: string; status: string; createdAt: string;
  customerName: string | null; amount: number; voucherDate: string | null; description: string;
  orders: string[]; result: string | null; decidedBy: string | null; decisionNote: string | null;
}
interface Attachment { id: number; fileName: string; fileType: string | null; fileSize: number | null; uploadedBy: string | null }
interface Options { customers: Array<{ id: number; name: string; shortName: string | null }>; accounts: Array<{ id: number; name: string }> }
interface OpenOrder { id: number; orderNumber: string; orderDate: string; label: string | null; outstanding: number; projectId: number | null }
interface ProjectOption { id: number; name: string; parentId: number | null; isActive?: boolean; startDate?: string | null; endDate?: string | null }

const MAX_FILES = 10;
const ACCEPT = "image/*,application/pdf";

export const RECEIPT_REQUEST_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  Pending: { label: "待財務確認", variant: "secondary" },
  Approved: { label: "已確認入帳", variant: "default" },
  Rejected: { label: "被退回", variant: "destructive" },
  Cancelled: { label: "已撤回", variant: "outline" },
};
export function ReceiptRequestBadge({ status }: { status: string }) {
  const s = RECEIPT_REQUEST_STATUS[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

async function uploadFiles(requestId: number, files: File[]): Promise<Attachment[]> {
  const body = new FormData();
  files.forEach(file => body.append("files", file));
  const response = await fetch(`/erp-api/my-receipt-requests/${requestId}/attachments`, { method: "POST", credentials: "include", body });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "上傳失敗");
  return json as Attachment[];
}

/** 打字找客戶：簡稱也找得到 */
function CustomerPicker({ value, onChange }: { value: { id: number; name: string } | null; onChange: (c: { id: number; name: string } | null) => void }) {
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => { const t = setTimeout(() => setSearch(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const { data } = useQuery({
    queryKey: ["/my-receipt-requests/options", search],
    queryFn: () => call<Options>(`my-receipt-requests/options?search=${encodeURIComponent(search)}`),
    enabled: !value && search.length > 0, staleTime: 60 * 1000,
  });
  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-sm">{value.name}</span>
        <Button type="button" variant="outline" className="min-h-10" onClick={() => { onChange(null); setText(""); }}>換一個</Button>
      </div>
    );
  }
  const list = search ? data?.customers ?? [] : [];
  return (
    <div className="space-y-1">
      <Input value={text} onChange={e => setText(e.target.value)} placeholder="打客戶名稱或簡稱，例如：樂善國小" className="h-10" data-testid="input-receipt-customer" />
      {search && (
        <div className="max-h-56 overflow-y-auto rounded-md border">
          {list.length === 0 ? <p className="px-3 py-2 text-sm text-muted-foreground">找不到「{search}」，換個說法試試</p> : list.map(c => (
            <button key={c.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/60 active:bg-muted" onClick={() => onChange({ id: c.id, name: c.name })} data-testid={`option-receipt-customer-${c.id}`}>
              {c.name}{c.shortName && c.shortName !== c.name ? <span className="text-muted-foreground">（{c.shortName}）</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const emptyForm = () => ({
  voucherDate: todayText(), customer: null as { id: number; name: string } | null, cashAccountId: "", projectId: "",
  picked: {} as Record<number, string>, other: "", memo: "",
});

export function ReceiptRequestForm({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated?: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: options } = useQuery({ queryKey: ["/my-receipt-requests/options", ""], queryFn: () => call<Options>("my-receipt-requests/options"), enabled: open, staleTime: 5 * 60 * 1000 });
  const customerId = form.customer?.id;
  const { data: orders = [] } = useQuery({
    queryKey: ["/my-receipt-requests/open-orders", customerId],
    queryFn: () => call<OpenOrder[]>(`my-receipt-requests/open-orders?customerId=${customerId}`), enabled: !!customerId,
  });

  // 專案：沿用「我的申請」的專案清單（已結束、停用的不列）
  const { data: requestOptions } = useQuery({ queryKey: ["/my-requests/options"], queryFn: () => call<{ projects: ProjectOption[] }>("my-requests/options"), enabled: open, staleTime: 5 * 60 * 1000 });
  const projects = selectableProjects(requestOptions?.projects ?? [], form.projectId);
  const pickedProjects = [...new Set(orders.filter(o => o.id in form.picked && o.projectId).map(o => String(o.projectId)))];
  // 勾的銷貨單都屬於同一個專案、還沒選專案：自動帶入
  useEffect(() => {
    if (!form.projectId && pickedProjects.length === 1) setForm(f => ({ ...f, projectId: pickedProjects[0] }));
  }, [pickedProjects.join(","), form.projectId]);
  const pickedLines = Object.entries(form.picked).filter(([, amount]) => Number(amount) > 0);
  const total = pickedLines.reduce((s, [, a]) => s + Number(a), 0) + (Number(form.other) || 0);
  const dirty = !!(form.customer || form.cashAccountId || form.projectId || form.other || form.memo || files.length || Object.keys(form.picked).length);
  const reset = () => { setForm(emptyForm()); setFiles([]); };
  const toggle = (order: OpenOrder) => setForm(f => {
    const picked = { ...f.picked };
    if (order.id in picked) delete picked[order.id]; else picked[order.id] = String(order.outstanding);
    return { ...f, picked };
  });

  const submit = async () => {
    if (!form.customer) { toast({ title: "請選擇是哪個客戶付的款", variant: "destructive" }); return; }
    if (!form.cashAccountId) { toast({ title: "請選擇錢收到哪個帳戶", variant: "destructive" }); return; }
    if (!form.projectId) { toast({ title: "請選擇這筆收款算哪個專案", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const lines = [
        ...pickedLines.map(([id, amount]) => ({ salesOrderId: Number(id), amount: Number(amount) })),
        ...(Number(form.other) > 0 ? [{ amount: Number(form.other), description: form.memo.trim().split("\n")[0] || undefined }] : []),
      ];
      const made = await post<{ id: number; requestNumber: string }>("my-receipt-requests", {
        customerId: form.customer.id, voucherDate: form.voucherDate, cashAccountId: Number(form.cashAccountId), projectId: Number(form.projectId), description: form.memo, lines,
      });
      let uploadNote = "";
      if (files.length > 0) {
        try { await uploadFiles(made.id, files); uploadNote = `，附上 ${files.length} 個檔案`; }
        catch (e) { toast({ title: "申請已送出，但附件沒傳上去", description: `${e instanceof Error ? e.message : "請再試一次"}。點開這張申請可以補附件。`, variant: "destructive" }); }
      }
      toast({ title: "已送出，等財務確認款項", description: `${made.requestNumber}・${money(total)}${uploadNote}` });
      onOpenChange(false); reset(); onCreated?.();
    } catch (e) {
      toast({ title: "沒有送出", description: e instanceof Error ? e.message : "請稍後再試", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <DocWindow open={open} onClose={() => onOpenChange(false)} name="新增收款申請" wide
      description="收到客戶的錢，從這裡申請開收款單。送出後要等財務確認款項真的進來，才會入帳。"
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button variant="outline" disabled={saving} onClick={() => { if (!dirty || window.confirm("把已經填的內容全部清掉，重新輸入？")) reset(); }}><RotateCcw className="mr-1 h-4 w-4" />重新輸入</Button>
        <Button onClick={submit} disabled={saving || !(total > 0)} data-testid="button-submit-receipt-request">{saving ? "送出中…" : `送財務確認（${money(total)}）`}</Button>
      </>}>
      <div className="space-y-4">
        <DocFormRows>
          <DocFormRow label="收款日期" htmlFor="rcpt-date" required>
            <Input id="rcpt-date" type="date" className="h-10 md:w-48" value={form.voucherDate} max={todayText()} onChange={e => setForm(f => ({ ...f, voucherDate: e.target.value }))} />
          </DocFormRow>
          <DocFormRow label="客戶" required hint="誰付的錢。打簡稱就找得到。">
            <CustomerPicker value={form.customer} onChange={customer => setForm(f => ({ ...f, customer, picked: {} }))} />
          </DocFormRow>
          <DocFormRow label="收到哪裡" htmlFor="rcpt-account" required hint="錢匯進哪個銀行帳戶，或收現金。不確定就問財務。">
            <select id="rcpt-account" className={selectClass} value={form.cashAccountId} onChange={e => setForm(f => ({ ...f, cashAccountId: e.target.value }))} data-testid="select-receipt-account">
              <option value="">請選擇</option>
              {(options?.accounts ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </DocFormRow>
          <DocFormRow label="專案" htmlFor="rcpt-project" required hint="勾了銷貨單會自動帶那張單的專案。">
            <select id="rcpt-project" className={selectClass} value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))} data-testid="select-receipt-project">
              <option value="">請選擇這筆收款算哪個專案</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.parentId ? "　└ " : ""}{projectPickerLabel(p)}</option>)}
            </select>
          </DocFormRow>
          <DocFormRow label="備註" htmlFor="rcpt-memo" top hint="匯款帳號後五碼、對方匯款人名字、哪一堂課，財務比較好對。">
            <Textarea id="rcpt-memo" rows={3} value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder={"例如：\n11/18 匯款，帳號後五碼 12345\n樂善國小 上學期課程費"} />
          </DocFormRow>
          <DocFormRow label="附件" top hint={files.length === 0 ? `匯款截圖、收據照片。選填，最多 ${MAX_FILES} 個。有附截圖財務確認比較快。` : undefined}>
            <input ref={fileInput} type="file" accept={ACCEPT} multiple className="hidden" onChange={e => { const picked = Array.from(e.target.files ?? []); setFiles(f => [...f, ...picked].slice(0, MAX_FILES)); e.target.value = ""; }} />
            <Button type="button" variant="outline" className="min-h-10" disabled={files.length >= MAX_FILES} onClick={() => fileInput.current?.click()}><Paperclip className="mr-1 h-4 w-4" />拍照或選檔案</Button>
            {files.length > 0 && (
              <ul className="space-y-1 text-sm">
                {files.map((file, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-10 w-10" onClick={() => setFiles(f => f.filter((_, idx) => idx !== i))} aria-label={`移除 ${file.name}`}><X className="h-4 w-4" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </DocFormRow>
        </DocFormRows>

        {form.customer && (
          <div className="max-w-full overflow-x-auto rounded-md border" data-testid="receipt-request-lines">
            <table className="w-full min-w-[460px] text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-2 py-2"><span className="sr-only">勾選</span></th>
                  <th className="px-1 py-2 text-left font-medium">收的是哪張銷貨單</th>
                  <th className="w-28 px-1 py-2 text-right font-medium">還沒收</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">這次收</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {orders.length === 0 && <tr><td colSpan={4} className="px-3 py-2 text-muted-foreground">這個客戶沒有還沒收齊的銷貨單</td></tr>}
                {orders.map(order => {
                  const on = order.id in form.picked;
                  return (
                    <tr key={order.id}>
                      <td className="px-2 py-1.5 text-center"><input type="checkbox" className="h-5 w-5" checked={on} onChange={() => toggle(order)} aria-label={`收 ${order.orderNumber}`} /></td>
                      <td className="px-1 py-1.5"><span className="font-medium">{order.orderNumber}</span> <span className="text-muted-foreground">{order.orderDate}{order.label ? `・${order.label}` : ""}</span></td>
                      <td className="px-1 py-1.5 text-right tabular-nums">{money(order.outstanding)}</td>
                      <td className="px-2 py-1.5">
                        <Input type="number" inputMode="decimal" min={0} max={order.outstanding} disabled={!on} className="h-9 text-right" value={form.picked[order.id] ?? ""}
                          onChange={e => setForm(f => ({ ...f, picked: { ...f.picked, [order.id]: e.target.value } }))} aria-label={`${order.orderNumber} 這次收的金額`} />
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td />
                  <td className="px-1 py-1.5 text-muted-foreground" colSpan={2}>其他收款（不對銷貨單，例如訂金）</td>
                  <td className="px-2 py-1.5"><Input type="number" inputMode="decimal" min={0} className="h-9 text-right" value={form.other} onChange={e => setForm(f => ({ ...f, other: e.target.value }))} aria-label="其他收款金額" data-testid="input-receipt-other" /></td>
                </tr>
              </tbody>
              <tfoot className="bg-muted/40 font-medium"><tr><td colSpan={3} className="px-2 py-2 text-right">合計</td><td className="px-2 py-2 text-right tabular-nums">{money(total)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </DocWindow>
  );
}

/** 點開一張收款申請：內容、審批結果、附件、撤回 */
export function ReceiptRequestWindow({ request, onClose }: { request: ReceiptRequest | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const id = request?.id;
  const { data: attachments = [], refetch } = useQuery({ queryKey: ["/my-receipt-requests/attachments", id], queryFn: () => call<Attachment[]>(`my-receipt-requests/${id}/attachments`), enabled: !!id });
  const pending = request?.status === "Pending";

  const cancel = async () => {
    if (!request || !confirm(`確定撤回 ${request.requestNumber}？撤回後財務就不會處理這張。`)) return;
    try {
      await post(`my-receipt-requests/${request.id}/cancel`);
      toast({ title: "已撤回" });
      await queryClient.invalidateQueries({ queryKey: ["/my-receipt-requests"] });
      onClose();
    } catch (e) { toast({ title: "沒有成功", description: e instanceof Error ? e.message : "請稍後再試", variant: "destructive" }); }
  };
  const addFiles = async (files: File[]) => {
    if (!id || files.length === 0) return;
    setBusy(true);
    try { await uploadFiles(id, files); toast({ title: `已附上 ${files.length} 個檔案` }); await refetch(); }
    catch (e) { toast({ title: "上傳失敗", description: e instanceof Error ? e.message : "請再試一次", variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <DocWindow open={request !== null} onClose={onClose} name="收款申請" number={request?.requestNumber} status={request && <ReceiptRequestBadge status={request.status} />}
      footer={<>
        {pending && <Button variant="outline" className="mr-auto text-destructive" onClick={cancel} data-testid="button-cancel-receipt-request">撤回這張申請</Button>}
        <Button variant="outline" onClick={onClose}>關閉</Button>
      </>}>
      {request && (
        <div className="space-y-4">
          <DocFields items={[
            ["客戶", request.customerName ?? "—"],
            ["金額", money(request.amount)],
            ["收款日期", request.voucherDate ?? "—"],
            ["收的單", request.orders.length ? request.orders.join("、") : "（不對銷貨單）"],
          ]} />
          {request.description && <DocNote label="備註">{request.description}</DocNote>}
          {request.status === "Pending" && <p className="text-sm text-muted-foreground">等財務確認款項有沒有收到。確認後系統會自動開收款單入帳。</p>}
          {request.status === "Approved" && <p className="text-sm">財務{request.decidedBy ? `（${request.decidedBy}）` : ""}已確認款項，收款單已入帳。</p>}
          {request.status === "Rejected" && <p className="text-sm text-destructive">被退回{request.decidedBy ? `（${request.decidedBy}）` : ""}：{request.decisionNote || "沒有寫原因，請問財務"}。要改的話請重新送一張。</p>}
          <div className="space-y-2">
            <p className="text-sm font-medium">附件</p>
            {attachments.length === 0 ? <p className="text-sm text-muted-foreground">沒有附件</p> : (
              <ul className="space-y-1 text-sm">
                {attachments.map(a => (
                  <li key={a.id}><a className="flex items-center gap-2 rounded-md border px-2 py-1.5 hover:bg-muted/40" href={`/erp-api/my-receipt-requests/${request.id}/attachments/${a.id}`} target="_blank" rel="noreferrer"><FileText className="h-4 w-4 text-muted-foreground" /><span className="truncate">{a.fileName}</span></a></li>
                ))}
              </ul>
            )}
            {pending && (
              <>
                <input ref={fileInput} type="file" accept={ACCEPT} multiple className="hidden" onChange={e => { const picked = Array.from(e.target.files ?? []); e.target.value = ""; void addFiles(picked); }} />
                <Button type="button" variant="outline" className="min-h-10" disabled={busy || attachments.length >= MAX_FILES} onClick={() => fileInput.current?.click()}><Paperclip className="mr-1 h-4 w-4" />{busy ? "上傳中…" : "補附件"}</Button>
              </>
            )}
          </div>
        </div>
      )}
    </DocWindow>
  );
}
