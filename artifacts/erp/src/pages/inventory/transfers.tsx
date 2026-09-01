import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListErpItemsQueryKey,
  getListErpStockMovementsQueryKey,
  getListErpStockTransfersQueryKey,
  getListErpWarehouseStockQueryKey,
  getListErpWarehousesQueryKey,
  useCreateErpStockTransfer,
  useListErpItems,
  useListErpStockTransfers,
  useListErpWarehouses,
  useUpdateErpStockTransferStatus,
  type ErpStockTransferStatusUpdateStatus,
} from '@workspace/api-client-react';
import { CheckCircle2, Loader2, Plus, Trash2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

const statusLabels: Record<string, string> = { draft: '草稿', confirmed: '已確認', cancelled: '已取消' };
const statusClasses: Record<string, string> = {
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  confirmed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  cancelled: 'border-red-200 bg-red-50 text-red-700',
};
const errorMessage = (err: any) => err?.response?.data?.error || err?.data?.error || err?.message || '請稍後再試';
type Line = { productId: string; variantId: string; quantity: string };
const emptyLine = (): Line => ({ productId: '', variantId: '', quantity: '1' });

export default function TransfersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const { data: transfers, isLoading } = useListErpStockTransfers(
    { status: status === 'all' ? undefined : status },
    { query: { queryKey: getListErpStockTransfersQueryKey({ status: status === 'all' ? undefined : status }) } },
  );
  const { data: warehouses } = useListErpWarehouses({ query: { queryKey: getListErpWarehousesQueryKey() } });
  const { data: products } = useListErpItems({}, { query: { queryKey: getListErpItemsQueryKey({}) } });
  const activeWarehouses = warehouses?.filter((warehouse) => warehouse.isActive) ?? [];
  const physicalItems = products?.filter((product) => product.isActive && !product.isVirtual) ?? [];
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListErpStockTransfersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListErpWarehouseStockQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListErpStockMovementsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListErpItemsQueryKey() });
  };
  const reset = () => {
    setCreateOpen(false);
    setFromWarehouseId('');
    setToWarehouseId('');
    setNote('');
    setLines([emptyLine()]);
  };
  const create = useCreateErpStockTransfer({ mutation: {
    onSuccess: () => { invalidate(); toast({ title: '已建立庫存調撥單', description: '調撥單目前為草稿' }); reset(); },
    onError: (err) => toast({ title: '建立失敗', description: errorMessage(err), variant: 'destructive' }),
  } });
  const update = useUpdateErpStockTransferStatus({ mutation: {
    onSuccess: (result) => { invalidate(); toast({ title: result.status === 'confirmed' ? '調撥已確認' : '調撥單已取消' }); },
    onError: (err) => toast({ title: '更新失敗', description: errorMessage(err), variant: 'destructive' }),
  } });
  const changeLine = (index: number, patch: Partial<Line>) => setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  const submit = () => {
    if (!fromWarehouseId || !toWarehouseId) {
      toast({ title: '請選擇來源倉與目的倉', variant: 'destructive' });
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      toast({ title: '來源倉與目的倉不可相同', variant: 'destructive' });
      return;
    }
    const selected = lines.filter((line) => line.productId);
    const invalidVariant = selected.some((line) => {
      const product = physicalItems.find((item) => item.id === Number(line.productId));
      return !!product?.variants.length && !line.variantId;
    });
    if (!selected.length || selected.some((line) => !Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1) || invalidVariant) {
      toast({ title: '請完整填寫調撥明細', description: invalidVariant ? '有規格的品項必須選擇規格' : '數量須為正整數', variant: 'destructive' });
      return;
    }
    create.mutate({ data: {
      fromWarehouseId: Number(fromWarehouseId),
      toWarehouseId: Number(toWarehouseId),
      note: note.trim() || null,
      items: selected.map((line) => ({ productId: Number(line.productId), variantId: line.variantId ? Number(line.variantId) : null, quantity: Number(line.quantity) })),
    } });
  };
  const changeStatus = (id: number, next: ErpStockTransferStatusUpdateStatus) => {
    const prompt = next === 'confirmed' ? '確定要確認此調撥單並移轉庫存？' : '確定要取消此調撥單？';
    if (window.confirm(prompt)) update.mutate({ id, data: { status: next } });
  };

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="text-xl font-bold">庫存調撥</h2><p className="text-sm text-muted-foreground">建立倉庫間的庫存移轉單據</p></div>
      <div className="flex gap-2"><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-36 bg-card"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部狀態</SelectItem>{Object.entries(statusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Button onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" />建立調撥單</Button></div>
    </div>
    <Card className="overflow-x-auto border-t-2 border-t-primary shadow-sm"><Table>
      <TableHeader className="bg-secondary/50"><TableRow><TableHead>單號</TableHead><TableHead>來源倉</TableHead><TableHead>目的倉</TableHead><TableHead>品項</TableHead><TableHead>狀態</TableHead><TableHead>建立時間</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
      <TableBody>
        {isLoading ? <TableRow><TableCell colSpan={7} className="h-32"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></TableCell></TableRow>
          : !transfers?.length ? <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">尚無庫存調撥單</TableCell></TableRow>
          : transfers.map((transfer) => <TableRow key={transfer.id}>
            <TableCell className="font-mono">{transfer.stNo}</TableCell><TableCell>{transfer.fromWarehouseName}</TableCell><TableCell>{transfer.toWarehouseName}</TableCell>
            <TableCell><div>{transfer.items.length} 項</div><div className="max-w-xs truncate text-xs text-muted-foreground">{transfer.items.map((item) => `${item.productName}${item.variantName ? `／${item.variantName}` : ''} × ${item.quantity}`).join('、')}</div></TableCell>
            <TableCell><Badge variant="outline" className={statusClasses[transfer.status]}>{statusLabels[transfer.status] || transfer.status}</Badge></TableCell>
            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{new Date(transfer.createdAt).toLocaleString('zh-TW')}</TableCell>
            <TableCell className="text-right">{transfer.status === 'draft' && <div className="flex justify-end gap-2"><Button size="sm" disabled={update.isPending} onClick={() => changeStatus(transfer.id, 'confirmed')}><CheckCircle2 className="mr-1 h-4 w-4" />確認</Button><Button size="sm" variant="outline" className="text-destructive" disabled={update.isPending} onClick={() => changeStatus(transfer.id, 'cancelled')}><XCircle className="mr-1 h-4 w-4" />取消</Button></div>}</TableCell>
          </TableRow>)}
      </TableBody>
    </Table></Card>

    <Dialog open={createOpen} onOpenChange={(open) => !open && reset()}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
      <DialogHeader><DialogTitle>建立庫存調撥單</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label>來源倉 *</Label><Select value={fromWarehouseId} onValueChange={setFromWarehouseId}><SelectTrigger><SelectValue placeholder="選擇來源倉" /></SelectTrigger><SelectContent>{activeWarehouses.map((warehouse) => <SelectItem key={warehouse.id} value={String(warehouse.id)} disabled={String(warehouse.id) === toWarehouseId}>{warehouse.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>目的倉 *</Label><Select value={toWarehouseId} onValueChange={setToWarehouseId}><SelectTrigger><SelectValue placeholder="選擇目的倉" /></SelectTrigger><SelectContent>{activeWarehouses.map((warehouse) => <SelectItem key={warehouse.id} value={String(warehouse.id)} disabled={String(warehouse.id) === fromWarehouseId}>{warehouse.name}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div className="space-y-3"><Label>調撥明細 *</Label>
          {lines.map((line, index) => {
            const product = physicalItems.find((item) => item.id === Number(line.productId));
            return <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[2fr_1.5fr_1fr_auto]">
              <Select value={line.productId} onValueChange={(value) => changeLine(index, { productId: value, variantId: '' })}><SelectTrigger><SelectValue placeholder="選擇品項" /></SelectTrigger><SelectContent>{physicalItems.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.code}－{item.name}</SelectItem>)}</SelectContent></Select>
              <Select value={line.variantId} onValueChange={(value) => changeLine(index, { variantId: value })} disabled={!product?.variants.length}><SelectTrigger><SelectValue placeholder={product?.variants.length ? '選擇規格 *' : '無規格'} /></SelectTrigger><SelectContent>{product?.variants.filter((variant) => variant.isActive).map((variant) => <SelectItem key={variant.id} value={String(variant.id)}>{variant.name}</SelectItem>)}</SelectContent></Select>
              <Input type="number" min={1} step={1} placeholder="數量" value={line.quantity} onChange={(event) => changeLine(index, { quantity: event.target.value })} />
              <Button size="icon" variant="ghost" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
            </div>;
          })}
          <Button size="sm" variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}><Plus className="mr-1 h-4 w-4" />新增品項</Button>
        </div>
        <div className="space-y-2"><Label>備註</Label><Textarea value={note} onChange={(event) => setNote(event.target.value)} /></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={reset}>取消</Button><Button disabled={create.isPending} onClick={submit}>{create.isPending ? '建立中…' : '建立草稿'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}