import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DocWindow, DocFields, DocLines, DocNote, DocSection, type DocColumn } from "@/components/shared/doc-window";
import { PageHeader } from "@/components/shared/page-header";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, ChevronRight, ExternalLink, Check, X, Circle, Ban, FileText } from "lucide-react";
import { ChangeReview } from "@/components/accounting/change-review";

const api = (path: string) => `/erp-api/${path}`;

const statusColors: Record<string, string> = { Pending: "default", "In Progress": "secondary", Approved: "outline", Rejected: "destructive", Cancelled: "outline" };
const docTypeLabels: Record<string, string> = { Leave: "請假單", PurchaseOrder: "採購訂單", PaymentRequest: "付款申請", ChangeRequest: "異動申請" };
const statusLabels: Record<string, string> = { Pending: "待審批", "In Progress": "審批中", Approved: "已核准", Rejected: "已駁回", Cancelled: "已撤銷" };
const docStatusLabels: Record<string, string> = { Draft: "草稿", Pending: "待審", Approved: "已核准", Rejected: "已駁回", Paid: "已付款", Cancelled: "已取消", Voided: "已作廢", Submitted: "已送出", Completed: "已完成", "To Receive": "待收貨" };
const actionLabels: Record<string, string> = { Approved: "核准", Rejected: "駁回" };
const isOpen = (s: string) => s === "Pending" || s === "In Progress";
const money = (n: unknown) => `NT$ ${Math.round(Number(n) || 0).toLocaleString()}`;

type Tab = "mine" | "open" | "all";

