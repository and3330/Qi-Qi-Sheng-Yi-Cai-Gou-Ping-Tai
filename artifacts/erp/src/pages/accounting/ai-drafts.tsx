import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, RefreshCw, XCircle } from "lucide-react";
import { aiDraftsApi, aiCustomerDraftsApi, type AiDraftStatus } from "@/lib/api";
import { PendingEmails } from "@/components/shared/pending-emails";

const STATUS_TABS: { value: AiDraftStatus; label: string }[] = [
  { value: "pending", label: "待確認" },
  { value: "confirmed", label: "已確認" },
  { value: "rejected", label: "已駁回" },
];

const DOC_TYPE_LABEL: Record<string, string> = {
  receipt: "收款單",
  payment: "付款單",
  quotation: "報價單",
  payment_request: "請款單",
  sales_invoice: "銷貨發票",
  customer: "客戶主檔",
};

type DraftKind = "document" | "customer";
const KIND_TABS: { value: DraftKind; label: string }[] = [
  { value: "document", label: "單據草稿" },
  { value: "customer", label: "客戶草稿" },
];

/** Common view of document drafts (ai_draft_documents) and customer drafts (ai_customer_drafts). */
interface DraftRow {
  kind: DraftKind;
  id: number;
  docType: string;
  payload: unknown;
  status: AiDraftStatus;
  summary: string | null;
  createdAt: string;
  confirmedBy: string | number | null;
  confirmedAt: string | null;
  resultId: number | string | null;
}

async function listDrafts(kind: DraftKind, status: AiDraftStatus): Promise<DraftRow[]> {
  if (kind === "customer") {
    return (await aiCustomerDraftsApi.list(status)).map((d) => ({ ...d, kind, docType: "customer", resultId: d.resultCustomerId }));
  }
  return (await aiDraftsApi.list(status)).map((d) => ({ ...d, kind, resultId: d.resultDocumentId }));
}

function confirmLabel(kind: DraftKind) {
  return kind === "customer" ? "確認建立客戶" : "確認入帳";
}

function docLabel(t: string) {
  return DOC_TYPE_LABEL[t] ?? t;
}

function confirmEffect(t: string) {
  if (t === "customer") return "確認後會建立正式客戶主檔（非帳務過帳：不會產生任何單據、分錄、發票或收付款）。確認當下系統會重新檢查統一編號與同租戶重複（統編／客戶代碼／名稱），有衝突時不會建立。";
  if (t === "receipt") return "此操作會建立收款單並立即過帳，影響應收帳款與銀行/現金科目。";
  if (t === "quotation" || t === "sales_invoice") return `此操作會建立真實的${docLabel(t)}，建立後可能維持草稿狀態，仍需於原模組後續處理。`;
  return `此操作會建立真實的${docLabel(t)}，並可能影響帳務資料。`;
}

