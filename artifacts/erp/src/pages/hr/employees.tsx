import { useState } from "react";
import { useListEmployees, useCreateEmployee, useUpdateEmployee, useDeleteEmployee, useListDepartments } from "@workspace/erp-api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, UserPlus, CheckSquare, Square, Search, Settings2, X, KeyRound, ShieldOff, FileCheck, UserX, UserCheck } from "lucide-react";
import { useLocation } from "wouter";
import { adminApi } from "@/lib/api";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;

const statusMap: Record<string, string> = { Active: "在職", Inactive: "離職", Suspended: "停職" };
const statusOptions = ["Active", "Inactive", "Suspended"];

type EmpForm = {
  employeeId: string; firstName: string; lastName: string; email: string;
  phone: string; departmentId: string; designation: string; status: string;
  dateOfJoining: string; salary: string;
  shiftTypeId: string; gradeId: string; healthInsuranceDependents: string; pensionSelfRate: string;
  resignationDate: string; birthDate: string; emergencyContact: string; emergencyPhone: string;
};
const emptyForm: EmpForm = { employeeId: "", firstName: "", lastName: "", email: "", phone: "", departmentId: "", designation: "", status: "Active", dateOfJoining: new Date().toISOString().slice(0, 10), salary: "0", shiftTypeId: "", gradeId: "", healthInsuranceDependents: "0", pensionSelfRate: "0", resignationDate: "", birthDate: "", emergencyContact: "", emergencyPhone: "" };

