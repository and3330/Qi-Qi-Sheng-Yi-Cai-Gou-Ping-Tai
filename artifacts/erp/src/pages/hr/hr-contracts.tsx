import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, Settings2, X } from "lucide-react";
import { AttachmentsPanel } from "@/components/shared/attachments-panel";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

/**
 * 人事合約：跟員工、老師、臨時人員簽的合約（新進人員合約、勞務合約、勞務報酬單、勞務表單、臨時工作合約）。
 * 每一列可以點開看內容與附件、可以編輯；勾選多筆可以一次改狀態、類型、日期。
 * 從員工頁帶 ?employeeId= 進來會只看那位員工；帶 ?new=1 會直接開新增（新人入職用）。
 */
type HrContract = {
  id: number; contractNumber: string; title: string; partyType: "Employee" | "Teacher" | "Person"; contractType: string | null;
  employeeId: number | null; teacherId: number | null; personName: string | null; partyName: string | null; employeeCode: string | null;
  status: string; signedDate: string | null; startDate: string | null; endDate: string | null;
  payBasis: string | null; payAmount: number | null; terms: string | null; description: string | null;
};
type Options = { contractTypes: { key: string; label: string; hint: string }[] };

const statusLabel: Record<string, string> = { Draft: "草稿", Active: "生效中", Expired: "已到期", Renewed: "已續約", Cancelled: "已取消" };
const statusClass: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-800", Active: "bg-green-100 text-green-800", Expired: "bg-red-100 text-red-800",
  Renewed: "bg-blue-100 text-blue-800", Cancelled: "bg-yellow-100 text-yellow-800",
};
const partyLabel: Record<string, string> = { Employee: "員工", Teacher: "老師", Person: "名單外" };
const payBasisLabel: Record<string, string> = { monthly: "月薪", hourly: "時薪", daily: "日薪", per_session: "每堂／每次", per_case: "按件", lump_sum: "一次給付" };
const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = {
  title: "", contractType: "onboarding", partyType: "Employee" as HrContract["partyType"], employeeId: "", teacherId: "", personName: "",
  status: "Draft", signedDate: "", startDate: "", endDate: "", payBasis: "", payAmount: "", terms: "", description: "",
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/erp-api${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err as any).error || `操作失敗（${res.status}）`); }
  return res.status === 204 ? (undefined as T) : res.json();
}

