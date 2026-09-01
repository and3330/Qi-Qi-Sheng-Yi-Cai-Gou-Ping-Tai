import { useEffect, useState } from 'react';
import {
  getListErpItemsQueryKey,
  getListErpStockMovementsQueryKey,
  getListErpWarehousesQueryKey,
  getListErpWarehouseStockQueryKey,
  useErpAdjustStock,
  useListErpItems,
  useListErpWarehouses,
  useListErpWarehouseStock,
  useUpdateErpItem,
  type ErpItem,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Package, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

const money = (value: number) => new Intl.NumberFormat('zh-TW').format(value);
const errorMessage = (err: any) => err?.response?.data?.error || err?.message || '請稍後再試';

export default function ItemsPage() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<ErpItem | null>(null);
  const [adjusting, setAdjusting] = useState<ErpItem | null>(null);
  const [breakdown, setBreakdown] = useState<ErpItem | null>(null);
  const { data: items, isLoading } = useListErpItems({ search, includeInactive: String(includeInactive) });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="flex items-center gap-2 text-xl font-bold"><Package className="h-5 w-5 text-primary" />品項清單</h2>
        <div className="flex flex-wrap items-center gap-4">
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="w-64 pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋編號或名稱..." />
            </div>
            <Button type="submit" variant="secondary">搜尋</Button>
          </form>
          <div className="flex items-center gap-2"><Switch id="inactive" checked={includeInactive} onCheckedChange={setIncludeInactive} /><Label htmlFor="inactive">顯示停用</Label></div>
        </div>
      </div>
      <Card className="overflow-x-auto border-t-2 border-t-primary shadow-sm">
        <Table>
          <TableHeader className="bg-secondary/50"><TableRow>
            {['編號', '名稱', '分類', '單位', '庫存／規格', '安全庫存', '成本', '售價', '虛擬', '狀態', '操作'].map((h) => <TableHead key={h} className="whitespace-nowrap font-semibold">{h}</TableHead>)}
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={11} className="h-32"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></TableCell></TableRow>
              : !items?.length ? <TableRow><TableCell colSpan={11} className="h-32 text-center text-muted-foreground">查無品項</TableCell></TableRow>
              : items.map((item) => {
                const low = !item.isVirtual && item.stock < item.safetyStock;
                return <TableRow key={item.id} className={low ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/30'}>
                  <TableCell className="font-mono">{item.code}</TableCell>
                  <TableCell className="font-medium">{item.name}{item.spec && <div className="text-xs text-muted-foreground">{item.spec}</div>}</TableCell>
                  <TableCell>{item.category}</TableCell><TableCell>{item.unit || '—'}</TableCell>
                  <TableCell>
                    <div className={low ? 'font-bold text-destructive' : 'font-medium'}>{item.isVirtual ? '不管理' : item.stock}{low && <AlertTriangle className="ml-1 inline h-4 w-4" />}</div>
                    {item.variants.map((v) => <div key={v.id} className="mt-1 text-xs text-muted-foreground">{v.name}：<span className={v.stock < item.safetyStock ? 'text-destructive' : ''}>{v.stock}</span>{!v.isActive && '（停用）'}</div>)}
                  </TableCell>
                  <TableCell>{item.safetyStock}</TableCell><TableCell>NT$ {money(item.costPrice)}</TableCell><TableCell>NT$ {money(item.priceConsumer)}</TableCell>
                  <TableCell>{item.isVirtual ? <Badge variant="secondary">虛擬</Badge> : '否'}</TableCell>
                  <TableCell><Badge variant={item.isActive ? 'default' : 'secondary'}>{item.isActive ? '啟用' : '停用'}</Badge></TableCell>
                  <TableCell><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditing(item)}>編輯</Button><Button size="sm" variant="outline" disabled={item.isVirtual} title={item.isVirtual ? '虛擬品項不動庫存' : undefined} onClick={() => setAdjusting(item)}>{item.isVirtual ? '虛擬品項不動庫存' : '庫存調整'}</Button><Button size="sm" variant="outline" disabled={item.isVirtual} onClick={() => setBreakdown(item)}>分倉</Button></div></TableCell>
                </TableRow>;
              })}
          </TableBody>
        </Table>
      </Card>
      <EditDialog item={editing} onClose={() => setEditing(null)} />
      <AdjustDialog item={adjusting} onClose={() => setAdjusting(null)} />
      <WarehouseStockDialog item={breakdown} onClose={() => setBreakdown(null)} />
    </div>
  );
}

