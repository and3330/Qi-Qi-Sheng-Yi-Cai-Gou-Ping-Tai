import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;

interface WorkflowOptions { roles: Array<{ value: string; label: string }>; documents: Array<{ module: string; documentType: string; label: string; when: string }> }
interface AppUser { username: string; displayName: string | null; role: string; isActive?: boolean; employeeName?: string | null }
const emptyStep ={ stepNumber: 1, approverRole: "", approverName: "", note: "" };

export default function ApprovalWorkflows() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", module: "Accounting", documentType: "PaymentRequest", description: "", isActive: "Yes", steps: [{ ...emptyStep }] });
  // 可以選的角色、哪些單據會走審批，都由後端提供（只有這幾種單據真的會送審批）
  const { data: options } = useQuery<WorkflowOptions>({ queryKey: ["approval-workflows", "options"], queryFn: () => fetch(api("approval-workflows/options")).then(r => r.json()) });
  const roleLabel = (value: string) => options?.roles.find(r => r.value === value)?.label || "";
  const docLabel = (wf: { module: string; documentType: string }) => options?.documents.find(d => d.module === wf.module && d.documentType === wf.documentType)?.label || `${wf.documentType}（這種單據目前不會送審批）`;
  // 能指定的人：有登入帳號、啟用中、角色可以審批的員工
  const { data: users = [] } = useQuery<AppUser[]>({ queryKey: ["admin-users"], queryFn: () => fetch(api("admin/users")).then(r => r.ok ? r.json() : []) });
  // 後端允許審批的角色：清單裡的審批角色，再加上超級管理員
  const approverUsers = users.filter(u => u.isActive !== false && (u.role === "super_admin" || (options?.roles ?? []).some(r => r.value === u.role)));
  const findUser = (name: string) => name ? users.find(u => u.username === name) || users.find(u => u.displayName === name || u.employeeName === name) : undefined;
  const userLabel = (u: AppUser) => `${u.employeeName || u.displayName || u.username}（${roleLabel(u.role) || (u.role === "super_admin" ? "超級管理員" : u.role)}）`;
  const stepText = (s: any) => { const u = findUser(s?.approverName); return (u ? (u.employeeName || u.displayName || u.username) : s?.approverName) || roleLabel(s?.approverRole) || "任何主管"; };

  const { data: workflows = [] } = useQuery({ queryKey: ["approval-workflows"], queryFn: () => fetch(api("approval-workflows")).then(r => r.json()) });
  const batch = useBatchSelection(workflows);

  const saveMutation = useMutation({
    mutationFn: (data: any) => {
      const url = editing ? api(`approval-workflows/${editing.id}`) : api("approval-workflows");
      return fetch(url, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json());
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["approval-workflows"] }); setOpen(false); toast({ title: editing ? "已更新" : "已建立" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetch(api(`approval-workflows/${id}`), { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["approval-workflows"] }); toast({ title: "已刪除" }); },
  });

  const openCreate = () => { setEditing(null); setForm({ name: "", module: "Accounting", documentType: "PaymentRequest", description: "", isActive: "Yes", steps: [{ ...emptyStep }] }); setOpen(true); };
  const openEdit = (wf: any) => { setEditing(wf); setForm({ name: wf.name, module: wf.module, documentType: wf.documentType, description: wf.description || "", isActive: wf.isActive, steps: Array.isArray(wf.steps) && wf.steps.length > 0 ? wf.steps.map((s: any) => ({ ...emptyStep, ...s, note: s.note ?? "" })) : [{ ...emptyStep }] }); setOpen(true); };

  const addStep = () => setForm(f => ({ ...f, steps: [...f.steps, { ...emptyStep, stepNumber: f.steps.length + 1 }] }));
  const removeStep = (i: number) => setForm(f => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, stepNumber: idx + 1 })) }));
  const updateStep = (i: number, field: string, val: string) => setForm(f => ({ ...f, steps: f.steps.map((s, idx) => idx === i ? { ...s, [field]: val } : s) }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">審批流程</h1>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />新增流程</Button>
      </div>

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="審批流程"
          entityEndpoint="approval-workflows"
          ids={batch.ids}
          batchFields={[]}
          onClear={batch.clearSelection}
          onComplete={() => qc.invalidateQueries({ queryKey: ["approval-workflows"] })}
        />
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></TableHead>
                <TableHead>名稱</TableHead>
                <TableHead>套用在哪種單據</TableHead>
                <TableHead>審批步驟</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workflows.map((wf: any) => (
                <TableRow key={wf.id}>
                  <TableCell><CheckboxCell checked={batch.selectedIds.has(wf.id)} onChange={() => batch.toggle(wf.id)} /></TableCell>
                  <TableCell className="font-medium">{wf.name}</TableCell>
                  <TableCell>{docLabel(wf)}</TableCell>
                  <TableCell>{Array.isArray(wf.steps) && wf.steps.length > 0 ? wf.steps.map(stepText).join(" → ") : "—"}</TableCell>
                  <TableCell><Badge variant={wf.isActive === "Yes" ? "default" : "secondary"}>{wf.isActive === "Yes" ? "啟用" : "停用"}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(wf)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(wf.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {workflows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">尚無審批流程</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "編輯審批流程" : "新增審批流程"}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label>名稱</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><Label>狀態</Label><Select value={form.isActive} onValueChange={v => setForm(f => ({ ...f, isActive: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Yes">啟用</SelectItem><SelectItem value="No">停用</SelectItem></SelectContent></Select></div>
            </div>
            <div>
              <Label>套用在哪種單據</Label>
              <Select value={`${form.module}|${form.documentType}`} onValueChange={v => { const [module, documentType] = v.split("|"); setForm(f => ({ ...f, module, documentType })); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(options?.documents ?? []).map(d => <SelectItem key={d.documentType} value={`${d.module}|${d.documentType}`}>{d.label}</SelectItem>)}
                  {!(options?.documents ?? []).some(d => d.module === form.module && d.documentType === form.documentType) && <SelectItem value={`${form.module}|${form.documentType}`}>{form.documentType}（目前不會送審批）</SelectItem>}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{options?.documents.find(d => d.module === form.module && d.documentType === form.documentType)?.when || "這種單據目前不會送審批，流程設了也不會生效。"} 一種單據只會套用一個啟用中的流程。</p>
            </div>
            <div><Label>說明</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>

            <div>
              <div className="flex items-center justify-between mb-1"><Label>審批步驟</Label><Button type="button" variant="outline" size="sm" onClick={addStep}><Plus className="h-3 w-3 mr-1" />新增步驟</Button></div>
              <p className="mb-2 text-xs text-muted-foreground">單據會依序一關一關送審，全部核准才算通過。每一關選一個「角色」，有這個角色的人都可以審這一關（擁有者、管理員可以代審任何一關）。要限定某一個人，就在右邊選那位員工（只列出有登入帳號、而且角色可以審批的人）。</p>
              {form.steps.map((step, i) => (
                <div key={i} className="mb-2 flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <span className="w-14 text-sm text-muted-foreground">第 {step.stepNumber} 關</span>
                  <select className="h-10 min-w-[150px] flex-1 rounded-md border border-input bg-background px-3 text-sm" value={step.approverRole} onChange={e => updateStep(i, "approverRole", e.target.value)} aria-label={`第 ${step.stepNumber} 關由哪個角色審批`}>
                    <option value="">任何主管都可以</option>
                    {(options?.roles ?? []).map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    {step.approverRole && !(options?.roles ?? []).some(r => r.value === step.approverRole) && <option value={step.approverRole}>{step.approverRole}（舊設定，請重選）</option>}
                  </select>
                  {(() => {
                    // 存登入帳號：審批權限和通知都是用帳號比對
                    const picked = findUser(step.approverName);
                    const value = picked ? picked.username : step.approverName;
                    return (
                      <select className="h-10 min-w-[150px] flex-1 rounded-md border border-input bg-background px-3 text-sm" value={value} onChange={e => updateStep(i, "approverName", e.target.value)} aria-label={`第 ${step.stepNumber} 關指定由誰審批`}>
                        <option value="">不指定人（有角色的人都能審）</option>
                        {approverUsers.map(u => <option key={u.username} value={u.username}>{userLabel(u)}</option>)}
                        {picked && !approverUsers.includes(picked) && <option value={picked.username}>{userLabel(picked)}（這個角色不能審批，請重選）</option>}
                        {value && !picked && <option value={value}>{value}（找不到這個帳號，請重選）</option>}
                      </select>
                    );
                  })()}
                  {form.steps.length > 1 && <Button variant="ghost" size="icon" onClick={() => removeStep(i)} aria-label="刪除這一關"><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => saveMutation.mutate(form)} disabled={!form.name}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
