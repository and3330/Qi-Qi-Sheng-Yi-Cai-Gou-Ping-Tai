import { useEffect, useMemo, useState } from 'react';
import {
  getListErpBankReconciliationEntriesQueryKey,
  getListErpBankStatementsQueryKey,
  useAutoMatchErpBankStatement,
  useCreateErpBankStatement,
  useImportErpBankStatementCsv,
  useListErpBankReconciliationEntries,
  useListErpBankStatements,
  useMatchErpBankReconciliationEntry,
  useUpdateErpBankStatementStatus,
  type ErpBankReconciliationEntry,
  type ErpBankStatement,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, FileUp, Loader2, Plus, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

const errorMessage = (err: any) => err?.response?.data?.error || err?.message || '請稍後再試';
const money = (value?: number | null) => (value ?? 0).toLocaleString('zh-TW');
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const statusText: Record<string, string> = { draft: '草稿', reconciling: '對帳中', completed: '已完成' };
const entryStatusText: Record<string, string> = { unmatched: '未比對', matched: '已比對', ignored: '已忽略' };

export default function BankReconciliationPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [matching, setMatching] = useState<ErpBankReconciliationEntry | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: statements, isLoading: statementsLoading } = useListErpBankStatements();
  const { data: entries, isLoading: entriesLoading } = useListErpBankReconciliationEntries(selectedId ?? 0, {
    query: {
      queryKey: getListErpBankReconciliationEntriesQueryKey(selectedId ?? 0),
      enabled: selectedId != null,
    },
  });
  const selected = statements?.find((statement) => statement.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId == null && statements?.length) setSelectedId(statements[0].id);
  }, [selectedId, statements]);

  const counts = useMemo(() => ({
    matched: entries?.filter((entry) => entry.status === 'matched').length ?? 0,
    unmatched: entries?.filter((entry) => entry.status === 'unmatched').length ?? 0,
  }), [entries]);

  const refresh = (id: number) => {
    queryClient.invalidateQueries({ queryKey: getListErpBankStatementsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListErpBankReconciliationEntriesQueryKey(id) });
  };
  const autoMatch = useAutoMatchErpBankStatement({
    mutation: {
      onSuccess: (result, variables) => {
        refresh(variables.id);
        toast({ title: '自動比對完成', description: `共檢查 ${result.total} 筆，成功比對 ${result.matched} 筆` });
      },
      onError: (err) => toast({ title: '自動比對失敗', description: errorMessage(err), variant: 'destructive' }),
    },
  });
  const updateStatus = useUpdateErpBankStatementStatus({
    mutation: {
      onSuccess: (statement) => {
        refresh(statement.id);
        toast({ title: '狀態已更新' });
      },
      onError: (err) => toast({ title: '更新失敗', description: errorMessage(err), variant: 'destructive' }),
    },
  });

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="flex items-center gap-2 text-xl font-bold"><ArrowRightLeft className="h-5 w-5 text-primary" />銀行對帳</h2>
      <Button onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />新增對帳單</Button>
    </div>
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="overflow-hidden border-t-2 border-t-primary shadow-sm">
        <div className="border-b bg-secondary/40 px-4 py-3 font-semibold">對帳單清單</div>
        <div className="max-h-[650px] divide-y overflow-y-auto">
          {statementsLoading ? <Loader2 className="mx-auto my-12 h-6 w-6 animate-spin text-primary" /> : !statements?.length
            ? <div className="p-10 text-center text-sm text-muted-foreground">尚無銀行對帳單</div>
            : statements.map((statement) => <button key={statement.id} type="button" onClick={() => setSelectedId(statement.id)} className={`w-full space-y-2 p-4 text-left transition-colors hover:bg-secondary/50 ${selectedId === statement.id ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : ''}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{statement.bankAccountName || '未指定銀行帳戶'}</span><StatusBadge status={statement.status} /></div>
              <div className="text-sm text-muted-foreground">{statement.statementDate}</div>
              <div className="flex justify-between text-xs"><span>期初 NT$ {money(statement.openingBalance)}</span><span>期末 NT$ {money(statement.closingBalance)}</span></div>
            </button>)}
        </div>
      </Card>
      <Card className="min-w-0 overflow-hidden border-t-2 border-t-primary shadow-sm">
        {!selected ? <div className="p-16 text-center text-muted-foreground">請選擇一份對帳單</div> : <>
          <div className="space-y-4 border-b p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div><div className="text-lg font-semibold">{selected.bankAccountName || '未指定銀行帳戶'}</div><div className="text-sm text-muted-foreground">對帳日期：{selected.statementDate}</div></div>
              <div className="flex flex-wrap gap-2">
                <Select value={selected.status} onValueChange={(status: 'draft' | 'reconciling' | 'completed') => updateStatus.mutate({ id: selected.id, data: { status } })}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="draft">草稿</SelectItem><SelectItem value="reconciling">對帳中</SelectItem><SelectItem value="completed">已完成</SelectItem></SelectContent>
                </Select>
                <Button variant="outline" onClick={() => setImporting(true)}><FileUp className="mr-2 h-4 w-4" />匯入 CSV</Button>
                <Button disabled={autoMatch.isPending || selected.status === 'completed'} onClick={() => autoMatch.mutate({ id: selected.id })}>{autoMatch.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}自動比對</Button>
              </div>
            </div>
            <div className="flex gap-3 text-sm"><Badge variant="secondary">已比對 {counts.matched} 筆</Badge><Badge variant={counts.unmatched ? 'destructive' : 'secondary'}>未比對 {counts.unmatched} 筆</Badge></div>
          </div>
          <div className="overflow-x-auto"><Table><TableHeader className="bg-secondary/50"><TableRow><TableHead>交易日期</TableHead><TableHead>說明</TableHead><TableHead className="text-right">金額</TableHead><TableHead>狀態</TableHead><TableHead>傳票編號</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>
            {entriesLoading ? <TableRow><TableCell colSpan={6} className="h-32"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></TableCell></TableRow> : !entries?.length ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">尚無對帳明細，請匯入 CSV</TableCell></TableRow> : entries.map((entry) => <TableRow key={entry.id}><TableCell className="whitespace-nowrap">{entry.transactionDate}</TableCell><TableCell>{entry.description || '—'}</TableCell><TableCell className={`text-right font-mono font-medium ${entry.amount < 0 ? 'text-destructive' : ''}`}>NT$ {money(entry.amount)}</TableCell><TableCell><EntryStatusBadge status={entry.status} /></TableCell><TableCell>{entry.journalEntryId ? `#${entry.journalEntryId}` : '—'}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" disabled={selected.status === 'completed'} onClick={() => setMatching(entry)}>手動處理</Button></TableCell></TableRow>)}
          </TableBody></Table></div>
        </>}
      </Card>
    </div>
    <CreateStatementDialog open={creating} onClose={() => setCreating(false)} onCreated={setSelectedId} />
    {selected && <ImportDialog open={importing} statement={selected} onClose={() => setImporting(false)} />}
    {selected && <MatchDialog entry={matching} statementId={selected.id} onClose={() => setMatching(null)} />}
  </div>;
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'completed' ? 'default' : 'secondary'}>{statusText[status] || status}</Badge>;
}

function EntryStatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'matched' ? 'default' : status === 'unmatched' ? 'destructive' : 'secondary'}>{entryStatusText[status] || status}</Badge>;
}

function CreateStatementDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const [form, setForm] = useState({ statementDate: today(), bankAccountName: '', openingBalance: '0', closingBalance: '0' });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useEffect(() => {
    if (open) setForm({ statementDate: today(), bankAccountName: '', openingBalance: '0', closingBalance: '0' });
  }, [open]);
  const create = useCreateErpBankStatement({
    mutation: {
      onSuccess: (statement) => {
        queryClient.invalidateQueries({ queryKey: getListErpBankStatementsQueryKey() });
        toast({ title: '新增成功', description: '銀行對帳單已建立' });
        onCreated(statement.id);
        onClose();
      },
      onError: (err) => toast({ title: '新增失敗', description: errorMessage(err), variant: 'destructive' }),
    },
  });
  const save = () => create.mutate({ data: {
    statementDate: form.statementDate,
    bankAccountName: form.bankAccountName.trim() || null,
    bankName: form.bankAccountName.trim() || null,
    openingBalance: Number(form.openingBalance || 0),
    closingBalance: Number(form.closingBalance || 0),
  } as any });
  return <Dialog open={open} onOpenChange={(value) => !value && onClose()}><DialogContent><DialogHeader><DialogTitle>新增銀行對帳單</DialogTitle></DialogHeader><div className="grid gap-4 py-2 sm:grid-cols-2">
    <div className="space-y-2 sm:col-span-2"><Label>銀行帳戶名稱</Label><Input value={form.bankAccountName} onChange={(e) => setForm((current) => ({ ...current, bankAccountName: e.target.value }))} placeholder="例如：第一銀行 活期存款" /></div>
    <div className="space-y-2"><Label>對帳日期</Label><Input type="date" value={form.statementDate} onChange={(e) => setForm((current) => ({ ...current, statementDate: e.target.value }))} /></div>
    <div />
    <div className="space-y-2"><Label>期初餘額（元）</Label><Input type="number" step="1" value={form.openingBalance} onChange={(e) => setForm((current) => ({ ...current, openingBalance: e.target.value }))} /></div>
    <div className="space-y-2"><Label>期末餘額（元）</Label><Input type="number" step="1" value={form.closingBalance} onChange={(e) => setForm((current) => ({ ...current, closingBalance: e.target.value }))} /></div>
  </div><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={create.isPending || !form.statementDate} onClick={save}>{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}建立</Button></DialogFooter></DialogContent></Dialog>;
}

