import { useEffect, useState } from 'react';
import {
  getListErpWarehousesQueryKey,
  useCreateErpWarehouse,
  useListErpWarehouses,
  useUpdateErpWarehouse,
  type ErpWarehouse,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Warehouse } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

const message = (err: any) => err?.response?.data?.error || err?.message || '請稍後再試';

export default function WarehousesPage() {
  const { data, isLoading } = useListErpWarehouses();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ErpWarehouse | null>(null);
  return <div className="space-y-6">
    <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-xl font-bold"><Warehouse className="h-5 w-5 text-primary" />倉庫</h2><Button onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />新增倉庫</Button></div>
    <Card className="border-t-2 border-t-primary shadow-sm"><Table><TableHeader className="bg-secondary/50"><TableRow><TableHead>代碼</TableHead><TableHead>名稱</TableHead><TableHead>地址</TableHead><TableHead>備註</TableHead><TableHead>狀態</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>
      {isLoading ? <TableRow><TableCell colSpan={6} className="h-32"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></TableCell></TableRow> : !data?.length ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">尚無倉庫</TableCell></TableRow> : data.map((w) => <TableRow key={w.id}><TableCell className="font-mono">{w.code}</TableCell><TableCell className="font-medium">{w.name} {w.isDefault && <Badge className="ml-2">預設</Badge>}</TableCell><TableCell>{w.address || '—'}</TableCell><TableCell className="max-w-xs truncate">{w.note || '—'}</TableCell><TableCell><Badge variant={w.isActive ? 'default' : 'secondary'}>{w.isActive ? '啟用' : '停用'}</Badge></TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setEditing(w)}>編輯</Button></TableCell></TableRow>)}
    </TableBody></Table></Card>
    <WarehouseDialog open={creating} onClose={() => setCreating(false)} />
    <WarehouseDialog open={!!editing} warehouse={editing} onClose={() => setEditing(null)} />
  </div>;
}

function WarehouseDialog({ open, warehouse, onClose }: { open: boolean; warehouse?: ErpWarehouse | null; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [isActive, setIsActive] = useState(true);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useEffect(() => { if (open) { setCode(warehouse?.code || ''); setName(warehouse?.name || ''); setAddress(warehouse?.address || ''); setNote(warehouse?.note || ''); setIsActive(warehouse?.isActive ?? true); } }, [open, warehouse]);
  const done = (description: string) => { queryClient.invalidateQueries({ queryKey: getListErpWarehousesQueryKey() }); toast({ title: '儲存成功', description }); onClose(); };
  const create = useCreateErpWarehouse({ mutation: { onSuccess: () => done('倉庫已新增'), onError: (e) => toast({ title: '新增失敗', description: message(e), variant: 'destructive' }) } });
  const update = useUpdateErpWarehouse({ mutation: { onSuccess: () => done('倉庫資料已更新'), onError: (e) => toast({ title: '更新失敗', description: message(e), variant: 'destructive' }) } });
  const pending = create.isPending || update.isPending;
  const save = () => warehouse ? update.mutate({ id: warehouse.id, data: { name, address: address || null, note: note || null, isActive } }) : create.mutate({ data: { code, name, address: address || null, note: note || null } });
  return <Dialog open={open} onOpenChange={(v) => !v && onClose()}><DialogContent><DialogHeader><DialogTitle>{warehouse ? '編輯倉庫' : '新增倉庫'}</DialogTitle></DialogHeader><div className="grid gap-4 py-2">
    <div className="space-y-2"><Label>代碼</Label><Input value={code} disabled={!!warehouse} onChange={(e) => setCode(e.target.value)} /></div>
    <div className="space-y-2"><Label>名稱</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
    <div className="space-y-2"><Label>地址</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
    <div className="space-y-2"><Label>備註</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></div>
    {warehouse && <div className="flex items-center justify-between"><div><Label>啟用</Label>{warehouse.isDefault && <p className="text-xs text-muted-foreground">預設倉不可停用</p>}</div><Switch checked={isActive} disabled={warehouse.isDefault} onCheckedChange={setIsActive} /></div>}
  </div><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={pending || !name.trim() || (!warehouse && !code.trim())} onClick={save}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}儲存</Button></DialogFooter></DialogContent></Dialog>;
}