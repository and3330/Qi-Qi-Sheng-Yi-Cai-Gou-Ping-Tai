import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, Eye, GraduationCap, Users, UserCheck, UserX } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

const BASE_URL = import.meta.env.BASE_URL;
const api = (path: string) => {
  const base = BASE_URL.endsWith("/") ? BASE_URL : BASE_URL + "/";
  return `/erp-api/${path}`;
};

type Teacher = {
  id: number; teacherId: string; name: string; position: string;
  phone: string; email: string; skills: string; address: string;
  registeredAddress: string; idNumber: string; dateOfBirth: string;
  bankName: string; bankAccountName: string; bankAccountNumber: string;
  bankBranch: string; otherPositions: string; referrer: string;
  teachingExperience: string; preferredArea: string; notes: string;
  status: string; createdAt: string;
};

type TeacherForm = {
  teacherId: string; name: string; position: string; phone: string;
  email: string; skills: string; address: string; registeredAddress: string;
  idNumber: string; dateOfBirth: string; bankName: string;
  bankAccountName: string; bankAccountNumber: string; bankBranch: string;
  otherPositions: string; referrer: string; teachingExperience: string;
  preferredArea: string; notes: string; status: string;
};

const emptyForm: TeacherForm = {
  teacherId: "", name: "", position: "", phone: "", email: "", skills: "",
  address: "", registeredAddress: "", idNumber: "", dateOfBirth: "",
  bankName: "", bankAccountName: "", bankAccountNumber: "", bankBranch: "",
  otherPositions: "", referrer: "", teachingExperience: "", preferredArea: "",
  notes: "", status: "Active",
};