function ImportDialog({ open, statement, onClose }: { open: boolean; statement: ErpBankStatement; onClose: () => void }) {
  const [csv, setCsv] = useState('日期,說明,金額\n');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useEffect(() => { if (open) setCsv('日期,說明,金額\n'); }, [open]);
  const importCsv = useImportErpBankStatementCsv({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListErpBankReconciliationEntriesQueryKey(statement.id) });
        toast({ title: '匯入完成', description: `成功匯入 ${result.imported} 筆${result.skipped ? `，略過 ${result.skipped} 筆` : ''}` });
        onClose();
      },
      onError: (err) => toast({ title: '匯入失敗', description: errorMessage(err), variant: 'destructive' }),
    },
  });
  return <Dialog open={open} onOpenChange={(value) => !value && onClose()}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>匯入銀行對帳 CSV</DialogTitle></DialogHeader><div className="space-y-2"><Label>CSV 內容</Label><Textarea className="min-h-64 font-mono text-sm" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'日期,說明,金額\n2025-01-15,客戶匯款,12000'} /><p className="text-xs text-muted-foreground">第一列須為標題，格式為「日期,說明,金額」；支出請輸入負數。</p></div><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={importCsv.isPending || !csv.trim()} onClick={() => importCsv.mutate({ id: statement.id, data: { csv } })}>{importCsv.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}開始匯入</Button></DialogFooter></DialogContent></Dialog>;
}

function MatchDialog({ entry, statementId, onClose }: { entry: ErpBankReconciliationEntry | null; statementId: number; onClose: () => void }) {
  const [status, setStatus] = useState<'unmatched' | 'matched' | 'ignored'>('unmatched');
  const [journalEntryId, setJournalEntryId] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useEffect(() => {
    if (entry) {
      setStatus(entry.status === 'matched' || entry.status === 'ignored' ? entry.status : 'unmatched');
      setJournalEntryId(entry.journalEntryId ? String(entry.journalEntryId) : '');
    }
  }, [entry]);
  const match = useMatchErpBankReconciliationEntry({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListErpBankReconciliationEntriesQueryKey(statementId) });
        toast({ title: '明細已更新' });
        onClose();
      },
      onError: (err) => toast({ title: '更新失敗', description: errorMessage(err), variant: 'destructive' }),
    },
  });
  const save = () => {
    if (!entry) return;
    match.mutate({ id: entry.id, data: { status, journalEntryId: status === 'matched' ? Number(journalEntryId) : null } });
  };
  return <Dialog open={!!entry} onOpenChange={(value) => !value && onClose()}><DialogContent><DialogHeader><DialogTitle>手動處理對帳明細</DialogTitle></DialogHeader>{entry && <div className="space-y-4">
    <div className="rounded-md bg-muted p-3 text-sm"><div>{entry.transactionDate}　{entry.description || '無說明'}</div><div className="mt-1 font-mono font-semibold">NT$ {money(entry.amount)}</div></div>
    <div className="space-y-2"><Label>處理狀態</Label><Select value={status} onValueChange={(value: 'unmatched' | 'matched' | 'ignored') => setStatus(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="matched">已比對</SelectItem><SelectItem value="unmatched">未比對</SelectItem><SelectItem value="ignored">忽略此筆</SelectItem></SelectContent></Select></div>
    {status === 'matched' && <div className="space-y-2"><Label>傳票編號 ID</Label><Input type="number" min="1" step="1" value={journalEntryId} onChange={(e) => setJournalEntryId(e.target.value)} placeholder="請輸入傳票 ID" /></div>}
  </div>}<DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={match.isPending || (status === 'matched' && (!journalEntryId || Number(journalEntryId) <= 0))} onClick={save}>{match.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}儲存</Button></DialogFooter></DialogContent></Dialog>;
}