function fmtTime(s: string | null) {
  if (!s) return "-";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString("zh-TW", { hour12: false });
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "number") return v.toLocaleString("zh-TW");
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** Renders payload as plain text only (no HTML injection). */
function PayloadView({ payload }: { payload: unknown }) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const entries = Object.entries(payload as Record<string, unknown>);
    const scalars = entries.filter(([, v]) => v === null || typeof v !== "object");
    const nested = entries.filter(([, v]) => v !== null && typeof v === "object");
    return (
      <div className="space-y-3">
        {scalars.length > 0 && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {scalars.map(([k, v]) => (
              <div key={k} className="flex gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0 font-mono text-xs pt-0.5">{k}</dt>
                <dd className="break-words min-w-0">{fmtValue(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {nested.map(([k, v]) => (
          <div key={k}>
            <div className="text-xs font-mono text-muted-foreground mb-1">{k}</div>
            {Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === "object" && !Array.isArray(r)) ? (
              <div className="overflow-x-auto border rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>{Object.keys(v[0] as object).map((c) => <th key={c} scope="col" className="text-left px-2 py-1 font-medium">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {v.map((row, i) => (
                      <tr key={i} className="border-t">
                        {Object.keys(v[0] as object).map((c) => <td key={c} className="px-2 py-1 align-top">{fmtValue((row as Record<string, unknown>)[c])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <pre className="text-xs bg-muted/50 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-64">{JSON.stringify(v, null, 2)}</pre>
            )}
          </div>
        ))}
      </div>
    );
  }
  return <pre className="text-xs bg-muted/50 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-64">{fmtValue(payload)}</pre>;
}

export default function AiDraftsPage() {
  const [status, setStatus] = useState<AiDraftStatus>("pending");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [kind, setKind] = useState<DraftKind>("document");
  const [action, setAction] = useState<{ kind: "confirm" | "reject"; draft: DraftRow } | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ["ai-drafts", kind, status],
    queryFn: () => listDrafts(kind, status),
    staleTime: 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: status === "pending" ? 30_000 : false,
  });

  const mutation = useMutation({
    mutationFn: async (a: { kind: "confirm" | "reject"; id: number; draftKind: DraftKind }): Promise<void> => {
      if (a.draftKind === "customer") {
        await (a.kind === "confirm" ? aiCustomerDraftsApi.confirm(a.id) : aiCustomerDraftsApi.reject(a.id));
      } else {
        await (a.kind === "confirm" ? aiDraftsApi.confirm(a.id) : aiDraftsApi.reject(a.id));
      }
    },
    onSuccess: (_d, a) => {
      toast({ title: a.kind === "confirm" ? (a.draftKind === "customer" ? "已建立正式客戶" : "已確認草稿") : "已駁回草稿" });
      setAction(null);
      qc.invalidateQueries({ queryKey: ["ai-drafts"] });
      if (a.kind === "confirm") qc.invalidateQueries();
    },
    onError: (e: Error, a) => {
      toast({ title: a.kind === "confirm" ? "確認失敗" : "駁回失敗", description: e.message, variant: "destructive" });
      qc.invalidateQueries({ queryKey: ["ai-drafts"] });
    },
  });

  const toggle = (id: number) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const drafts = query.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title="AI 草稿待確認" description="AI 助理產生的單據、客戶主檔提案與要寄給客戶的信，需經人員檢視確認後才會生效" />

      <PendingEmails />

      <div role="tablist" aria-label="草稿類型" className="inline-flex rounded-md border p-0.5 bg-muted/40 mr-2">
        {KIND_TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={kind === t.value}
            onClick={() => { setKind(t.value); setExpanded(new Set()); }}
            className={`px-3 py-1.5 text-sm rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${kind === t.value ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tablist" aria-label="草稿狀態篩選" className="inline-flex rounded-md border p-0.5 bg-muted/40">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={status === t.value}
            onClick={() => setStatus(t.value)}
            className={`px-3 py-1.5 text-sm rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${status === t.value ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="載入中">
          {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : query.isError ? (
        <Card>
          <CardContent className="py-8 flex flex-col items-center gap-3 text-center" role="alert">
            <AlertTriangle className="text-destructive" size={28} aria-hidden="true" />
            <div className="text-sm">無法載入 AI 草稿：{(query.error as Error).message}</div>
            <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
              <RefreshCw size={14} className={`mr-1.5 ${query.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />重試
            </Button>
          </CardContent>
        </Card>
      ) : drafts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="mx-auto text-muted-foreground mb-2" size={28} aria-hidden="true" />
            <div className="font-medium">目前沒有{STATUS_TABS.find((t) => t.value === status)?.label}的{kind === "customer" ? "客戶" : "單據"}草稿</div>
            <div className="text-sm text-muted-foreground mt-1">
              {status === "pending" ? `AI 助理提出的${kind === "customer" ? "客戶主檔" : "單據"}提案會出現在這裡等待確認。` : "切換其他狀態以檢視歷史紀錄。"}
            </div>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2" aria-label="草稿列表">
          {drafts.map((d) => {
            const open = expanded.has(d.id);
            const busy = mutation.isPending && mutation.variables?.id === d.id && mutation.variables?.draftKind === d.kind;
            return (
              <li key={d.id}>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{docLabel(d.docType)}</Badge>
                          <span className="text-xs text-muted-foreground">#{d.id} · 建立於 {fmtTime(d.createdAt)}</span>
                          {d.status === "confirmed" && <Badge>已確認</Badge>}
                          {d.status === "rejected" && <Badge variant="secondary">已駁回</Badge>}
                        </div>
                        <p className="mt-1.5 text-sm break-words">{d.summary || "（無摘要）"}</p>
                        {d.status !== "pending" && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            處理人：{fmtValue(d.confirmedBy)} · 時間：{fmtTime(d.confirmedAt)}
                            {d.resultId != null && <> · {d.kind === "customer" ? "產生客戶 ID" : "產生單據 ID"}：{String(d.resultId)}</>}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => toggle(d.id)} aria-expanded={open} aria-controls={`draft-payload-${d.id}`}>
                          {open ? <ChevronDown size={14} className="mr-1" aria-hidden="true" /> : <ChevronRight size={14} className="mr-1" aria-hidden="true" />}
                          {open ? "收合內容" : "檢視內容"}
                        </Button>
                        {d.status === "pending" && (
                          <>
                            <Button variant="outline" size="sm" disabled={mutation.isPending} onClick={() => setAction({ kind: "reject", draft: d })}>
                              <XCircle size={14} className="mr-1" aria-hidden="true" />駁回
                            </Button>
                            <Button size="sm" disabled={mutation.isPending} onClick={() => { setExpanded((s) => new Set(s).add(d.id)); setAction({ kind: "confirm", draft: d }); }}>
                              {busy ? <Loader2 size={14} className="mr-1 animate-spin" aria-hidden="true" /> : <CheckCircle2 size={14} className="mr-1" aria-hidden="true" />}
                              {confirmLabel(d.kind)}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    {open && (
                      <div id={`draft-payload-${d.id}`} className="mt-3 pt-3 border-t">
                        <PayloadView payload={d.payload} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!action} onOpenChange={(o) => { if (!o && !mutation.isPending) setAction(null); }}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          {action && (
            <>
              <DialogHeader>
                <DialogTitle>{action.kind === "confirm" ? confirmLabel(action.draft.kind) : "駁回 AI 草稿"}</DialogTitle>
                <DialogDescription>
                  {docLabel(action.draft.docType)} #{action.draft.id}：{action.draft.summary || "（無摘要）"}
                </DialogDescription>
              </DialogHeader>
              {action.kind === "confirm" ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-3 text-sm flex gap-2" role="note">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <div className="font-medium">{action.draft.kind === "customer" ? "此操作將建立正式客戶主檔，非草稿預覽" : "此操作將建立正式單據，非草稿預覽"}</div>
                    <div className="mt-0.5">{confirmEffect(action.draft.docType)} 請確認下列內容正確無誤。</div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">駁回後此草稿不會建立任何{action.draft.kind === "customer" ? "客戶" : "單據"}，紀錄會保留於「已駁回」供日後查閱。</p>
              )}
              <div className="border rounded-md p-3">
                <PayloadView payload={action.draft.payload} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAction(null)} disabled={mutation.isPending}>取消</Button>
                <Button
                  variant={action.kind === "reject" ? "destructive" : "default"}
                  disabled={mutation.isPending}
                  onClick={() => { if (!mutation.isPending) mutation.mutate({ kind: action.kind, id: action.draft.id, draftKind: action.draft.kind }); }}
                >
                  {mutation.isPending && <Loader2 size={14} className="mr-1.5 animate-spin" aria-hidden="true" />}
                  {action.kind === "confirm" ? confirmLabel(action.draft.kind) : "確認駁回"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
