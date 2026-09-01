import { useEffect, useState } from 'react';
import { getListErpSuppliersQueryKey, useCreateErpSupplier, useListErpSuppliers, useUpdateErpSupplier, type Supplier } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search, Truck } from 'lucide-react';
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

const errorMessage = (err: any) => err?.response?.data?.error || err?.message || '請稍後再試';
export default function SuppliersPage() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const { data, isLoading } = useListErpSuppliers({ search });
  return <div className="space-y-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><h2 className="flex items-center gap-2 text-xl font-bold"><Truck className="h-5 w-5 text-primary" />供應商</h2><div className="flex gap-2"><form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="w-64 pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋名稱或聯絡人..." /></div><Button variant="secondary">搜尋</Button></form><Button onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />新增供應商</Button></div></div>
    <Card className="overflow-x-auto border-t-2 border-t-primary shadow-sm"><Table><TableHeader className="bg-secondary/50"><TableRow>{['名稱', '聯絡人', '電話', 'Email', '地址', '付款條件', '狀態', '操作'].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{isLoading ? <TableRow><TableCell colSpan={8} className="h-32"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></TableCell></TableRow> : !data?.length ? <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">查無供應商</TableCell></TableRow> : data.map((s) => <TableRow key={s.id}><TableCell className="font-medium">{s.name}</TableCell><TableCell>{s.contactPerson || '—'}</TableCell><TableCell>{s.phone || '—'}</TableCell><TableCell>{s.email || '—'}</TableCell><TableCell className="max-w-xs truncate">{s.address || '—'}</TableCell><TableCell>{s.paymentTerms || '—'}</TableCell><TableCell><Badge variant={s.isActive ? 'default' : 'secondary'}>{s.isActive ? '啟用' : '停用'}</Badge></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setEditing(s)}>編輯</Button></TableCell></TableRow>)}</TableBody></Table></Card>
    <SupplierDialog open={creating} onClose={() => setCreating(false)} /><SupplierDialog open={!!editing} supplier={editing} onClose={() => setEditing(null)} />
  </div>;
}

type Form = { name: string; contactPerson: string; phone: string; email: string; address: string; paymentTerms: string; note: string; isActive: boolean };
const empty: Form = { name: '', contactPerson: '', phone: '', email: '', address: '', paymentTerms: '', note: '', isActive: true };
function SupplierDialog({ open, supplier, onClose }: { open: boolean; supplier?: Supplier | null; onClose: () => void }) {
  const [form, setForm] = useState<Form>(empty);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useEffect(() => { if (open) setForm(supplier ? { name: supplier.name, contactPerson: supplier.contactPerson || '', phone: supplier.phone || '', email: supplier.email || '', address: supplier.address || '', paymentTerms: supplier.paymentTerms || '', note: supplier.note || '', isActive: supplier.isActive } : empty); }, [open, supplier]);
  const success = () => { queryClient.invalidateQueries({ queryKey: getListErpSuppliersQueryKey() }); toast({ title: '儲存成功', description: supplier ? '供應商資料已更新' : '供應商已新增' }); onClose(); };
  const failure = (e: unknown) => toast({ title: '儲存失敗', description: errorMessage(e), variant: 'destructive' });
  const create = useCreateErpSupplier({ mutation: { onSuccess: success, onError: failure } });
  const update = useUpdateErpSupplier({ mutation: { onSuccess: success, onError: failure } });
  const set = (key: keyof Form, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));
  const data = { name: form.name, contactPerson: form.contactPerson || null, phone: form.phone || null, email: form.email || null, address: form.address || null, paymentTerms: form.paymentTerms || null, note: form.note || null };
  const save = () => supplier ? update.mutate({ id: supplier.id, data: { ...data, isActive: form.isActive } }) : create.mutate({ data });
  const fields: Array<[keyof Form, string, string?]> = [['name', '名稱'], ['contactPerson', '聯絡人'], ['phone', '電話'], ['email', 'Email', 'email'], ['address', '地址'], ['paymentTerms', '付款條件']];
  const pending = create.isPending || update.isPending;
  return <Dialog open={open} onOpenChange={(v) => !v && onClose()}><DialogContent><DialogHeader><DialogTitle>{supplier ? '編輯供應商' : '新增供應商'}</DialogTitle></DialogHeader><div className="grid gap-4 py-2 sm:grid-cols-2">{fields.map(([key, label, type]) => <div key={key} className={`space-y-2 ${key === 'address' ? 'sm:col-span-2' : ''}`}><Label>{label}</Label><Input type={type} value={String(form[key])} onChange={(e) => set(key, e.target.value)} /></div>)}<div className="space-y-2 sm:col-span-2"><Label>備註</Label><Textarea value={form.note} onChange={(e) => set('note', e.target.value)} /></div>{supplier && <div className="flex items-center gap-2"><Switch checked={form.isActive} onCheckedChange={(v) => set('isActive', v)} /><Label>啟用</Label></div>}</div><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={pending || !form.name.trim()} onClick={save}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}儲存</Button></DialogFooter></DialogContent></Dialog>;
}