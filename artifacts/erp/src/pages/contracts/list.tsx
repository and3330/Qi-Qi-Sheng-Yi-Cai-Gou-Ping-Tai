import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListErpContractsQueryKey, useCreateErpContract, useListErpContracts,
  useUpdateErpContract, useListErpCustomers, useListErpSuppliers, type ErpContract,
} from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { FileSignature, Plus } from 'lucide-react';

const statuses = ['draft', 'active', 'expired', 'terminated'] as const;
const statusNames = { draft: '草稿', active: '生效', expired: '已到期', terminated: '已終止' };
const partyNames = { customer: '客戶', supplier: '供應商', other: '其他' };
const isExpiring = (endDate: string | null | undefined) => {
  if (!endDate) return false;
  const days = (new Date(`${endDate}T23:59:59`).getTime() - Date.now()) / 86400000;
  return days >= 0 && days <= 30;
};

export default function ContractsPage() {
  const [expiring, setExpiring] = useState(false);
  const [editing, setEditing] = useState<ErpContract | null | undefined>();
  const { data } = useListErpContracts({ expiring: expiring || undefined });
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-xl font-bold"><FileSignature className="text-primary" />合約管理</h2>
      <div className="flex items-center gap-4"><label className="flex items-center gap-2 text-sm"><Checkbox checked={expiring} onCheckedChange={v => setExpiring(v === true)} />僅顯示 30 天內到期</label><Button onClick={() => setEditing(null)}><Plus className="mr-1 h-4 w-4" />新增合約</Button></div>
    </div>
    <Card className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>合約編號／標題</TableHead><TableHead>對象</TableHead><TableHead>金額</TableHead><TableHead>期間</TableHead><TableHead>狀態</TableHead><TableHead>續約提醒</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>{!data?.length ? <TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">查無合約</TableCell></TableRow> : data.map(c => <TableRow key={c.id} className={isExpiring(c.endDate) && c.status === 'active' ? 'bg-amber-50 dark:bg-amber-950/20' : ''}>
        <TableCell><div className="font-medium">{c.title}</div><div className="font-mono text-xs text-muted-foreground">{c.contractNo}</div></TableCell>
        <TableCell>{partyNames[c.partyType]}</TableCell><TableCell>{c.amount == null ? '—' : `NT$ ${c.amount.toLocaleString()}`}</TableCell>
        <TableCell>{c.startDate || '—'}～{c.endDate || '—'} {isExpiring(c.endDate) && c.status === 'active' && <Badge variant="destructive">即將到期</Badge>}</TableCell>
        <TableCell><Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{statusNames[c.status]}</Badge></TableCell><TableCell>{c.renewalNotice ? '是' : '否'}</TableCell>
        <TableCell><Button size="sm" variant="outline" onClick={() => setEditing(c)}>編輯</Button></TableCell>
      </TableRow>)}</TableBody>
    </Table></Card>
    {editing !== undefined && <ContractDialog item={editing} close={() => setEditing(undefined)} />}
  </div>;
}

function ContractDialog({ item, close }: { item: ErpContract | null; close: () => void }) {
  const [title, setTitle] = useState(item?.title || '');
  const [partyType, setPartyType] = useState<'customer' | 'supplier' | 'other'>(item?.partyType || 'other');
  const [partyId, setPartyId] = useState(String(item?.customerId || item?.supplierId || 'none'));
  const [amount, setAmount] = useState(item?.amount == null ? '' : String(item.amount));
  const [signedDate, setSignedDate] = useState(item?.signedDate || '');
  const [startDate, setStartDate] = useState(item?.startDate || '');
  const [endDate, setEndDate] = useState(item?.endDate || '');
  const [status, setStatus] = useState(item?.status || 'draft');
  const [renewalNotice, setRenewalNotice] = useState(item?.renewalNotice || false);
  const [notes, setNotes] = useState(item?.notes || '');
  const { data: customers } = useListErpCustomers({ search: '' });
  const { data: suppliers } = useListErpSuppliers({ search: '' });
  const qc = useQueryClient(); const { toast } = useToast();
  useEffect(() => setPartyId('none'), [partyType]);
  const done = () => { qc.invalidateQueries({ queryKey: getListErpContractsQueryKey() }); toast({ title: '合約已儲存' }); close(); };
  const fail = (err: any) => toast({ title: '儲存失敗', description: err?.response?.data?.error || '請稍後再試', variant: 'destructive' });
  const create = useCreateErpContract({ mutation: { onSuccess: done, onError: fail } });
  const update = useUpdateErpContract({ mutation: { onSuccess: done, onError: fail } });
  const save = () => {
    const data = { title, partyType, customerId: partyType === 'customer' && partyId !== 'none' ? Number(partyId) : null, supplierId: partyType === 'supplier' && partyId !== 'none' ? Number(partyId) : null, amount: amount ? Number(amount) : null, signedDate: signedDate || null, startDate: startDate || null, endDate: endDate || null, status, renewalNotice, notes: notes || null };
    item ? update.mutate({ id: item.id, data }) : create.mutate({ data });
  };
  const parties = partyType === 'customer' ? customers : partyType === 'supplier' ? suppliers : [];
  return <Dialog open onOpenChange={v => !v && close()}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{item ? '編輯合約' : '新增合約'}</DialogTitle></DialogHeader>
    <Label>標題</Label><Input value={title} onChange={e => setTitle(e.target.value)} />
    <div className="grid grid-cols-2 gap-3"><div><Label>對象類型</Label><Select value={partyType} onValueChange={(v: any) => setPartyType(v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(partyNames).map(([v, n]) => <SelectItem key={v} value={v}>{n}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>對象</Label><Select disabled={partyType === 'other'} value={partyId} onValueChange={setPartyId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">未指定</SelectItem>{parties?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent></Select></div></div>
    <Label>金額（NT$）</Label><Input type="number" min="0" step="1" value={amount} onChange={e => setAmount(e.target.value)} />
    <div className="grid grid-cols-3 gap-3">{[['簽署日期', signedDate, setSignedDate], ['開始日期', startDate, setStartDate], ['結束日期', endDate, setEndDate]].map(([label, value, setter]: any) => <div key={label}><Label>{label}</Label><Input type="date" value={value} onChange={e => setter(e.target.value)} /></div>)}</div>
    <Label>狀態</Label><Select value={status} onValueChange={(v: any) => setStatus(v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{statuses.map(v => <SelectItem key={v} value={v}>{statusNames[v]}</SelectItem>)}</SelectContent></Select>
    <label className="flex items-center gap-2"><Switch checked={renewalNotice} onCheckedChange={setRenewalNotice} /><span className="text-sm">啟用續約提醒</span></label>
    <Label>備註</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} />
    <DialogFooter><Button variant="outline" onClick={close}>取消</Button><Button disabled={!title.trim() || create.isPending || update.isPending} onClick={save}>儲存</Button></DialogFooter>
  </DialogContent></Dialog>;
}