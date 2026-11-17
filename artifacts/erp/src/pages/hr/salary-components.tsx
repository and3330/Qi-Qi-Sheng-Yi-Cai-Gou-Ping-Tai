import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { call, money, post, selectClass } from "@/lib/call";

interface Component { id: number; name: string; kind: "earning" | "deduction"; defaultAmount: number; insurable: boolean; isActive: boolean; sortOrder: number; note: string | null; employeeCount: number }
interface StructureItem { componentId: number; name: string; kind: string; amount: number; isActive: boolean }
interface EmployeeStructure { id: number; employeeCode: string; name: string; baseSalary: number; items: StructureItem[]; earnings: number; deductions: number }

const emptyForm = { id: 0, name: "", kind: "earning", defaultAmount: "", insurable: true, isActive: true, note: "" };

export default function SalaryComponentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"components" | "employees">("components");
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [editing, setEditing] = useState<EmployeeStructure | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [assigning, setAssigning] = useState<Component | null>(null);
  const [assignAmount, setAssignAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: components, isLoading } = useQuery({ queryKey: ["/salary-components"], queryFn: () => call<Component[]>("salary-components") });
  const { data: employees, isLoading: employeesLoading } = useQuery({ queryKey: ["/salary-components/employees"], queryFn: () => call<EmployeeStructure[]>("salary-components/employees") });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/salary-components"] });
    queryClient.invalidateQueries({ queryKey: ["/salary-components/employees"] });
  };
  const run = async (action: () => Promise<unknown>, done: string) => {
    setSaving(true);
    try { await action(); toast({ title: done }); refresh(); return true; }
    catch (error) { toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" }); return false; }
    finally { setSaving(false); }
  };

  const saveComponent = async () => {
    if (!form) return;
    const body = { name: form.name, kind: form.kind, defaultAmount: Number(form.defaultAmount) || 0, insurable: form.insurable, isActive: form.isActive, note: form.note };
    if (await run(() => form.id ? post(`salary-components/${form.id}`, body, "PUT") : post("salary-components", body), form.id ? "已更新" : "已新增薪資項目")) setForm(null);
  };
  const removeComponent = (c: Component) => {
    if (!confirm(`確定刪除「${c.name}」？`)) return;
    run(() => call(`salary-components/${c.id}`, { method: "DELETE" }), "已刪除");
  };
  const openStructure = (emp: EmployeeStructure) => {
    setEditing(emp);
    setAmounts(Object.fromEntries(emp.items.map(i => [i.componentId, String(i.amount)])));
  };
  const saveStructure = async () => {
    if (!editing) return;
    const items = Object.entries(amounts).filter(([, value]) => value !== "" && Number(value) > 0).map(([componentId, value]) => ({ componentId: Number(componentId), amount: Math.round(Number(value)) }));
    if (await run(() => post(`salary-components/employees/${editing.id}`, { items }, "PUT"), "已儲存薪資結構")) setEditing(null);
  };
  const assignAll = async () => {
    if (!assigning) return;
    if (await run(() => post(`salary-components/${assigning.id}/assign`, { amount: assignAmount === "" ? undefined : Math.round(Number(assignAmount)) }), "已套用到全部在職員工")) setAssigning(null);
  };

  const active = (components || []).filter(c => c.isActive);

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="薪資項目" description="設定每個月固定的津貼、加給與扣款，薪資計算時自動帶入每位員工的薪資單"
        action={<Button onClick={() => setForm(emptyForm)}><Plus className="h-4 w-4 mr-1" />新增項目</Button>} />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={tab === "components" ? "default" : "outline"} onClick={() => setTab("components")}>薪資項目</Button>
        <Button size="sm" variant={tab === "employees" ? "default" : "outline"} onClick={() => setTab("employees")}>員工薪資結構</Button>
      </div>

      {tab === "components" ? (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <DataTable
              isLoading={isLoading}
              data={components}
              emptyMessage="還沒有薪資項目。先新增「伙食津貼」「交通津貼」這類每月固定的項目"
              columns={[
                { header: "項目", accessor: (c: Component) => <div><span className="font-medium">{c.name}</span>{c.note && <span className="block text-xs text-muted-foreground">{c.note}</span>}</div> },
                { header: "類型", accessor: (c: Component) => <Badge variant={c.kind === "earning" ? "default" : "secondary"}>{c.kind === "earning" ? "加項" : "減項"}</Badge> },
                { header: "預設金額", accessor: (c: Component) => money(c.defaultAmount) },
                { header: "列入投保薪資", accessor: (c: Component) => c.kind === "deduction" ? "—" : c.insurable ? "是" : "否", className: "hidden md:table-cell" },
                { header: "使用人數", accessor: (c: Component) => `${c.employeeCount} 人` },
                { header: "狀態", accessor: (c: Component) => c.isActive ? "使用中" : <span className="text-muted-foreground">已停用</span> },
                {
                  header: "操作",
                  accessor: (c: Component) => (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-8" onClick={() => { setAssigning(c); setAssignAmount(String(c.defaultAmount)); }} disabled={!c.isActive}><Users className="h-3.5 w-3.5 mr-1" />套用全員</Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`編輯 ${c.name}`} onClick={() => setForm({ id: c.id, name: c.name, kind: c.kind, defaultAmount: String(c.defaultAmount), insurable: c.insurable, isActive: c.isActive, note: c.note || "" })}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" aria-label={`刪除 ${c.name}`} onClick={() => removeComponent(c)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <DataTable
              isLoading={employeesLoading}
              data={employees}
              emptyMessage="沒有在職員工"
              columns={[
                { header: "員工", accessor: (e: EmployeeStructure) => <div><span className="font-medium">{e.name}</span><span className="ml-2 text-xs text-muted-foreground">{e.employeeCode}</span></div> },
                { header: "本薪", accessor: (e: EmployeeStructure) => money(e.baseSalary) },
                { header: "固定項目", accessor: (e: EmployeeStructure) => e.items.length === 0 ? <span className="text-muted-foreground">尚未設定</span> : <span className="text-sm">{e.items.filter(i => i.isActive).map(i => `${i.name} ${i.kind === "deduction" ? "-" : ""}${money(i.amount)}`).join("、") || "—"}</span> },
                { header: "每月固定應發", accessor: (e: EmployeeStructure) => <span className="font-semibold">{money(e.baseSalary + e.earnings)}</span> },
                { header: "固定扣款", accessor: (e: EmployeeStructure) => e.deductions > 0 ? money(e.deductions) : "—", className: "hidden md:table-cell" },
                { header: "操作", accessor: (e: EmployeeStructure) => <Button size="sm" variant="outline" className="h-8" onClick={() => openStructure(e)}><Pencil className="h-3.5 w-3.5 mr-1" />設定</Button> },
              ]}
            />
          </CardContent>
        </Card>
      )}

      <Dialog open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }}>
        <DialogContent className="md:max-w-md max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form?.id ? "編輯薪資項目" : "新增薪資項目"}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="space-y-1.5"><Label htmlFor="sc-name">項目名稱 *</Label><Input id="sc-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：伙食津貼" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sc-kind">類型</Label>
                  <select id="sc-kind" className={selectClass} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
                    <option value="earning">加項（津貼、加給）</option>
                    <option value="deduction">減項（扣款）</option>
                  </select>
                </div>
                <div className="space-y-1.5"><Label htmlFor="sc-amount">預設金額</Label><Input id="sc-amount" type="number" inputMode="numeric" value={form.defaultAmount} onChange={e => setForm({ ...form, defaultAmount: e.target.value })} /></div>
              </div>
              {form.kind === "earning" && (
                <label className="flex items-start gap-3 text-sm">
                  <Switch checked={form.insurable} onCheckedChange={v => setForm({ ...form, insurable: v })} />
                  <span>列入投保薪資<span className="block text-xs text-muted-foreground">伙食津貼這類不算進勞健保投保薪資的項目請關掉。哪些項目要列入，請依會計師或勞保局的認定。</span></span>
                </label>
              )}
              <label className="flex items-center gap-3 text-sm"><Switch checked={form.isActive} onCheckedChange={v => setForm({ ...form, isActive: v })} />使用中（停用後不會再帶入薪資單）</label>
              <div className="space-y-1.5"><Label htmlFor="sc-note">說明</Label><Input id="sc-note" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>取消</Button>
            <Button onClick={saveComponent} disabled={saving || !form?.name.trim()}>{saving ? "處理中…" : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="md:max-w-md max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.name} 的薪資結構</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">本薪 {money(editing.baseSalary)}（在員工資料修改）。下面填每個月固定的金額，留空或填 0 表示沒有這個項目。</p>
              {active.length === 0 && <p className="text-sm text-amber-600 dark:text-amber-400">還沒有使用中的薪資項目，請先到「薪資項目」新增。</p>}
              {active.map(c => (
                <div key={c.id} className="flex items-center gap-3">
                  <Label htmlFor={`amt-${c.id}`} className="flex-1">{c.name}<span className="ml-2 text-xs text-muted-foreground">{c.kind === "earning" ? "加項" : "減項"}</span></Label>
                  <Input id={`amt-${c.id}`} type="number" inputMode="numeric" className="w-32 text-right" value={amounts[c.id] ?? ""} placeholder="0" onChange={e => setAmounts({ ...amounts, [c.id]: e.target.value })} />
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={saveStructure} disabled={saving}>{saving ? "處理中…" : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assigning} onOpenChange={(o) => { if (!o) setAssigning(null); }}>
        <DialogContent className="md:max-w-sm">
          <DialogHeader><DialogTitle>把「{assigning?.name}」套用到全部在職員工</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="assign-amount">每人每月金額</Label>
            <Input id="assign-amount" type="number" inputMode="numeric" value={assignAmount} onChange={e => setAssignAmount(e.target.value)} />
            <p className="text-xs text-muted-foreground">已經有這個項目的員工，金額會改成這裡填的數字。之後可以到「員工薪資結構」個別調整。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssigning(null)}>取消</Button>
            <Button onClick={assignAll} disabled={saving}>{saving ? "處理中…" : "套用"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
