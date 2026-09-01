import { useEffect, useState } from 'react';
import {
  getListErpCustomersQueryKey,
  useCreateErpCustomer,
  useListErpCustomers,
  useListErpPriceLists,
  useUpdateErpCustomer,
  type ErpCustomer,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search, Users } from 'lucide-react';
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

const errorMessage = (err: any) => err?.response?.data?.error || err?.message || '請稍後再試';

export default function CustomersPage() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ErpCustomer | null>(null);
  const { data, isLoading } = useListErpCustomers({ search });
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><h2 className="flex items-center gap-2 text-xl font-bold"><Users className="h-5 w-5 text-primary" />客戶</h2><div className="flex gap-2"><form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="w-64 pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋代碼、名稱或聯絡人..." /></div><Button variant="secondary">搜尋</Button></form><Button onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />新增客戶</Button></div></div>
    <Card className="overflow-x-auto border-t-2 border-t-primary shadow-sm"><Table><TableHeader className="bg-secondary/50"><TableRow>{['代碼／名稱', '聯絡人', '電話／Email', '統編', '付款條件', '價目表', '狀態', '操作'].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>
      {isLoading ? <TableRow><TableCell colSpan={8} className="h-32"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></TableCell></TableRow> : !data?.length ? <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">查無客戶</TableCell></TableRow> : data.map((c) => <TableRow key={c.id}><TableCell><div className="font-medium">{c.name} {c.memberId && <Badge variant="secondary" className="ml-1">會員：{c.memberUsername || c.memberId}</Badge>}</div><div className="font-mono text-xs text-muted-foreground">{c.code}</div></TableCell><TableCell>{c.contactPerson || '—'}</TableCell><TableCell><div>{c.phone || '—'}</div><div className="text-xs text-muted-foreground">{c.email}</div></TableCell><TableCell>{c.taxId || '—'}</TableCell><TableCell>{c.paymentTerms || '—'}</TableCell><TableCell>{c.priceListId ? `#${c.priceListId}` : '—'}</TableCell><TableCell><Badge variant={c.isActive ? 'default' : 'secondary'}>{c.isActive ? '啟用' : '停用'}</Badge></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setEditing(c)}>編輯</Button></TableCell></TableRow>)}
    </TableBody></Table></Card>
    <CustomerDialog open={creating} onClose={() => setCreating(false)} />
    <CustomerDialog open={!!editing} customer={editing} onClose={() => setEditing(null)} />
  </div>;
}

type FormData = { code: string; name: string; contactPerson: string; phone: string; email: string; address: string; taxId: string; paymentTerms: string; priceListId: string; note: string; isActive: boolean };
const empty: FormData = { code: '', name: '', contactPerson: '', phone: '', email: '', address: '', taxId: '', paymentTerms: '', priceListId: 'none', note: '', isActive: true };
function CustomerDialog({ open, customer, onClose }: { open: boolean; customer?: ErpCustomer | null; onClose: () => void }) {
  const [form, setForm] = useState<FormData>(empty);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: priceLists } = useListErpPriceLists();
  useEffect(() => { if (open) setForm(customer ? { code: customer.code, name: customer.name, contactPerson: customer.contactPerson || '', phone: customer.phone || '', email: customer.email || '', address: customer.address || '', taxId: customer.taxId || '', paymentTerms: customer.paymentTerms || '', priceListId: customer.priceListId ? String(customer.priceListId) : 'none', note: customer.note || '', isActive: customer.isActive } : empty); }, [open, customer]);
  const success = () => { queryClient.invalidateQueries({ queryKey: getListErpCustomersQueryKey() }); toast({ title: '儲存成功', description: customer ? '客戶資料已更新' : '客戶已新增' }); onClose(); };
  const failure = (err: unknown) => toast({ title: '儲存失敗', description: errorMessage(err), variant: 'destructive' });
  const create = useCreateErpCustomer({ mutation: { onSuccess: success, onError: failure } });
  const update = useUpdateErpCustomer({ mutation: { onSuccess: success, onError: failure } });
  const set = (key: keyof FormData, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));
  const nullable = (v: string) => v.trim() || null;
  const save = () => {
    const common = { name: form.name, contactPerson: nullable(form.contactPerson), phone: nullable(form.phone), email: nullable(form.email), address: nullable(form.address), taxId: nullable(form.taxId), paymentTerms: nullable(form.paymentTerms), priceListId: form.priceListId === 'none' ? null : Number(form.priceListId), note: nullable(form.note) };
    if (customer) update.mutate({ id: customer.id, data: { ...common, code: form.code, isActive: form.isActive } as any });
    else create.mutate({ data: { code: form.code, ...common } });
  };
  const fields: Array<[keyof FormData, string, string?]> = [['code', '客戶代碼'], ['name', '客戶名稱'], ['contactPerson', '聯絡人'], ['phone', '電話'], ['email', 'Email', 'email'], ['taxId', '統一編號'], ['paymentTerms', '付款條件']];
  const pending = create.isPending || update.isPending;
  return <Dialog open={open} onOpenChange={(v) => !v && onClose()}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{customer ? '編輯客戶' : '新增客戶'}</DialogTitle></DialogHeader>{customer?.memberId && <div className="rounded-md bg-muted p-3 text-sm">此客戶由商城會員自動對應：<Badge variant="secondary">{customer.memberUsername || customer.memberId}</Badge>（會員連結不可變更）</div>}<div className="grid gap-4 py-2 sm:grid-cols-2">
    {fields.map(([key, label, type]) => <div key={key} className="space-y-2"><Label>{label}</Label><Input type={type} value={String(form[key])} onChange={(e) => set(key, e.target.value)} /></div>)}
    <div className="space-y-2"><Label>價目表</Label><Select value={form.priceListId} onValueChange={(v) => set('priceListId', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">未指定</SelectItem>{priceLists?.filter((p) => p.isActive || p.id === customer?.priceListId).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent></Select></div>
    <div className="space-y-2 sm:col-span-2"><Label>地址</Label><Input value={form.address} onChange={(e) => set('address', e.target.value)} /></div><div className="space-y-2 sm:col-span-2"><Label>備註</Label><Textarea value={form.note} onChange={(e) => set('note', e.target.value)} /></div>
    {customer && <div className="flex items-center gap-2"><Switch checked={form.isActive} onCheckedChange={(v) => set('isActive', v)} /><Label>啟用</Label></div>}
  </div><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={pending || !form.code.trim() || !form.name.trim()} onClick={save}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}儲存</Button></DialogFooter></DialogContent></Dialog>;
}