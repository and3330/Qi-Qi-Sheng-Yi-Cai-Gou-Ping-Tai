import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListErpComplaintsQueryKey, useConvertErpComplaintToTicket, useCreateErpComplaint, useListErpComplaints, useListErpCrmAssignees, useUpdateErpComplaint, type ErpComplaint } from '@workspace/api-client-react';
import { MessageSquareWarning, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button'; import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input'; import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'; import { Textarea } from '@/components/ui/textarea';
export default function ComplaintsPage() {
  const [edit,setEdit]=useState<ErpComplaint|null|undefined>(); const {data}=useListErpComplaints(); const qc=useQueryClient();
  const ticket=useConvertErpComplaintToTicket({mutation:{onSuccess:()=>qc.invalidateQueries({queryKey:getListErpComplaintsQueryKey()})}});
  return <div className="space-y-6"><div className="flex justify-between"><h2 className="flex gap-2 text-xl font-bold"><MessageSquareWarning className="text-primary"/>客訴</h2><Button onClick={()=>setEdit(null)}><Plus className="mr-1 h-4 w-4"/>新增</Button></div>
    <Card><Table><TableHeader><TableRow><TableHead>單號／主旨</TableHead><TableHead>分類</TableHead><TableHead>嚴重度</TableHead><TableHead>狀態</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{data?.map(x=><TableRow key={x.id}><TableCell><b>{x.complaintNo}</b><div>{x.subject}</div></TableCell><TableCell>{x.category}</TableCell><TableCell>{x.severity}</TableCell><TableCell>{x.status}</TableCell><TableCell className="space-x-2"><Button size="sm" variant="outline" onClick={()=>setEdit(x)}>處理</Button><Button size="sm" onClick={()=>ticket.mutate({id:x.id,data:{}})}>轉工單</Button></TableCell></TableRow>)}</TableBody></Table></Card>
    {edit!==undefined&&<Editor item={edit} close={()=>setEdit(undefined)}/>}</div>;
}
function Editor({item,close}:{item:ErpComplaint|null;close:()=>void}) {
  const [subject,setSubject]=useState(item?.subject||''); const [content,setContent]=useState(item?.content||'');
  const [category,setCategory]=useState<string>(item?.category||'other'); const [severity,setSeverity]=useState<string>(item?.severity||'medium');
  const [status,setStatus]=useState<string>(item?.status||'open'); const [resolution,setResolution]=useState(item?.resolution||'');
  const [assignee,setAssignee]=useState(item?.assigneeId?String(item.assigneeId):'none'); const {data:assignees}=useListErpCrmAssignees();
  const qc=useQueryClient(); const done=()=>{qc.invalidateQueries({queryKey:getListErpComplaintsQueryKey()});close()};
  const create=useCreateErpComplaint({mutation:{onSuccess:done}}); const update=useUpdateErpComplaint({mutation:{onSuccess:done}});
  const save=()=>{const data:any={subject,content,category,severity,status,resolution:resolution||null,assigneeId:assignee==='none'?null:+assignee};item?update.mutate({id:item.id,data}):create.mutate({data})};
  const select=(value:string,set:(v:string)=>void,options:string[]) => <Select value={value} onValueChange={set}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{options.map(x=><SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select>;
  return <Dialog open onOpenChange={v=>!v&&close()}><DialogContent><DialogHeader><DialogTitle>{item?'處理':'新增'}客訴</DialogTitle></DialogHeader>
    <Label>主旨</Label><Input value={subject} onChange={e=>setSubject(e.target.value)}/><Label>內容</Label><Textarea value={content} onChange={e=>setContent(e.target.value)}/>
    <div className="grid grid-cols-3 gap-2">{select(category,setCategory,['product','delivery','service','billing','other'])}{select(severity,setSeverity,['low','medium','high','urgent'])}{select(status,setStatus,['open','investigating','resolved','closed'])}</div>
    <Label>指派人員</Label><Select value={assignee} onValueChange={setAssignee}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="none">未指派</SelectItem>{assignees?.map(x=><SelectItem key={x.id} value={String(x.id)}>{x.name||x.username}</SelectItem>)}</SelectContent></Select>
    {['resolved','closed'].includes(status)&&<><Label>處理結果</Label><Textarea value={resolution} onChange={e=>setResolution(e.target.value)}/></>}
    <DialogFooter><Button disabled={!subject||!content||(['resolved','closed'].includes(status)&&!resolution)} onClick={save}>儲存</Button></DialogFooter></DialogContent></Dialog>;
}