import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetErpTicketQueryKey, getListErpTicketsQueryKey, useAddErpTicketComment, useCreateErpTicket, useGetErpTicket, useListErpCrmAssignees, useListErpTickets, useUpdateErpTicket, type ErpTicket } from '@workspace/api-client-react';
import { Plus, TicketCheck } from 'lucide-react';
import { Button } from '@/components/ui/button'; import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input'; import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'; import { Textarea } from '@/components/ui/textarea';
export default function TicketsPage() {
  const [selected,setSelected]=useState<ErpTicket|null|undefined>(); const {data}=useListErpTickets();
  return <div className="space-y-6"><div className="flex justify-between"><h2 className="flex gap-2 text-xl font-bold"><TicketCheck className="text-primary"/>工單</h2><Button onClick={()=>setSelected(null)}><Plus className="mr-1 h-4 w-4"/>新增</Button></div>
    <Card><Table><TableHeader><TableRow><TableHead>單號</TableHead><TableHead>標題</TableHead><TableHead>優先度</TableHead><TableHead>狀態</TableHead><TableHead/></TableRow></TableHeader><TableBody>{data?.map(x=><TableRow key={x.id}><TableCell>{x.ticketNo}</TableCell><TableCell>{x.title}</TableCell><TableCell>{x.priority}</TableCell><TableCell>{x.status}</TableCell><TableCell><Button size="sm" onClick={()=>setSelected(x)}>詳情</Button></TableCell></TableRow>)}</TableBody></Table></Card>
    {selected!==undefined&&<Editor item={selected} close={()=>setSelected(undefined)}/>}</div>;
}
function Editor({item,close}:{item:ErpTicket|null;close:()=>void}) {
  const [title,setTitle]=useState(item?.title||''); const [description,setDescription]=useState(item?.description||'');
  const [priority,setPriority]=useState<string>(item?.priority||'medium'); const [status,setStatus]=useState<string>(item?.status||'open'); const [comment,setComment]=useState('');
  const [assignee,setAssignee]=useState(item?.assigneeId ? String(item.assigneeId) : 'none'); const {data:assignees}=useListErpCrmAssignees();
  const qc=useQueryClient(); const ticketId=item?.id||0;
  const detail=useGetErpTicket(ticketId,{query:{queryKey:getGetErpTicketQueryKey(ticketId),enabled:!!item}});
  const done=()=>{qc.invalidateQueries({queryKey:getListErpTicketsQueryKey()});close()};
  const create=useCreateErpTicket({mutation:{onSuccess:done}}); const update=useUpdateErpTicket({mutation:{onSuccess:done}});
  const add=useAddErpTicketComment({mutation:{onSuccess:()=>{setComment('');qc.invalidateQueries({queryKey:getGetErpTicketQueryKey(ticketId)})}}});
  const save=()=>{const data:any={title,description,priority,status,assigneeId:assignee==='none'?null:+assignee};item?update.mutate({id:item.id,data}):create.mutate({data})};
  return <Dialog open onOpenChange={v=>!v&&close()}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{item?.ticketNo||'新增工單'}</DialogTitle></DialogHeader>
    <Label>標題</Label><Input value={title} onChange={e=>setTitle(e.target.value)}/><Label>說明</Label><Textarea value={description} onChange={e=>setDescription(e.target.value)}/>
    <div className="grid grid-cols-2 gap-2"><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{['low','medium','high','urgent'].map(x=><SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{['open','in_progress','pending','resolved','closed'].map(x=><SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select></div>
    <Label>指派人員</Label><Select value={assignee} onValueChange={setAssignee}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="none">未指派</SelectItem>{assignees?.map(x=><SelectItem key={x.id} value={String(x.id)}>{x.name||x.username}</SelectItem>)}</SelectContent></Select>
    {item&&<div className="space-y-2 border-t pt-3"><b>留言串</b>{detail.data?.comments.map(x=><div className="rounded bg-muted p-2" key={x.id}>{x.content}</div>)}<div className="flex gap-2"><Input value={comment} onChange={e=>setComment(e.target.value)}/><Button disabled={!comment.trim()} onClick={()=>add.mutate({id:item.id,data:{content:comment}})}>留言</Button></div></div>}
    <DialogFooter><Button disabled={!title||!description} onClick={save}>儲存</Button></DialogFooter></DialogContent></Dialog>;
}