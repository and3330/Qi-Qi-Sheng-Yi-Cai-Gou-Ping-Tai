import { useEffect, useMemo, useState } from 'react';
import {
  getGetErpAccountingSettingsQueryKey,
  getListErpAccountsQueryKey,
  useCreateErpAccount,
  useGetErpAccountingSettings,
  useListErpAccounts,
  useUpdateErpAccount,
  useUpdateErpAccountingSettings,
  type ErpAccount,
  type ErpAccountInputAccountType,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Loader2, LockKeyhole, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

const errorMessage = (err: any) => err?.response?.data?.error || err?.message || '請稍後再試';

const typeLabels: Record<string, string> = {
  Asset: '資產',
  Liability: '負債',
  Equity: '權益',
  Income: '收入',
  Expense: '費用',
};
const typeOrder = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];
const cashFlowLabels: Record<string, string> = {
  operating: '營業活動',
  investing: '投資活動',
  financing: '籌資活動',
  cash: '現金及約當現金',
};

export default function AccountsPage() {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ErpAccount | null>(null);
  const { data: accounts, isLoading } = useListErpAccounts();
  const rows = useMemo(() => {
    if (!accounts) return [];
    const result: Array<{ account: ErpAccount; depth: number }> = [];
    const add = (account: ErpAccount, depth: number, visited: Set<number>) => {
      if (visited.has(account.id)) return;
      visited.add(account.id);
      result.push({ account, depth });
      accounts
        .filter((child) => child.parentAccountId === account.id)
        .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
        .forEach((child) => add(child, depth + 1, visited));
    };
    const visited = new Set<number>();
    typeOrder.forEach((type) => {
      accounts
        .filter((account) => account.accountType === type && (!account.parentAccountId || !accounts.some((parent) => parent.id === account.parentAccountId)))
        .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
        .forEach((account) => add(account, 0, visited));
    });
    accounts.filter((account) => !visited.has(account.id)).forEach((account) => add(account, 0, visited));
    return result;
  }, [accounts]);

  return <div className="space-y-6">
    <div className="flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-xl font-bold"><BookOpen className="h-5 w-5 text-primary" />會計科目表</h2>
      <Button onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />新增科目</Button>
    </div>
    <LockDateCard />
    <Card className="overflow-x-auto border-t-2 border-t-primary shadow-sm">
      <Table>
        <TableHeader className="bg-secondary/50"><TableRow><TableHead>科目編號／名稱</TableHead><TableHead>類型</TableHead><TableHead>現金流量分類</TableHead><TableHead>狀態</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
        <TableBody>
          {isLoading ? <TableRow><TableCell colSpan={5} className="h-32"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></TableCell></TableRow>
            : !rows.length ? <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">尚無會計科目</TableCell></TableRow>
              : rows.map(({ account, depth }, index) => {
                const previousType = index > 0 ? rows[index - 1].account.accountType : null;
                return [
                  account.accountType !== previousType && <TableRow key={`group-${account.accountType}`} className="bg-muted/40"><TableCell colSpan={5} className="font-semibold text-primary">{typeLabels[account.accountType] || account.accountType}</TableCell></TableRow>,
                  <TableRow key={account.id}>
                    <TableCell><div className="flex items-center" style={{ paddingLeft: `${depth * 24}px` }}><span className="font-mono text-sm text-muted-foreground">{account.accountNumber}</span><span className="ml-3 font-medium">{account.accountName}</span>{account.hasChildren && <Badge variant="outline" className="ml-2">彙總</Badge>}</div></TableCell>
                    <TableCell>{typeLabels[account.accountType] || account.accountType}</TableCell>
                    <TableCell>{account.cashFlowCategory ? cashFlowLabels[account.cashFlowCategory] || account.cashFlowCategory : '—'}</TableCell>
                    <TableCell><Badge variant={account.isActive ? 'default' : 'secondary'}>{account.isActive ? '啟用' : '停用'}</Badge></TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setEditing(account)}>編輯</Button></TableCell>
                  </TableRow>,
                ];
              })}
        </TableBody>
      </Table>
    </Card>
    <AccountDialog open={creating} accounts={accounts || []} onClose={() => setCreating(false)} />
    <AccountDialog open={!!editing} account={editing} accounts={accounts || []} onClose={() => setEditing(null)} />
  </div>;
}

