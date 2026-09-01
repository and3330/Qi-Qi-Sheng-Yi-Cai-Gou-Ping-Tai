import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListErpItemsQueryKey,
  getListErpPurchaseReturnsQueryKey,
  useCreateErpPurchaseReturn,
  useListErpPurchaseOrders,
  useListErpPurchaseReturns,
  useUpdateErpPurchaseReturnStatus,
  type AdminPurchaseOrder,
  type ErpPurchaseReturn,
} from '@workspace/api-client-react';
import { CheckCircle2, Eye, Loader2, Plus, RotateCcw, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

const statusLabel: Record<string, string> = { draft: '草稿', confirmed: '已確認', cancelled: '已取消' };
const statusClass: Record<string, string> = {
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  confirmed: 'border-amber-200 bg-amber-50 text-amber-700',
  cancelled: 'border-red-200 bg-red-50 text-red-700',
};
const errorMessage = (err: any) => err?.response?.data?.error ?? err?.data?.error ?? err?.message ?? '請稍後再試';

export default function PurchaseReturnsPage() {
  const [status, setStatus] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [detail, setDetail] = useState<ErpPurchaseReturn | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: returns, isLoading } = useListErpPurchaseReturns(status === 'all' ? {} : { status });
  const { data: receivedOrders } = useListErpPurchaseOrders({ status: 'received' });
  const selectedOrder = useMemo(() => receivedOrders?.find((order) => order.id === Number(purchaseOrderId)), [receivedOrders, purchaseOrderId]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListErpPurchaseReturnsQueryKey() });
  const reset = () => { setCreateOpen(false); setPurchaseOrderId(''); setQuantities({}); setReason(''); setNote(''); };
  const createReturn = useCreateErpPurchaseReturn({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: '已建立採購退回單', description: '退回單目前為草稿' }); reset(); },
      onError: (err) => toast({ title: '建立失敗', description: errorMessage(err), variant: 'destructive' }),
    },
  });
  const updateStatus = useUpdateErpPurchaseReturnStatus({
    mutation: {
      onSuccess: (updated) => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: getListErpItemsQueryKey() });
        setDetail(updated);
        toast({ title: updated.status === 'confirmed' ? '退回已確認' : '退回單已取消', description: updated.status === 'confirmed' ? '庫存已依退回數量扣減' : undefined });
      },
      onError: (err) => toast({ title: '更新失敗', description: errorMessage(err), variant: 'destructive' }),
    },
  });
  const submit = () => {
    if (!selectedOrder) { toast({ title: '請選擇已收貨採購單', variant: 'destructive' }); return; }
    const items = selectedOrder.items.flatMap((item) => {
      const quantity = Number(quantities[item.id] || 0);
      return quantity > 0 ? [{ purchaseOrderItemId: item.id, quantity }] : [];
    });
    if (!items.length) { toast({ title: '請輸入至少一項退回數量', variant: 'destructive' }); return; }
    if (items.some((row) => !Number.isInteger(row.quantity) || row.quantity > (selectedOrder.items.find((item) => item.id === row.purchaseOrderItemId)?.quantity ?? 0))) {
      toast({ title: '退回數量不正確', description: '數量須為正整數且不可超過原採購數量', variant: 'destructive' }); return;
    }
    createReturn.mutate({ data: { purchaseOrderId: selectedOrder.id, reason: reason.trim() || null, note: note.trim() || null, items } });
    return;
  };
  const openCreate = () => { reset(); setCreateOpen(true); };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-xl font-bold">採購退回</h2><p className="text-sm text-muted-foreground">依已收貨採購單建立退回，確認後扣減庫存</p></div>
        <div className="flex gap-2"><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-36 bg-card"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部狀態</SelectItem>{Object.entries(statusLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Button onClick={openCreate}><Plus className="mr-1 h-4 w-4" />建立退回單</Button></div>
      </div>
      <Card className="overflow-hidden border-t-2 border-t-primary shadow-sm">
        <Table>
          <TableHeader className="bg-secondary/50"><TableRow><TableHead>退回單號</TableHead><TableHead>原採購單</TableHead><TableHead>供應商</TableHead><TableHead>品項數</TableHead><TableHead className="text-right">金額</TableHead><TableHead>狀態</TableHead><TableHead>建立時間</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={8} className="h-32 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></TableCell></TableRow>
              : !returns?.length ? <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">尚無採購退回單</TableCell></TableRow>
              : returns.map((row) => <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.prNo}</TableCell><TableCell className="font-mono text-xs">{row.purchaseOrderNo || '—'}</TableCell><TableCell>{row.supplierName}</TableCell><TableCell>{row.items.length}</TableCell>
                <TableCell className="text-right font-medium">NT$ {row.totalAmount.toLocaleString()}</TableCell><TableCell><Badge variant="outline" className={statusClass[row.status]}>{statusLabel[row.status] ?? row.status}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{new Date(row.createdAt).toLocaleString('zh-TW')}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setDetail(row)}><Eye className="mr-1 h-4 w-4" />詳情</Button></TableCell>
              </TableRow>)}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => !open && reset()}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>建立採購退回單</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>已收貨採購單 *</Label><Select value={purchaseOrderId} onValueChange={(value) => { setPurchaseOrderId(value); setQuantities({}); }}><SelectTrigger><SelectValue placeholder="選擇採購單" /></SelectTrigger><SelectContent>{(receivedOrders ?? []).map((order) => <SelectItem key={order.id} value={String(order.id)}>{order.poNo}｜{order.supplierName}｜NT$ {order.totalAmount.toLocaleString()}</SelectItem>)}</SelectContent></Select></div>
            {selectedOrder && <div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>品項</TableHead><TableHead>規格</TableHead><TableHead className="text-right">原數量</TableHead><TableHead className="w-36 text-right">退回數量</TableHead></TableRow></TableHeader><TableBody>{selectedOrder.items.map((item) => <TableRow key={item.id}><TableCell><div className="font-medium">{item.productName}</div><div className="text-xs text-muted-foreground">{item.productCode}</div></TableCell><TableCell>{item.variantName || '—'}</TableCell><TableCell className="text-right">{item.quantity}</TableCell><TableCell><Input className="text-right" type="number" min={0} max={item.quantity} step={1} value={quantities[item.id] ?? ''} onChange={(e) => setQuantities((current) => ({ ...current, [item.id]: e.target.value }))} /></TableCell></TableRow>)}</TableBody></Table></div>}
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>退回原因</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：瑕疵、規格錯誤" /></div><div className="space-y-2"><Label>備註</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></div></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={reset}>取消</Button><Button onClick={submit} disabled={createReturn.isPending}>{createReturn.isPending ? '建立中…' : '建立草稿'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2">退回單 {detail?.prNo}{detail && <Badge variant="outline" className={statusClass[detail.status]}>{statusLabel[detail.status] ?? detail.status}</Badge>}</DialogTitle></DialogHeader>
          {detail && <div className="space-y-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2"><p><span className="text-muted-foreground">供應商：</span>{detail.supplierName}</p><p><span className="text-muted-foreground">原採購單：</span>{detail.purchaseOrderNo || '—'}</p>{detail.reason && <p><span className="text-muted-foreground">原因：</span>{detail.reason}</p>}{detail.note && <p><span className="text-muted-foreground">備註：</span>{detail.note}</p>}</div>
            <div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>品項</TableHead><TableHead>規格</TableHead><TableHead className="text-right">成本</TableHead><TableHead className="text-right">退回數量</TableHead><TableHead className="text-right">小計</TableHead></TableRow></TableHeader><TableBody>{detail.items.map((item) => <TableRow key={item.id}><TableCell><div className="font-medium">{item.productName}</div><div className="text-xs text-muted-foreground">{item.productCode}</div></TableCell><TableCell>{item.variantName || '—'}</TableCell><TableCell className="text-right">NT$ {item.unitCost.toLocaleString()}</TableCell><TableCell className="text-right">{item.quantity}</TableCell><TableCell className="text-right">NT$ {(item.unitCost * item.quantity).toLocaleString()}</TableCell></TableRow>)}</TableBody></Table></div>
            <p className="text-right font-bold">合計：NT$ {detail.totalAmount.toLocaleString()}</p>
          </div>}
          <DialogFooter>{detail?.status === 'draft' && <Button variant="outline" className="text-destructive" disabled={updateStatus.isPending} onClick={() => updateStatus.mutate({ id: detail.id, data: { status: 'cancelled' } })}><XCircle className="mr-1 h-4 w-4" />取消</Button>}{detail?.status === 'draft' && <Button disabled={updateStatus.isPending} onClick={() => updateStatus.mutate({ id: detail.id, data: { status: 'confirmed' } })}><CheckCircle2 className="mr-1 h-4 w-4" />確認退回並扣減庫存</Button>}{detail?.status === 'confirmed' && <span className="flex items-center text-sm text-muted-foreground"><RotateCcw className="mr-1 h-4 w-4" />已完成出庫扣減</span>}</DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}