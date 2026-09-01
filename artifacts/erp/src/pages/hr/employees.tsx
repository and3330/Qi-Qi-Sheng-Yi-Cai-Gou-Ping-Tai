import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, Loader2, Plus } from 'lucide-react';
import { getListErpHrEmployeesQueryKey, useCreateErpHrEmployee, useListErpHrEmployees, useUpdateErpHrEmployee, type ErpHrEmployee } from '@workspace/api-client-react';
import { useErpAuth } from '@/hooks/use-erp-auth';
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

const payrollRoles = ['super_admin', 'admin', 'hr_admin'];
const statusLabel: Record<string, string> = { active: '在職', leave: '留停', terminated: '離職' };
const errorMessage = (err: any) => err?.response?.data?.error || err?.message || '請稍後再試';

export default function EmployeesPage() {
  const { data, isLoading } = useListErpHrEmployees();
  const { user } = useErpAuth();
  const canPayroll = payrollRoles.includes(user?.erpRole || '');
  const [editing, setEditing] = useState<ErpHrEmployee | null | undefined>();
  return <div className="space-y-6">
    <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-xl font-bold"><BriefcaseBusiness className="h-5 w-5 text-primary" />員工主檔</h2><Button onClick={() => setEditing(null)}><Plus className="mr-2 h-4 w-4" />新增員工</Button></div>
    <Card className="overflow-x-auto border-t-2 border-t-primary"><Table><TableHeader><TableRow>{['員工編號', '姓名', '職稱', '部門 ID', '到職日', '聯絡方式', ...(canPayroll ? ['本薪'] : []), '狀態', '操作'].map((x) => <TableHead key={x}>{x}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{isLoading ? <TableRow><TableCell colSpan={9}><Loader2 className="mx-auto my-10 animate-spin" /></TableCell></TableRow> : !data?.length ? <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">尚無員工資料</TableCell></TableRow> : data.map((e) => <TableRow key={e.id}>
        <TableCell className="font-mono">{e.employeeNo}</TableCell><TableCell className="font-medium">{e.name}</TableCell><TableCell>{e.jobTitle || '—'}</TableCell><TableCell>{e.departmentId || '—'}</TableCell><TableCell>{e.hireDate || '—'}</TableCell><TableCell>{e.email || e.phone || '—'}</TableCell>
        {canPayroll && <TableCell>NT$ {(e.baseSalary || 0).toLocaleString()}</TableCell>}<TableCell><Badge variant={e.status === 'active' ? 'default' : 'secondary'}>{statusLabel[e.status]}</Badge></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setEditing(e)}>編輯</Button></TableCell>
      </TableRow>)}</TableBody>
    </Table></Card>
    <EmployeeDialog open={editing !== undefined} employee={editing || null} canPayroll={canPayroll} onClose={() => setEditing(undefined)} />
  </div>;
}

function EmployeeDialog({ open, employee, canPayroll, onClose }: { open: boolean; employee: ErpHrEmployee | null; canPayroll: boolean; onClose: () => void }) {
  const empty = { employeeNo: '', name: '', memberId: '', departmentId: '', jobTitle: '', hireDate: '', status: 'active', email: '', phone: '', baseSalary: '0', bankAccount: '', idNumber: '', notes: '' };
  const [form, setForm] = useState(empty);
  useEffect(() => { setForm(employee ? { employeeNo: employee.employeeNo, name: employee.name, memberId: String(employee.memberId || ''), departmentId: String(employee.departmentId || ''), jobTitle: employee.jobTitle || '', hireDate: employee.hireDate || '', status: employee.status, email: employee.email || '', phone: employee.phone || '', baseSalary: String(employee.baseSalary || 0), bankAccount: employee.bankAccount || '', idNumber: employee.idNumber || '', notes: employee.notes || '' } : empty); }, [employee, open]);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const qc = useQueryClient(); const { toast } = useToast();
  const success = () => { qc.invalidateQueries({ queryKey: getListErpHrEmployeesQueryKey() }); toast({ title: '員工資料已儲存' }); onClose(); };
  const fail = (err: any) => toast({ title: '儲存失敗', description: errorMessage(err), variant: 'destructive' });
  const create = useCreateErpHrEmployee({ mutation: { onSuccess: success, onError: fail } });
  const update = useUpdateErpHrEmployee({ mutation: { onSuccess: success, onError: fail } });
  const data: any = { ...form, memberId: form.memberId ? Number(form.memberId) : null, departmentId: form.departmentId ? Number(form.departmentId) : null, hireDate: form.hireDate || null, email: form.email || null, phone: form.phone || null, jobTitle: form.jobTitle || null, notes: form.notes || null };
  if (canPayroll) Object.assign(data, { baseSalary: Number(form.baseSalary), bankAccount: form.bankAccount || null, idNumber: form.idNumber || null });
  else { delete data.baseSalary; delete data.bankAccount; delete data.idNumber; }
  return <Dialog open={open} onOpenChange={(v) => !v && onClose()}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{employee ? '編輯員工' : '新增員工'}</DialogTitle></DialogHeader><div className="grid gap-4 sm:grid-cols-2">
    <Field label="員工編號 *" value={form.employeeNo} onChange={(v) => set('employeeNo', v)} /><Field label="姓名 *" value={form.name} onChange={(v) => set('name', v)} /><Field label="會員 ID（打卡對應）" type="number" value={form.memberId} onChange={(v) => set('memberId', v)} /><Field label="部門 ID" type="number" value={form.departmentId} onChange={(v) => set('departmentId', v)} /><Field label="職稱" value={form.jobTitle} onChange={(v) => set('jobTitle', v)} /><Field label="到職日" type="date" value={form.hireDate} onChange={(v) => set('hireDate', v)} />
    <div className="space-y-2"><Label>狀態</Label><Select value={form.status} onValueChange={(v) => set('status', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(statusLabel).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
    <Field label="電子郵件" value={form.email} onChange={(v) => set('email', v)} /><Field label="電話" value={form.phone} onChange={(v) => set('phone', v)} />
    {canPayroll && <><Field label="本薪（NT$）" type="number" value={form.baseSalary} onChange={(v) => set('baseSalary', v)} /><Field label="銀行帳號" value={form.bankAccount} onChange={(v) => set('bankAccount', v)} /><Field label="身分證字號" value={form.idNumber} onChange={(v) => set('idNumber', v)} /></>}
    <div className="space-y-2 sm:col-span-2"><Label>備註</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
  </div><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={!form.employeeNo || !form.name || create.isPending || update.isPending} onClick={() => employee ? update.mutate({ id: employee.id, data }) : create.mutate({ data })}>儲存</Button></DialogFooter></DialogContent></Dialog>;
}
function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) { return <div className="space-y-2"><Label>{label}</Label><Input type={type} value={value} onChange={(e) => onChange(e.target.value)} /></div>; }