function EditDialog({ item, onClose }: { item: ErpItem | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [unit, setUnit] = useState('');
  const [barcode, setBarcode] = useState('');
  const [safetyStock, setSafetyStock] = useState('0');
  const [isVirtual, setIsVirtual] = useState(false);
  useEffect(() => {
    if (item) {
      setUnit(item.unit || '');
      setBarcode(item.barcode || '');
      setSafetyStock(String(item.safetyStock));
      setIsVirtual(item.isVirtual);
    }
  }, [item]);
  const mutation = useUpdateErpItem({ mutation: {
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListErpItemsQueryKey() }); toast({ title: '更新成功', description: '品項 ERP 欄位已儲存' }); onClose(); },
    onError: (err) => toast({ title: '更新失敗', description: errorMessage(err), variant: 'destructive' }),
  } });
  const open = !!item;
  return <Dialog open={open} onOpenChange={(openNow) => !openNow && onClose()}><DialogContent>
    <DialogHeader><DialogTitle>編輯 ERP 欄位－{item?.name}</DialogTitle></DialogHeader>
    <div className="grid gap-4 py-2">
      <div className="flex items-center justify-between"><Label htmlFor="virtual">虛擬品項</Label><Switch id="virtual" checked={isVirtual} onCheckedChange={setIsVirtual} /></div>
      <div className="space-y-2"><Label>單位</Label><Input value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
      <div className="space-y-2"><Label>條碼</Label><Input value={barcode} onChange={(e) => setBarcode(e.target.value)} /></div>
      <div className="space-y-2"><Label>安全庫存</Label><Input type="number" min="0" step="1" value={safetyStock} onChange={(e) => setSafetyStock(e.target.value)} /></div>
    </div>
    <DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={mutation.isPending || !item} onClick={() => item && mutation.mutate({ id: item.id, data: { unit: unit || null, barcode: barcode || null, safetyStock: Number(safetyStock), isVirtual } })}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}儲存</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function AdjustDialog({ item, onClose }: { item: ErpItem | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activeVariants = item?.variants.filter((v) => v.isActive) || [];
  const [variantId, setVariantId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('盤點');
  const [note, setNote] = useState('');
  const { data: warehouses } = useListErpWarehouses({ query: { queryKey: getListErpWarehousesQueryKey(), enabled: !!item } });
  useEffect(() => { setVariantId(''); setQuantity(''); setReason('盤點'); setNote(''); setWarehouseId(''); }, [item]);
  useEffect(() => {
    if (item && !warehouseId && warehouses?.length) setWarehouseId(String(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0].id));
  }, [item, warehouseId, warehouses]);
  const mutation = useErpAdjustStock({ mutation: {
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListErpItemsQueryKey() }); queryClient.invalidateQueries({ queryKey: getListErpStockMovementsQueryKey() }); toast({ title: '調整成功', description: '庫存已更新' }); onClose(); },
    onError: (err) => toast({ title: '調整失敗', description: errorMessage(err), variant: 'destructive' }),
  } });
  const valid = !!item && !!warehouseId && Number.isInteger(Number(quantity)) && Number(quantity) !== 0 && (!activeVariants.length || !!variantId);
  return <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>庫存調整－{item?.name}</DialogTitle></DialogHeader>
    <div className="grid gap-4 py-2">
      <div className="space-y-2"><Label>倉庫</Label><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue placeholder="選擇倉庫" /></SelectTrigger><SelectContent>{warehouses?.filter((w) => w.isActive).map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.name}{w.isDefault ? '（預設）' : ''}</SelectItem>)}</SelectContent></Select></div>
      {activeVariants.length > 0 && <div className="space-y-2"><Label>規格（必填）</Label><Select value={variantId} onValueChange={setVariantId}><SelectTrigger><SelectValue placeholder="選擇規格" /></SelectTrigger><SelectContent>{activeVariants.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}（目前 {v.stock}）</SelectItem>)}</SelectContent></Select></div>}
      <div className="space-y-2"><Label>調整數量（正數增加、負數減少）</Label><Input type="number" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="例如：10 或 -3" /></div>
      <div className="space-y-2"><Label>原因</Label><Select value={reason} onValueChange={setReason}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['盤點', '報廢', '其他'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label>備註</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></div>
    </div>
    <DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={!valid || mutation.isPending} onClick={() => item && mutation.mutate({ data: { productId: item.id, variantId: variantId ? Number(variantId) : null, warehouseId: Number(warehouseId), quantity: Number(quantity), reason, note: note || null } })}>確認調整</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function WarehouseStockDialog({ item, onClose }: { item: ErpItem | null; onClose: () => void }) {
  const { data, isLoading } = useListErpWarehouseStock(
    { productId: item?.id },
    { query: { queryKey: getListErpWarehouseStockQueryKey({ productId: item?.id }), enabled: !!item } },
  );
  return <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}><DialogContent className="max-w-2xl">
    <DialogHeader><DialogTitle>分倉庫存－{item?.name}</DialogTitle></DialogHeader>
    <Table><TableHeader><TableRow><TableHead>倉庫</TableHead><TableHead>規格</TableHead><TableHead className="text-right">數量</TableHead></TableRow></TableHeader><TableBody>
      {isLoading ? <TableRow><TableCell colSpan={3} className="h-24"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
        : !data?.length ? <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">尚無分倉庫存</TableCell></TableRow>
        : data.map((row) => <TableRow key={row.id}><TableCell>{row.warehouseCode}－{row.warehouseName}</TableCell><TableCell>{row.variantName || '—'}</TableCell><TableCell className="text-right font-medium">{row.quantity}</TableCell></TableRow>)}
    </TableBody></Table>
    <DialogFooter><Button variant="outline" onClick={onClose}>關閉</Button></DialogFooter>
  </DialogContent></Dialog>;
}