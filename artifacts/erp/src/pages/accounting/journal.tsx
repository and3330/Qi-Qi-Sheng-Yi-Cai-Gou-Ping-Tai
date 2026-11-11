import { useMemo, useState } from 'react';
import {
  getListErpJournalEntriesQueryKey,
  useCreateErpJournalEntry,
  useDeleteErpJournalEntry,
  useListErpAccounts,
  useListErpJournalEntries,
  useVoidErpJournalEntry,
  type ErpJournalEntry,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, FileText, Loader2, Plus, Search, Trash2 } from 'lucide-react';
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
const money = (value: number) => value.toLocaleString('zh-TW');

export default function JournalPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ startDate: '', endDate: '', q: '' });
  const [draft, setDraft] = useState(filters);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const params = { page, pageSize: 20, startDate: filters.startDate || undefined, endDate: filters.endDate || undefined, q: filters.q || undefined };
  const { data, isLoading } = useListErpJournalEntries(params);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const remove = useDeleteErpJournalEntry({ mutation: {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListErpJournalEntriesQueryKey() });
      toast({ title: '傳票已刪除' });
    },
    onError: (err) => toast({ title: '刪除失敗', description: errorMessage(err), variant: 'destructive' }),
  } });
  const voidEntry = useVoidErpJournalEntry({ mutation: {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListErpJournalEntriesQueryKey() });
      toast({ title: '傳票已作廢', description: '已自動產生一張借貸相反的沖銷傳票' });
    },
    onError: (err) => toast({ title: '作廢失敗', description: errorMessage(err), variant: 'destructive' }),
  } });
  // 已入帳的傳票只能作廢（保留紀錄並產生沖銷傳票），草稿才可以刪除
  const askVoid = (entry: ErpJournalEntry) => {
    const reason = window.prompt(`作廢傳票 ${entry.entryNumber}？原傳票會保留，並產生一張沖銷傳票。可填寫作廢原因（選填）：`, '');
    if (reason === null) return;
    voidEntry.mutate({ id: entry.id, data: { reason: reason.trim() || undefined } });
  };
  const toggle = (id: number) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const exportCsv = () => {
    if (!data?.items.length) return;
    const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows: unknown[][] = [['傳票編號', '日期', '摘要', '參考編號', '科目', '分錄摘要', '借方', '貸方']];
    data.items.forEach((entry) => entry.lines.forEach((line) => rows.push([entry.entryNumber, entry.entryDate, entry.description, entry.reference, line.accountName, line.description, line.debit, line.credit])));
    const csv = `\ufeff${rows.map((row) => row.map(quote).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `日記帳-第${page}頁.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 20)));

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="flex items-center gap-2 text-xl font-bold"><FileText className="h-5 w-5 text-primary" />傳票／日記帳</h2><div className="flex gap-2"><Button variant="outline" disabled={!data?.items.length} onClick={exportCsv}><Download className="mr-2 h-4 w-4" />匯出目前頁 CSV</Button><Button onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />新增傳票</Button></div></div>
    <Card className="p-4">
      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); setPage(1); setFilters(draft); }}>
        <div className="space-y-2"><Label>起始日期</Label><Input type="date" value={draft.startDate} onChange={(e) => setDraft((f) => ({ ...f, startDate: e.target.value }))} /></div>
        <div className="space-y-2"><Label>結束日期</Label><Input type="date" value={draft.endDate} onChange={(e) => setDraft((f) => ({ ...f, endDate: e.target.value }))} /></div>
        <div className="space-y-2 sm:flex-1"><Label>關鍵字</Label><Input value={draft.q} onChange={(e) => setDraft((f) => ({ ...f, q: e.target.value }))} placeholder="搜尋傳票編號或摘要..." /></div>
        <Button type="submit" variant="secondary"><Search className="mr-2 h-4 w-4" />查詢</Button>
      </form>
    </Card>
    <Card className="overflow-x-auto border-t-2 border-t-primary shadow-sm"><Table>
      <TableHeader className="bg-secondary/50"><TableRow><TableHead className="w-12" /><TableHead>傳票編號</TableHead><TableHead>日期</TableHead><TableHead>摘要</TableHead><TableHead>參考編號</TableHead><TableHead>來源</TableHead><TableHead className="text-right">借方合計</TableHead><TableHead className="text-right">貸方合計</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
      <TableBody>
        {isLoading ? <TableRow><TableCell colSpan={9} className="h-32"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></TableCell></TableRow>
          : !data?.items.length ? <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">查無傳票</TableCell></TableRow>
            : data.items.map((entry) => {
              const isOpen = expanded.has(entry.id);
              const debit = entry.lines.reduce((sum, line) => sum + line.debit, 0);
              const credit = entry.lines.reduce((sum, line) => sum + line.credit, 0);
              return [
                <TableRow key={entry.id}>
                  <TableCell><Button size="icon" variant="ghost" aria-label={isOpen ? '收合分錄' : '展開分錄'} onClick={() => toggle(entry.id)}>{isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button></TableCell>
                  <TableCell className="font-mono font-medium">{entry.entryNumber}</TableCell><TableCell>{entry.entryDate}</TableCell><TableCell>{entry.description || '—'}</TableCell><TableCell>{entry.reference || '—'}</TableCell>
                  <TableCell><span className="inline-flex flex-wrap gap-1">{entry.sourceType ? <Badge variant="secondary">自動</Badge> : <Badge variant="outline">手動</Badge>}{entry.status === 'Voided' && <Badge variant="destructive">已作廢</Badge>}{entry.status === 'Draft' && <Badge variant="outline">草稿</Badge>}</span></TableCell><TableCell className="text-right font-mono">{money(debit)}</TableCell><TableCell className="text-right font-mono">{money(credit)}</TableCell>
                  <TableCell className="text-right">{!entry.sourceType && entry.status === 'Draft' && <Button size="icon" variant="ghost" className="text-destructive" aria-label="刪除草稿" title="刪除草稿" disabled={remove.isPending} onClick={() => { if (window.confirm(`確定刪除草稿傳票 ${entry.entryNumber}？`)) remove.mutate({ id: entry.id }); }}><Trash2 className="h-4 w-4" /></Button>}{!entry.sourceType && entry.status !== 'Draft' && entry.status !== 'Voided' && <Button size="icon" variant="ghost" className="text-destructive" aria-label="作廢傳票" title="作廢傳票" disabled={voidEntry.isPending} onClick={() => askVoid(entry)}><Ban className="h-4 w-4" /></Button>}</TableCell>
                </TableRow>,
                isOpen && <TableRow key={`${entry.id}-lines`}><TableCell /><TableCell colSpan={8} className="bg-muted/20 p-4"><JournalLines entry={entry} /></TableCell></TableRow>,
              ];
            })}
      </TableBody>
    </Table>
      {data && data.total > 0 && <div className="flex items-center justify-between border-t px-4 py-3"><span className="text-sm text-muted-foreground">顯示 {(page - 1) * data.pageSize + 1} 至 {Math.min(page * data.pageSize, data.total)} 筆，共 {data.total} 筆</span><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="h-4 w-4" />上一頁</Button><span className="text-sm">{page} / {totalPages}</span><Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>下一頁<ChevronRight className="h-4 w-4" /></Button></div></div>}
    </Card>
    <JournalDialog open={creating} onClose={() => setCreating(false)} />
  </div>;
}