export default function EmployeesPage() {
  const { data: allEmployees, isLoading } = useListEmployees();
  const [, navigate] = useLocation();
  // 狀態篩選：在職／已停用（離職、停職）／全部
  const [statusTab, setStatusTab] = useState<"active" | "inactive" | "all">("active");
  const [listSearch, setListSearch] = useState("");
  const [contractAfterCreate, setContractAfterCreate] = useState(true);
  const activeTotal = (allEmployees || []).filter((e: any) => e.status === "Active").length;
  const inactiveTotal = (allEmployees || []).length - activeTotal;
  const employees = (allEmployees || []).filter((e: any) => {
    if (statusTab === "active" && e.status !== "Active") return false;
    if (statusTab === "inactive" && e.status === "Active") return false;
    const q = listSearch.trim().toLowerCase();
    return !q || `${e.employeeId || ""} ${e.firstName || ""}${e.lastName || ""} ${e.email || ""} ${e.phone || ""} ${e.departmentName || ""} ${e.designation || ""}`.toLowerCase().includes(q);
  });
  const { data: departments } = useListDepartments();
  const createMut = useCreateEmployee();
  const updateMut = useUpdateEmployee();
  const deleteMut = useDeleteEmployee();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<EmpForm>(emptyForm);
  const [showImport, setShowImport] = useState(false);
  const [selectedTeachers, setSelectedTeachers] = useState<number[]>([]);
  const [importDeptId, setImportDeptId] = useState("");
  const [importSearch, setImportSearch] = useState("");
  const [importing, setImporting] = useState(false);

  const [accountDialog, setAccountDialog] = useState<{ open: boolean; emp: any | null }>({ open: false, emp: null });
  const [accountForm, setAccountForm] = useState({ username: "", password: "", role: "viewer" });
  const [accountSaving, setAccountSaving] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const [batchField, setBatchField] = useState<string>("");
  const [batchValue, setBatchValue] = useState<string>("");
  const [batchProcessing, setBatchProcessing] = useState(false);
  // 辦理離職：選離職日後直接停用（登入帳號由後端一併停用）
  const [resignTarget, setResignTarget] = useState<any>(null);
  const [resignDate, setResignDate] = useState("");
  const todayStr = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const openResign = (emp: any) => { setResignTarget(emp); setResignDate(todayStr()); };
  const submitResign = async () => {
    if (!resignTarget || !resignDate) return;
    try {
      await updateMut.mutateAsync({ id: resignTarget.id, data: { status: resignDate <= todayStr() ? "Inactive" : "Active", resignationDate: resignDate } as any });
      queryClient.invalidateQueries({ queryKey: ["/employees"] });
      toast({ title: `已辦理離職：${resignTarget.firstName}${resignTarget.lastName}`, description: resignDate <= todayStr() ? "已移到「已停用」，登入帳號也一併停用" : `到 ${resignDate} 會自動停用` });
      setResignTarget(null);
    } catch (err: any) { toast({ title: "操作失敗", description: err.message, variant: "destructive" }); }
  };
  const reinstate = async (emp: any) => {
    if (!confirm(`讓「${emp.firstName}${emp.lastName}」復職（改回在職、清掉離職日）？\n\n登入帳號不會自動恢復，需要的話再按「建立登入帳號」。`)) return;
    try {
      await updateMut.mutateAsync({ id: emp.id, data: { status: "Active", resignationDate: null } as any });
      queryClient.invalidateQueries({ queryKey: ["/employees"] });
      toast({ title: "已復職" });
    } catch (err: any) { toast({ title: "操作失敗", description: err.message, variant: "destructive" }); }
  };

  const { data: gradeOptions = [] } = useQuery({
    queryKey: ["/grades"],
    queryFn: () => fetch(api("grades")).then(r => r.ok ? r.json() : []),
    enabled: open,
  });
  // 選了職級而且職級有設薪資範圍時，提醒月薪是否落在範圍內（只提醒，不擋）
  const selectedGrade = (gradeOptions as any[]).find((g: any) => String(g.id) === form.gradeId);
  const salaryNumber = Number(form.salary) || 0;
  const salaryOutOfRange = !!selectedGrade && salaryNumber > 0 && (
    (selectedGrade.minSalary != null && salaryNumber < Number(selectedGrade.minSalary)) ||
    (selectedGrade.maxSalary != null && salaryNumber > Number(selectedGrade.maxSalary))
  );
  const { data: designationOptions = [] } = useQuery({
    queryKey: ["/designations"],
    queryFn: () => fetch(api("designations")).then(r => r.ok ? r.json() : []),
    enabled: open,
  });
  const { data: shiftTypes = [] } = useQuery({
    queryKey: ["/shift-types"],
    queryFn: () => fetch(api("shift-types")).then(r => r.ok ? r.json() : []),
    enabled: open,
  });
  const { data: teachers = [] } = useQuery({
    queryKey: ["teachers-for-import"],
    queryFn: () => fetch(api("teachers")).then(r => r.json()),
    enabled: showImport,
  });

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm, employeeId: `EMP-${Date.now().toString().slice(-6)}` }); setOpen(true); };
  const openEdit = (emp: any) => {
    setEditing(emp);
    setForm({
      employeeId: emp.employeeId || "", firstName: emp.firstName || "", lastName: emp.lastName || "",
      email: emp.email || "", phone: emp.phone || "", departmentId: String(emp.departmentId || ""),
      designation: emp.designation || "", status: emp.status || "Active",
      dateOfJoining: emp.dateOfJoining || "", salary: String(emp.salary || 0),
      shiftTypeId: emp.shiftTypeId ? String(emp.shiftTypeId) : "",
      gradeId: emp.gradeId ? String(emp.gradeId) : "",
      healthInsuranceDependents: String(emp.healthInsuranceDependents ?? 0), pensionSelfRate: String(emp.pensionSelfRate ?? 0),
      resignationDate: emp.resignationDate || "", birthDate: emp.birthDate || "",
      emergencyContact: emp.emergencyContact || "", emergencyPhone: emp.emergencyPhone || "",
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.firstName || !form.lastName || !form.email || !form.employeeId || !form.dateOfJoining) {
      toast({ title: "請填寫必填欄位", description: "員工編號、姓名、電子郵件、到職日都要填", variant: "destructive" }); return;
    }
    if (form.status === "Inactive" && !form.resignationDate && !confirm("狀態是「離職」但沒有填離職日，要用今天當離職日嗎？\n\n離職後這位員工的登入帳號會一併停用。")) return;
    const payload: any = {
      ...form,
      departmentId: form.departmentId ? Number(form.departmentId) : undefined,
      salary: Number(form.salary) || 0,
      shiftTypeId: form.shiftTypeId ? Number(form.shiftTypeId) : null,
      gradeId: form.gradeId ? Number(form.gradeId) : null,
      healthInsuranceDependents: Number(form.healthInsuranceDependents) || 0,
      pensionSelfRate: Number(form.pensionSelfRate) || 0,
    };
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: payload });
        toast({ title: "員工已更新" });
      } else {
        const created: any = await createMut.mutateAsync({ data: payload });
        toast({ title: "員工已建立" });
        // 新人入職：建立後直接去填新進人員合約
        if (contractAfterCreate && created?.id) { setOpen(false); navigate(`/hr/contracts?new=1&employeeId=${created.id}&type=onboarding`); return; }
      }
      setOpen(false);
    } catch (err: any) {
      toast({ title: "操作失敗", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (emp: any) => {
    if (!confirm(`確定刪除員工「${emp.firstName} ${emp.lastName}」？`)) return;
    try {
      await deleteMut.mutateAsync({ id: emp.id });
      toast({ title: "員工已刪除" });
    } catch (err: any) {
      toast({ title: "刪除失敗", description: err.message, variant: "destructive" });
    }
  };

  const openImportDialog = () => {
    setSelectedTeachers([]);
    setImportDeptId("");
    setImportSearch("");
    setShowImport(true);
  };

  const toggleTeacher = (id: number) => {
    setSelectedTeachers(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  };

  const toggleAll = () => {
    const filtered = filteredTeachers;
    const allSelected = filtered.every((t: any) => selectedTeachers.includes(t.id));
    if (allSelected) {
      setSelectedTeachers(prev => prev.filter(id => !filtered.some((t: any) => t.id === id)));
    } else {
      const newIds = filtered.map((t: any) => t.id);
      setSelectedTeachers(prev => [...new Set([...prev, ...newIds])]);
    }
  };

  const filteredTeachers = teachers.filter((t: any) => {
    if (!importSearch.trim()) return true;
    const s = importSearch.toLowerCase();
    return (t.name || "").toLowerCase().includes(s) ||
      (t.teacherId || "").toLowerCase().includes(s) ||
      (t.position || "").toLowerCase().includes(s) ||
      (t.skills || "").toLowerCase().includes(s);
  });

  const handleImport = async () => {
    if (selectedTeachers.length === 0) {
      toast({ title: "請至少選擇一位老師", variant: "destructive" }); return;
    }
    setImporting(true);
    try {
      const res = await fetch(api("employees/import-from-teachers"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherIds: selectedTeachers, departmentId: importDeptId || undefined }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "匯入失敗");
      }
      const result = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/employees"] });
      toast({
        title: "匯入完成",
        description: `成功匯入 ${result.imported} 位，跳過 ${result.skipped} 位（已存在）`,
      });
      setShowImport(false);
    } catch (err: any) {
      toast({ title: "匯入失敗", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!employees) return;
    if (selectedIds.size === employees.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(employees.map((e: any) => e.id)));
    }
  };

  const openBatchEdit = () => {
    setBatchField("");
    setBatchValue("");
    setShowBatchEdit(true);
  };

  const handleBatchUpdate = async () => {
    if (selectedIds.size === 0) return;
    if (!batchField || !batchValue) {
      toast({ title: "請選擇欄位並填寫值", variant: "destructive" }); return;
    }
    setBatchProcessing(true);
    try {
      const res = await fetch(api("employees/batch-update"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          updates: { [batchField]: batchValue },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "批次更新失敗");
      }
      const result = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/employees"] });
      toast({ title: "批次更新完成", description: `已更新 ${result.updated} 位員工` });
      setShowBatchEdit(false);
      setSelectedIds(new Set());
    } catch (err: any) {
      toast({ title: "批次更新失敗", description: err.message, variant: "destructive" });
    } finally {
      setBatchProcessing(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`確定要刪除選取的 ${selectedIds.size} 位員工？此操作無法復原。`)) return;
    setBatchProcessing(true);
    try {
      const res = await fetch(api("employees/batch-delete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "批次刪除失敗");
      }
      const result = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/employees"] });
      if (result.failedCount > 0) {
        const list = (result.failed || []).slice(0, 5).map((f: any) => `• ${f.name}：${f.reason}`).join("\n");
        const more = result.failedCount > 5 ? `\n…等共 ${result.failedCount} 位` : "";
        toast({
          title: `已刪除 ${result.deleted} 位，${result.failedCount} 位無法刪除`,
          description: list + more,
          variant: result.deleted === 0 ? "destructive" : undefined,
        });
      } else {
        toast({ title: "批次刪除完成", description: `已刪除 ${result.deleted} 位員工` });
      }
      setSelectedIds(new Set());
    } catch (err: any) {
      toast({ title: "批次刪除失敗", description: err.message, variant: "destructive" });
    } finally {
      setBatchProcessing(false);
    }
  };

  const openAccountDialog = (emp: any) => {
    setAccountForm({ username: emp.employeeId || emp.email || "", password: "", role: "viewer" });
    setAccountDialog({ open: true, emp });
  };

  const handleCreateAccount = async () => {
    if (!accountDialog.emp) return;
    if (!accountForm.password || accountForm.password.length < 6) {
      toast({ title: "密碼至少 6 字元", variant: "destructive" }); return;
    }
    setAccountSaving(true);
    try {
      await adminApi.createEmployeeAccount(accountDialog.emp.id, {
        username: accountForm.username || undefined,
        password: accountForm.password,
        role: accountForm.role,
      });
      queryClient.invalidateQueries({ queryKey: ["/employees"] });
      toast({ title: "登入帳號已建立", description: `${accountDialog.emp.firstName}${accountDialog.emp.lastName} 可使用 ${accountForm.username || accountDialog.emp.employeeId} 登入` });
      setAccountDialog({ open: false, emp: null });
    } catch (err: any) {
      toast({ title: "建立失敗", description: err.message, variant: "destructive" });
    } finally {
      setAccountSaving(false);
    }
  };

  const handleDeleteAccount = async (emp: any) => {
    if (!confirm(`確定解除「${emp.firstName}${emp.lastName}」的登入帳號 ${emp.accountUsername}？此操作會刪除帳號。`)) return;
    try {
      await adminApi.deleteEmployeeAccount(emp.id);
      queryClient.invalidateQueries({ queryKey: ["/employees"] });
      toast({ title: "已解除登入帳號" });
    } catch (err: any) {
      toast({ title: "操作失敗", description: err.message, variant: "destructive" });
    }
  };

  const fieldLabel: Record<string, string> = {
    departmentId: "部門",
    status: "狀態",
    designation: "職稱",
    salary: "薪資",
  };

  const F = (key: keyof EmpForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [key]: e.target.value }));

  return (
    <div className="space-y-6">
      <PageHeader title="員工管理" description="管理公司所有員工資料">
        <Button variant="outline" onClick={openImportDialog}><UserPlus size={16} className="mr-1" />從老師匯入</Button>
        <Button onClick={openCreate}><Plus size={16} className="mr-1" />新增員工</Button>
      </PageHeader>

      {selectedIds.size > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="text-sm px-3 py-1">已選取 {selectedIds.size} 位</Badge>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} className="h-7">
                <X size={14} className="mr-1" />取消選取
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={openBatchEdit} disabled={batchProcessing}>
                <Settings2 size={14} className="mr-1" />批次編輯
              </Button>
              <Button variant="destructive" size="sm" onClick={handleBatchDelete} disabled={batchProcessing}>
                <Trash2 size={14} className="mr-1" />批次刪除
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="flex gap-2" role="tablist" aria-label="員工狀態">
          {([["active", `在職（${activeTotal}）`], ["inactive", `已停用（${inactiveTotal}）`], ["all", "全部"]] as const).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={statusTab === key} data-testid={`employee-status-${key}`}
              onClick={() => { setStatusTab(key); setSelectedIds(new Set()); }}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${statusTab === key ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>{label}</button>
          ))}
        </div>
        <div className="relative md:ml-auto md:w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="搜尋編號、姓名、部門、電話" value={listSearch} onChange={e => setListSearch(e.target.value)} aria-label="搜尋員工" />
        </div>
      </div>
      {statusTab === "inactive" && <p className="text-sm text-muted-foreground">已停用＝離職或停職的員工。資料與過去的薪資、出勤紀錄都留著；要復職，點編輯把狀態改回「在職」。</p>}

      <Dialog open={!!resignTarget} onOpenChange={(o) => { if (!o) setResignTarget(null); }}>
        <DialogContent className="md:max-w-md">
          <DialogHeader><DialogTitle>辦理離職：{resignTarget?.firstName}{resignTarget?.lastName}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="resign-date">離職日</Label><Input id="resign-date" type="date" value={resignDate} onChange={e => setResignDate(e.target.value)} /></div>
            <p className="text-sm text-muted-foreground">離職日是今天或更早：馬上停用，登入帳號一併停用。填未來的日期：到那天自動停用。資料、薪資與出勤紀錄都會保留，之後可以按「復職」恢復。</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setResignTarget(null)}>取消</Button>
            <Button onClick={submitResign} disabled={!resignDate || updateMut.isPending} data-testid="button-confirm-resign">確定離職</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={employees}
            emptyMessage={statusTab === "inactive" ? "沒有已停用的員工" : "沒有符合條件的員工"}
            columns={[
              {
                header: () => (
                  <button onClick={toggleSelectAll} className="flex items-center justify-center w-full">
                    {employees && selectedIds.size === employees.length && employees.length > 0
                      ? <CheckSquare size={16} className="text-primary" />
                      : selectedIds.size > 0
                        ? <div className="relative"><Square size={16} /><div className="absolute inset-0 flex items-center justify-center"><div className="w-2 h-2 bg-primary rounded-sm" /></div></div>
                        : <Square size={16} className="text-muted-foreground" />
                    }
                  </button>
                ),
                accessor: (r) => (
                  <button onClick={(e) => { e.stopPropagation(); toggleSelect(r.id); }} className="flex items-center justify-center w-full">
                    {selectedIds.has(r.id)
                      ? <CheckSquare size={16} className="text-primary" />
                      : <Square size={16} className="text-muted-foreground" />
                    }
                  </button>
                ),
                className: "w-10 px-2",
              },
              { header: "員工編號", accessor: "employeeId", className: "font-mono text-xs" },
              { header: "姓名", accessor: (r) => `${r.firstName} ${r.lastName}` },
              { header: "電子郵件", accessor: "email", className: "hidden md:table-cell" },
              { header: "部門", accessor: (r) => r.departmentName || "—", className: "hidden md:table-cell" },
              { header: "職稱／職級", accessor: (r: any) => [r.designation, r.gradeName].filter(Boolean).join("・") || "—", className: "hidden sm:table-cell" },
              { header: "到職日／年資", accessor: (r: any) => <span>{r.dateOfJoining}<span className="ml-1.5 text-xs text-muted-foreground">{r.seniority}</span></span>, className: "hidden lg:table-cell" },
              {
                header: "狀態",
                accessor: (r) => (
                  <Badge variant={r.status === "Active" ? "default" : "secondary"}>
                    {statusMap[r.status] || r.status}
                  </Badge>
                ),
              },
              { header: "薪資", accessor: (r) => `$${Number(r.salary).toLocaleString()}`, className: "text-right hidden lg:table-cell" },
              {
                header: "登入帳號",
                accessor: (r: any) => r.accountUsername ? (
                  <Badge variant={r.accountIsActive ? "default" : "secondary"} className="gap-1 font-mono text-xs">
                    <KeyRound size={10} />{r.accountUsername}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                ),
                className: "hidden md:table-cell",
              },
              {
                header: "操作",
                accessor: (r: any) => (
                  <div className="flex gap-1">
                    {r.accountUsername ? (
                      <Button variant="ghost" size="icon" title="解除登入帳號" onClick={() => handleDeleteAccount(r)}>
                        <ShieldOff size={14} className="text-amber-600" />
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" title="建立登入帳號" onClick={() => openAccountDialog(r)}>
                        <KeyRound size={14} className="text-primary" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" title="這位員工的合約" aria-label="這位員工的合約" onClick={() => navigate(`/hr/contracts?employeeId=${r.id}`)}><FileCheck size={14} /></Button>
                    {r.status === "Active"
                      ? <Button variant="ghost" size="icon" title="辦理離職（停用）" aria-label="辦理離職" onClick={() => openResign(r)}><UserX size={14} className="text-amber-600" /></Button>
                      : <Button variant="ghost" size="icon" title="復職" aria-label="復職" onClick={() => reinstate(r)}><UserCheck size={14} className="text-emerald-600" /></Button>}
                    <Button variant="ghost" size="icon" title="編輯" aria-label="編輯員工" onClick={() => openEdit(r)}><Pencil size={14} /></Button>
                    <Button variant="ghost" size="icon" title="刪除" aria-label="刪除員工" onClick={() => handleDelete(r)}><Trash2 size={14} className="text-destructive" /></Button>
                  </div>
                ),
                className: "w-48",
              },
            ]}
          />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "編輯員工" : "新增員工"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>員工編號 *</Label><Input value={form.employeeId} onChange={F("employeeId")} /></div>
              <div><Label>狀態</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.status} onChange={F("status")}>
                  {statusOptions.map(s => <option key={s} value={s}>{statusMap[s]}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>姓 *</Label><Input value={form.firstName} onChange={F("firstName")} /></div>
              <div><Label>名 *</Label><Input value={form.lastName} onChange={F("lastName")} /></div>
            </div>
            <div><Label>電子郵件 *</Label><Input type="email" value={form.email} onChange={F("email")} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>電話</Label><Input value={form.phone} onChange={F("phone")} /></div>
              <div><Label>職稱</Label><Input list="designation-options" value={form.designation} onChange={F("designation")} placeholder="可從職稱管理的清單選，或直接輸入" />
                <datalist id="designation-options">{(designationOptions as any[]).filter((d: any) => d.isActive !== false).map((d: any) => <option key={d.id} value={d.title} />)}</datalist>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>部門</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.departmentId} onChange={F("departmentId")}>
                  <option value="">請選擇</option>
                  {(departments || []).filter((d: any) => d.isActive !== false || String(d.id) === form.departmentId).map((d: any) => <option key={d.id} value={d.id}>{d.name}{d.isActive === false ? "（已停用）" : ""}</option>)}
                </select>
              </div>
              <div><Label>到職日 *</Label><Input type="date" value={form.dateOfJoining} onChange={F("dateOfJoining")} /><p className="text-xs text-muted-foreground mt-1">年資與特休從這天起算</p></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>職級</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.gradeId} onChange={F("gradeId")}>
                  <option value="">未設定</option>
                  {(gradeOptions as any[]).filter((g: any) => g.isActive !== false || String(g.id) === form.gradeId).map((g: any) => <option key={g.id} value={g.id}>{g.name}{g.isActive === false ? "（已停用）" : ""}</option>)}
                </select>
                {selectedGrade && (selectedGrade.minSalary != null || selectedGrade.maxSalary != null) && (
                  <p className={`text-xs mt-1 ${salaryOutOfRange ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground"}`}>
                    薪資範圍 {selectedGrade.minSalary != null ? `$${Number(selectedGrade.minSalary).toLocaleString()}` : "不限"} ~ {selectedGrade.maxSalary != null ? `$${Number(selectedGrade.maxSalary).toLocaleString()}` : "不限"}{salaryOutOfRange ? "，目前月薪不在範圍內" : ""}
                  </p>
                )}
              </div>
              <div><Label>月薪</Label><Input type="number" inputMode="numeric" value={form.salary} onChange={F("salary")} /></div>
              <div><Label>班別</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.shiftTypeId} onChange={F("shiftTypeId")}>
                  <option value="">標準班（09:00–18:00）</option>
                  {(shiftTypes as any[]).filter((s: any) => s.status !== "inactive" || String(s.id) === form.shiftTypeId).map((s: any) => <option key={s.id} value={s.id}>{s.name}（{s.startTime}–{s.endTime}）</option>)}
                </select>
                <p className="text-xs text-muted-foreground mt-1">遲到、早退、加班依班別計算</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>健保眷屬人數</Label><Input type="number" inputMode="numeric" min={0} value={form.healthInsuranceDependents} onChange={F("healthInsuranceDependents")} /></div>
              <div><Label>勞退自提（%）</Label><Input type="number" inputMode="numeric" min={0} max={6} value={form.pensionSelfRate} onChange={F("pensionSelfRate")} /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>生日</Label><Input type="date" value={form.birthDate} onChange={F("birthDate")} /></div>
              <div><Label>離職日</Label><Input type="date" value={form.resignationDate} onChange={F("resignationDate")} /><p className="text-xs text-muted-foreground mt-1">到期後自動改為離職並停用登入帳號</p></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>緊急聯絡人</Label><Input value={form.emergencyContact} onChange={F("emergencyContact")} placeholder="姓名（關係）" /></div>
              <div><Label>緊急聯絡電話</Label><Input type="tel" inputMode="tel" value={form.emergencyPhone} onChange={F("emergencyPhone")} /></div>
            </div>
          </div>
          {!editing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={contractAfterCreate} onChange={e => setContractAfterCreate(e.target.checked)} />
              建立後接著填這位新人的合約（新進人員合約）
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
              {createMut.isPending || updateMut.isPending ? "處理中..." : editing ? "更新" : "建立"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBatchEdit} onOpenChange={setShowBatchEdit}>
        <DialogContent className="md:max-w-md">
          <DialogHeader><DialogTitle>批次編輯 — {selectedIds.size} 位員工</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">選擇要修改的欄位和新值，將套用到所有選取的員工。</p>
          <div className="space-y-4 mt-2">
            <div>
              <Label>修改欄位</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={batchField}
                onChange={e => { setBatchField(e.target.value); setBatchValue(""); }}
              >
                <option value="">請選擇欄位</option>
                <option value="departmentId">部門</option>
                <option value="status">狀態</option>
                <option value="designation">職稱</option>
                <option value="salary">薪資</option>
              </select>
            </div>
            {batchField && (
              <div>
                <Label>新值 — {fieldLabel[batchField]}</Label>
                {batchField === "departmentId" ? (
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={batchValue}
                    onChange={e => setBatchValue(e.target.value)}
                  >
                    <option value="">請選擇部門</option>
                    {(departments || []).filter((d: any) => d.isActive !== false).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                ) : batchField === "status" ? (
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={batchValue}
                    onChange={e => setBatchValue(e.target.value)}
                  >
                    <option value="">請選擇狀態</option>
                    {statusOptions.map(s => <option key={s} value={s}>{statusMap[s]}</option>)}
                  </select>
                ) : batchField === "salary" ? (
                  <Input type="number" value={batchValue} onChange={e => setBatchValue(e.target.value)} placeholder="輸入薪資金額" />
                ) : (
                  <Input value={batchValue} onChange={e => setBatchValue(e.target.value)} placeholder={`輸入新${fieldLabel[batchField]}`} />
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatchEdit(false)}>取消</Button>
            <Button onClick={handleBatchUpdate} disabled={batchProcessing || !batchField || !batchValue}>
              {batchProcessing ? "處理中..." : `更新 ${selectedIds.size} 位員工`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="md:max-w-2xl max-h-[85dvh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>從老師管理匯入員工</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            選擇要匯入的老師，系統會自動將老師資料轉換為員工資料。已存在的員工（姓名+Email 相同）會自動跳過。
          </p>

          <div className="flex items-center gap-3 mt-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋老師姓名、編號、職位、技能..."
                value={importSearch}
                onChange={e => setImportSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div>
              <select
                className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={importDeptId}
                onChange={e => setImportDeptId(e.target.value)}
              >
                <option value="">指定部門（選填）</option>
                {(departments || []).filter((d: any) => d.isActive !== false).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between mt-2 mb-1">
            <Button variant="ghost" size="sm" onClick={toggleAll}>
              {filteredTeachers.length > 0 && filteredTeachers.every((t: any) => selectedTeachers.includes(t.id))
                ? <><CheckSquare size={14} className="mr-1" />取消全選</>
                : <><Square size={14} className="mr-1" />全選 ({filteredTeachers.length})</>
              }
            </Button>
            <span className="text-sm text-muted-foreground">
              已選 {selectedTeachers.length} / {teachers.length} 位
            </span>
          </div>

          <div className="flex-1 overflow-y-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="p-2 w-10"></th>
                  <th className="p-2 text-left">編號</th>
                  <th className="p-2 text-left">姓名</th>
                  <th className="p-2 text-left">職位</th>
                  <th className="p-2 text-left">電話</th>
                  <th className="p-2 text-left">狀態</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeachers.map((t: any) => (
                  <tr
                    key={t.id}
                    className={`border-t cursor-pointer hover:bg-accent/50 ${selectedTeachers.includes(t.id) ? "bg-primary/5" : ""}`}
                    onClick={() => toggleTeacher(t.id)}
                  >
                    <td className="p-2 text-center">
                      {selectedTeachers.includes(t.id)
                        ? <CheckSquare size={16} className="text-primary" />
                        : <Square size={16} className="text-muted-foreground" />
                      }
                    </td>
                    <td className="p-2 font-mono text-xs">{t.teacherId}</td>
                    <td className="p-2 font-medium">{t.name}</td>
                    <td className="p-2">{t.position || "—"}</td>
                    <td className="p-2">{t.phone || "—"}</td>
                    <td className="p-2">
                      <Badge variant={t.status === "Active" ? "default" : "secondary"} className="text-xs">
                        {t.status === "Active" ? "在職" : "離職"}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {filteredTeachers.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">
                    {importSearch ? "搜尋無結果" : "載入中..."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <DialogFooter className="mt-3">
            <Button variant="outline" onClick={() => setShowImport(false)}>取消</Button>
            <Button onClick={handleImport} disabled={importing || selectedTeachers.length === 0}>
              {importing ? "匯入中..." : `匯入 ${selectedTeachers.length} 位老師`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={accountDialog.open} onOpenChange={(o) => setAccountDialog({ open: o, emp: o ? accountDialog.emp : null })}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>建立員工登入帳號</DialogTitle>
          </DialogHeader>
          {accountDialog.emp && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                員工：<span className="font-medium text-foreground">{accountDialog.emp.firstName}{accountDialog.emp.lastName}</span>
                <span className="ml-2 font-mono text-xs">({accountDialog.emp.employeeId})</span>
              </div>
              <div>
                <Label>登入帳號</Label>
                <Input value={accountForm.username} onChange={(e) => setAccountForm({ ...accountForm, username: e.target.value })} placeholder="預設使用員工編號" />
              </div>
              <div>
                <Label>密碼 *（至少 6 字元）</Label>
                <Input type="password" value={accountForm.password} onChange={(e) => setAccountForm({ ...accountForm, password: e.target.value })} />
              </div>
              <div>
                <Label>角色</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={accountForm.role} onChange={(e) => setAccountForm({ ...accountForm, role: e.target.value })}>
                  <option value="viewer">一般員工</option>
                  <option value="manager">主管</option>
                  <option value="accountant">會計</option>
                  <option value="hr_admin">人資管理員</option>
                  <option value="finance_admin">財務管理員</option>
                  <option value="admin">管理員</option>
                  <option value="owner">擁有者</option>
                  <option value="super_admin">超級管理員</option>
                </select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccountDialog({ open: false, emp: null })}>取消</Button>
            <Button onClick={handleCreateAccount} disabled={accountSaving || !accountForm.password}>
              {accountSaving ? "建立中..." : "建立帳號"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
