import { useState, Fragment } from "react";
import { selectableDepartments, departmentLabel } from "@/lib/select-options";
import { useListDepartments, useCreateDepartment, useUpdateDepartment, useDeleteDepartment, useListEmployees } from "@workspace/erp-api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DocWindow, DocStatus } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Users, Building2, Power, PowerOff, TrendingUp } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { FINANCE_ROLES } from "@/lib/roles";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { SearchableSelect } from "@/components/shared/searchable-select";

export default function DepartmentsPage() {
  const [, navigate] = useLocation();
  const canSeeFinancials = useAuth().hasRole(...FINANCE_ROLES);
  const { data: departments, isLoading, refetch } = useListDepartments();
  const { data: employees } = useListEmployees();
  const createDept = useCreateDepartment();
  const updateDept = useUpdateDepartment();
  const deleteDept = useDeleteDepartment();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const batch = useBatchSelection(departments);
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", description: "", parentId: "", managerId: "", costCenter: "", isActive: true });
  const [showInactive, setShowInactive] = useState(true);

  const resetForm = () => {
    setForm({ name: "", description: "", parentId: "", managerId: "", costCenter: "", isActive: true });
    setEditingId(null);
  };

  const openEdit = (d: any) => {
    setForm({
      name: d.name,
      description: d.description || "",
      parentId: d.parentId ? String(d.parentId) : "",
      managerId: d.managerId ? String(d.managerId) : "",
      costCenter: d.costCenter || "",
      isActive: d.isActive !== false,
    });
    setEditingId(d.id);
    setShowDialog(true);
  };

  const handleToggleActive = async (d: any) => {
    try {
      await updateDept.mutateAsync({ id: d.id, data: { isActive: !(d.isActive !== false) } as any });
      toast({ title: d.isActive !== false ? `${d.name} 已停用` : `${d.name} 已啟用`, description: "歷史財務資料仍會出現在會計報表中" });
      refetch();
    } catch {
      toast({ title: "操作失敗", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    try {
      const data: any = { name: form.name, description: form.description || undefined, costCenter: form.costCenter || undefined, isActive: form.isActive };
      if (form.parentId) data.parentId = Number(form.parentId);
      if (form.managerId) data.managerId = Number(form.managerId);

      if (editingId) {
        await updateDept.mutateAsync({ id: editingId, data });
        toast({ title: "部門已更新" });
      } else {
        await createDept.mutateAsync({ data });
        toast({ title: "部門已建立" });
      }
      setShowDialog(false);
      resetForm();
      refetch();
    } catch {
      toast({ title: "操作失敗", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    await deleteDept.mutateAsync({ id });
    toast({ title: "部門已刪除" });
    refetch();
  };

  const editingDept: any = editingId ? (departments || []).find(d => d.id === editingId) : null;
  const visibleDepts = (departments || []).filter((d: any) => showInactive || d.isActive !== false);
  const topLevel = visibleDepts.filter((d: any) => !d.parentId);
  const getChildren = (parentId: number) => visibleDepts.filter((d: any) => d.parentId === parentId);

  return (
    <div className="space-y-6">
      <PageHeader title="部門管理" description="組織架構與部門設定">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowInactive(s => !s)}>
            {showInactive ? "隱藏已停用" : "顯示已停用"}
          </Button>
          <Button size="sm" onClick={() => { resetForm(); setShowDialog(true); }}><Plus className="h-4 w-4 mr-1" />新增部門</Button>
        </div>
      </PageHeader>

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="部門"
          entityEndpoint="departments"
          ids={batch.ids}
          batchFields={[{key:"name",label:"名稱",type:"text"} as BatchField]}
          onClear={batch.clearSelection}
          onComplete={() => { queryClient.invalidateQueries({ queryKey: ["/departments"] }); refetch(); }}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-sm text-gray-500">部門總數</div>
            <div className="text-2xl font-bold">{departments?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-sm text-gray-500">總人數</div>
            <div className="text-2xl font-bold">{departments?.reduce((s, d) => s + d.employeeCount, 0) || 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                  <th className="text-left px-4 py-3 font-medium">部門名稱</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">說明</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">上級部門</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">主管</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">成本中心</th>
                  <th className="text-center px-4 py-3 font-medium">人數</th>
                  <th className="text-center px-4 py-3 font-medium w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">載入中...</td></tr>
                ) : !departments?.length ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">尚無部門</td></tr>
                ) : (
                  <>
                    {topLevel.map(d => (
                      <Fragment key={d.id}>
                        <tr className="border-b hover:bg-gray-50 bg-blue-50/30 cursor-pointer" onClick={e => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; openEdit(d); }}>
                          <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(d.id)} onChange={() => batch.toggle(d.id)} /></td>
                          <td className="px-4 py-3 font-medium">
                            <div className="flex items-center gap-2">
                              <Building2 className={`h-4 w-4 ${(d as any).isActive === false ? "text-gray-400" : "text-blue-500"}`} />
                              <span className={(d as any).isActive === false ? "text-gray-400 line-through" : ""}>{d.name}</span>
                              {(d as any).isActive === false && <Badge variant="secondary" className="text-[10px]">已停用</Badge>}
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">{d.description || "-"}</td>
                          <td className="px-4 py-3 hidden md:table-cell">-</td>
                          <td className="px-4 py-3 hidden md:table-cell">{d.managerName || "-"}</td>
                          <td className="px-4 py-3 hidden lg:table-cell font-mono text-xs">{d.costCenter || "-"}</td>
                          <td className="px-4 py-3 text-center"><Badge variant="outline">{d.employeeCount}</Badge></td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex gap-1 justify-center">
                              <Button variant="ghost" size="sm" title={(d as any).isActive === false ? "啟用" : "停用"} onClick={() => handleToggleActive(d)}>
                                {(d as any).isActive === false ? <Power className="h-4 w-4 text-green-600" /> : <PowerOff className="h-4 w-4 text-orange-500" />}
                              </Button>
                              {canSeeFinancials && <Button variant="ghost" size="sm" title="部門損益" onClick={() => navigate(`/hr/dept-financials?id=${d.id}`)}><TrendingUp className="h-4 w-4" /></Button>}
<Button variant="ghost" size="sm" onClick={() => openEdit(d)}><Pencil className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="sm" onClick={() => handleDelete(d.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                            </div>
                          </td>
                        </tr>
                        {getChildren(d.id).map(child => (
                          <tr key={child.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={e => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; openEdit(child); }}>
                            <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(child.id)} onChange={() => batch.toggle(child.id)} /></td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2 pl-6">
                                <span className="text-gray-300">└</span>
                                <Users className={`h-4 w-4 ${(child as any).isActive === false ? "text-gray-300" : "text-gray-400"}`} />
                                <span className={(child as any).isActive === false ? "text-gray-400 line-through" : ""}>{child.name}</span>
                                {(child as any).isActive === false && <Badge variant="secondary" className="text-[10px]">已停用</Badge>}
                              </div>
                            </td>
                            <td className="px-4 py-3 hidden sm:table-cell">{child.description || "-"}</td>
                            <td className="px-4 py-3 hidden md:table-cell text-gray-500">{d.name}</td>
                            <td className="px-4 py-3 hidden md:table-cell">{child.managerName || "-"}</td>
                            <td className="px-4 py-3 hidden lg:table-cell font-mono text-xs">{child.costCenter || "-"}</td>
                            <td className="px-4 py-3 text-center"><Badge variant="outline">{child.employeeCount}</Badge></td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex gap-1 justify-center">
                                <Button variant="ghost" size="sm" title={(child as any).isActive === false ? "啟用" : "停用"} onClick={() => handleToggleActive(child)}>
                                  {(child as any).isActive === false ? <Power className="h-4 w-4 text-green-600" /> : <PowerOff className="h-4 w-4 text-orange-500" />}
                                </Button>
                                {canSeeFinancials && <Button variant="ghost" size="sm" title="部門損益" onClick={() => navigate(`/hr/dept-financials?id=${child.id}`)}><TrendingUp className="h-4 w-4" /></Button>}
<Button variant="ghost" size="sm" onClick={() => openEdit(child)}><Pencil className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDelete(child.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    {departments.filter(d => d.parentId && !departments.some(p => p.id === d.parentId && !p.parentId)).length > 0 && departments.filter(d => d.parentId && !topLevel.some(p => p.id === d.parentId)).map(d => (
                      <tr key={d.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={e => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; openEdit(d); }}>
                        <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(d.id)} onChange={() => batch.toggle(d.id)} /></td>
                        <td className="px-4 py-3 font-medium">{d.name}</td>
                        <td className="px-4 py-3 hidden sm:table-cell">{d.description || "-"}</td>
                        <td className="px-4 py-3 hidden md:table-cell">{d.parentName || "-"}</td>
                        <td className="px-4 py-3 hidden md:table-cell">{d.managerName || "-"}</td>
                        <td className="px-4 py-3 hidden lg:table-cell font-mono text-xs">{d.costCenter || "-"}</td>
                        <td className="px-4 py-3 text-center"><Badge variant="outline">{d.employeeCount}</Badge></td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex gap-1 justify-center">
                            {canSeeFinancials && <Button variant="ghost" size="sm" title="部門損益" onClick={() => navigate(`/hr/dept-financials?id=${d.id}`)}><TrendingUp className="h-4 w-4" /></Button>}
<Button variant="ghost" size="sm" onClick={() => openEdit(d)}><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(d.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <DocWindow
        open={showDialog}
        onClose={() => setShowDialog(false)}
        name={editingId ? "部門" : "新增部門"}
        number={editingDept?.costCenter}
        status={editingDept ? <DocStatus label={editingDept.isActive === false ? "已停用" : "啟用中"} tone={editingDept.isActive === false ? "secondary" : "default"} /> : undefined}
        footer={<>
          <Button variant="outline" onClick={() => setShowDialog(false)}>取消</Button>
          <Button onClick={handleSave}>{editingId ? "更新" : "建立"}</Button>
        </>}
      >
          <div className="grid gap-4">
            <div><Label>部門名稱 *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>說明</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>上級部門</Label>
                <SearchableSelect
                  value={form.parentId}
                  onValueChange={parentId => setForm(f => ({ ...f, parentId }))}
                  options={[
                    { value: "", label: "無" },
                    ...selectableDepartments(departments, form.parentId).filter(d => d.id !== editingId).map(d => ({ value: String(d.id), label: departmentLabel(d) })),
                  ]}
                  searchPlaceholder="搜尋部門..."
                  emptyText="找不到部門"
                />
              </div>
              <div>
                <Label>部門主管</Label>
                <SearchableSelect
                  value={form.managerId}
                  onValueChange={managerId => setForm(f => ({ ...f, managerId }))}
                  options={[
                    { value: "", label: "無" },
                    ...(employees || []).map(e => ({ value: String(e.id), label: `${e.firstName} ${e.lastName}` })),
                  ]}
                  searchPlaceholder="搜尋員工..."
                  emptyText="找不到員工"
                />
              </div>
            </div>
            <div><Label>成本中心代碼</Label><Input value={form.costCenter} onChange={e => setForm(f => ({ ...f, costCenter: e.target.value }))} placeholder="如 CC-001" /></div>
            <div className="flex items-center gap-2 border rounded-md p-3 bg-muted/30">
              <input
                type="checkbox"
                id="dept-isActive"
                checked={form.isActive}
                onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                className="h-4 w-4"
              />
              <Label htmlFor="dept-isActive" className="cursor-pointer mb-0">啟用此部門</Label>
              <span className="text-xs text-muted-foreground ml-2">停用後不會出現在新增表單下拉選單，但會計報表仍可看到歷史數據</span>
            </div>
          </div>
      </DocWindow>
    </div>
  );
}
