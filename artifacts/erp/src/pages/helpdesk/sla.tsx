import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = <T,>(path: string, opts?: RequestInit) =>
  fetch(`/erp-api${path}`, { headers: { "Content-Type": "application/json" }, ...opts })
    .then(r => { if (!r.ok) throw new Error("請求失敗"); return r.status === 204 ? (undefined as T) : r.json() as Promise<T>; });

interface SlaDef { id: number; name: string; priority: string; responseTimeHours: number; resolutionTimeHours: number; description: string | null; }
interface Category { id: number; name: string; description: string | null; parentId: number | null; }

const priorityLabel: Record<string, string> = { Low: "低", Medium: "中", High: "高", Critical: "緊急" };
const priorities = ["Low", "Medium", "High", "Critical"];

export default function SlaPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("sla");
  const [slaOpen, setSlaOpen] = useState(false);
  const [editingSla, setEditingSla] = useState<SlaDef | null>(null);
  const [slaForm, setSlaForm] = useState({ name: "", priority: "Medium", responseTimeHours: "4", resolutionTimeHours: "24", description: "" });
  const [catOpen, setCatOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [catForm, setCatForm] = useState({ name: "", description: "" });

  const { data: slas = [] } = useQuery<SlaDef[]>({ queryKey: ["sla-definitions"], queryFn: () => api("/sla-definitions") });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["ticket-categories"], queryFn: () => api("/ticket-categories") });
  const batch = useBatchSelection(slas);

  const slaMut = useMutation({
    mutationFn: (data: any) => editingSla ? api(`/sla-definitions/${editingSla.id}`, { method: "PATCH", body: JSON.stringify(data) }) : api("/sla-definitions", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sla-definitions"] }); setSlaOpen(false); setEditingSla(null); toast({ title: "已儲存" }); },
  });
  const deleteSla = useMutation({
    mutationFn: (id: number) => api(`/sla-definitions/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sla-definitions"] }); toast({ title: "已刪除" }); },
  });
  const catMut = useMutation({
    mutationFn: (data: any) => editingCat ? api(`/ticket-categories/${editingCat.id}`, { method: "PATCH", body: JSON.stringify(data) }) : api("/ticket-categories", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ticket-categories"] }); setCatOpen(false); setEditingCat(null); toast({ title: "已儲存" }); },
  });
  const deleteCat = useMutation({
    mutationFn: (id: number) => api(`/ticket-categories/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ticket-categories"] }); toast({ title: "已刪除" }); },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">SLA 與分類設定</h1>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="sla">SLA 定義</TabsTrigger><TabsTrigger value="categories">工單分類</TabsTrigger></TabsList>
        <TabsContent value="sla" className="space-y-4">
          {batch.count > 0 && (
            <BatchActionBar
              count={batch.count}
              entityName="SLA"
              entityEndpoint="sla"
              ids={batch.ids}
              onClear={batch.clearSelection}
              onComplete={() => qc.invalidateQueries({ queryKey: ["sla-definitions"] })}
            />
          )}
          <div className="flex justify-end">
            <Button onClick={() => { setEditingSla(null); setSlaForm({ name: "", priority: "Medium", responseTimeHours: "4", resolutionTimeHours: "24", description: "" }); setSlaOpen(true); }}><Plus className="w-4 h-4 mr-1" />新增 SLA</Button>
          </div>
          <Card><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-10"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></TableHead>
                <TableHead>名稱</TableHead><TableHead>優先序</TableHead><TableHead>回應時間 (小時)</TableHead>
                <TableHead>解決時間 (小時)</TableHead><TableHead>說明</TableHead><TableHead className="w-20">操作</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {slas.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">尚無定義</TableCell></TableRow>}
                {slas.map(s => (
                  <TableRow key={s.id}>
                    <TableCell><CheckboxCell checked={batch.selectedIds.has(s.id)} onChange={() => batch.toggle(s.id)} /></TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{priorityLabel[s.priority] || s.priority}</TableCell>
                    <TableCell>{s.responseTimeHours}</TableCell>
                    <TableCell>{s.resolutionTimeHours}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.description || "-"}</TableCell>
                    <TableCell><div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setEditingSla(s); setSlaForm({ name: s.name, priority: s.priority, responseTimeHours: String(s.responseTimeHours), resolutionTimeHours: String(s.resolutionTimeHours), description: s.description || "" }); setSlaOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm("確定刪除？")) deleteSla.mutate(s.id); }}><Trash2 className="w-4 h-4" /></Button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="categories" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditingCat(null); setCatForm({ name: "", description: "" }); setCatOpen(true); }}><Plus className="w-4 h-4 mr-1" />新增分類</Button>
          </div>
          <Card><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>名稱</TableHead><TableHead>說明</TableHead><TableHead className="w-20">操作</TableHead></TableRow></TableHeader>
              <TableBody>
                {categories.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">尚無分類</TableCell></TableRow>}
                {categories.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.description || "-"}</TableCell>
                    <TableCell><div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setEditingCat(c); setCatForm({ name: c.name, description: c.description || "" }); setCatOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm("確定刪除？")) deleteCat.mutate(c.id); }}><Trash2 className="w-4 h-4" /></Button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={slaOpen} onOpenChange={setSlaOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingSla ? "編輯 SLA" : "新增 SLA"}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div><label className="text-sm font-medium">名稱 *</label><Input value={slaForm.name} onChange={e => setSlaForm({ ...slaForm, name: e.target.value })} /></div>
            <div>
              <label className="text-sm font-medium">優先序</label>
              <Select value={slaForm.priority} onValueChange={v => setSlaForm({ ...slaForm, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{priorities.map(p => <SelectItem key={p} value={p}>{priorityLabel[p]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="text-sm font-medium">回應時間 (小時)</label><Input type="number" value={slaForm.responseTimeHours} onChange={e => setSlaForm({ ...slaForm, responseTimeHours: e.target.value })} /></div>
              <div><label className="text-sm font-medium">解決時間 (小時)</label><Input type="number" value={slaForm.resolutionTimeHours} onChange={e => setSlaForm({ ...slaForm, resolutionTimeHours: e.target.value })} /></div>
            </div>
            <div><label className="text-sm font-medium">說明</label><Input value={slaForm.description} onChange={e => setSlaForm({ ...slaForm, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSlaOpen(false)}>取消</Button>
            <Button onClick={() => slaMut.mutate({ ...slaForm, responseTimeHours: Number(slaForm.responseTimeHours), resolutionTimeHours: Number(slaForm.resolutionTimeHours), description: slaForm.description || null })} disabled={!slaForm.name}>{editingSla ? "更新" : "建立"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingCat ? "編輯分類" : "新增分類"}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div><label className="text-sm font-medium">名稱 *</label><Input value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} /></div>
            <div><label className="text-sm font-medium">說明</label><Input value={catForm.description} onChange={e => setCatForm({ ...catForm, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatOpen(false)}>取消</Button>
            <Button onClick={() => catMut.mutate({ ...catForm, description: catForm.description || null })} disabled={!catForm.name}>{editingCat ? "更新" : "建立"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
