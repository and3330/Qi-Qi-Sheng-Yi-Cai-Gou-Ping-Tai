import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListErpVouchersQueryKey, useCreateErpVoucher, useDeleteErpVoucher, useListErpAccounts, useListErpCustomers, useListErpInvoices, useListErpSuppliers, useListErpVouchers, type ErpVoucher } from '@workspace/api-client-react';
import { CreditCard, Loader2, Plus, Trash2 } from 'lucide-react';
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

const errorMessage = (err: any) => err?.response?.data?.error || err?.message || '請稍後再試';
const today = () => new Date().toISOString().slice(0, 10);
const voucherLabels: Record<string, string> = { Receipt: '收款單', Payment: '付款單', Journal: '請款單' };

export default function VouchersPage() {
  const [type, setType] = useState('all'); const [open, setOpen] = useState(false);
  const { data, isLoading } = useListErpVouchers({ voucherType: type === 'all' ? undefined : type });
  return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-xl font-bold"><CreditCard className="h-5 w-5 text-primary" />收付款單</h2><Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />新增收付款單</Button></div>
    <Select value={type} onValueChange={setType}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部類型</SelectItem><SelectItem value="Receipt">收款單</SelectItem><SelectItem value="Payment">付款單</SelectItem></SelectContent></Select>
    <Card className="overflow-x-auto border-t-2 border-t-primary"><Table><TableHeader className="bg-secondary/50"><TableRow><TableHead>單號</TableHead><TableHead>類型</TableHead><TableHead>日期</TableHead><TableHead>對象</TableHead><TableHead className="text-right">金額</TableHead><TableHead>說明</TableHead><TableHead>傳票</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <TableRow><TableCell colSpan={8} className="h-32"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></TableCell></TableRow> : !data?.length ? <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">查無收付款單</TableCell></TableRow> : data.map((v) => <TableRow key={v.id}><TableCell className="font-medium">{v.voucherNumber}</TableCell><TableCell><Badge variant="outline">{voucherLabels[v.voucherType] || v.voucherType}</Badge></TableCell><TableCell>{v.voucherDate}</TableCell><TableCell>{v.partyName || '—'}</TableCell><TableCell className="text-right font-medium">NT$ {v.totalAmount.toLocaleString('zh-TW')}</TableCell><TableCell>{v.description || '—'}</TableCell><TableCell>{v.journalEntryId ? `#${v.journalEntryId}` : '—'}</TableCell><TableCell><DeleteVoucherButton voucher={v} /></TableCell></TableRow>)}</TableBody></Table></Card>
    <VoucherDialog open={open} onClose={() => setOpen(false)} />
  </div>;
}

function DeleteVoucherButton({ voucher }: { voucher: ErpVoucher }) {
  const queryClient = useQueryClient(); const { toast } = useToast();
  const mutation = useDeleteErpVoucher({ mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListErpVouchersQueryKey() }); toast({ title: '單據已刪除' }); }, onError: (err: any) => toast({ title: '刪除失敗', description: errorMessage(err), variant: 'destructive' }) } });
  return <Button size="icon" variant="ghost" disabled={mutation.isPending} onClick={() => window.confirm(`確定刪除 ${voucher.voucherNumber}？\n系統會同時刪除自動傳票與核銷紀錄，並還原發票未收付金額。`) && mutation.mutate({ id: voucher.id })}>{mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}</Button>;
}

function VoucherDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [voucherType, setVoucherType] = useState<'Receipt' | 'Payment'>('Receipt'); const [date, setDate] = useState(today()); const [partyId, setPartyId] = useState(''); const [amount, setAmount] = useState(''); const [accountId, setAccountId] = useState(''); const [description, setDescription] = useState(''); const [settlements, setSettlements] = useState<Record<number, string>>({});
  const { data: customers } = useListErpCustomers(); const { data: suppliers } = useListErpSuppliers(); const { data: accounts } = useListErpAccounts(); const { data: invoices } = useListErpInvoices({ invoiceType: voucherType === 'Receipt' ? 'Sales' : 'Purchase' });
  const queryClient = useQueryClient(); const { toast } = useToast();
  const available = useMemo(() => invoices?.filter((inv) => (voucherType === 'Receipt' ? inv.customerId : inv.supplierId) === Number(partyId) && (inv.outstandingAmount || 0) > 0 && inv.status !== 'Cancelled') || [], [invoices, partyId, voucherType]);
  const settlementTotal = Object.values(settlements).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const reset = () => { setVoucherType('Receipt'); setDate(today()); setPartyId(''); setAmount(''); setAccountId(''); setDescription(''); setSettlements({}); };
  const mutation = useCreateErpVoucher({ mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListErpVouchersQueryKey() }); toast({ title: '收付款單已新增' }); reset(); onClose(); }, onError: (err: any) => toast({ title: '新增失敗', description: errorMessage(err), variant: 'destructive' }) } });
  const save = () => {
    const chosen = available.filter((inv) => Number(settlements[inv.id]) > 0).map((inv) => ({ invoiceId: inv.id, amount: Number(settlements[inv.id]) }));
    const exceeded = available.some((inv) => Number(settlements[inv.id]) > (inv.outstandingAmount || 0));
    if (exceeded || settlementTotal > Number(amount)) { toast({ title: '核銷金額不正確', description: exceeded ? '核銷金額不可超過發票未收付餘額' : '核銷合計不可超過單據金額', variant: 'destructive' }); return; }
    mutation.mutate({ data: { voucherType, voucherDate: date, partyType: voucherType === 'Receipt' ? 'Customer' : 'Supplier', partyId: Number(partyId), partyName: (voucherType === 'Receipt' ? customers : suppliers)?.find((x) => x.id === Number(partyId))?.name || null, totalAmount: Number(amount), paymentAccountId: Number(accountId), description: description || null, settlements: chosen } });
  };
  const valid = partyId && accountId && Number.isInteger(Number(amount)) && Number(amount) > 0;
  return <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>新增收付款單</DialogTitle></DialogHeader><div className="grid gap-4 sm:grid-cols-2">
    <div className="space-y-2"><Label>單據類型</Label><Select value={voucherType} onValueChange={(v: 'Receipt' | 'Payment') => { setVoucherType(v); setPartyId(''); setSettlements({}); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Receipt">收款單</SelectItem><SelectItem value="Payment">付款單</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>日期 *</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
    <div className="space-y-2"><Label>{voucherType === 'Receipt' ? '客戶' : '供應商'} *</Label><Select value={partyId} onValueChange={(v) => { setPartyId(v); setSettlements({}); }}><SelectTrigger><SelectValue placeholder="請選擇" /></SelectTrigger><SelectContent>{(voucherType === 'Receipt' ? customers : suppliers)?.filter((x) => x.isActive).map((x) => <SelectItem key={x.id} value={String(x.id)}>{x.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>金額（元） *</Label><Input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
    <div className="space-y-2 sm:col-span-2"><Label>收付款科目 *</Label><Select value={accountId} onValueChange={setAccountId}><SelectTrigger><SelectValue placeholder="選擇資產葉節點科目" /></SelectTrigger><SelectContent>{accounts?.filter((x) => x.accountType === 'Asset' && !x.hasChildren && x.isActive).map((x) => <SelectItem key={x.id} value={String(x.id)}>{x.accountNumber}－{x.accountName}</SelectItem>)}</SelectContent></Select></div>
    <div className="space-y-2 sm:col-span-2"><Label>說明</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
    <div className="space-y-3 sm:col-span-2"><div className="flex justify-between"><Label>核銷發票（選填）</Label><span className="text-sm">核銷合計：NT$ {settlementTotal.toLocaleString('zh-TW')}</span></div>{!partyId ? <p className="text-sm text-muted-foreground">請先選擇對象</p> : !available.length ? <p className="text-sm text-muted-foreground">此對象沒有待核銷發票</p> : available.map((inv) => <div key={inv.id} className="grid grid-cols-[1fr_auto_9rem] items-center gap-3 rounded border p-3 text-sm"><div><div className="font-medium">{inv.invoiceNumber}</div><div className="text-muted-foreground">{inv.invoiceDate}</div></div><span>未收付 NT$ {(inv.outstandingAmount || 0).toLocaleString('zh-TW')}</span><Input type="number" min="0" max={inv.outstandingAmount} step="1" placeholder="核銷金額" value={settlements[inv.id] || ''} onChange={(e) => setSettlements((s) => ({ ...s, [inv.id]: e.target.value }))} /></div>)}</div>
  </div><DialogFooter className="mt-4"><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={!valid || mutation.isPending} onClick={save}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}新增</Button></DialogFooter></DialogContent></Dialog>;
}