function LockDateCard() {
  const { data } = useGetErpAccountingSettings();
  const [lockDate, setLockDate] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useEffect(() => setLockDate(data?.lockDate || ''), [data?.lockDate]);
  const update = useUpdateErpAccountingSettings({ mutation: {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetErpAccountingSettingsQueryKey() });
      toast({ title: '關帳日已更新' });
    },
    onError: (err) => toast({ title: '更新失敗', description: errorMessage(err), variant: 'destructive' }),
  } });
  return <Card className="p-4">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-4 w-4 text-primary" />關帳日</div><p className="mt-1 text-sm text-muted-foreground">關帳日（含）以前的會計傳票不得新增或刪除；清空可取消關帳限制。</p></div>
      <div className="flex items-end gap-2"><div className="space-y-2"><Label htmlFor="lock-date">日期</Label><Input id="lock-date" type="date" value={lockDate} onChange={(e) => setLockDate(e.target.value)} /></div><Button disabled={update.isPending} onClick={() => update.mutate({ data: { lockDate: lockDate || null } })}>{update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}儲存</Button></div>
    </div>
  </Card>;
}

type AccountForm = { accountNumber: string; accountName: string; accountType: ErpAccountInputAccountType; parentAccountId: string; cashFlowCategory: string; isActive: boolean };
const emptyAccount: AccountForm = { accountNumber: '', accountName: '', accountType: 'Asset', parentAccountId: 'none', cashFlowCategory: 'none', isActive: true };

function AccountDialog({ open, account, accounts, onClose }: { open: boolean; account?: ErpAccount | null; accounts: ErpAccount[]; onClose: () => void }) {
  const [form, setForm] = useState<AccountForm>(emptyAccount);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useEffect(() => {
    if (open) setForm(account ? { accountNumber: account.accountNumber, accountName: account.accountName, accountType: account.accountType as ErpAccountInputAccountType, parentAccountId: account.parentAccountId ? String(account.parentAccountId) : 'none', cashFlowCategory: account.cashFlowCategory || 'none', isActive: account.isActive } : emptyAccount);
  }, [open, account]);
  const success = () => {
    queryClient.invalidateQueries({ queryKey: getListErpAccountsQueryKey() });
    toast({ title: '儲存成功', description: account ? '科目資料已更新' : '科目已新增' });
    onClose();
  };
  const failure = (err: unknown) => toast({ title: '儲存失敗', description: errorMessage(err), variant: 'destructive' });
  const create = useCreateErpAccount({ mutation: { onSuccess: success, onError: failure } });
  const update = useUpdateErpAccount({ mutation: { onSuccess: success, onError: failure } });
  const save = () => {
    if (account) update.mutate({ id: account.id, data: { accountName: form.accountName.trim(), cashFlowCategory: form.cashFlowCategory === 'none' ? null : form.cashFlowCategory, isActive: form.isActive } });
    else create.mutate({ data: { accountNumber: form.accountNumber.trim(), accountName: form.accountName.trim(), accountType: form.accountType, parentAccountId: form.parentAccountId === 'none' ? null : Number(form.parentAccountId), cashFlowCategory: form.cashFlowCategory === 'none' ? null : form.cashFlowCategory } });
  };
  const pending = create.isPending || update.isPending;
  return <Dialog open={open} onOpenChange={(value) => !value && onClose()}><DialogContent><DialogHeader><DialogTitle>{account ? '編輯會計科目' : '新增會計科目'}</DialogTitle></DialogHeader>
    <div className="grid gap-4 py-2 sm:grid-cols-2">
      <div className="space-y-2"><Label>科目編號</Label><Input disabled={!!account} value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} /></div>
      <div className="space-y-2"><Label>科目名稱</Label><Input value={form.accountName} onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))} /></div>
      <div className="space-y-2"><Label>科目類型</Label><Select disabled={!!account} value={form.accountType} onValueChange={(value) => setForm((f) => ({ ...f, accountType: value as ErpAccountInputAccountType }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{typeOrder.map((type) => <SelectItem key={type} value={type}>{typeLabels[type]}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label>上層科目</Label><Select disabled={!!account} value={form.parentAccountId} onValueChange={(value) => setForm((f) => ({ ...f, parentAccountId: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">無（最上層）</SelectItem>{accounts.filter((item) => item.id !== account?.id && item.accountType === form.accountType).map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.accountNumber} {item.accountName}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2 sm:col-span-2"><Label>現金流量分類</Label><Select value={form.cashFlowCategory} onValueChange={(value) => setForm((f) => ({ ...f, cashFlowCategory: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">未指定</SelectItem>{Object.entries(cashFlowLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
      {account && <div className="flex items-center gap-2 sm:col-span-2"><Switch checked={form.isActive} onCheckedChange={(isActive) => setForm((f) => ({ ...f, isActive }))} /><Label>啟用</Label></div>}
    </div>
    <DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={pending || !form.accountNumber.trim() || !form.accountName.trim()} onClick={save}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}儲存</Button></DialogFooter>
  </DialogContent></Dialog>;
}