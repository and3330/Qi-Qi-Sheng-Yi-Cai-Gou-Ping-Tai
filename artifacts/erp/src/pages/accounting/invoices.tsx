import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListErpInvoicesQueryKey,
  useCreateErpInvoice,
  useDeleteErpInvoice,
  useListErpCustomers,
  useListErpInvoices,
  useListErpInvoiceSettlements,
  useListErpSuppliers,
  useUpdateErpInvoice,
  type ErpInvoice,
} from '@workspace/api-client-react';
import { ChevronDown, ChevronRight, FileText, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

const errorMessage = (err: any) => err?.response?.data?.error || err?.message || '請稍後再試';
const today = () => new Date().toISOString().slice(0, 10);
const statusLabels: Record<string, string> = { Draft: '草稿', Unpaid: '未收付', PartiallyPaid: '部分收付', Paid: '已收付', Overdue: '逾期', Cancelled: '已取消' };
const statusColors: Record<string, string> = { Draft: 'bg-slate-100 text-slate-700', Unpaid: 'bg-amber-100 text-amber-700', PartiallyPaid: 'bg-blue-100 text-blue-700', Paid: 'bg-green-100 text-green-700', Overdue: 'bg-red-100 text-red-700', Cancelled: 'bg-slate-200 text-slate-600' };
const taxLabels: Record<string, string> = { taxable: '應稅', zero_rated: '零稅率', exempt: '免稅', unclassified: '未分類' };

export default function InvoicesPage() {
  const [invoiceType, setInvoiceType] = useState('Sales');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ErpInvoice | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const { data, isLoading } = useListErpInvoices({ invoiceType, status: status === 'all' ? undefined : status, q: search || undefined });
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-xl font-bold"><FileText className="h-5 w-5 text-primary" />發票管理</h2><Button onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />開立發票</Button></div>
    <div className="flex flex-wrap gap-3">
      <Tabs value={invoiceType} onValueChange={(v) => { setInvoiceType(v); setExpanded(null); }}><TabsList><TabsTrigger value="Sales">銷售發票（AR）</TabsTrigger><TabsTrigger value="Purchase">採購發票（AP）</TabsTrigger></TabsList></Tabs>
      <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部狀態</SelectItem>{Object.entries(statusLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="w-60 pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋發票號碼..." /></div><Button variant="secondary">搜尋</Button></form>
    </div>
    <Card className="overflow-x-auto border-t-2 border-t-primary"><Table><TableHeader className="bg-secondary/50"><TableRow><TableHead className="w-10" /><TableHead>發票號碼</TableHead><TableHead>{invoiceType === 'Sales' ? '客戶' : '供應商'}</TableHead><TableHead>日期／到期日</TableHead><TableHead className="text-right">總額</TableHead><TableHead className="text-right">已收付</TableHead><TableHead className="text-right">未收付</TableHead><TableHead>稅別</TableHead><TableHead>狀態</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>
      {isLoading ? <TableRow><TableCell colSpan={10} className="h-32"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></TableCell></TableRow> : !data?.length ? <TableRow><TableCell colSpan={10} className="h-32 text-center text-muted-foreground">查無發票</TableCell></TableRow> : data.map((inv) => <>
        <TableRow key={inv.id} className="cursor-pointer" onClick={() => setExpanded(expanded === inv.id ? null : inv.id)}><TableCell>{expanded === inv.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell><TableCell className="font-medium">{inv.invoiceNumber}<div className="text-xs text-muted-foreground">{inv.journalEntryId ? `傳票 #${inv.journalEntryId}` : '尚無傳票'}</div></TableCell><TableCell>{inv.customerName || inv.supplierName || '—'}</TableCell><TableCell><div>{inv.invoiceDate}</div><div className="text-xs text-muted-foreground">{inv.dueDate || '未設定'}</div></TableCell><TableCell className="text-right">NT$ {inv.totalAmount.toLocaleString('zh-TW')}</TableCell><TableCell className="text-right text-green-700">{(inv.paidAmount || 0).toLocaleString('zh-TW')}</TableCell><TableCell className="text-right font-medium text-amber-700">{(inv.outstandingAmount ?? inv.totalAmount).toLocaleString('zh-TW')}</TableCell><TableCell>{taxLabels[inv.taxType || ''] || inv.taxType || '—'}<div className="text-xs text-muted-foreground">未稅 {(inv.netAmount || 0).toLocaleString('zh-TW')}／稅 {(inv.taxAmount || 0).toLocaleString('zh-TW')}</div></TableCell><TableCell><Badge variant="outline" className={statusColors[inv.status]}>{statusLabels[inv.status] || inv.status}</Badge></TableCell><TableCell onClick={(e) => e.stopPropagation()}><div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => setEditing(inv)}><Pencil className="h-4 w-4" /></Button><DeleteInvoiceButton invoice={inv} /></div></TableCell></TableRow>
        {expanded === inv.id && <SettlementRow key={`${inv.id}-settlements`} invoice={inv} />}
      </>)}
    </TableBody></Table></Card>
    <InvoiceDialog open={creating} invoiceType={invoiceType} onClose={() => setCreating(false)} />
    <InvoiceDialog open={!!editing} invoiceType={editing?.invoiceType || invoiceType} invoice={editing} onClose={() => setEditing(null)} />
  </div>;
}

function SettlementRow({ invoice }: { invoice: ErpInvoice }) {
  const { data, isLoading } = useListErpInvoiceSettlements(invoice.id);
  return <TableRow className="bg-muted/30"><TableCell /><TableCell colSpan={9}><div className="py-3"><div className="mb-2 font-medium">核銷紀錄</div>{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : !data?.length ? <div className="text-sm text-muted-foreground">尚無核銷紀錄</div> : <div className="space-y-2">{data.map((s) => <div key={s.id} className="flex max-w-xl justify-between rounded border bg-background p-2 text-sm"><span>{s.voucherId ? `收付款單 #${s.voucherId}` : `付款申請 #${s.paymentRequestId}`}</span><span>{s.settlementDate}</span><span className="font-medium">NT$ {s.amount.toLocaleString('zh-TW')}</span></div>)}</div>}</div></TableCell></TableRow>;
}

function DeleteInvoiceButton({ invoice }: { invoice: ErpInvoice }) {
  const queryClient = useQueryClient(); const { toast } = useToast();
  const mutation = useDeleteErpInvoice({ mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListErpInvoicesQueryKey() }); toast({ title: '發票已刪除' }); }, onError: (err: any) => toast({ title: '刪除失敗', description: errorMessage(err), variant: 'destructive' }) } });
  return <Button size="icon" variant="ghost" disabled={mutation.isPending} onClick={() => window.confirm(`確定刪除發票 ${invoice.invoiceNumber}？已有核銷紀錄的發票無法刪除。`) && mutation.mutate({ id: invoice.id })}>{mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}</Button>;
}