export default function TeachersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTeacher, setDetailTeacher] = useState<Teacher | null>(null);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [form, setForm] = useState<TeacherForm>(emptyForm);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { data: teachers = [], isLoading } = useQuery<Teacher[]>({
    queryKey: ["/erp-api/teachers", search, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(api(`teachers?${params.toString()}`));
      return res.json();
    },
  });

  const saveMut = useMutation({
    mutationFn: async (data: { id?: number; body: TeacherForm }) => {
      const url = data.id ? api(`teachers/${data.id}`) : api("teachers");
      const res = await fetch(url, {
        method: data.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data.body),
      });
      if (!res.ok) throw new Error((await res.json()).error || "操作失敗");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/erp-api/teachers"] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(api(`teachers/${id}`), { method: "DELETE" });
      if (!res.ok) throw new Error("刪除失敗");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/erp-api/teachers"] }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, teacherId: `T-${Date.now().toString().slice(-6)}` });
    setOpen(true);
  };

  const openEdit = (t: Teacher) => {
    setEditing(t);
    setForm({
      teacherId: t.teacherId, name: t.name, position: t.position || "",
      phone: t.phone || "", email: t.email || "", skills: t.skills || "",
      address: t.address || "", registeredAddress: t.registeredAddress || "",
      idNumber: t.idNumber || "", dateOfBirth: t.dateOfBirth || "",
      bankName: t.bankName || "", bankAccountName: t.bankAccountName || "",
      bankAccountNumber: t.bankAccountNumber || "", bankBranch: t.bankBranch || "",
      otherPositions: t.otherPositions || "", referrer: t.referrer || "",
      teachingExperience: t.teachingExperience || "", preferredArea: t.preferredArea || "",
      notes: t.notes || "", status: t.status,
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name) { toast({ title: "請填寫姓名", variant: "destructive" }); return; }
    try {
      await saveMut.mutateAsync({ id: editing?.id, body: form });
      toast({ title: editing ? "老師資料已更新" : "老師已新增" });
      setOpen(false);
    } catch (err: any) {
      toast({ title: "操作失敗", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (t: Teacher) => {
    if (!confirm(`確定刪除老師「${t.name}」？`)) return;
    try {
      await deleteMut.mutateAsync(t.id);
      toast({ title: "老師已刪除" });
    } catch (err: any) {
      toast({ title: "刪除失敗", description: err.message, variant: "destructive" });
    }
  };

  const openDetail = (t: Teacher) => { setDetailTeacher(t); setDetailOpen(true); };

  const teacherBatchFields: BatchField[] = [
    {key:"status",label:"狀態",type:"select",options:[{value:"Active",label:"在職"},{value:"Inactive",label:"離職"}]},
    {key:"position",label:"職位",type:"text"},
  ];

  const pagedTeachers = teachers.slice(page * pageSize, (page + 1) * pageSize);
  const batch = useBatchSelection(pagedTeachers);
  const totalPages = Math.ceil(teachers.length / pageSize);

  const positionCounts = teachers.reduce((acc: Record<string, number>, t) => {
    const p = t.position || "未分類";
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});

  const activeCount = teachers.filter(t => t.status === "Active").length;
  const inactiveCount = teachers.filter(t => t.status !== "Active").length;

  const posColor = (pos: string) => {
    if (pos.includes("才藝講師")) return "bg-purple-100 text-purple-700";
    if (pos.includes("正職")) return "bg-blue-100 text-blue-700";
    if (pos.includes("實習")) return "bg-green-100 text-green-700";
    if (pos.includes("業務")) return "bg-orange-100 text-orange-700";
    if (pos.includes("表演")) return "bg-pink-100 text-pink-700";
    return "bg-gray-100 text-gray-700";
  };

  const F = ({ label, value }: { label: string; value: string }) => (
    <div>
      <Label className="text-xs text-gray-500">{label}</Label>
      <div className="mt-0.5">{value || "-"}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="老師管理" description={`共 ${teachers.length} 位老師 / 人員`}>
        <Button onClick={openCreate}><Plus size={16} className="mr-1" />新增老師</Button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <GraduationCap className="text-blue-500" size={28} />
            <div><div className="text-sm text-gray-500">總人數</div><div className="text-xl font-bold">{teachers.length}</div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <UserCheck className="text-green-500" size={28} />
            <div><div className="text-sm text-gray-500">在職</div><div className="text-xl font-bold">{activeCount}</div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <UserX className="text-red-500" size={28} />
            <div><div className="text-sm text-gray-500">離職</div><div className="text-xl font-bold">{inactiveCount}</div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Users className="text-purple-500" size={28} />
            <div><div className="text-sm text-gray-500">才藝講師</div><div className="text-xl font-bold">{positionCounts["才藝講師"] || 0}</div></div>
          </CardContent>
        </Card>
      </div>

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="老師"
          entityEndpoint="teachers"
          ids={batch.ids}
          batchFields={teacherBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => qc.invalidateQueries({ queryKey: ["/erp-api/teachers"] })}
        />
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[250px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input placeholder="搜尋姓名、編號、技能、職位、電話..." className="pl-10"
            value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <select className="border rounded-md px-3 py-2 text-sm" value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(0); }}>
          <option value="">全部狀態</option>
          <option value="Active">在職</option>
          <option value="Inactive">已停用（離職）</option>
        </select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                  <th className="text-left p-3">編號</th>
                  <th className="text-left p-3">姓名</th>
                  <th className="text-left p-3">職位</th>
                  <th className="text-left p-3">電話</th>
                  <th className="text-left p-3">Email</th>
                  <th className="text-left p-3">專業技能</th>
                  <th className="text-left p-3">教課區域</th>
                  <th className="text-left p-3">狀態</th>
                  <th className="text-left p-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={10} className="p-8 text-center text-gray-400">載入中...</td></tr>
                ) : pagedTeachers.length === 0 ? (
                  <tr><td colSpan={10} className="p-8 text-center text-gray-400">尚無資料</td></tr>
                ) : pagedTeachers.map(t => (
                  <tr key={t.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => openDetail(t)}>
                    <td className="px-2" onClick={e => e.stopPropagation()}><CheckboxCell checked={batch.selectedIds.has(t.id)} onChange={() => batch.toggle(t.id)} /></td>
                    <td className="p-3 font-mono text-xs">{t.teacherId}</td>
                    <td className="p-3 font-medium">{t.name}</td>
                    <td className="p-3"><Badge className={posColor(t.position || "")} variant="secondary">{t.position || "-"}</Badge></td>
                    <td className="p-3 text-xs">{t.phone || "-"}</td>
                    <td className="p-3 text-xs truncate max-w-[180px]">{t.email || "-"}</td>
                    <td className="p-3 text-xs truncate max-w-[150px]">{t.skills || "-"}</td>
                    <td className="p-3 text-xs">{t.preferredArea || "-"}</td>
                    <td className="p-3">
                      <Badge variant={t.status === "Active" ? "default" : "secondary"}>{t.status === "Active" ? "在職" : "離職"}</Badge>
                    </td>
                    <td className="p-3" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openDetail(t)}><Eye size={16} /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(t)}><Pencil size={16} /></Button>
                        <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleDelete(t)}><Trash2 size={16} /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t">
              <span className="text-sm text-gray-500">第 {page + 1} / {totalPages} 頁</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>上一頁</Button>
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>下一頁</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="md:max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>老師詳細資料 — {detailTeacher?.name}</DialogTitle></DialogHeader>
          {detailTeacher && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <F label="編號" value={detailTeacher.teacherId} />
              <F label="姓名" value={detailTeacher.name} />
              <F label="職位" value={detailTeacher.position} />
              <F label="狀態" value={detailTeacher.status === "Active" ? "在職" : "離職"} />
              <F label="電話" value={detailTeacher.phone} />
              <F label="Email" value={detailTeacher.email} />
              <F label="專業技能" value={detailTeacher.skills} />
              <F label="期望教課區域" value={detailTeacher.preferredArea} />
              <F label="出生日期" value={detailTeacher.dateOfBirth} />
              <F label="通訊住址" value={detailTeacher.address} />
              <F label="戶籍地址" value={detailTeacher.registeredAddress} />
              <F label="銀行" value={detailTeacher.bankName} />
              <F label="戶頭名稱" value={detailTeacher.bankAccountName} />
              <F label="銀行帳號" value={detailTeacher.bankAccountNumber} />
              <F label="分行" value={detailTeacher.bankBranch} />
              <F label="其他配合職位" value={detailTeacher.otherPositions} />
              <F label="推薦人" value={detailTeacher.referrer} />
              <div className="col-span-2">
                <F label="教學經歷" value={detailTeacher.teachingExperience} />
              </div>
              <div className="col-span-2">
                <F label="備註" value={detailTeacher.notes} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>關閉</Button>
            <Button onClick={() => { setDetailOpen(false); if (detailTeacher) openEdit(detailTeacher); }}>編輯</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "編輯老師" : "新增老師"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>編號</Label><Input value={form.teacherId} onChange={e => setForm(p => ({ ...p, teacherId: e.target.value }))} /></div>
            <div><Label>姓名 *</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div>
              <Label>職位</Label>
              <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.position} onChange={e => setForm(p => ({ ...p, position: e.target.value }))}>
                <option value="">請選擇</option>
                <option value="才藝講師">才藝講師</option>
                <option value="正職員工">正職員工</option>
                <option value="實習生">實習生</option>
                <option value="業務員">業務員</option>
                <option value="表演者">表演者</option>
                <option value="其他">其他</option>
              </select>
            </div>
            <div>
              <Label>狀態</Label>
              <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                <option value="Active">在職</option>
                <option value="Inactive">離職</option>
              </select>
            </div>
            <div><Label>電話</Label><Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
            <div><Label>Email</Label><Input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
            <div className="col-span-2"><Label>專業技能</Label><Input value={form.skills} onChange={e => setForm(p => ({ ...p, skills: e.target.value }))} /></div>
            <div><Label>出生日期</Label><Input type="date" value={form.dateOfBirth} onChange={e => setForm(p => ({ ...p, dateOfBirth: e.target.value }))} /></div>
            <div><Label>期望教課區域</Label><Input value={form.preferredArea} onChange={e => setForm(p => ({ ...p, preferredArea: e.target.value }))} /></div>
            <div className="col-span-2"><Label>通訊住址</Label><Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} /></div>
            <div className="col-span-2"><Label>戶籍地址</Label><Input value={form.registeredAddress} onChange={e => setForm(p => ({ ...p, registeredAddress: e.target.value }))} /></div>
            <div><Label>銀行</Label><Input value={form.bankName} onChange={e => setForm(p => ({ ...p, bankName: e.target.value }))} /></div>
            <div><Label>戶頭名稱</Label><Input value={form.bankAccountName} onChange={e => setForm(p => ({ ...p, bankAccountName: e.target.value }))} /></div>
            <div><Label>銀行帳號</Label><Input value={form.bankAccountNumber} onChange={e => setForm(p => ({ ...p, bankAccountNumber: e.target.value }))} /></div>
            <div><Label>分行</Label><Input value={form.bankBranch} onChange={e => setForm(p => ({ ...p, bankBranch: e.target.value }))} /></div>
            <div className="col-span-2"><Label>其他配合職位</Label><Input value={form.otherPositions} onChange={e => setForm(p => ({ ...p, otherPositions: e.target.value }))} /></div>
            <div><Label>推薦人</Label><Input value={form.referrer} onChange={e => setForm(p => ({ ...p, referrer: e.target.value }))} /></div>
            <div className="col-span-2"><Label>教學經歷</Label><textarea className="w-full border rounded-md px-3 py-2 text-sm min-h-[80px]" value={form.teachingExperience} onChange={e => setForm(p => ({ ...p, teachingExperience: e.target.value }))} /></div>
            <div className="col-span-2"><Label>備註</Label><Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saveMut.isPending}>
              {saveMut.isPending ? "處理中..." : editing ? "更新" : "建立"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
