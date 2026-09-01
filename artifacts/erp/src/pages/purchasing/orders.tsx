import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetErpPurchaseOrderQueryKey,
  getListErpPurchaseOrdersQueryKey,
  useCreateErpPurchaseOrder,
  useGetErpPurchaseOrder,
  useListErpItems,
  useListErpPurchaseOrders,
  useListErpSuppliers,
  useListErpWarehouses,
  useUpdateErpPurchaseOrderStatus,
  type AdminPurchaseOrder,
} from '@workspace/api-client-react';
import { Eye, Loader2, Plus, Send, Trash2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

const statusLabel: Record<string, string> = {
  draft: '草稿',
  ordered: '已下單',
  received: '已收貨',
  cancelled: '已取消',
};
const statusClass: Record<string, string> = {
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  ordered: 'border-blue-200 bg-blue-50 text-blue-700',
  received: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  cancelled: 'border-red-200 bg-red-50 text-red-700',
};
type Line = { productId: string; variantId: string; unitCost: string; quantity: string };
const emptyLine = (): Line => ({ productId: '', variantId: '', unitCost: '', quantity: '' });
const errorMessage = (err: any) => err?.response?.data?.error ?? err?.data?.error ?? err?.message ?? '請稍後再試';

function OrderItems({ order }: { order: AdminPurchaseOrder }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>品項</TableHead><TableHead>規格</TableHead>
            <TableHead className="text-right">進價</TableHead><TableHead className="text-right">數量</TableHead>
            <TableHead className="text-right">小計</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {order.items.map((item) => (
            <TableRow key={item.id}>
              <TableCell><div className="font-medium">{item.productName}</div><div className="text-xs text-muted-foreground">{item.productCode}</div></TableCell>
              <TableCell>{item.variantName || '—'}</TableCell>
              <TableCell className="text-right">NT$ {item.unitCost.toLocaleString()}</TableCell>
              <TableCell className="text-right">{item.quantity}</TableCell>
              <TableCell className="text-right font-medium">NT$ {(item.unitCost * item.quantity).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function PurchaseOrdersPage() {
  const [status, setStatus] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('default');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const params = status === 'all' ? {} : { status };
  const { data: orders, isLoading } = useListErpPurchaseOrders(params);
  const { data: suppliers } = useListErpSuppliers({});
  const { data: items } = useListErpItems({});
  const { data: warehouses } = useListErpWarehouses();
  const { data: detail, isLoading: detailLoading } = useGetErpPurchaseOrder(selectedId ?? 0, {
    query: { enabled: selectedId !== null, queryKey: getGetErpPurchaseOrderQueryKey(selectedId ?? 0) },
  });
  const physicalItems = useMemo(() => (items ?? []).filter((item) => !item.isVirtual && item.isActive), [items]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListErpPurchaseOrdersQueryKey() });
  const resetCreate = () => {
    setCreateOpen(false); setSupplierId(''); setWarehouseId('default'); setNote(''); setLines([emptyLine()]);
  };
  const createOrder = useCreateErpPurchaseOrder({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: '已建立採購單', description: '採購單目前為草稿' }); resetCreate(); },
      onError: (err) => toast({ title: '建立失敗', description: errorMessage(err), variant: 'destructive' }),
    },
  });
  const updateStatus = useUpdateErpPurchaseOrderStatus({
    mutation: {
      onSuccess: (order) => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: getGetErpPurchaseOrderQueryKey(order.id) });
        toast({ title: order.status === 'ordered' ? '已確認下單' : '已取消採購單' });
      },
      onError: (err) => toast({ title: '更新失敗', description: errorMessage(err), variant: 'destructive' }),
    },
  });
  const total = lines.reduce((sum, line) => sum + (Number(line.unitCost) || 0) * (Number(line.quantity) || 0), 0);
  const submit = () => {
    if (!supplierId) { toast({ title: '請選擇供應商', variant: 'destructive' }); return; }
    const chosen = lines.filter((line) => line.productId);
    if (!chosen.length) { toast({ title: '請至少新增一個品項', variant: 'destructive' }); return; }
    for (const line of chosen) {
      const item = physicalItems.find((row) => row.id === Number(line.productId));
      if (!item || !Number.isInteger(Number(line.unitCost)) || Number(line.unitCost) < 0 || !Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1) {
        toast({ title: '請確認採購明細', description: '進價須為非負整數，數量須為正整數', variant: 'destructive' }); return;
      }
      if (item.variants.length && !line.variantId) { toast({ title: `請選擇「${item.name}」的規格`, variant: 'destructive' }); return; }
    }
    createOrder.mutate({
      data: {
        supplierId: Number(supplierId), warehouseId: warehouseId === 'default' ? null : Number(warehouseId), note: note.trim() || null,
        items: chosen.map((line) => ({ productId: Number(line.productId), variantId: line.variantId ? Number(line.variantId) : null, unitCost: Number(line.unitCost), quantity: Number(line.quantity) })),
      },
    });
  };
  const changeLine = (index: number, patch: Partial<Line>) => setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-xl font-bold">採購單</h2><p className="text-sm text-muted-foreground">建立採購需求並追蹤下單狀態</p></div>
        <div className="flex gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36 bg-card"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">全部狀態</SelectItem>{Object.entries(statusLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" />建立採購單</Button>
        </div>
      </div>
      <Card className="overflow-hidden border-t-2 border-t-primary shadow-sm">
        <Table>
          <TableHeader className="bg-secondary/50"><TableRow><TableHead>單號</TableHead><TableHead>供應商</TableHead><TableHead>品項數</TableHead><TableHead className="text-right">金額</TableHead><TableHead>狀態</TableHead><TableHead>建立時間</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={7} className="h-32 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></TableCell></TableRow>
              : !orders?.length ? <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">尚無採購單</TableCell></TableRow>
              : orders.map((order) => <TableRow key={order.id}>
                <TableCell className="font-mono text-xs">{order.poNo}</TableCell><TableCell>{order.supplierName}</TableCell><TableCell>{order.items.length}</TableCell>
                <TableCell className="text-right font-medium">NT$ {order.totalAmount.toLocaleString()}</TableCell>
                <TableCell><Badge variant="outline" className={statusClass[order.status]}>{statusLabel[order.status]}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{new Date(order.createdAt).toLocaleString('zh-TW')}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setSelectedId(order.id)}><Eye className="mr-1 h-4 w-4" />詳情</Button></TableCell>
              </TableRow>)}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => !open && resetCreate()}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>建立採購單</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2"><Label>供應商 *</Label><Select value={supplierId} onValueChange={setSupplierId}><SelectTrigger><SelectValue placeholder="選擇供應商" /></SelectTrigger><SelectContent>{(suppliers ?? []).filter((row) => row.isActive).map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>收貨倉</Label><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">預設倉</SelectItem>{warehouses?.filter((w) => w.isActive).map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>備註</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
            </div>
            <div className="space-y-3">
              <Label>採購明細 *</Label>
              {lines.map((line, index) => {
                const item = physicalItems.find((row) => row.id === Number(line.productId));
                return <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[2fr_1.5fr_1fr_1fr_auto]">
                  <Select value={line.productId} onValueChange={(value) => changeLine(index, { productId: value, variantId: '' })}><SelectTrigger><SelectValue placeholder="選擇品項" /></SelectTrigger><SelectContent>{physicalItems.map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.code} {row.name}</SelectItem>)}</SelectContent></Select>
                  <Select value={line.variantId} onValueChange={(value) => changeLine(index, { variantId: value })} disabled={!item?.variants.length}><SelectTrigger><SelectValue placeholder={item?.variants.length ? '選擇規格 *' : '無規格'} /></SelectTrigger><SelectContent>{item?.variants.filter((row) => row.isActive).map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}</SelectContent></Select>
                  <Input type="number" min={0} step={1} placeholder="進價" value={line.unitCost} onChange={(e) => changeLine(index, { unitCost: e.target.value })} />
                  <Input type="number" min={1} step={1} placeholder="數量" value={line.quantity} onChange={(e) => changeLine(index, { quantity: e.target.value })} />
                  <Button size="icon" variant="ghost" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
                </div>;
              })}
              <Button size="sm" variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}><Plus className="mr-1 h-4 w-4" />新增品項</Button>
            </div>
            <p className="text-right font-semibold">合計：NT$ {total.toLocaleString()}</p>
          </div>
          <DialogFooter><Button variant="outline" onClick={resetCreate}>取消</Button><Button onClick={submit} disabled={createOrder.isPending}>{createOrder.isPending ? '建立中…' : '建立草稿'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2">採購單 {detail?.poNo}{detail && <Badge variant="outline" className={statusClass[detail.status]}>{statusLabel[detail.status]}</Badge>}</DialogTitle></DialogHeader>
          {detailLoading ? <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin" /> : detail && <div className="space-y-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2"><p><span className="text-muted-foreground">供應商：</span>{detail.supplierName}</p><p><span className="text-muted-foreground">建立時間：</span>{new Date(detail.createdAt).toLocaleString('zh-TW')}</p>{detail.note && <p className="sm:col-span-2"><span className="text-muted-foreground">備註：</span>{detail.note}</p>}</div>
            <OrderItems order={detail} /><p className="text-right font-bold">合計：NT$ {detail.totalAmount.toLocaleString()}</p>
          </div>}
          <DialogFooter>
            {detail?.status === 'draft' && <Button variant="outline" className="text-destructive" disabled={updateStatus.isPending} onClick={() => updateStatus.mutate({ id: detail.id, data: { status: 'cancelled' } })}><XCircle className="mr-1 h-4 w-4" />取消</Button>}
            {detail?.status === 'draft' && <Button disabled={updateStatus.isPending} onClick={() => updateStatus.mutate({ id: detail.id, data: { status: 'ordered' } })}><Send className="mr-1 h-4 w-4" />下單</Button>}
            {detail?.status === 'ordered' && <Button variant="destructive" disabled={updateStatus.isPending} onClick={() => updateStatus.mutate({ id: detail.id, data: { status: 'cancelled' } })}><XCircle className="mr-1 h-4 w-4" />取消採購單</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}