function JournalLines({ entry }: { entry: ErpJournalEntry }) {
  return <Table><TableHeader><TableRow><TableHead>科目</TableHead><TableHead>分錄摘要</TableHead><TableHead className="text-right">借方</TableHead><TableHead className="text-right">貸方</TableHead></TableRow></TableHeader><TableBody>{entry.lines.map((line, index) => <TableRow key={`${line.accountId}-${index}`}><TableCell>{line.accountName}</TableCell><TableCell>{line.description || '—'}</TableCell><TableCell className="text-right font-mono">{line.debit ? money(line.debit) : '—'}</TableCell><TableCell className="text-right font-mono">{line.credit ? money(line.credit) : '—'}</TableCell></TableRow>)}</TableBody></Table>;
}

type JournalLineForm = { accountId: string; debit: string; credit: string; description: string };
const newLine = (): JournalLineForm => ({ accountId: '', debit: '', credit: '', description: '' });

function JournalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const today = new Date().toLocaleDateString('en-CA');
  const [entryDate, setEntryDate] = useState(today);
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<JournalLineForm[]>([newLine(), newLine()]);
  const { data: accounts } = useListErpAccounts();
  const leafAccounts = useMemo(() => (accounts || []).filter((account) => account.isActive && !account.hasChildren), [accounts]);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const totalDebit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
  const validLines = lines.length >= 2 && lines.every((line) => line.accountId && Number.isInteger(Number(line.debit || 0)) && Number.isInteger(Number(line.credit || 0)) && ((Number(line.debit) > 0) !== (Number(line.credit) > 0)));
  const balanced = totalDebit > 0 && totalDebit === totalCredit;
  const reset = () => { setEntryDate(today); setDescription(''); setReference(''); setLines([newLine(), newLine()]); };
  const create = useCreateErpJournalEntry({ mutation: {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListErpJournalEntriesQueryKey() });
      toast({ title: '傳票新增成功' });
      reset();
      onClose();
    },
    onError: (err) => toast({ title: '新增失敗', description: errorMessage(err), variant: 'destructive' }),
  } });
  const patchLine = (index: number, patch: Partial<JournalLineForm>) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  const save = () => create.mutate({ data: { entryDate, description: description.trim() || null, reference: reference.trim() || null, lines: lines.map((line) => ({ accountId: Number(line.accountId), debit: Number(line.debit) || 0, credit: Number(line.credit) || 0, description: line.description.trim() || null })) } });

  return <Dialog open={open} onOpenChange={(value) => { if (!value) { reset(); onClose(); } }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle>新增傳票</DialogTitle></DialogHeader>
    <div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label>傳票日期</Label><Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div><div className="space-y-2"><Label>參考編號</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} /></div><div className="space-y-2 sm:col-span-3"><Label>傳票摘要</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div></div>
    <div className="mt-2 overflow-x-auto rounded-md border"><Table><TableHeader className="bg-muted/50"><TableRow><TableHead className="min-w-52">科目</TableHead><TableHead className="min-w-40">分錄摘要</TableHead><TableHead className="w-36">借方</TableHead><TableHead className="w-36">貸方</TableHead><TableHead className="w-14" /></TableRow></TableHeader><TableBody>
      {lines.map((line, index) => <TableRow key={index}><TableCell><Select value={line.accountId || undefined} onValueChange={(value) => patchLine(index, { accountId: value })}><SelectTrigger><SelectValue placeholder="選擇科目" /></SelectTrigger><SelectContent>{leafAccounts.map((account) => <SelectItem key={account.id} value={String(account.id)}>{account.accountNumber} {account.accountName}</SelectItem>)}</SelectContent></Select></TableCell><TableCell><Input value={line.description} onChange={(e) => patchLine(index, { description: e.target.value })} /></TableCell><TableCell><Input type="number" min="0" step="1" value={line.debit} onChange={(e) => patchLine(index, { debit: e.target.value, ...(Number(e.target.value) > 0 ? { credit: '' } : {}) })} /></TableCell><TableCell><Input type="number" min="0" step="1" value={line.credit} onChange={(e) => patchLine(index, { credit: e.target.value, ...(Number(e.target.value) > 0 ? { debit: '' } : {}) })} /></TableCell><TableCell><Button size="icon" variant="ghost" disabled={lines.length <= 2} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 className="h-4 w-4" /></Button></TableCell></TableRow>)}
    </TableBody></Table></div>
    <Button className="w-fit" variant="outline" onClick={() => setLines((current) => [...current, newLine()])}><Plus className="mr-2 h-4 w-4" />新增分錄行</Button>
    <div className={`flex justify-end gap-6 rounded-md p-3 text-sm font-medium ${balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-destructive/10 text-destructive'}`}><span>借方合計：NT$ {money(totalDebit)}</span><span>貸方合計：NT$ {money(totalCredit)}</span><span>{balanced ? '借貸平衡' : '借貸不平衡'}</span></div>
    <DialogFooter><Button variant="outline" onClick={() => { reset(); onClose(); }}>取消</Button><Button disabled={create.isPending || !entryDate || !validLines || !balanced} onClick={save}>{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}建立傳票</Button></DialogFooter>
  </DialogContent></Dialog>;
}