async function decide(id: number, status: "Approved" | "Rejected", comments: string, changePayload?: unknown) {
  const r = await fetch(api(`approval-requests/${id}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, comments, ...(changePayload !== undefined ? { changePayload } : {}) }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "審批失敗");
  return data;
}

/** 審批內容視窗（共用的單據外框）：單據內容、審批關卡與歷程，底部核准／駁回 */
function ApprovalDetail({ id, number, onClose }: { id: number; number?: string | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [comments, setComments] = useState("");
  const [rejecting, setRejecting] = useState(false);
  // 異動申請：審核人直接改了內容，核准時一起送出
  const [revised, setRevised] = useState<unknown>(undefined);
  const { data, isLoading } = useQuery<any>({ queryKey: ["approval-request-detail", id], queryFn: () => fetch(api(`approval-requests/${id}/detail`)).then(r => r.json()) });

  const mutation = useMutation({
    mutationFn: (status: "Approved" | "Rejected") => decide(id, status, comments.trim(), status === "Approved" ? revised : undefined),
    onSuccess: (row: any, status) => {
      qc.invalidateQueries({ queryKey: ["approval-requests"] });
      qc.invalidateQueries({ queryKey: ["approval-request-detail", id] });
      if (status === "Rejected") toast({ title: "已駁回", description: "申請人會收到通知與原因" });
      else if (row?.status === "In Progress") toast({ title: "已核准這一關", description: `已送到第 ${row.currentStep}/${row.totalSteps} 關` });
      else toast({ title: "已核准", description: "全部關卡都通過了" });
      setComments(""); setRejecting(false);
      onClose();
    },
    onError: (e: Error) => toast({ title: "沒有成功", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <DocWindow open onClose={onClose} name="審批內容" number={number}><p className="text-muted-foreground">載入中…</p></DocWindow>;
  if (data.error) return <DocWindow open onClose={onClose} name="審批內容" number={number}><p className="text-destructive">{data.error}</p></DocWindow>;
  const req = data.request;
  const doc = data.document;
  const hasQty = doc?.lines?.some((l: any) => l.qty);
  const lineColumns: DocColumn<any>[] = [
    { header: "項目", cell: l => l.name },
    ...(hasQty ? [
      { header: "數量", cell: (l: any) => <span className="whitespace-nowrap">{l.qty}{l.unit}</span>, align: "right" as const },
      { header: "單價", cell: (l: any) => Number(l.price).toLocaleString(), align: "right" as const },
    ] : []),
    { header: "金額", cell: l => Number(l.amount).toLocaleString(), align: "right" },
  ];

  return (
    <DocWindow
      open onClose={onClose} name="審批內容" number={number ?? req.documentNumber}
      status={<>
        <Badge variant="secondary">{docTypeLabels[req.documentType] || req.documentType}</Badge>
        <Badge variant={statusColors[req.status] as any}>{statusLabels[req.status] || req.status}</Badge>
      </>}
      footer={isOpen(req.status) ? (
        <div className="w-full space-y-3">
          {data.canDecide ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="approval-comment">{rejecting ? "駁回原因（必填）" : "意見（選填）"}</Label>
                <Textarea id="approval-comment" rows={2} value={comments} onChange={e => setComments(e.target.value)} placeholder={rejecting ? "例如：缺少發票、金額跟報價不符" : "例如：同意，下週付款"} />
              </div>
              <div className="flex gap-2">
                {rejecting ? (
                  <>
                    <Button variant="outline" className="flex-1" onClick={() => setRejecting(false)}>取消</Button>
                    <Button variant="destructive" className="flex-1" disabled={!comments.trim() || mutation.isPending} onClick={() => mutation.mutate("Rejected")} data-testid="button-confirm-reject">確定駁回</Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" className="flex-1 text-destructive" onClick={() => setRejecting(true)} data-testid="button-reject"><XCircle size={16} className="mr-1" />駁回</Button>
                    <Button className="flex-1" disabled={mutation.isPending} onClick={() => mutation.mutate("Approved")} data-testid="button-approve"><CheckCircle size={16} className="mr-1" />核准</Button>
                  </>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{data.decideBlockedReason}</p>
          )}
        </div>
      ) : <Button variant="outline" onClick={onClose}>關閉</Button>}
    >
      {doc?.status && <p className="text-xs text-muted-foreground">單據狀態：{docStatusLabels[doc.status] || doc.status}</p>}

      {doc?.amount != null && (
        <div>
          <p className="text-xs text-muted-foreground">金額</p>
          <p className="text-2xl font-semibold tabular-nums">{money(doc.amount)}</p>
        </div>
      )}

      {data.documentMissing ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">找不到這張單據（可能已經刪除）。</p>
      ) : (
        <DocFields items={doc.fields as [string, string][]} />
      )}

      {doc?.lines?.length > 0 && <DocLines columns={lineColumns} rows={doc.lines as any[]} />}

      {doc?.change && (
        <div className="rounded-md border p-3">
          <ChangeReview change={doc.change} editable={isOpen(req.status) && data.canDecide && doc.change.kind === "edit"} onChange={setRevised} />
        </div>
      )}

      <DocNote label={req.documentType === "Leave" ? "請假原因" : req.documentType === "ChangeRequest" ? "申請原因" : "說明"}>{doc?.remarks}</DocNote>

      {data.attachments?.length > 0 && (
        <DocSection title={`附件（${data.attachments.length}）`}>
          <div className="grid grid-cols-3 gap-2">
            {(data.attachments as any[]).map(a => {
              const href = api(`approval-requests/${id}/attachments/${a.id}`);
              const isImage = /^image\//.test(a.fileType || "");
              return (
                <a key={a.id} href={href} target="_blank" rel="noopener noreferrer" title={a.fileName} className="group overflow-hidden rounded-md border bg-muted/30 hover:border-primary">
                  {isImage
                    ? <img src={href} alt={a.fileName} loading="lazy" className="aspect-square w-full object-cover" />
                    : <div className="flex aspect-square w-full items-center justify-center p-2 text-center text-xs text-muted-foreground"><FileText size={22} className="mb-1 block" /></div>}
                  <p className="truncate px-1.5 py-1 text-[11px] text-muted-foreground group-hover:text-foreground">{a.fileName}</p>
                </a>
              );
            })}
          </div>
        </DocSection>
      )}
      {req.documentType === "PaymentRequest" && !data.documentMissing && !(data.attachments?.length > 0) && (
        <p className="text-xs text-muted-foreground">這張單沒有附收據或發票。</p>
      )}

      {doc?.link && (
        <Link href={doc.link} className="inline-flex items-center gap-1 text-sm text-primary hover:underline" onClick={onClose}>
          打開完整單據<ExternalLink size={13} />
        </Link>
      )}

      <DocSection title={`審批關卡${req.workflowName ? `（${req.workflowName}）` : ""}`}>
        <ol className="space-y-2">
          {data.steps.map((s: any) => (
            <li key={s.step} className="flex items-center gap-2 text-sm">
              {s.state === "done" ? <Check size={16} className="text-emerald-600" /> : s.state === "rejected" ? <X size={16} className="text-destructive" /> : s.state === "cancelled" ? <Ban size={16} className="text-muted-foreground" /> : <Circle size={16} className={s.state === "current" ? "text-amber-500" : "text-muted-foreground"} />}
              <span className={s.state === "current" ? "font-medium" : ""}>第 {s.step} 關：{s.label}</span>
              {s.state === "current" && <Badge variant="outline" className="text-xs">輪到這關</Badge>}
              {s.note && <span className="text-xs text-muted-foreground">{s.note}</span>}
            </li>
          ))}
        </ol>
        {!req.workflowId && req.documentType === "ChangeRequest" && <p className="mt-2 text-xs text-muted-foreground">異動申請沒設流程時，由財務或超級管理員其中一位核准；財務提出的由超級管理員核准。</p>}
        {!req.workflowId && req.documentType !== "ChangeRequest" && <p className="mt-2 text-xs text-amber-700">這類單據還沒設定審批流程，所以任何主管都能審，而且不審也不會擋住後續作業。可到「系統管理 › 審批流程」設定。</p>}
      </DocSection>

      <DocSection title="歷程">
        <ul className="space-y-1.5 text-sm">
          <li className="text-muted-foreground">{new Date(req.createdAt).toLocaleString("zh-TW")}　{req.requestedBy} 送出申請</li>
          {(data.history as any[]).map((h, i) => (
            <li key={i}>
              <span className="text-muted-foreground">{h.at ? new Date(h.at).toLocaleString("zh-TW") : ""}　</span>
              {h.name} {actionLabels[h.action] || h.action}了第 {h.step} 關
              {h.comments && <span className="block pl-4 text-muted-foreground">「{h.comments}」</span>}
              {h.revised && <span className="block pl-4 text-amber-700">審核人修改：{h.revised}</span>}
            </li>
          ))}
          {req.status === "Cancelled" && <li className="text-muted-foreground">單據已取消，這筆審批自動撤銷</li>}
        </ul>
      </DocSection>
    </DocWindow>
  );
}

export default function ApprovalRequests() {
  const search = useSearch();
  const [tab, setTab] = useState<Tab>("mine");
  const [openId, setOpenId] = useState<number | null>(null);

  const { data: requests = [], isLoading } = useQuery<any[]>({ queryKey: ["approval-requests"], queryFn: () => fetch(api("approval-requests")).then(r => r.json()) });

  // 從通知點進來（?doc=PaymentRequest:12 或 ?open=審批編號）：直接打開那一筆
  useEffect(() => {
    const params = new URLSearchParams(search);
    const open = Number(params.get("open"));
    if (open) { setOpenId(open); return; }
    const doc = params.get("doc");
    if (doc && requests.length > 0) {
      const [type, docId] = doc.split(":");
      const hit = requests.find(r => r.documentType === type && String(r.documentId) === docId);
      if (hit) { setOpenId(hit.id); if (!isOpen(hit.status)) setTab("all"); }
    }
  }, [search, requests]);

  const counts = useMemo(() => ({
    mine: requests.filter(r => isOpen(r.status) && r.canDecide).length,
    open: requests.filter(r => isOpen(r.status)).length,
    all: requests.length,
  }), [requests]);
  const rows = requests.filter(r => tab === "all" ? true : tab === "open" ? isOpen(r.status) : isOpen(r.status) && r.canDecide);

  const summaryText = (r: any) => [r.summary?.party && `對象 ${r.summary.party}`, r.summary?.amount != null && money(r.summary.amount), r.summary?.project].filter(Boolean).join("・");

  return (
    <div className="space-y-5">
      <PageHeader title="審批請求" description="點任何一筆就能看完整內容，在視窗裡直接核准或駁回。" />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="審批篩選">
        {([["mine", "輪到我審", counts.mine], ["open", "全部待審", counts.open], ["all", "全部紀錄", counts.all]] as [Tab, string, number][]).map(([key, label, n]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} data-testid={`approval-tab-${key}`}
            className={`rounded-full border px-3.5 py-1.5 text-sm ${tab === key ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
            {label}<span className="ml-1.5 tabular-nums opacity-80">{n}</span>
          </button>
        ))}
      </div>

      {/* 手機：卡片 */}
      <div className="space-y-2 md:hidden">
        {rows.map(r => (
          <button key={r.id} type="button" onClick={() => setOpenId(r.id)} className="w-full rounded-lg border bg-card p-3 text-left active:bg-muted/50">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{docTypeLabels[r.documentType] || r.documentType} {r.documentNumber}</span>
              <Badge variant={statusColors[r.status] as any}>{statusLabels[r.status] || r.status}</Badge>
            </div>
            {summaryText(r) && <p className="mt-1 text-sm">{summaryText(r)}</p>}
            <p className="mt-1 text-xs text-muted-foreground">{r.requestedBy}・{new Date(r.createdAt).toLocaleDateString("zh-TW")}・第 {r.currentStep}/{r.totalSteps} 關 {r.currentStepLabel}</p>
          </button>
        ))}
        {!isLoading && rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{tab === "mine" ? "目前沒有輪到你審的單" : "沒有資料"}</p>}
      </div>

      {/* 電腦：表格，整列可以點 */}
      <Card className="hidden md:block">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>單據</TableHead>
                <TableHead>內容</TableHead>
                <TableHead>申請人</TableHead>
                <TableHead>目前關卡</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead>申請日期</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)} data-testid={`approval-row-${r.id}`}>
                  <TableCell className="whitespace-nowrap">
                    <div className="font-medium">{r.documentNumber || "-"}</div>
                    <div className="text-xs text-muted-foreground">{docTypeLabels[r.documentType] || r.documentType}</div>
                  </TableCell>
                  <TableCell className="max-w-[380px]">
                    <div className="text-sm">{summaryText(r) || <span className="text-muted-foreground">-</span>}</div>
                    {r.summary?.note && <div className="truncate text-xs text-muted-foreground" title={r.summary.note}>{r.summary.note}</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{r.requestedBy}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{isOpen(r.status) ? `第 ${r.currentStep}/${r.totalSteps} 關・${r.currentStepLabel}` : "-"}</TableCell>
                  <TableCell><Badge variant={statusColors[r.status] as any}>{statusLabels[r.status] || r.status}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString("zh-TW")}</TableCell>
                  <TableCell><ChevronRight size={16} className="text-muted-foreground" /></TableCell>
                </TableRow>
              ))}
              {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{tab === "mine" ? "目前沒有輪到你審的單" : "沒有資料"}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {openId != null && <ApprovalDetail key={openId} id={openId} number={requests.find(r => r.id === openId)?.documentNumber} onClose={() => setOpenId(null)} />}
    </div>
  );
}