type InvoiceForm = { partyId: string; invoiceDate: string; dueDate: string; totalAmount: string; taxType: 'taxable' | 'zero_rated' | 'exempt' | 'unclassified'; status: string; remarks: string };
const emptyInvoice = (): InvoiceForm => ({ partyId: '', invoiceDate: today(), dueDate: '', totalAmount: '', taxType: 'taxable', status: 'Unpaid', remarks: '' });
function InvoiceDialog({ open, invoiceType, invoice, onClose }: { open: boolean; invoiceType: string; invoice?: ErpInvoice | null; onClose: () => void }) {
  const [form, setForm] = useState<InvoiceForm>(emptyInvoice());
  const { data: customers } = useListErpCustomers(); const { data: suppliers } = useListErpSuppliers();
  const queryClient = useQueryClient(); const { toast } = useToast();
  useEffect(() => { if (open) setForm(invoice ? { partyId: String(invoice.customerId || invoice.supplierId || ''), invoiceDate: invoice.invoiceDate, dueDate: invoice.dueDate || '', totalAmount: String(invoice.totalAmount), taxType: (invoice.taxType || 'taxable') as InvoiceForm['taxType'], status: invoice.status, remarks: invoice.remarks || '' } : emptyInvoice()); }, [open, invoice]);
  const success = () => { queryClient.invalidateQueries({ queryKey: getListErpInvoicesQueryKey() }); toast({ title: invoice ? '發票已更新' : '發票已開立' }); onClose(); };
  const fail = (err: any) => toast({ title: '儲存失敗', description: errorMessage(err), variant: 'destructive' });
  const create = useCreateErpInvoice({ mutation: { onSuccess: success, onError: fail } }); const update = useUpdateErpInvoice({ mutation: { onSuccess: success, onError: fail } });
  const set = (key: keyof InvoiceForm, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const save = () => invoice ? update.mutate({ id: invoice.id, data: { invoiceDate: form.invoiceDate, dueDate: form.dueDate || null, taxType: form.taxType, status: form.status, remarks: form.remarks || null } }) : create.mutate({ data: { invoiceType: invoiceType as 'Sales' | 'Purchase', customerId: invoiceType === 'Sales' ? Number(form.partyId) : null, supplierId: invoiceType === 'Purchase' ? Number(form.partyId) : null, invoiceDate: form.invoiceDate, dueDate: form.dueDate || null, totalAmount: Number(form.totalAmount), taxType: form.taxType, remarks: form.remarks || null } });
  const pending = create.isPending || update.isPending;
  return <Dialog open={open} onOpenChange={(v) => !v && onClose()}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{invoice ? '編輯發票' : `開立${invoiceType === 'Sales' ? '銷售' : '採購'}發票`}</DialogTitle></DialogHeader><div className="grid gap-4 py-2 sm:grid-cols-2">
    {!invoice && <div className="space-y-2 sm:col-span-2"><Label>{invoiceType === 'Sales' ? '客戶' : '供應商'} *</Label><Select value={form.partyId} onValueChange={(v) => set('partyId', v)}><SelectTrigger><SelectValue placeholder="請選擇" /></SelectTrigger><SelectContent>{invoiceType === 'Sales' ? customers?.filter((x) => x.isActive).map((x) => <SelectItem key={x.id} value={String(x.id)}>{x.code}－{x.name}</SelectItem>) : suppliers?.filter((x) => x.isActive).map((x) => <SelectItem key={x.id} value={String(x.id)}>{x.name}</SelectItem>)}</SelectContent></Select></div>}
    <div className="space-y-2"><Label>發票日期 *</Label><Input type="date" value={form.invoiceDate} onChange={(e) => set('invoiceDate', e.target.value)} /></div><div className="space-y-2"><Label>到期日</Label><Input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></div>
    <div className="space-y-2"><Label>含稅總額（元） *</Label><Input type="number" min="1" step="1" disabled={!!invoice} value={form.totalAmount} onChange={(e) => set('totalAmount', e.target.value)} /></div><div className="space-y-2"><Label>稅別</Label><Select value={form.taxType} onValueChange={(v) => set('taxType', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(taxLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
    {invoice && <div className="space-y-2 sm:col-span-2"><Label>狀態</Label><Select value={form.status} onValueChange={(v) => set('status', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(statusLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">狀態流轉及作廢限制將由系統檢核。</p></div>}
    <div className="space-y-2 sm:col-span-2"><Label>備註</Label><Textarea value={form.remarks} onChange={(e) => set('remarks', e.target.value)} /></div>
  </div><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={pending || !form.invoiceDate || (!invoice && (!form.partyId || Number(form.totalAmount) < 1 || !Number.isInteger(Number(form.totalAmount))))} onClick={save}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}儲存</Button></DialogFooter></DialogContent></Dialog>;
}