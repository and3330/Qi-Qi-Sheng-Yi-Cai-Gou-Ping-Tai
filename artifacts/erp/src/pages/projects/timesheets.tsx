import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListErpJobCardsQueryKey, useCreateErpJobCard, useDeleteErpJobCard, useListErpJobCards, useListErpProjects } from '@workspace/api-client-react';
import { Clock, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button'; import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input'; import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useErpAuth } from '@/hooks/use-erp-auth';
import { useToast } from '@/hooks/use-toast';

export default function TimesheetsPage() {
  const { user } = useErpAuth(); const manager = ['super_admin', 'admin', 'manager'].includes(user?.erpRole || '');
  const [member, setMember] = useState('all'); const [open, setOpen] = useState(false); const params = member === 'all' ? undefined : { memberId: Number(member) };
  const { data } = useListErpJobCards(params); const members = Array.from(new Map(data?.map(x => [x.memberId, { id: x.memberId, name: x.memberName }]) || []).values()); const qc = useQueryClient(); const { toast } = useToast();
  const remove = useDeleteErpJobCard({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListErpJobCardsQueryKey(params) }); toast({ title: '工時已刪除' }); } } });
  return <div className="space-y-6"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-xl font-bold"><Clock className="text-primary" />工時</h2><div className="flex gap-2">{manager && <Select value={member} onValueChange={setMember}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部人員</SelectItem>{members.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name || `使用者 #${m.id}`}</SelectItem>)}</SelectContent></Select>}<Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />填報工時</Button></div></div>
    <Card><Table><TableHeader><TableRow><TableHead>日期</TableHead><TableHead>填報人</TableHead><TableHead>專案</TableHead><TableHead>工時</TableHead><TableHead>說明</TableHead><TableHead /></TableRow></TableHeader><TableBody>{data?.map(card => <TableRow key={card.id}><TableCell>{card.workDate}</TableCell><TableCell>{card.memberName}</TableCell><TableCell>{card.projectName}</TableCell><TableCell>{card.hours}</TableCell><TableCell>{card.description || '—'}</TableCell><TableCell><Button size="icon" variant="ghost" onClick={() => remove.mutate({ id: card.id })}><Trash2 className="h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody></Table></Card>
    {open && <TimesheetEditor close={() => setOpen(false)} />}</div>;
}
function TimesheetEditor({ close }: { close: () => void }) {
  const { data: projects } = useListErpProjects(); const [projectId, setProjectId] = useState(''); const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10)); const [hours, setHours] = useState(''); const [description, setDescription] = useState('');
  const qc = useQueryClient(); const { toast } = useToast(); const create = useCreateErpJobCard({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListErpJobCardsQueryKey() }); toast({ title: '工時已填報' }); close(); }, onError: () => toast({ title: '填報失敗', variant: 'destructive' }) } });
  return <Dialog open onOpenChange={v => !v && close()}><DialogContent><DialogHeader><DialogTitle>填報工時</DialogTitle></DialogHeader><Label>專案</Label><Select value={projectId} onValueChange={setProjectId}><SelectTrigger><SelectValue placeholder="選擇專案" /></SelectTrigger><SelectContent>{projects?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.projectNo} {p.name}</SelectItem>)}</SelectContent></Select><div className="grid grid-cols-2 gap-3"><div><Label>工作日期</Label><Input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} /></div><div><Label>工時</Label><Input type="number" min="0.25" step="0.25" value={hours} onChange={e => setHours(e.target.value)} /></div></div><Label>工作說明</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} /><DialogFooter><Button disabled={!projectId || !workDate || !(Number(hours) > 0)} onClick={() => create.mutate({ data: { projectId: Number(projectId), workDate, hours: Number(hours), description: description || null } })}>送出</Button></DialogFooter></DialogContent></Dialog>;
}