export default function HrContractsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const presetEmployee = params.get("employeeId") || "";
  const [employeeFilter, setEmployeeFilter] = useState(presetEmployee);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HrContract | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchField, setBatchField] = useState("");
  const [batchValue, setBatchValue] = useState("");

  const { data: contracts = [], isLoading } = useQuery<HrContract[]>({ queryKey: ["hr-contracts"], queryFn: () => call("/hr-contracts") });
  const { data: options } = useQuery<Options>({ queryKey: ["hr-contracts-options"], queryFn: () => call("/hr-contracts/options") });
  const { data: employees = [] } = useQuery<any[]>({ queryKey: ["hr-contracts-employees"], queryFn: () => call("/employees") });
  const { data: teachers = [] } = useQuery<any[]>({ queryKey: ["hr-contracts-teachers"], queryFn: () => call("/teachers") });
  const types = options?.contractTypes || [];
  const typeLabel = (key: string | null) => types.find(t => t.key === key)?.label || key || "-";
  const employeeName = (e: any) => e.fullName || `${e.firstName || ""}${e.lastName || ""}`;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contracts.filter(c => {
      if (employeeFilter && String(c.employeeId || "") !== employeeFilter) return false;
      if (typeFilter && c.contractType !== typeFilter) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      return !q || `${c.contractNumber} ${c.title} ${c.partyName || ""} ${c.employeeCode || ""}`.toLowerCase().includes(q);
    });
  }, [contracts, employeeFilter, typeFilter, statusFilter, search]);
  const batch = useBatchSelection(filtered);
  const filteredEmployee = employees.find((e: any) => String(e.id) === employeeFilter);
  const refresh = () => qc.invalidateQueries({ queryKey: ["hr-contracts"] });

  const openCreate = (preset?: Partial<typeof emptyForm>) => {
    setEditing(null);
    setForm({ ...emptyForm, signedDate: today(), startDate: today(), ...(employeeFilter ? { employeeId: employeeFilter } : {}), ...preset });
    setOpen(true);
  };
  const openEdit = (c: HrContract) => {
    setEditing(c);
    setForm({
      title: c.title, contractType: c.contractType || "other", partyType: c.partyType,
      employeeId: c.employeeId ? String(c.employeeId) : "", teacherId: c.teacherId ? String(c.teacherId) : "", personName: c.personName || "",
      status: c.status, signedDate: c.signedDate || "", startDate: c.startDate || "", endDate: c.endDate || "",
      payBasis: c.payBasis || "", payAmount: c.payAmount == null ? "" : String(c.payAmount), terms: c.terms || "", description: c.description || "",
    });
    setOpen(true);
  };

  // 新人入職：從員工頁帶 ?new=1&employeeId=&type= 進來，直接開新增
  useEffect(() => {
    if (params.get("new") !== "1" || !options) return;
    const type = params.get("type") || "onboarding";
    const emp = employees.find((e: any) => String(e.id) === presetEmployee);
    if (presetEmployee && !emp) return;
    openCreate({ contractType: type, employeeId: presetEmployee, title: emp ? `${employeeName(emp)} ${typeLabel(type)}` : "" });
    params.delete("new");
    window.history.replaceState(null, "", `${window.location.pathname}${presetEmployee ? `?employeeId=${presetEmployee}` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, employees]);

  const set = (key: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [key]: e.target.value }));

  // 選了對象與類型、名稱還沒填時，自動帶「某某 新進人員合約」
  const suggestTitle = (next: typeof emptyForm) => {
    const name = next.partyType === "Employee" ? (() => { const e = employees.find((x: any) => String(x.id) === next.employeeId); return e ? employeeName(e) : ""; })()
      : next.partyType === "Teacher" ? (teachers.find((x: any) => String(x.id) === next.teacherId)?.name || "") : next.personName;
    return name ? `${name} ${typeLabel(next.contractType)}` : "";
  };
  const update = (changes: Partial<typeof emptyForm>) => setForm(prev => {
    const next = { ...prev, ...changes };
    const auto = suggestTitle(prev);
    if (!editing && (!prev.title || prev.title === auto)) next.title = suggestTitle(next);
    return next;
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = { ...form, payAmount: form.payAmount === "" ? null : Number(form.payAmount) };
      if (editing) await call(`/hr-contracts/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else {
        const created = await call<HrContract>("/hr-contracts", { method: "POST", body: JSON.stringify(body) });
        // 建立後留在畫面上，可以接著上傳簽好的合約檔
        setEditing(created);
        toast({ title: "合約已建立", description: "可以在下方上傳簽好的合約檔" });
        refresh();
        return;
      }
      toast({ title: "合約已更新" });
      setOpen(false);
      refresh();
    } catch (err: any) {
      toast({ title: "儲存失敗", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleDelete = async (c: HrContract) => {
    if (!confirm(`確定刪除「${c.title}」？`)) return;
    try { await call(`/hr-contracts/${c.id}`, { method: "DELETE" }); toast({ title: "已刪除" }); refresh(); }
    catch (err: any) { toast({ title: "無法刪除", description: err.message, variant: "destructive" }); }
  };

  const handleBatch = async () => {
    try {
      const result = await call<{ updated: number }>("/hr-contracts/batch-update", { method: "POST", body: JSON.stringify({ ids: batch.ids, updates: { [batchField]: batchValue } }) });
      toast({ title: "批次更新完成", description: `已更新 ${result.updated} 份合約` });
      setBatchOpen(false); batch.clearSelection(); refresh();
    } catch (err: any) { toast({ title: "批次更新失敗", description: err.message, variant: "destructive" }); }
  };

  const currentType = types.find(t => t.key === form.contractType);
  const canSave = !!form.title.trim() && (form.partyType === "Employee" ? !!form.employeeId : form.partyType === "Teacher" ? !!form.teacherId : !!form.personName.trim());

  return (
    <div className="space-y-4">
      <PageHeader title="人事合約" description="員工、老師、臨時人員的合約：新進人員合約、勞務合約、勞務報酬單、勞務表單、臨時工作合約">
        <Button onClick={() => openCreate()}><Plus size={16} className="mr-1" />新增合約</Button>
      </PageHeader>

      {filteredEmployee && (
        <div className="flex items-center gap-2 rounded-lg border bg-primary/5 px-3 py-2 text-sm">
          <span>只顯示 <b>{employeeName(filteredEmployee)}</b> 的合約</span>
          <Button variant="ghost" size="sm" className="h-7" onClick={() => { setEmployeeFilter(""); window.history.replaceState(null, "", window.location.pathname); }}><X size={14} className="mr-1" />看全部</Button>
        </div>
      )}

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative md:w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="搜尋合約編號、名稱、姓名" value={search} onChange={e => setSearch(e.target.value)} aria-label="搜尋合約" />
        </div>
        <select className={`${selectClass} md:w-48`} value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="合約類型">
          <option value="">全部類型</option>
          {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select className={`${selectClass} md:w-40`} value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="狀態">
          <option value="">全部狀態</option>
          {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="text-sm text-muted-foreground md:ml-auto">共 {filtered.length} 份</span>
      </div>

      {batch.count > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="text-sm px-3 py-1">已選取 {batch.count} 份</Badge>
              <Button variant="ghost" size="sm" className="h-7" onClick={batch.clearSelection}><X size={14} className="mr-1" />取消選取</Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setBatchField(""); setBatchValue(""); setBatchOpen(true); }}><Settings2 size={14} className="mr-1" />批次編輯</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={filtered}
            onRowClick={openEdit}
            emptyMessage={contracts.length === 0 ? "還沒有人事合約，按右上角「新增合約」建立第一份" : "沒有符合條件的合約"}
            columns={[
              { header: () => <CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} />, accessor: (r: HrContract) => <span onClick={e => e.stopPropagation()}><CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} /></span>, className: "w-10" },
              { header: "合約名稱", accessor: (r: HrContract) => <div><div className="font-medium">{r.title}</div><div className="font-mono text-xs text-muted-foreground">{r.contractNumber}</div></div> },
              { header: "類型", accessor: (r: HrContract) => typeLabel(r.contractType) },
              { header: "簽約人", accessor: (r: HrContract) => <span>{r.partyName || "-"} <span className="text-xs text-muted-foreground">（{partyLabel[r.partyType]}）</span></span> },
              { header: "狀態", accessor: (r: HrContract) => <Badge variant="secondary" className={statusClass[r.status]}>{statusLabel[r.status] || r.status}</Badge> },
              { header: "期間", accessor: (r: HrContract) => r.startDate || r.endDate ? `${r.startDate || "?"} ～ ${r.endDate || "未定"}` : "-", className: "hidden md:table-cell" },
              { header: "報酬", accessor: (r: HrContract) => r.payAmount != null ? `${payBasisLabel[r.payBasis || ""] || ""} $${r.payAmount.toLocaleString()}` : "-", className: "hidden lg:table-cell" },
              {
                header: "操作",
                accessor: (r: HrContract) => (
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)} aria-label="編輯合約"><Pencil size={14} /></Button>
                    {r.status === "Draft" && <Button variant="ghost" size="icon" onClick={() => handleDelete(r)} aria-label="刪除合約"><Trash2 size={14} className="text-destructive" /></Button>}
                  </div>
                ),
                className: "w-20",
              },
            ]}
          />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `合約 ${editing.contractNumber}` : "新增人事合約"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-1">
            <section className="grid gap-3 rounded-lg border p-3">
              <h3 className="text-sm font-semibold">合約類型與簽約人</h3>
              <div>
                <Label>合約類型 *</Label>
                <select className={selectClass} value={form.contractType} onChange={e => update({ contractType: e.target.value })}>
                  {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                {currentType && <p className="mt-1 text-xs text-muted-foreground">{currentType.hint}</p>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>簽約對象 *</Label>
                  <select className={selectClass} value={form.partyType} onChange={e => update({ partyType: e.target.value as HrContract["partyType"] })}>
                    <option value="Employee">員工</option>
                    <option value="Teacher">老師</option>
                    <option value="Person">名單外的人</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Label>{form.partyType === "Employee" ? "員工 *" : form.partyType === "Teacher" ? "老師 *" : "姓名 *"}</Label>
                  {form.partyType === "Employee" ? (
                    <select className={selectClass} value={form.employeeId} onChange={e => update({ employeeId: e.target.value })}>
                      <option value="">請選擇員工</option>
                      {employees.filter((e: any) => e.status === "Active" || String(e.id) === form.employeeId).map((e: any) => <option key={e.id} value={e.id}>{e.employeeId} {employeeName(e)}{e.status !== "Active" ? "（已停用）" : ""}</option>)}
                    </select>
                  ) : form.partyType === "Teacher" ? (
                    <select className={selectClass} value={form.teacherId} onChange={e => update({ teacherId: e.target.value })}>
                      <option value="">請選擇老師</option>
                      {teachers.filter((t: any) => t.status === "Active" || String(t.id) === form.teacherId).map((t: any) => <option key={t.id} value={t.id}>{t.teacherId} {t.name}{t.status !== "Active" ? "（已停用）" : ""}</option>)}
                    </select>
                  ) : (
                    <Input value={form.personName} onChange={e => update({ personName: e.target.value })} placeholder="臨時人員或還沒建檔的人" />
                  )}
                </div>
              </div>
              <div><Label>合約名稱 *</Label><Input value={form.title} onChange={set("title")} placeholder="例：王小明 新進人員合約" /></div>
            </section>

            <section className="grid gap-3 rounded-lg border p-3">
              <h3 className="text-sm font-semibold">期間與報酬</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div><Label>簽約日</Label><Input type="date" value={form.signedDate} onChange={set("signedDate")} /></div>
                <div><Label>起始日</Label><Input type="date" value={form.startDate} onChange={set("startDate")} /></div>
                <div><Label>到期日</Label><Input type="date" value={form.endDate} onChange={set("endDate")} /><p className="mt-1 text-xs text-muted-foreground">不定期合約可留空</p></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>計酬方式</Label>
                  <select className={selectClass} value={form.payBasis} onChange={set("payBasis")}>
                    <option value="">未填</option>
                    {Object.entries(payBasisLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div><Label>報酬金額</Label><Input type="number" min="0" inputMode="decimal" value={form.payAmount} onChange={set("payAmount")} /></div>
                <div>
                  <Label>狀態</Label>
                  <select className={selectClass} value={form.status} onChange={set("status")}>
                    {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
            </section>

            <section className="grid gap-3 rounded-lg border p-3">
              <h3 className="text-sm font-semibold">內容</h3>
              <div><Label>合約條款／工作內容</Label><textarea className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[96px]" value={form.terms} onChange={set("terms")} placeholder="職稱、工作內容、試用期、工時、保密等約定" /></div>
              <div><Label>備註</Label><textarea className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[56px]" value={form.description} onChange={set("description")} /></div>
            </section>

            {editing ? (
              <section className="rounded-lg border p-3">
                <h3 className="mb-2 text-sm font-semibold">合約檔案（簽好的掃描檔、照片）</h3>
                <AttachmentsPanel module="HR" documentType="hr-contract" documentId={editing.id} />
              </section>
            ) : <p className="text-xs text-muted-foreground">先按「建立」，就可以在這裡上傳簽好的合約檔。</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>關閉</Button>
            <Button onClick={handleSave} disabled={!canSave || saving}>{saving ? "處理中..." : editing ? "更新" : "建立"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="md:max-w-md">
          <DialogHeader><DialogTitle>批次編輯 — {batch.count} 份合約</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>修改欄位</Label>
              <select className={selectClass} value={batchField} onChange={e => { setBatchField(e.target.value); setBatchValue(""); }}>
                <option value="">請選擇欄位</option>
                <option value="status">狀態</option>
                <option value="contractType">合約類型</option>
                <option value="payBasis">計酬方式</option>
                <option value="signedDate">簽約日</option>
                <option value="startDate">起始日</option>
                <option value="endDate">到期日</option>
              </select>
            </div>
            {batchField && (
              <div>
                <Label>新值</Label>
                {batchField === "status" ? (
                  <select className={selectClass} value={batchValue} onChange={e => setBatchValue(e.target.value)}><option value="">請選擇</option>{Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                ) : batchField === "contractType" ? (
                  <select className={selectClass} value={batchValue} onChange={e => setBatchValue(e.target.value)}><option value="">請選擇</option>{types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
                ) : batchField === "payBasis" ? (
                  <select className={selectClass} value={batchValue} onChange={e => setBatchValue(e.target.value)}><option value="">請選擇</option>{Object.entries(payBasisLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                ) : (
                  <Input type="date" value={batchValue} onChange={e => setBatchValue(e.target.value)} />
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)}>取消</Button>
            <Button onClick={handleBatch} disabled={!batchField || !batchValue}>更新 {batch.count} 份</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
