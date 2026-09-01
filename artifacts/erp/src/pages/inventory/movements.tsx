import { useState } from 'react';
import { useListErpItems, useListErpStockMovements, useListErpWarehouses } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const types: Record<string, string> = { purchase: '進貨', sale: '銷貨', adjust: '調整', transfer: '調撥', sale_return: '銷退', purchase_return: '採退' };

export default function MovementsPage() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('all');
  const [productId, setProductId] = useState('all');
  const { data: products } = useListErpItems({ includeInactive: 'true' });
  const { data: warehouses } = useListErpWarehouses();
  const { data, isLoading } = useListErpStockMovements({ page, type: type === 'all' ? undefined : type, productId: productId === 'all' ? undefined : Number(productId) });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><h2 className="text-xl font-bold">庫存異動</h2><div className="flex gap-2">
      <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部類型</SelectItem>{Object.entries(types).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select>
      <Select value={productId} onValueChange={(v) => { setProductId(v); setPage(1); }}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部品項</SelectItem>{products?.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code} {p.name}</SelectItem>)}</SelectContent></Select>
    </div></div>
    <Card className="overflow-x-auto border-t-2 border-t-primary shadow-sm"><Table><TableHeader className="bg-secondary/50"><TableRow>{['時間', '品項', '倉庫', '類型', '數量', '異動後庫存', '單號', '原因'].map((h) => <TableHead key={h} className="font-semibold">{h}</TableHead>)}</TableRow></TableHeader><TableBody>
      {isLoading ? <TableRow><TableCell colSpan={8} className="h-32"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></TableCell></TableRow> : !data?.items.length ? <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">查無庫存異動</TableCell></TableRow> : data.items.map((m) => <TableRow key={m.id}>
        <TableCell className="whitespace-nowrap font-mono text-sm">{format(new Date(m.createdAt), 'yyyy-MM-dd HH:mm:ss')}</TableCell><TableCell><div className="font-medium">{m.productName || `品項 #${m.productId}`}</div><div className="text-xs text-muted-foreground">{m.productCode}{m.variantId ? `／規格 #${m.variantId}` : ''}</div></TableCell><TableCell>{m.warehouseId ? warehouses?.find((w) => w.id === m.warehouseId)?.name || `#${m.warehouseId}` : '-'}</TableCell><TableCell><Badge variant="secondary">{types[m.type || ''] || m.type || '其他'}</Badge></TableCell><TableCell className={`font-bold ${m.quantity > 0 ? 'text-emerald-600' : m.quantity < 0 ? 'text-destructive' : ''}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</TableCell><TableCell>{m.stockAfter}</TableCell><TableCell className="font-mono">{m.refNo || '—'}</TableCell><TableCell>{m.reason || '—'}</TableCell>
      </TableRow>)}
    </TableBody></Table>{data && data.total > 0 && <div className="flex items-center justify-between border-t px-4 py-3"><span className="text-sm text-muted-foreground">顯示 {(page - 1) * data.pageSize + 1} 至 {Math.min(page * data.pageSize, data.total)} 筆，共 {data.total} 筆</span><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" />上一頁</Button><span className="text-sm">{page} / {totalPages}</span><Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一頁<ChevronRight className="h-4 w-4" /></Button></div></div>}</Card>
  </div>;
}