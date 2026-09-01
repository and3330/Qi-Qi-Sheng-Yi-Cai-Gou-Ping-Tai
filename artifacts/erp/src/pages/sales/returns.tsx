import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListErpSalesOrdersQueryKey, getListErpSalesReturnsQueryKey,
  useCreateErpSalesReturn, useListErpSalesOrders, useListErpSalesReturns,
  useUpdateErpSalesReturnStatus, type ErpReturnStatusUpdateStatus, type ErpSalesReturn,
} from "@workspace/api-client-react";
import { Eye, Loader2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const labels: Record<string, string> = { draft: "草稿", confirmed: "已確認", cancelled: "已取消" };
const colors: Record<string, string> = { draft: "bg-slate-100", confirmed: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700" };
const errorMessage = (e: any) => e?.response?.data?.error || e?.data?.error || e?.message || "發生未知錯誤";

export default function SalesReturnsPage() {
  const queryClient = useQueryClient(); const { toast } = useToast();
  const [status, setStatus] = useState("all"); const [createOpen, setCreateOpen] = useState(false); const [view, setView] = useState<ErpSalesReturn | null>(null);
  const [orderId, setOrderId] = useState(""); const [quantities, setQuantities] = useState<Record<number, string>>({}); const [reason, setReason] = useState(""); const [note, setNote] = useState("");
  const { data: returns, isLoading } = useListErpSalesReturns({ status: status === "all" ? undefined : status });
  const { data: shipped } = useListErpSalesOrders({ status: "shipped" }); const { data: completed } = useListErpSalesOrders({ status: "completed" });
  const orders = useMemo(() => [...(shipped?.items || []), ...(completed?.items || [])].filter((o, i, all) => all.findIndex((x) => x.id === o.id) === i), [shipped, completed]);
  const selectedOrder = orders.find((o) => o.id === Number(orderId));
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListErpSalesReturnsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListErpSalesOrdersQueryKey() });
  };
  const reset = () => { setOrderId(""); setQuantities({}); setReason(""); setNote(""); };
  const create = useCreateErpSalesReturn({ mutation: {
    onSuccess: () => { invalidate(); toast({ title: "已建立銷貨退回單" }); setCreateOpen(false); reset(); },
    onError: (e: any) => toast({ title: "建立失敗", description: errorMessage(e), variant: "destructive" }),
  }});
  const update = useUpdateErpSalesReturnStatus({ mutation: {
    onSuccess: (result) => { invalidate(); setView(result); toast({ title: result.status === "confirmed" ? "退回已確認，庫存已回補" : "退回單已取消" }); },
    onError: (e: any) => toast({ title: "更新失敗", description: errorMessage(e), variant: "destructive" }),
  }});
  const changeStatus = (value: ErpReturnStatusUpdateStatus) => view && update.mutate({ id: view.id, data: { status: value } });
  const submit = () => {
    if (!selectedOrder) { toast({ title: "請選擇銷貨單", variant: "destructive" }); return; }
    const items = selectedOrder.items.map((item) => ({ salesOrderItemId: item.id, quantity: Number(quantities[item.id] || 0) })).filter((item) => item.quantity > 0);
    const invalid = items.some((item) => item.quantity > (selectedOrder.items.find((x) => x.id === item.salesOrderItemId)?.quantity || 0));
    if (!items.length || invalid) { toast({ title: "請填寫有效退回數量", description: "退回數量不可超過原銷貨數量", variant: "destructive" }); return; }
    create.mutate({ data: { salesOrderId: selectedOrder.id, reason: reason || null, note: note || null, items } });
  };

  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-3"><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部狀態</SelectItem><SelectItem value="draft">草稿</SelectItem><SelectItem value="confirmed">已確認</SelectItem><SelectItem value="cancelled">已取消</SelectItem></SelectContent></Select>
      <Button onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" />建立銷貨退回</Button></div>
    <Card className="overflow-hidden border-t-2 border-t-primary"><Table><TableHeader className="bg-secondary/50"><TableRow><TableHead>退回單號</TableHead><TableHead>銷貨單號</TableHead><TableHead>客戶</TableHead><TableHead>原因</TableHead><TableHead className="text-right">金額</TableHead><TableHead>狀態</TableHead><TableHead>建立時間</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>{isLoading ? <TableRow><TableCell colSpan={8} className="h-32 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></TableCell></TableRow> : !returns?.length ? <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">查無銷貨退回單</TableCell></TableRow> : returns.map((r) => <TableRow key={r.id}><TableCell className="font-medium">{r.srNo}</TableCell><TableCell>{r.salesOrderNo || "—"}</TableCell><TableCell>{r.customerName}</TableCell><TableCell>{r.reason || "—"}</TableCell><TableCell className="text-right">NT$ {r.totalAmount.toLocaleString()}</TableCell><TableCell><Badge variant="outline" className={colors[r.status]}>{labels[r.status] || r.status}</Badge></TableCell><TableCell>{new Date(r.createdAt).toLocaleDateString("zh-TW")}</TableCell><TableCell><Button size="sm" variant="ghost" onClick={() => setView(r)}><Eye className="mr-1 h-4 w-4" />明細</Button></TableCell></TableRow>)}</TableBody>
    </Table></Card>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>建立銷貨退回</DialogTitle></DialogHeader>
      <div className="space-y-4"><div className="space-y-2"><Label>銷貨單 *</Label><Select value={orderId} onValueChange={(v) => { setOrderId(v); setQuantities({}); }}><SelectTrigger><SelectValue placeholder="選擇已出貨或已完成銷貨單" /></SelectTrigger><SelectContent>{orders.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.soNo}－{o.customerName}</SelectItem>)}</SelectContent></Select></div>
        {selectedOrder && <Table><TableHeader><TableRow><TableHead>品項</TableHead><TableHead>規格</TableHead><TableHead className="text-right">原數量</TableHead><TableHead className="w-32">退回數量</TableHead></TableRow></TableHeader><TableBody>{selectedOrder.items.map((item) => <TableRow key={item.id}><TableCell>{item.productName} {item.isVirtual && <Badge variant="secondary">虛擬</Badge>}</TableCell><TableCell>{item.variantName || "—"}</TableCell><TableCell className="text-right">{item.quantity}</TableCell><TableCell><Input type="number" min="0" max={item.quantity} value={quantities[item.id] || ""} onChange={(e) => setQuantities({ ...quantities, [item.id]: e.target.value })} /></TableCell></TableRow>)}</TableBody></Table>}
        <div className="space-y-2"><Label>退回原因</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="space-y-2"><Label>備註</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button disabled={create.isPending} onClick={submit}>建立</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={!!view} onOpenChange={(open) => !open && setView(null)}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>銷貨退回明細 {view?.srNo}</DialogTitle></DialogHeader>{view && <div className="space-y-4">
      <div className="flex gap-2"><Badge variant="outline" className={colors[view.status]}>{labels[view.status]}</Badge><Badge variant="outline">銷貨單：{view.salesOrderNo}</Badge></div>
      <div className="rounded-lg bg-muted/40 p-4 text-sm"><div>客戶：{view.customerName}</div><div>原因：{view.reason || "—"}</div>{view.note && <div>備註：{view.note}</div>}</div>
      <Table><TableHeader><TableRow><TableHead>品項</TableHead><TableHead>規格</TableHead><TableHead className="text-right">單價</TableHead><TableHead className="text-right">退回數量</TableHead><TableHead className="text-right">小計</TableHead></TableRow></TableHeader><TableBody>{view.items.map((i) => <TableRow key={i.id}><TableCell>{i.productCode}－{i.productName} {i.isVirtual && <Badge variant="secondary">虛擬</Badge>}</TableCell><TableCell>{i.variantName || "—"}</TableCell><TableCell className="text-right">NT$ {i.unitPrice.toLocaleString()}</TableCell><TableCell className="text-right">{i.quantity}</TableCell><TableCell className="text-right">NT$ {(i.unitPrice*i.quantity).toLocaleString()}</TableCell></TableRow>)}</TableBody></Table>
      <div className="text-right font-bold">退回總額：NT$ {view.totalAmount.toLocaleString()}</div>
      {view.status === "draft" && <><p className="text-sm text-muted-foreground">確認後將回補庫存，並同步商城訂單為已退貨。</p><div className="flex justify-end gap-2"><Button variant="destructive" onClick={() => changeStatus("cancelled")}>取消退回單</Button><Button onClick={() => changeStatus("confirmed")}>確認並回補庫存</Button></div></>}
    </div>}</DialogContent></Dialog>
  </div>;
}