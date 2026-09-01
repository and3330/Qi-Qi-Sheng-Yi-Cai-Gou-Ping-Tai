import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetErpProjectQueryKey, getListErpProjectsQueryKey, useCreateErpProject, useCreateErpProjectTask,
  useGetErpProject, useListErpProjectMembers, useListErpProjects, useUpdateErpProject,
  useUpdateErpProjectStatus, useUpdateErpProjectTask, useUpdateErpProjectTaskStatus,
  type ErpProject, type ErpProjectTask,
} from '@workspace/api-client-react';
import { FolderKanban, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

const projectStatuses = ['planning', 'active', 'on_hold', 'completed', 'cancelled'] as const;
const taskStatuses = ['todo', 'in_progress', 'review', 'done', 'cancelled'] as const;

export default function ProjectsPage() {
  const { data } = useListErpProjects();
  const [editing, setEditing] = useState<ErpProject | null | undefined>();
  const [detailId, setDetailId] = useState<number>();
  return <div className="space-y-6">
    <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-xl font-bold"><FolderKanban className="text-primary" />專案</h2><Button onClick={() => setEditing(null)}><Plus className="mr-1 h-4 w-4" />新增專案</Button></div>
    <Card><Table><TableHeader><TableRow><TableHead>專案編號</TableHead><TableHead>名稱</TableHead><TableHead>期間</TableHead><TableHead>預算</TableHead><TableHead>狀態</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>{data?.map(project => <TableRow key={project.id}><TableCell>{project.projectNo}</TableCell><TableCell className="font-medium">{project.name}</TableCell><TableCell>{project.startDate || '—'}～{project.endDate || '—'}</TableCell><TableCell>{project.budget == null ? '—' : `NT$ ${project.budget.toLocaleString()}`}</TableCell><TableCell>{project.status}</TableCell><TableCell className="space-x-2"><Button size="sm" variant="outline" onClick={() => setEditing(project)}>編輯</Button><Button size="sm" onClick={() => setDetailId(project.id)}>任務</Button></TableCell></TableRow>)}</TableBody>
    </Table></Card>
    {editing !== undefined && <ProjectEditor item={editing} close={() => setEditing(undefined)} />}
    {detailId !== undefined && <ProjectDetail id={detailId} close={() => setDetailId(undefined)} />}
  </div>;
}

function ProjectEditor({ item, close }: { item: ErpProject | null; close: () => void }) {
  const [name, setName] = useState(item?.name || ''); const [description, setDescription] = useState(item?.description || '');
  const [startDate, setStartDate] = useState(item?.startDate || ''); const [endDate, setEndDate] = useState(item?.endDate || '');
  const [budget, setBudget] = useState(item?.budget == null ? '' : String(item.budget));
  const [managerId, setManagerId] = useState(item?.managerId ? String(item.managerId) : 'none');
  const { data: members } = useListErpProjectMembers(); const qc = useQueryClient(); const { toast } = useToast();
  const done = () => { qc.invalidateQueries({ queryKey: getListErpProjectsQueryKey() }); toast({ title: '專案已儲存' }); close(); };
  const create = useCreateErpProject({ mutation: { onSuccess: done, onError: () => toast({ title: '儲存失敗', variant: 'destructive' }) } });
  const update = useUpdateErpProject({ mutation: { onSuccess: done, onError: () => toast({ title: '儲存失敗', variant: 'destructive' }) } });
  const save = () => {
    const data: any = { name, description: description || null, startDate: startDate || null, endDate: endDate || null, budget: budget ? Number(budget) : null, managerId: managerId === 'none' ? null : Number(managerId) };
    item ? update.mutate({ id: item.id, data }) : create.mutate({ data });
  };
  return <Dialog open onOpenChange={v => !v && close()}><DialogContent><DialogHeader><DialogTitle>{item ? '編輯專案' : '新增專案'}</DialogTitle></DialogHeader>
    <Label>專案名稱</Label><Input value={name} onChange={e => setName(e.target.value)} />
    <div className="grid grid-cols-2 gap-3"><div><Label>開始日期</Label><Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></div><div><Label>結束日期</Label><Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></div></div>
    <Label>專案經理</Label><Select value={managerId} onValueChange={setManagerId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">未指定</SelectItem>{members?.map(m => <SelectItem value={String(m.id)} key={m.id}>{m.name || m.username}</SelectItem>)}</SelectContent></Select>
    <Label>預算（NT$）</Label><Input type="number" min="0" step="1" value={budget} onChange={e => setBudget(e.target.value)} />
    <Label>說明</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} />
    <DialogFooter><Button disabled={!name.trim()} onClick={save}>儲存</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function ProjectDetail({ id, close }: { id: number; close: () => void }) {
  const { data } = useGetErpProject(id); const { data: members } = useListErpProjectMembers();
  const [task, setTask] = useState<ErpProjectTask | null | undefined>();
  const qc = useQueryClient(); const status = useUpdateErpProjectStatus({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetErpProjectQueryKey(id) }); qc.invalidateQueries({ queryKey: getListErpProjectsQueryKey() }); } } });
  return <Dialog open onOpenChange={v => !v && close()}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>{data?.projectNo} {data?.name}</DialogTitle></DialogHeader>
    {data && <><div className="flex flex-wrap items-center gap-3"><Select value={data.status} onValueChange={(value: any) => status.mutate({ id, data: { status: value } })}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>{projectStatuses.map(x => <SelectItem value={x} key={x}>{x}</SelectItem>)}</SelectContent></Select><span>總工時：<b>{data.totalHours}</b> 小時</span>{taskStatuses.map(x => <span className="rounded bg-muted px-2 py-1 text-xs" key={x}>{x}: {data.taskStats[x]}</span>)}</div>
      <div className="flex justify-end"><Button size="sm" onClick={() => setTask(null)}><Plus className="mr-1 h-4 w-4" />新增任務</Button></div>
      <Table><TableHeader><TableRow><TableHead>任務</TableHead><TableHead>指派</TableHead><TableHead>期限</TableHead><TableHead>優先度</TableHead><TableHead>狀態</TableHead><TableHead /></TableRow></TableHeader><TableBody>{data.tasks.map(t => <TaskRow key={t.id} task={t} members={members || []} refresh={() => qc.invalidateQueries({ queryKey: getGetErpProjectQueryKey(id) })} edit={() => setTask(t)} />)}</TableBody></Table>
    </>}
    {task !== undefined && <TaskEditor projectId={id} item={task} close={() => setTask(undefined)} />}
  </DialogContent></Dialog>;
}

