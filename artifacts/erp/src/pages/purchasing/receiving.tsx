import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetErpPurchaseOrderQueryKey,
  getListErpItemsQueryKey,
  getListErpPurchaseOrdersQueryKey,
  useGetErpPurchaseOrder,
  useListErpPurchaseOrders,
  useReceiveErpPurchaseOrder,
} from '@workspace/api-client-react';
import { Eye, Loader2, PackageCheck } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

const errorMessage = (err: any) => err?.response?.data?.error ?? err?.data?.error ?? err?.message ?? '請稍後再試';

export default function PurchaseReceivingPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: ordered, isLoading } = useListErpPurchaseOrders({ status: 'ordered' });
  const { data: received, isLoading: receivedLoading } = useListErpPurchaseOrders({ status: 'received' });
  const { data: detail, isLoading: detailLoading } = useGetErpPurchaseOrder(selectedId ?? 0, {
    query: { enabled: selectedId !== null, queryKey: getGetErpPurchaseOrderQueryKey(selectedId ?? 0) },
  });
  const receive = useReceiveErpPurchaseOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListErpPurchaseOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListErpItemsQueryKey() });
        toast({ title: '收貨完成', description: '品項已入庫並更新成本' });
        setConfirmId(null); setSelectedId(null);
      },
      onError: (err) => toast({ title: '收貨失敗', description: errorMessage(err), variant: 'destructive' }),
    },
  });

  const orderTable = (orders: typeof ordered, loading: boolean, recent = false) => (
    <Table>
      <TableHeader className="bg-secondary/50"><TableRow><TableHead>單號</TableHead><TableHead>供應商</TableHead><TableHead>品項數</TableHead><TableHead className="text-right">金額</TableHead><TableHead>{recent ? '收貨時間' : '下單時間'}</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
      <TableBody>
        {loading ? <TableRow><TableCell colSpan={6} className="h-28 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></TableCell></TableRow>
          : !orders?.length ? <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">{recent ? '尚無近期收貨紀錄' : '目前沒有待收貨採購單'}</TableCell></TableRow>
          : orders.map((order) => <TableRow key={order.id}>
            <TableCell className="font-mono text-xs">{order.poNo}</TableCell><TableCell>{order.supplierName}</TableCell><TableCell>{order.items.length}</TableCell>
            <TableCell className="text-right font-medium">NT$ {order.totalAmount.toLocaleString()}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{new Date((recent ? order.receivedAt : order.orderedAt) ?? order.createdAt).toLocaleString('zh-TW')}</TableCell>
            <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setSelectedId(order.id)}><Eye className="mr-1 h-4 w-4" />詳情</Button>{!recent && <Button size="sm" className="ml-2" onClick={() => setConfirmId(order.id)}><PackageCheck className="mr-1 h-4 w-4" />收貨</Button>}</TableCell>
          </TableRow>)}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-6">
      <div><h2 className="text-xl font-bold">採購收貨</h2><p className="text-sm text-muted-foreground">確認採購品項入庫並更新成本</p></div>
      <Card className="overflow-hidden border-t-2 border-t-primary shadow-sm">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><PackageCheck className="h-5 w-5 text-primary" />待收貨採購單 <Badge variant="secondary">{ordered?.length ?? 0}</Badge></CardTitle></CardHeader>
        <CardContent className="p-0">{orderTable(ordered, isLoading)}</CardContent>
      </Card>
      <Card className="overflow-hidden shadow-sm">
        <CardHeader><CardTitle className="text-base">最近已收貨</CardTitle></CardHeader>
        <CardContent className="p-0">{orderTable(received, receivedLoading, true)}</CardContent>
      </Card>

      <Dialog open={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2">採購單 {detail?.poNo}{detail && <Badge variant="outline" className={detail.status === 'received' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-blue-200 bg-blue-50 text-blue-700'}>{detail.status === 'received' ? '已收貨' : '已下單'}</Badge>}</DialogTitle></DialogHeader>
          {detailLoading ? <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin" /> : detail && <div className="space-y-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2"><p><span className="text-muted-foreground">供應商：</span>{detail.supplierName}</p><p><span className="text-muted-foreground">總金額：</span>NT$ {detail.totalAmount.toLocaleString()}</p>{detail.note && <p className="sm:col-span-2"><span className="text-muted-foreground">備註：</span>{detail.note}</p>}</div>
            <div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>品項</TableHead><TableHead>規格</TableHead><TableHead className="text-right">進價</TableHead><TableHead className="text-right">數量</TableHead><TableHead className="text-right">小計</TableHead></TableRow></TableHeader><TableBody>{detail.items.map((item) => <TableRow key={item.id}><TableCell><div className="font-medium">{item.productName}</div><div className="text-xs text-muted-foreground">{item.productCode}</div></TableCell><TableCell>{item.variantName || '—'}</TableCell><TableCell className="text-right">NT$ {item.unitCost.toLocaleString()}</TableCell><TableCell className="text-right">{item.quantity}</TableCell><TableCell className="text-right">NT$ {(item.unitCost * item.quantity).toLocaleString()}</TableCell></TableRow>)}</TableBody></Table></div>
          </div>}
          <DialogFooter>{detail?.status === 'ordered' && <Button onClick={() => setConfirmId(detail.id)}><PackageCheck className="mr-1 h-4 w-4" />收貨入庫</Button>}</DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmId !== null} onOpenChange={(open) => !open && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>確認採購收貨？</AlertDialogTitle><AlertDialogDescription>確認後將依採購明細入庫並更新品項成本。此操作無法復原。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={receive.isPending}>取消</AlertDialogCancel><AlertDialogAction disabled={receive.isPending} onClick={() => confirmId && receive.mutate({ id: confirmId })}>{receive.isPending ? '處理中…' : '入庫並更新成本'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}