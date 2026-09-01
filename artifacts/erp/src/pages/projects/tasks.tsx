import { useQueryClient } from '@tanstack/react-query';
import { getListErpProjectTasksQueryKey, useListErpProjectTasks, useUpdateErpProjectTaskStatus } from '@workspace/api-client-react';
import { ListChecks } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const params = { mine: true };
export default function MyTasksPage() {
  const { data } = useListErpProjectTasks(params); const qc = useQueryClient();
  const update = useUpdateErpProjectTaskStatus({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListErpProjectTasksQueryKey(params) }) } });
  return <div className="space-y-6"><h2 className="flex items-center gap-2 text-xl font-bold"><ListChecks className="text-primary" />我的任務</h2><Card><Table><TableHeader><TableRow><TableHead>專案</TableHead><TableHead>任務</TableHead><TableHead>優先度</TableHead><TableHead>期限</TableHead><TableHead>狀態</TableHead></TableRow></TableHeader><TableBody>{data?.map(task => <TableRow key={task.id}><TableCell>{task.projectName}</TableCell><TableCell className="font-medium">{task.title}</TableCell><TableCell>{task.priority}</TableCell><TableCell>{task.dueDate || '—'}</TableCell><TableCell><Select value={task.status} onValueChange={(status: any) => update.mutate({ id: task.id, data: { status } })}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>{['todo', 'in_progress', 'review', 'done', 'cancelled'].map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select></TableCell></TableRow>)}</TableBody></Table></Card></div>;
}