function TaskRow({ task, members, refresh, edit }: { task: ErpProjectTask; members: { id: number; name: string; username: string }[]; refresh: () => void; edit: () => void }) {
  const mutation = useUpdateErpProjectTaskStatus({ mutation: { onSuccess: refresh } });
  return <TableRow><TableCell>{task.title}</TableCell><TableCell>{members.find(m => m.id === task.assigneeId)?.name || '未指派'}</TableCell><TableCell>{task.dueDate || '—'}</TableCell><TableCell>{task.priority}</TableCell><TableCell><Select value={task.status} onValueChange={(value: any) => mutation.mutate({ id: task.id, data: { status: value } })}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent>{taskStatuses.map(x => <SelectItem value={x} key={x}>{x}</SelectItem>)}</SelectContent></Select></TableCell><TableCell><Button size="sm" variant="outline" onClick={edit}>編輯</Button></TableCell></TableRow>;
}

function TaskEditor({ projectId, item, close }: { projectId: number; item: ErpProjectTask | null; close: () => void }) {
  const [title, setTitle] = useState(item?.title || ''); const [description, setDescription] = useState(item?.description || '');
  const [priority, setPriority] = useState<any>(item?.priority || 'medium'); const [dueDate, setDueDate] = useState(item?.dueDate || '');
  const [assigneeId, setAssigneeId] = useState(item?.assigneeId ? String(item.assigneeId) : 'none'); const { data: members } = useListErpProjectMembers();
  const qc = useQueryClient(); const done = () => { qc.invalidateQueries({ queryKey: getGetErpProjectQueryKey(projectId) }); close(); };
  const create = useCreateErpProjectTask({ mutation: { onSuccess: done } }); const update = useUpdateErpProjectTask({ mutation: { onSuccess: done } });
  const save = () => { const data: any = { projectId, title, description: description || null, priority, dueDate: dueDate || null, assigneeId: assigneeId === 'none' ? null : Number(assigneeId) }; item ? update.mutate({ id: item.id, data }) : create.mutate({ data }); };
  return <Dialog open onOpenChange={v => !v && close()}><DialogContent><DialogHeader><DialogTitle>{item ? '編輯任務' : '新增任務'}</DialogTitle></DialogHeader><Label>任務名稱</Label><Input value={title} onChange={e => setTitle(e.target.value)} /><Label>說明</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} /><div className="grid grid-cols-2 gap-3"><div><Label>優先度</Label><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['low', 'medium', 'high', 'urgent'].map(x => <SelectItem value={x} key={x}>{x}</SelectItem>)}</SelectContent></Select></div><div><Label>期限</Label><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div></div><Label>指派人員</Label><Select value={assigneeId} onValueChange={setAssigneeId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">未指派</SelectItem>{members?.map(m => <SelectItem value={String(m.id)} key={m.id}>{m.name || m.username}</SelectItem>)}</SelectContent></Select><DialogFooter><Button disabled={!title.trim()} onClick={save}>儲存</Button></DialogFooter></DialogContent></Dialog>;
}