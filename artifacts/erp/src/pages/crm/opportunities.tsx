import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListErpOpportunitiesQueryKey, useCreateErpOpportunity, useListErpOpportunities, useUpdateErpOpportunity, type ErpOpportunity } from '@workspace/api-client-react';
import { BriefcaseBusiness, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button'; import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input'; import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
const stages = ['prospecting','proposal','negotiation','won','lost'];
export default function OpportunitiesPage() {
  const [filter,setFilter]=useState('all'); const [edit,setEdit]=useState<ErpOpportunity|null|undefined>();
  const {data}=useListErpOpportunities({stage:filter==='all'?undefined:filter});
  return <div className="space-y-6"><div className="flex justify-between"><h2 className="flex gap-2 text-xl font-bold"><BriefcaseBusiness className="text-primary"/>商機</h2><Button onClick={()=>setEdit(null)}><Plus className="mr-1 h-4 w-4"/>新增</Button></div>
    <Select value={filter} onValueChange={setFilter}><SelectTrigger className="w-44"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">全部階段</SelectItem>{stages.map(x=><SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select>
    <Card><Table><TableHeader><TableRow><TableHead>商機</TableHead><TableHead>階段</TableHead><TableHead>預估金額</TableHead><TableHead>機率</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{data?.map(x=><TableRow key={x.id}><TableCell>{x.name}</TableCell><TableCell>{x.stage}</TableCell><TableCell>NT$ {x.expectedAmount.toLocaleString()}</TableCell><TableCell>{x.probability}%</TableCell><TableCell><Button size="sm" variant="outline" onClick={()=>setEdit(x)}>編輯</Button></TableCell></TableRow>)}</TableBody></Table></Card>
    {edit!==undefined&&<Editor item={edit} close={()=>setEdit(undefined)}/>}</div>;
}
function Editor({item,close}:{item:ErpOpportunity|null;close:()=>void}) {
  const [name,setName]=useState(item?.name||''); const [stage,setStage]=useState<string>(item?.stage||'prospecting');
  const [amount,setAmount]=useState(String(item?.expectedAmount||0)); const [prob,setProb]=useState(String(item?.probability||0));
  const qc=useQueryClient(); const done=()=>{qc.invalidateQueries({queryKey:getListErpOpportunitiesQueryKey()});close()};
  const create=useCreateErpOpportunity({mutation:{onSuccess:done}}); const update=useUpdateErpOpportunity({mutation:{onSuccess:done}});
  const save=()=>{const data:any={name,stage,expectedAmount:+amount,probability:+prob};item?update.mutate({id:item.id,data}):create.mutate({data})};
  return <Dialog open onOpenChange={v=>!v&&close()}><DialogContent><DialogHeader><DialogTitle>商機資料</DialogTitle></DialogHeader>
    <Label>名稱</Label><Input value={name} onChange={e=>setName(e.target.value)}/><Label>階段</Label><Select value={stage} onValueChange={setStage}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{stages.map(x=><SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select>
    <Label>預估金額</Label><Input type="number" value={amount} onChange={e=>setAmount(e.target.value)}/><Label>機率（0–100）</Label><Input type="number" value={prob} onChange={e=>setProb(e.target.value)}/>
    <DialogFooter><Button disabled={!name||+prob<0||+prob>100} onClick={save}>儲存</Button></DialogFooter></DialogContent></Dialog>;
}