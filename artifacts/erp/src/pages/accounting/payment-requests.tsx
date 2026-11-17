import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DocWindow, DocSection } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";
import { Plus, Check, X, Ban, Eye, Trash2, Search } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useAutoReloadKey } from "@/lib/auto-refresh";

import { ChangeRequestDialog } from "@/components/accounting/change-request-dialog";
import { PaymentRequestForm, PaymentRequestView, RequestStatusBadge, PAYMENT_METHODS, type RequestDoc } from "@/components/accounting/payment-request-doc";
import { PayAccountDialog, type PayAccountChoice } from "@/components/shared/pay-account-dialog";
import { DateRangePresets } from "@/components/shared/date-range-presets";

interface PaymentRequest {
  id: number; requestNumber: string; invoiceId: number | null; partyType: string;
  customerId: number | null; customerName: string | null; supplierId: number | null;
  supplierName: string | null; requestDate: string; dueDate: string | null;
  amount: number; status: string; paymentMethod: string | null; bankAccount: string | null;
  remarks: string | null; createdAt: string;
  projectId?: number | null; departmentId?: number | null; projectName?: string | null; departmentName?: string | null; requestedBy?: string | null;
}
/** 點開一張單拿到的完整內容（多了每一行付給誰、申請類型、審批進度），給共用的檢視畫面用 */
type PaymentRequestDetail = PaymentRequest & RequestDoc;
const OPEN_STATUSES = ["Draft", "Pending", "Approved"];
const statusMap: Record<string, string> = { Draft: "草稿", Pending: "待審核", Approved: "已核准", Paid: "已付款", Rejected: "已駁回", Cancelled: "已取消", Voided: "已作廢" };
const statusColor = (s: string) => s === "Approved" || s === "Paid" ? "default" : s === "Rejected" || s === "Cancelled" ? "destructive" : "secondary";

function getMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}` };
}

export default function PaymentRequestsPage() {
  const reloadKey = useAutoReloadKey();
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<PaymentRequestDetail | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const [editRemarks, setEditRemarks] = useState("");
  const [editPaymentMethod, setEditPaymentMethod] = useState("");
  const [editBankAccount, setEditBankAccount] = useState("");
  const { toast } = useToast();
  const batch = useBatchSelection(requests);

  const defaultRange = useMemo(() => getMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [searchText, setSearchText] = useState("");

  const filteredRequests = useMemo(() => {
    return requests.filter(r => {
      // 還沒處理完的（草稿、待審核、已核准未付款）不管申請日期是哪一天都要看得到，免得舊的申請被日期篩掉沒人處理
      const open = OPEN_STATUSES.includes(r.status);
      if (!open && dateFrom && r.requestDate < dateFrom) return false;
      if (!open && dateTo && r.requestDate > dateTo) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        if (!(r.requestNumber.toLowerCase().includes(q) || (r.customerName || "").toLowerCase().includes(q) || (r.supplierName || "").toLowerCase().includes(q) || (r.remarks || "").toLowerCase().includes(q) || (r.projectName || "").toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [requests, dateFrom, dateTo, searchText]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const reqRes = await fetch(`/erp-api/payment-requests`);
    setRequests(await reqRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);
  // 從審批請求點單號過來（網址帶 ?open=編號）：直接打開那一張
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("open"));
    if (Number.isInteger(id) && id > 0) viewDetail(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 付款會動到帳：先問錢從哪個帳戶出去
  const [paying, setPaying] = useState<{ id: number; requestNumber: string; amount: number; invoiceId: number | null; partyType: string } | null>(null);
  const confirmPay = async (choice: PayAccountChoice) => {
    if (!paying) return;
    const ok = await updateStatus(paying.id, "Paid", choice);
    if (ok) setPaying(null);
  };

  const updateStatus = async (id: number, status: string, extra?: PayAccountChoice): Promise<boolean> => {
    if (status === "Paid" && !extra) {
      const target = requests.find(r => r.id === id) || (detailItem?.id === id ? detailItem : null);
      if (target) { setPaying(target); return false; }
    }
    const res = await fetch(`/erp-api/payment-requests/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, ...(extra || {}) }),
    });
    if (res.ok) {
      toast({ title: `已更新為${statusMap[status] || status}` });
      fetchAll(); if (detailItem?.id === id) viewDetail(id);
      return true;
    }
    const err = await res.json().catch(() => ({}));
    toast({ title: err.error || "操作失敗", variant: "destructive" });
    return false;
  };

  // 付錯了：作廢已付款的申請，系統會開沖銷分錄並把發票恢復成未付
  const handleVoid = async (id: number) => {
    const reason = window.prompt("作廢這筆已付款的申請？\n系統會開一張沖銷分錄，對應的發票會恢復成未付。\n\n請輸入作廢原因：");
    if (!reason || !reason.trim()) return;
    const res = await fetch(`/erp-api/payment-requests/${id}/void`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }),
    });
    if (res.ok) {
      toast({ title: "已作廢，並開立沖銷分錄" });
      fetchAll(); if (detailItem?.id === id) viewDetail(id);
    } else {
      const err = await res.json().catch(() => ({}));
      toast({ title: err.error || "作廢失敗", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/erp-api/payment-requests/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "已刪除" }); fetchAll(); setDetailItem(null); }
    else { const err = await res.json(); toast({ title: err.error || "刪除失敗", variant: "destructive" }); }
  };

  const saveDetail = async () => {
    if (!detailItem) return;
    const body: Record<string, unknown> = { remarks: editRemarks };
    if (detailItem.status === "Draft" || detailItem.status === "Rejected") {
      body.paymentMethod = editPaymentMethod || null;
      body.bankAccount = editBankAccount || null;
    }
    const res = await fetch(`/erp-api/payment-requests/${detailItem.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) toast({ title: "已更新" });
    else { const err = await res.json().catch(() => ({})); toast({ title: err.pending ? "已送審" : "沒有更新", description: err.error || "請再試一次", variant: err.pending ? "default" : "destructive" }); }
    viewDetail(detailItem.id); fetchAll();
  };

  const viewDetail = async (id: number) => {
    const res = await fetch(`/erp-api/payment-requests/${id}`);
    if (res.ok) {
      const d = await res.json();
      setDetailItem(d); setEditRemarks(d.remarks || "");
      setEditPaymentMethod(d.paymentMethod || ""); setEditBankAccount(d.bankAccount || "");
    }
  };

  // 已作廢、已取消：結束的單不能改；已核准、已付款：改備註要送審
  const closed = detailItem?.status === "Voided" || detailItem?.status === "Cancelled";
  const locked = detailItem?.status === "Approved" || detailItem?.status === "Paid";

  return (
    <div className="space-y-6">
      <PageHeader title="付款申請" description="管理付款審批流程 (草稿→待審核→核准→付款)" />
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="付款申請"
          entityEndpoint="payment-requests"
          ids={batch.ids}
          batchFields={[] as BatchField[]}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)} data-testid="button-new-payment-request"><Plus className="h-4 w-4 mr-1" />新增付款申請</Button>
      </div>
      {/* 跟「我的申請」是同一張表單 */}
      <PaymentRequestForm open={open} onOpenChange={setOpen} onCreated={fetchAll} />

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
                <Input className="pl-9" placeholder="申請編號、對象名稱..." value={searchText} onChange={e => setSearchText(e.target.value)} />
              </div>
            </div>
            <div className="text-sm text-muted-foreground pb-2">共 {filteredRequests.length} 筆</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 border-b"><CardTitle>付款申請列表</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                  <th className="text-left px-4 py-2.5 font-semibold">申請編號</th>
                  <th className="text-left px-4 py-2.5 font-semibold">對象</th>
                  <th className="text-left px-4 py-2.5 font-semibold">申請日期</th>
                  <th className="text-left px-4 py-2.5 font-semibold">付款方式</th>
                  <th className="text-left px-4 py-2.5 font-semibold">狀態</th>
                  <th className="text-right px-4 py-2.5 font-semibold">金額</th>
                  <th className="text-center px-4 py-2.5 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
                ) : filteredRequests.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
                ) : filteredRequests.map(r => (
                  <tr key={r.id} className="border-b hover:bg-gray-50 cursor-pointer" title="點一下看這張付款申請的內容"
                    onClick={(e) => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; viewDetail(r.id); }}>
                    <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} /></td>
                    <td className="px-4 py-2 font-medium">{r.requestNumber}</td>
                    <td className="px-4 py-2">
                      {r.customerName || r.supplierName || "-"}
                      {(r.projectName || r.remarks) && <div className="max-w-[320px] truncate text-xs text-muted-foreground" title={r.remarks || undefined}>{[r.projectName, (r.remarks || "").split("\n")[0]].filter(Boolean).join("・")}</div>}
                    </td>
                    <td className="px-4 py-2">{r.requestDate}</td>
                    <td className="px-4 py-2">{r.paymentMethod || "-"}</td>
                    <td className="px-4 py-2"><Badge variant={statusColor(r.status)}>{statusMap[r.status] || r.status}</Badge></td>
                    <td className="px-4 py-2 text-right font-mono">${r.amount.toLocaleString()}</td>
                    <td className="px-4 py-2 text-center">
                      <div className="flex gap-1 justify-center">
                        <Button size="sm" variant="outline" onClick={() => viewDetail(r.id)} title="檢視/編輯"><Eye className="h-3 w-3" /></Button>
                        {r.status === "Draft" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => updateStatus(r.id, "Pending")} title="送審"><Check className="h-3 w-3" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)} title="刪除"><Trash2 className="h-3 w-3" /></Button>
                          </>
                        )}
                        {r.status === "Pending" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => updateStatus(r.id, "Approved")} title="核准"><Check className="h-3 w-3" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => updateStatus(r.id, "Rejected")} title="駁回"><Ban className="h-3 w-3" /></Button>
                          </>
                        )}
                        {r.status === "Approved" && (
                          <Button size="sm" variant="outline" onClick={() => updateStatus(r.id, "Paid")} title="已付款"><Check className="h-3 w-3 mr-1" />付款</Button>
                        )}
                        {r.status === "Rejected" && (
                          <Button size="sm" variant="outline" onClick={() => updateStatus(r.id, "Draft")} title="重新編輯">重新編輯</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <DocWindow open={!!detailItem} onClose={() => setDetailItem(null)} name="付款申請" number={detailItem?.requestNumber} status={detailItem && <RequestStatusBadge status={detailItem.status} />}
        footer={detailItem && <>
                {detailItem.status !== "Draft" && detailItem.status !== "Pending" && (
                  <Button variant="outline" className="mr-auto text-destructive" onClick={() => setAskDelete(true)} data-testid="button-delete-payment-request" title="已經成立的單要送審，核准後單和分錄一起刪除">申請刪除</Button>
                )}
                {detailItem.status === "Draft" && (
                  <>
                    <Button onClick={() => updateStatus(detailItem.id, "Pending")}>送審</Button>
                    <Button variant="outline" onClick={() => updateStatus(detailItem.id, "Cancelled")}>取消</Button>
                    <Button variant="destructive" onClick={() => handleDelete(detailItem.id)}>刪除</Button>
                  </>
                )}
                {detailItem.status === "Paid" && (
                  <Button variant="destructive" onClick={() => handleVoid(detailItem.id)}>作廢（付錯了）</Button>
                )}
                {detailItem.status === "Pending" && (
                  <>
                    <Button onClick={() => updateStatus(detailItem.id, "Approved")}>核准</Button>
                    <Button variant="destructive" onClick={() => updateStatus(detailItem.id, "Rejected")}>駁回</Button>
                  </>
                )}
                {detailItem.status === "Approved" && (
                  <Button onClick={() => updateStatus(detailItem.id, "Paid")}>確認付款</Button>
                )}
                {detailItem.status === "Rejected" && (
                  <Button onClick={() => updateStatus(detailItem.id, "Draft")}>重新編輯</Button>
                )}
          <Button variant="outline" onClick={() => setDetailItem(null)}>關閉</Button>
        </>}>
        {detailItem && (
          <>
            {/* 跟「我的申請」點開是同一個畫面 */}
            <PaymentRequestView request={detailItem} source="payment-requests" />
            <DocSection title="財務處理">
              <div className="space-y-3">
                {(detailItem.status === "Draft" || detailItem.status === "Rejected") && (
                  <>
                    <div>
                      <label className="text-sm font-medium">付款方式</label>
                      <select className="w-full border rounded-md px-3 py-2 text-sm" value={editPaymentMethod} onChange={e => setEditPaymentMethod(e.target.value)}>
                        <option value="">選擇方式</option>
                        {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">銀行帳號</label>
                      <Input value={editBankAccount} onChange={e => setEditBankAccount(e.target.value)} placeholder="帳號" />
                    </div>
                  </>
                )}
                <div>
                  <label className="text-sm font-medium" htmlFor="pr-remarks">財務備註</label>
                  <textarea id="pr-remarks" className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60" rows={Math.min(12, Math.max(3, editRemarks.split("\n").length + 1))} value={editRemarks} onChange={e => setEditRemarks(e.target.value)} placeholder="備註" disabled={closed} />
                  <p className="mt-1 text-xs text-muted-foreground">{closed ? "這張單已經結束，內容不能再改。" : locked ? "這張單已經核准，改備註要寫原因送審，核准後才會改。" : ""}</p>
                </div>
                {!closed && <Button size="sm" onClick={saveDetail} disabled={editRemarks === (detailItem.remarks || "") && detailItem.status !== "Draft" && detailItem.status !== "Rejected"}>{locked ? "送出修改申請" : "儲存"}</Button>}
              </div>
            </DocSection>
          </>
        )}
      </DocWindow>
      {detailItem && (
        <ChangeRequestDialog open={askDelete} onClose={() => setAskDelete(false)} title={`申請刪除 ${detailItem.requestNumber}`}
          endpoint={`/erp-api/payment-requests/${detailItem.id}/delete-request`}
          onSubmitted={() => { fetchAll(); viewDetail(detailItem.id); }}
          description={<>要刪除付款申請 <b>{detailItem.requestNumber}</b>（{detailItem.requestDate}，${detailItem.amount.toLocaleString()}）。這張單開出來的分錄、沖銷分錄會一起刪，對應的發票恢復成未付。只是付錯了、想留紀錄的話，請用「作廢」。</>} />
      )}
      <PayAccountDialog
        open={!!paying}
        onOpenChange={(o) => { if (!o) setPaying(null); }}
        title={paying?.partyType === "Customer" ? "確認收款" : "確認付款"}
        cashLabel={paying?.partyType === "Customer" ? "收款帳戶" : "付款帳戶"}
        confirmLabel={paying?.partyType === "Customer" ? "確認收款" : "確認付款"}
        summary={paying ? <>{paying.requestNumber}，金額 <span className="font-semibold text-foreground">${Number(paying.amount).toLocaleString()}</span>。確認後會自動入帳。</> : null}
        actualCash={paying && paying.invoiceId ? { label: paying.partyType === "Customer" ? "實際收到的台幣（選填）" : "實際付出的台幣（選填）", booked: Number(paying.amount) } : undefined}
        counter={paying && !paying.invoiceId
          ? (paying.partyType === "Customer"
            ? { label: "記到哪個科目", types: ["Income", "Liability"], hint: "這筆沒有對應發票：先收的款項選「預收貨款」，直接認列選收入科目。" }
            : { label: "費用科目", types: ["Expense"], hint: "這筆沒有對應發票，帳上沒有應付帳款可沖，請選這筆錢的費用科目。" })
          : undefined}
        onConfirm={confirmPay}
      />
    </div>
  );
}
