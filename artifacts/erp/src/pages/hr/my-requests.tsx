import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DocWindow } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";
import { call, money, post } from "@/lib/call";
import { Plus, HandCoins } from "lucide-react";
import { ReceiptRequestBadge, ReceiptRequestForm, ReceiptRequestWindow, type ReceiptRequest } from "@/components/accounting/receipt-request-doc";
import { PaymentRequestForm, PaymentRequestView, RequestStatusBadge, approvalSteps, payeesText, type RequestDoc } from "@/components/accounting/payment-request-doc";

/**
 * 我的申請：自己送出請款／付款申請，看審批進度。員工自助帳號也能用（手機上常用，所以清單用卡片）。
 * 送出後是「待審核」，會出現在主管與財務的審批請求；核准、付款之後才會入帳。
 * 新增表單和點開的畫面，跟財務的「付款申請」是同一個（components/accounting/payment-request-doc）。
 */
const stillOpen = (status: string) => status === "Pending" || status === "Draft" || status === "Rejected";

export default function MyRequestsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<RequestDoc | null>(null);
  // 收款申請：收到客戶的錢，送財務確認（老闆 2026-11-18）
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [viewingReceipt, setViewingReceipt] = useState<ReceiptRequest | null>(null);
  const { data: receipts = [] } = useQuery({ queryKey: ["/my-receipt-requests"], queryFn: () => call<ReceiptRequest[]>("my-receipt-requests") });

  const { data: requests, isLoading } = useQuery({ queryKey: ["/my-requests"], queryFn: () => call<RequestDoc[]>("my-requests") });

  const cancel = async (request: RequestDoc) => {
    if (!confirm(`確定撤回 ${request.requestNumber}？撤回後這張單就作廢，要改內容請重新送一張。`)) return;
    try {
      await post(`my-requests/${request.id}/cancel`);
      toast({ title: "已撤回" });
      setViewing(null);
      await queryClient.invalidateQueries({ queryKey: ["/my-requests"] });
    } catch (e) {
      toast({ title: "沒有成功", description: e instanceof Error ? e.message : "請稍後再試", variant: "destructive" });
    }
  };

  const list = requests ?? [];
  const waiting = list.filter(r => r.status === "Pending" || r.status === "Approved");
  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="我的申請" description="請款、付款申請，以及收到客戶款項的收款申請，都從這裡送出。送出後由主管與財務審批，這裡可以看進度。"
        action={<div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setReceiptOpen(true)} data-testid="button-new-receipt-request"><HandCoins className="h-4 w-4 mr-1" />收款申請</Button>
          <Button onClick={() => setOpen(true)} data-testid="button-new-request"><Plus className="h-4 w-4 mr-1" />新增申請</Button>
        </div>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">處理中</p><p className="text-2xl font-semibold tabular-nums">{waiting.length} 張</p><p className="text-xs text-muted-foreground">{money(waiting.reduce((s, r) => s + r.amount, 0))}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">被退回</p><p className="text-2xl font-semibold tabular-nums">{list.filter(r => r.status === "Rejected").length} 張</p><p className="text-xs text-muted-foreground">請看退回原因後重送</p></CardContent></Card>
        <Card className="col-span-2 md:col-span-1"><CardContent className="p-4"><p className="text-xs text-muted-foreground">已付款</p><p className="text-2xl font-semibold tabular-nums">{list.filter(r => r.status === "Paid").length} 張</p><p className="text-xs text-muted-foreground">{money(list.filter(r => r.status === "Paid").reduce((s, r) => s + r.amount, 0))}</p></CardContent></Card>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">讀取中…</p> : list.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">還沒有送過申請。按右上角「新增申請」開始；有發票或收據的，也可以用「AI 拍照報銷」直接拍照送出。</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {list.map(request => (
            <button key={request.id} type="button" onClick={() => setViewing(request)} className="block w-full rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/40 active:bg-muted/60" data-testid={`card-request-${request.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-words">{request.lines?.length ? [...new Set(request.lines.map(l => l.summary))].join("、") : (request.remarks || "").split("\n")[1]?.replace(/^・/, "") || request.requestNumber}</p>
                  <p className="text-xs text-muted-foreground">{request.requestNumber}・{request.requestDate}・付給 {payeesText(request)}{request.projectName ? `・${request.projectName}` : ""}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(request.amount)}</p>
                  <span className="mt-1 inline-block"><RequestStatusBadge status={request.status} /></span>
                </div>
              </div>
              {request.approval && <p className="mt-2 text-xs">{approvalSteps(request.approval)}</p>}
              {request.status === "Rejected" && request.approval?.comments && <p className="mt-1 text-xs text-destructive">退回原因：{request.approval.comments}</p>}
            </button>
          ))}
        </div>
      )}

      {receipts.length > 0 && (
        <div className="space-y-3" data-testid="receipt-requests">
          <h2 className="text-sm font-semibold text-muted-foreground">收款申請</h2>
          {receipts.map(r => (
            <button key={r.id} type="button" onClick={() => setViewingReceipt(r)} className="block w-full rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/40 active:bg-muted/60" data-testid={`card-receipt-request-${r.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-words">收款：{r.customerName ?? "客戶"}</p>
                  <p className="text-xs text-muted-foreground">{r.requestNumber}・{r.voucherDate ?? ""}{r.orders.length ? `・${r.orders.join("、")}` : ""}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(r.amount)}</p>
                  <span className="mt-1 inline-block"><ReceiptRequestBadge status={r.status} /></span>
                </div>
              </div>
              {r.status === "Rejected" && r.decisionNote && <p className="mt-1 text-xs text-destructive">退回原因：{r.decisionNote}</p>}
            </button>
          ))}
        </div>
      )}

      <ReceiptRequestForm open={receiptOpen} onOpenChange={setReceiptOpen} onCreated={() => queryClient.invalidateQueries({ queryKey: ["/my-receipt-requests"] })} />
      <ReceiptRequestWindow request={viewingReceipt} onClose={() => setViewingReceipt(null)} />

      <PaymentRequestForm open={open} onOpenChange={setOpen} onCreated={() => queryClient.invalidateQueries({ queryKey: ["/my-requests"] })} />

      <DocWindow open={viewing !== null} onClose={() => setViewing(null)} name="付款申請" number={viewing?.requestNumber} status={viewing && <RequestStatusBadge status={viewing.status} />}
        footer={<>
          {viewing && stillOpen(viewing.status) && <Button variant="outline" className="mr-auto text-destructive" onClick={() => cancel(viewing)} data-testid="button-cancel-request">撤回這張申請</Button>}
          <Button variant="outline" onClick={() => setViewing(null)}>關閉</Button>
        </>}>
        {viewing && <PaymentRequestView request={viewing} source="my-requests" attachmentsEditable={stillOpen(viewing.status)} />}
      </DocWindow>
    </div>
  );
}
