import { useState, useEffect, useCallback } from "react";
import { selectableDepartments, departmentLabel } from "@/lib/select-options";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DocWindow, DocStatus, DocFields, DocLines, DocSection, DocNote, statusTone } from "@/components/shared/doc-window";
import { RelatedDocs } from "@/components/shared/related-docs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Eye, Trash2, Check, Search, Package, DollarSign, TrendingDown, ArrowRightLeft, Pencil } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

import { LookupSelect } from "@/components/shared/lookup-select";
import { CashAccountSelect } from "@/components/shared/ledger-account-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface Asset {
  id: number; assetNumber: string; name: string; categoryId: number; categoryName: string;
  status: string; purchaseDate: string; purchaseCost: number; depreciationMethod: string;
  usefulLifeYears: number; salvageValue: number; currentValue: number; accumulatedDepreciation: number;
  departmentId: number | null; departmentName: string; assignedTo: number | null;
  location: string | null; serialNumber: string | null; warrantyExpiry: string | null;
  disposalDate: string | null; disposalAmount: number | null; remarks: string | null;
}
interface AssetDetail extends Asset {
  assignedToName: string;
  depreciationEntries: { id: number; period: string; depreciationAmount: number; accumulatedAmount: number; bookValue: number; journalEntryId: number | null }[];
  maintenance: { id: number; maintenanceType: string; scheduledDate: string; status: string; cost: number }[];
  movements: { id: number; fromDeptName: string; toDeptName: string; fromLocation: string | null; toLocation: string | null; movementDate: string; reason: string | null }[];
  adjustments: { id: number; adjustmentDate: string; previousValue: number; newValue: number; adjustmentAmount: number; reason: string }[];
}
interface Category { id: number; name: string; depreciationMethod: string; defaultUsefulLifeYears: number }
interface Department { id: number; name: string; isActive?: boolean }
interface Employee { id: number; fullName: string }

const statusMap: Record<string, string> = { Draft: "草稿", Submitted: "已確認", "In Use": "使用中", Scrapped: "已報廢", Sold: "已出售" };
const statusColor = (s: string) => s === "In Use" ? "default" : s === "Scrapped" || s === "Sold" ? "destructive" : "secondary";
const methodMap: Record<string, string> = { "straight-line": "直線法", "declining": "定率遞減法" };

export default function AssetRegisterPage() {
  const reloadKey = useAutoReloadKey();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<AssetDetail | null>(null);
  const detailState = detailItem;
  const [disposeOpen, setDisposeOpen] = useState(false);
  const [disposeForm, setDisposeForm] = useState({ disposalDate: new Date().toISOString().slice(0, 10), disposalAmount: "0", type: "Scrapped" });
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({ toDepartmentId: "", toLocation: "", reason: "", movementDate: new Date().toISOString().slice(0, 10) });
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ newValue: "", reason: "", adjustmentDate: new Date().toISOString().slice(0, 10) });
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", categoryId: "", departmentId: "", assignedTo: "", location: "", serialNumber: "", warrantyExpiry: "", remarks: "", depreciationMethod: "", usefulLifeYears: "", salvageValue: "" });
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("");
  const { toast } = useToast();

  const [form, setForm] = useState({
    name: "", categoryId: "", purchaseDate: new Date().toISOString().slice(0, 10),
    purchaseCost: "", depreciationMethod: "straight-line", usefulLifeYears: "5",
    salvageValue: "0", departmentId: "", assignedTo: "", location: "",
    serialNumber: "", warrantyExpiry: "", remarks: "",
  });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [aRes, cRes, dRes, eRes] = await Promise.all([
      fetch(`/erp-api/assets`), fetch(`/erp-api/asset-categories`),
      fetch(`/erp-api/departments`), fetch(`/erp-api/employees`),
    ]);
    setAssets(await aRes.json()); setCategories(await cRes.json());
    setDepartments(await dRes.json()); setEmployees(await eRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const onSelectCategory = (catId: string) => {
    const cat = categories.find(c => c.id === Number(catId));
    setForm(p => ({
      ...p, categoryId: catId,
      depreciationMethod: cat?.depreciationMethod || "straight-line",
      usefulLifeYears: String(cat?.defaultUsefulLifeYears || 5),
    }));
  };

  const handleCreate = async () => {
    const payload = {
      ...form, categoryId: Number(form.categoryId), purchaseCost: Number(form.purchaseCost),
      usefulLifeYears: Number(form.usefulLifeYears), salvageValue: Number(form.salvageValue),
      departmentId: form.departmentId ? Number(form.departmentId) : null,
      assignedTo: form.assignedTo ? Number(form.assignedTo) : null,
    };
    const res = await fetch(`/erp-api/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) {
      toast({ title: "資產已建立" }); setOpen(false); fetchAll();
      setForm({ name: "", categoryId: "", purchaseDate: new Date().toISOString().slice(0, 10), purchaseCost: "", depreciationMethod: "straight-line", usefulLifeYears: "5", salvageValue: "0", departmentId: "", assignedTo: "", location: "", serialNumber: "", warrantyExpiry: "", remarks: "" });
    } else { const err = await res.json(); toast({ title: err.error || "建立失敗", variant: "destructive" }); }
  };

  const updateStatus = async (id: number, status: string, extra?: Record<string, unknown>) => {
    const res = await fetch(`/erp-api/assets/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...extra }),
    });
    if (res.ok) {
      toast({ title: `狀態已更新為${statusMap[status] || status}` });
      fetchAll(); if (detailItem?.id === id) viewDetail(id);
    } else { const err = await res.json(); toast({ title: err.error || "操作失敗", variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/erp-api/assets/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "已刪除" }); fetchAll(); setDetailItem(null); }
    else { const err = await res.json(); toast({ title: err.error || "刪除失敗", variant: "destructive" }); }
  };

  const viewDetail = async (id: number): Promise<AssetDetail | null> => {
    const res = await fetch(`/erp-api/assets/${id}`);
    if (!res.ok) return null;
    const detail = await res.json();
    setDetailItem(detail);
    return detail;
  };
  // 列上的「編輯」：開啟明細後直接進編輯
  const editFromRow = async (id: number) => { const detail = await viewDetail(id); if (detail) openEdit(detail); };

  const [saleCashAccountId, setSaleCashAccountId] = useState("");
  const handleDispose = async () => {
    if (!detailItem) return;
    if (disposeForm.type === "Sold" && Number(disposeForm.disposalAmount) > 0 && !saleCashAccountId) {
      alert("請選擇出售款項的收款帳戶");
      return;
    }
    await updateStatus(detailItem.id, disposeForm.type, {
      disposalDate: disposeForm.disposalDate, disposalAmount: Number(disposeForm.disposalAmount),
      ...(disposeForm.type === "Sold" && saleCashAccountId ? { cashAccountId: Number(saleCashAccountId) } : {}),
    });
    setDisposeOpen(false);
  };

  const handleTransfer = async () => {
    if (!detailItem) return;
    const res = await fetch(`/erp-api/assets/${detailItem.id}/transfer`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(transferForm),
    });
    if (res.ok) {
      toast({ title: "資產調撥完成" }); setTransferOpen(false); viewDetail(detailItem.id); fetchAll();
    } else { const err = await res.json(); toast({ title: err.error || "操作失敗", variant: "destructive" }); }
  };

  const handleAdjust = async () => {
    if (!detailItem) return;
    const res = await fetch(`/erp-api/assets/${detailItem.id}/adjust-value`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newValue: Number(adjustForm.newValue), reason: adjustForm.reason, adjustmentDate: adjustForm.adjustmentDate }),
    });
    if (res.ok) {
      toast({ title: "價值已調整" }); setAdjustOpen(false); viewDetail(detailItem.id); fetchAll();
    } else { const err = await res.json(); toast({ title: err.error || "操作失敗", variant: "destructive" }); }
  };

  const openEdit = (item?: AssetDetail | unknown) => {
    const detailItem = (item && typeof item === "object" && "assetNumber" in (item as any) ? item : detailState) as AssetDetail | null;
    if (!detailItem) return;
    setEditForm({
      name: detailItem.name, categoryId: String(detailItem.categoryId),
      departmentId: detailItem.departmentId ? String(detailItem.departmentId) : "",
      assignedTo: detailItem.assignedTo ? String(detailItem.assignedTo) : "",
      location: detailItem.location || "", serialNumber: detailItem.serialNumber || "",
      warrantyExpiry: detailItem.warrantyExpiry || "", remarks: detailItem.remarks || "",
      depreciationMethod: detailItem.depreciationMethod, usefulLifeYears: String(detailItem.usefulLifeYears),
      salvageValue: String(detailItem.salvageValue),
    });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!detailItem) return;
    const payload: Record<string, unknown> = {
      name: editForm.name, categoryId: Number(editForm.categoryId),
      departmentId: editForm.departmentId ? Number(editForm.departmentId) : null,
      assignedTo: editForm.assignedTo ? Number(editForm.assignedTo) : null,
      location: editForm.location || null, serialNumber: editForm.serialNumber || null,
      warrantyExpiry: editForm.warrantyExpiry || null, remarks: editForm.remarks || null,
      depreciationMethod: editForm.depreciationMethod, usefulLifeYears: Number(editForm.usefulLifeYears),
      salvageValue: Number(editForm.salvageValue),
    };
    const res = await fetch(`/erp-api/assets/${detailItem.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (res.ok) {
      toast({ title: "資產已更新" }); setEditOpen(false); viewDetail(detailItem.id); fetchAll();
    } else { const err = await res.json(); toast({ title: err.error || "更新失敗", variant: "destructive" }); }
  };

  const filtered = assets.filter(a => {
    if (searchTerm && !a.name.includes(searchTerm) && !a.assetNumber.includes(searchTerm)) return false;
    if (filterStatus && a.status !== filterStatus) return false;
    if (filterCategory && a.categoryId !== Number(filterCategory)) return false;
    if (filterDepartment && a.departmentId !== Number(filterDepartment)) return false;
    return true;
  });

  const batch = useBatchSelection(filtered);

  const totalAssets = assets.length;
  const totalValue = assets.reduce((s, a) => s + a.currentValue, 0);
  const monthlyDep = assets.filter(a => a.status === "In Use").reduce((s, a) => {
    if (a.depreciationMethod === "declining") return s + (a.currentValue * 2 / a.usefulLifeYears / 12);
    return s + ((a.purchaseCost - a.salvageValue) / a.usefulLifeYears / 12);
  }, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="資產登記冊" description="管理公司固定資產，追蹤資產價值與折舊" />

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="資產"
          entityEndpoint="assets"
          ids={batch.ids}
          batchFields={[
            { key: "categoryId", label: "類別（放進同一類別）", type: "select", options: categories.map(c => ({ value: String(c.id), label: c.name })) },
            { key: "assignedTo", label: "保管人", type: "select", options: [{ value: "__none__", label: "（不指定）" }, ...employees.map(e => ({ value: String(e.id), label: e.fullName }))] },
            { key: "location", label: "存放位置", type: "text", clearable: true },
            { key: "warrantyExpiry", label: "保固到期日", type: "date", clearable: true },
            { key: "remarks", label: "備註", type: "text", clearable: true },
          ] as BatchField[]}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><Package className="h-8 w-8 text-blue-500" /><div><p className="text-sm text-gray-500">資產總數</p><p className="text-2xl font-bold">{totalAssets}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><DollarSign className="h-8 w-8 text-green-500" /><div><p className="text-sm text-gray-500">資產總值</p><p className="text-2xl font-bold">${totalValue.toLocaleString()}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><TrendingDown className="h-8 w-8 text-orange-500" /><div><p className="text-sm text-gray-500">月折舊額</p><p className="text-2xl font-bold">${Math.round(monthlyDep).toLocaleString()}</p></div></div></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input className="pl-9" placeholder="搜尋資產..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <select className="border rounded-md px-3 py-2 text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">所有狀態</option>
          {Object.entries(statusMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <LookupSelect className="border rounded-md px-3 py-2 text-sm" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="">所有類別</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </LookupSelect>
        <LookupSelect className="border rounded-md px-3 py-2 text-sm" value={filterDepartment} onChange={e => setFilterDepartment(e.target.value)}>
          <option value="">所有部門</option>
          {departments.map(d => <option key={d.id} value={d.id}>{departmentLabel(d)}</option>)}
        </LookupSelect>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />新增資產</Button>
        <DocWindow
          open={open} onClose={() => setOpen(false)} name="新增固定資產"
          footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={!form.name || !form.categoryId || !form.purchaseCost}>建立</Button>
          </>}
        >
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">資產名稱 *</label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="資產名稱" /></div>
                <div>
                  <label className="text-sm font-medium">資產類別 *</label>
                  <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.categoryId} onChange={e => onSelectCategory(e.target.value)}>
                    <option value="">選擇類別</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </LookupSelect>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">購入日期 *</label><Input type="date" value={form.purchaseDate} onChange={e => setForm(p => ({ ...p, purchaseDate: e.target.value }))} /></div>
                <div><label className="text-sm font-medium">購入成本 *</label><Input type="number" min="0" value={form.purchaseCost} onChange={e => setForm(p => ({ ...p, purchaseCost: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium">折舊方式</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.depreciationMethod} onChange={e => setForm(p => ({ ...p, depreciationMethod: e.target.value }))}>
                    <option value="straight-line">直線法</option>
                    <option value="declining">定率遞減法</option>
                  </select>
                </div>
                <div><label className="text-sm font-medium">使用年限 *</label><Input type="number" min="1" value={form.usefulLifeYears} onChange={e => setForm(p => ({ ...p, usefulLifeYears: e.target.value }))} /></div>
                <div><label className="text-sm font-medium">殘值</label><Input type="number" min="0" value={form.salvageValue} onChange={e => setForm(p => ({ ...p, salvageValue: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">部門</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.departmentId} onChange={e => setForm(p => ({ ...p, departmentId: e.target.value }))}>
                    <option value="">選擇部門</option>
                    {selectableDepartments(departments, form.departmentId).map(d => <option key={d.id} value={d.id}>{departmentLabel(d)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">指派給</label>
                  <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.assignedTo} onChange={e => setForm(p => ({ ...p, assignedTo: e.target.value }))}>
                    <option value="">選擇員工</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                  </LookupSelect>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">存放位置</label><Input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="存放位置" /></div>
                <div><label className="text-sm font-medium">序號</label><Input value={form.serialNumber} onChange={e => setForm(p => ({ ...p, serialNumber: e.target.value }))} placeholder="序號" /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">保固到期</label><Input type="date" value={form.warrantyExpiry} onChange={e => setForm(p => ({ ...p, warrantyExpiry: e.target.value }))} /></div>
                <div><label className="text-sm font-medium">備註</label><Input value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} placeholder="備註" /></div>
              </div>
              {form.purchaseCost && form.usefulLifeYears && (
                <Card className="bg-blue-50">
                  <CardContent className="pt-3 pb-3">
                    <p className="text-sm font-medium text-blue-700">折舊預覽</p>
                    <p className="text-xs text-blue-600">
                      月折舊額：${Math.round((Number(form.purchaseCost) - Number(form.salvageValue)) / Number(form.usefulLifeYears) / 12).toLocaleString()}
                      {" "}| 年折舊額：${Math.round((Number(form.purchaseCost) - Number(form.salvageValue)) / Number(form.usefulLifeYears)).toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
        </DocWindow>
      </div>

      <Card>
        <CardHeader className="py-3 border-b"><CardTitle>資產列表</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50/50">
                <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                <th className="text-left px-4 py-2.5 font-semibold">資產編號</th>
                <th className="text-left px-4 py-2.5 font-semibold">名稱</th>
                <th className="text-left px-4 py-2.5 font-semibold">類別</th>
                <th className="text-left px-4 py-2.5 font-semibold">部門</th>
                <th className="text-left px-4 py-2.5 font-semibold">狀態</th>
                <th className="text-right px-4 py-2.5 font-semibold">購入成本</th>
                <th className="text-right px-4 py-2.5 font-semibold">帳面價值</th>
                <th className="text-center px-4 py-2.5 font-semibold">操作</th>
              </tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
                ) : filtered.map(a => (
                  <tr key={a.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => viewDetail(a.id)} data-testid={`asset-row-${a.id}`}>
                    <td className="px-2" onClick={e => e.stopPropagation()}><CheckboxCell checked={batch.selectedIds.has(a.id)} onChange={() => batch.toggle(a.id)} /></td>
                    <td className="px-4 py-2 font-medium font-mono">{a.assetNumber}</td>
                    <td className="px-4 py-2">{a.name}</td>
                    <td className="px-4 py-2 text-gray-500">{a.categoryName}</td>
                    <td className="px-4 py-2 text-gray-500">{a.departmentName || "-"}</td>
                    <td className="px-4 py-2"><Badge variant={statusColor(a.status)}>{statusMap[a.status] || a.status}</Badge></td>
                    <td className="px-4 py-2 text-right font-mono">${a.purchaseCost.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono">${a.currentValue.toLocaleString()}</td>
                    <td className="px-4 py-2 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1 justify-center">
                        <Button size="sm" variant="outline" onClick={() => viewDetail(a.id)} title="檢視"><Eye className="h-3 w-3" /></Button>
                        {a.status !== "Scrapped" && a.status !== "Sold" && (
                          <Button size="sm" variant="outline" onClick={() => editFromRow(a.id)} title="編輯" aria-label="編輯資產"><Pencil className="h-3 w-3" /></Button>
                        )}
                        {a.status === "Draft" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => updateStatus(a.id, "Submitted")} title="確認"><Check className="h-3 w-3" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDelete(a.id)} title="刪除"><Trash2 className="h-3 w-3" /></Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 資產明細：標題列 → 表頭欄位 → 折舊／調撥／價值調整／維護紀錄 → 底部按鈕列 */}
      <DocWindow
        open={!!detailItem} onClose={() => setDetailItem(null)} wide
        name="資產" number={detailItem?.assetNumber}
        status={detailItem ? <DocStatus label={statusMap[detailItem.status] || detailItem.status} tone={statusTone(detailItem.status)} /> : undefined}
        footer={detailItem && <>
          {detailItem.status === "Draft" && <Button variant="destructive" className="mr-auto" onClick={() => handleDelete(detailItem.id)}>刪除</Button>}
          {detailItem.status === "In Use" && <Button variant="destructive" className="mr-auto" onClick={() => { setDisposeForm({ disposalDate: new Date().toISOString().slice(0, 10), disposalAmount: "0", type: "Scrapped" }); setDisposeOpen(true); }}>報廢/出售</Button>}
          <Button variant="outline" onClick={() => setDetailItem(null)}>關閉</Button>
          {(detailItem.status === "Draft" || detailItem.status === "Submitted" || detailItem.status === "In Use") && (
            <Button variant="outline" onClick={() => openEdit()}><Pencil className="h-3 w-3 mr-1" />編輯</Button>
          )}
          {detailItem.status === "In Use" && (
            <>
              <Button variant="outline" onClick={() => { setTransferForm({ toDepartmentId: "", toLocation: "", reason: "", movementDate: new Date().toISOString().slice(0, 10) }); setTransferOpen(true); }}><ArrowRightLeft className="h-3 w-3 mr-1" />調撥</Button>
              <Button variant="outline" onClick={() => { setAdjustForm({ newValue: String(detailItem.currentValue), reason: "", adjustmentDate: new Date().toISOString().slice(0, 10) }); setAdjustOpen(true); }}><DollarSign className="h-3 w-3 mr-1" />調整價值</Button>
            </>
          )}
          {detailItem.status === "Draft" && <Button onClick={() => updateStatus(detailItem.id, "Submitted")}>確認資產</Button>}
          {detailItem.status === "Submitted" && <Button onClick={() => updateStatus(detailItem.id, "In Use")}>啟用</Button>}
        </>}
      >
        {detailItem && (
          <>
            <DocFields items={[
              ["名稱", detailItem.name],
              ["類別", detailItem.categoryName],
              ["購入日期", detailItem.purchaseDate],
              ["購入成本", <span className="font-mono">${detailItem.purchaseCost.toLocaleString()}</span>],
              ["帳面價值", <span className="font-mono font-bold">${detailItem.currentValue.toLocaleString()}</span>],
              ["折舊方式", methodMap[detailItem.depreciationMethod]],
              ["使用年限", `${detailItem.usefulLifeYears} 年`],
              ["殘值", <span className="font-mono">${detailItem.salvageValue.toLocaleString()}</span>],
              ["累計折舊", <span className="font-mono">${detailItem.accumulatedDepreciation.toLocaleString()}</span>],
              ["部門", detailItem.departmentName || "-"],
              ["指派給", detailItem.assignedToName || "-"],
              ["位置", detailItem.location],
              ["序號", detailItem.serialNumber],
              ["保固到期", detailItem.warrantyExpiry],
              ["處分日期", detailItem.disposalDate],
              detailItem.disposalAmount !== null && ["處分金額", <span className="font-mono">${detailItem.disposalAmount.toLocaleString()}</span>],
            ]} />

            {detailItem.depreciationEntries.length > 0 && (
              <DocSection title="折舊紀錄">
                <DocLines
                  columns={[
                    { header: "期間", cell: (e: AssetDetail["depreciationEntries"][number]) => e.period },
                    { header: "折舊額", align: "right", cell: (e: AssetDetail["depreciationEntries"][number]) => `$${e.depreciationAmount.toLocaleString()}` },
                    { header: "累計折舊", align: "right", cell: (e: AssetDetail["depreciationEntries"][number]) => `$${e.accumulatedAmount.toLocaleString()}` },
                    { header: "帳面價值", align: "right", cell: (e: AssetDetail["depreciationEntries"][number]) => `$${e.bookValue.toLocaleString()}` },
                    { header: "日記帳", cell: (e: AssetDetail["depreciationEntries"][number]) => e.journalEntryId ? <Badge variant="secondary">JE#{e.journalEntryId}</Badge> : "-" },
                  ]}
                  rows={detailItem.depreciationEntries}
                />
              </DocSection>
            )}

            {detailItem.movements.length > 0 && (
              <DocSection title="調撥紀錄">
                <DocLines
                  columns={[
                    { header: "日期", cell: (m: AssetDetail["movements"][number]) => m.movementDate },
                    { header: "從", cell: (m: AssetDetail["movements"][number]) => m.fromDeptName || m.fromLocation || "-" },
                    { header: "至", cell: (m: AssetDetail["movements"][number]) => m.toDeptName || m.toLocation || "-" },
                    { header: "原因", cell: (m: AssetDetail["movements"][number]) => m.reason || "-" },
                  ]}
                  rows={detailItem.movements}
                />
              </DocSection>
            )}

            {detailItem.adjustments.length > 0 && (
              <DocSection title="價值調整紀錄">
                <DocLines
                  columns={[
                    { header: "日期", cell: (a: AssetDetail["adjustments"][number]) => a.adjustmentDate },
                    { header: "原值", align: "right", cell: (a: AssetDetail["adjustments"][number]) => `$${a.previousValue.toLocaleString()}` },
                    { header: "新值", align: "right", cell: (a: AssetDetail["adjustments"][number]) => `$${a.newValue.toLocaleString()}` },
                    { header: "調整額", align: "right", cell: (a: AssetDetail["adjustments"][number]) => `$${a.adjustmentAmount.toLocaleString()}` },
                    { header: "原因", cell: (a: AssetDetail["adjustments"][number]) => a.reason },
                  ]}
                  rows={detailItem.adjustments}
                />
              </DocSection>
            )}

            {detailItem.maintenance.length > 0 && (
              <DocSection title="維護紀錄">
                <DocLines
                  columns={[
                    { header: "類型", cell: (m: AssetDetail["maintenance"][number]) => m.maintenanceType },
                    { header: "排程日期", cell: (m: AssetDetail["maintenance"][number]) => m.scheduledDate },
                    { header: "狀態", cell: (m: AssetDetail["maintenance"][number]) => <Badge variant="secondary">{m.status}</Badge> },
                    { header: "費用", align: "right", cell: (m: AssetDetail["maintenance"][number]) => `$${m.cost.toLocaleString()}` },
                  ]}
                  rows={detailItem.maintenance}
                />
              </DocSection>
            )}

            <DocNote>{detailItem.remarks}</DocNote>
            <RelatedDocs type="asset" id={detailItem.id} onNavigate={() => setDetailItem(null)} />
          </>
        )}
      </DocWindow>

      <DocWindow
        open={editOpen} onClose={() => setEditOpen(false)}
        name="編輯資產" number={detailItem?.assetNumber}
        status={detailItem ? <DocStatus label={statusMap[detailItem.status] || detailItem.status} tone={statusTone(detailItem.status)} /> : undefined}
        footer={<>
          <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
          <Button onClick={handleEdit} disabled={!editForm.name}>更新</Button>
        </>}
      >
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="text-sm font-medium">資產名稱 *</label><Input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div>
                <label className="text-sm font-medium">資產類別</label>
                <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={editForm.categoryId} onChange={e => setEditForm(p => ({ ...p, categoryId: e.target.value }))}>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </LookupSelect>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium">折舊方式</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm" value={editForm.depreciationMethod} onChange={e => setEditForm(p => ({ ...p, depreciationMethod: e.target.value }))}>
                  <option value="straight-line">直線法</option>
                  <option value="declining">定率遞減法</option>
                </select>
              </div>
              <div><label className="text-sm font-medium">使用年限</label><Input type="number" min="1" value={editForm.usefulLifeYears} onChange={e => setEditForm(p => ({ ...p, usefulLifeYears: e.target.value }))} /></div>
              <div><label className="text-sm font-medium">殘值</label><Input type="number" min="0" value={editForm.salvageValue} onChange={e => setEditForm(p => ({ ...p, salvageValue: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">部門</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm" value={editForm.departmentId} onChange={e => setEditForm(p => ({ ...p, departmentId: e.target.value }))}>
                  <option value="">無</option>
                  {selectableDepartments(departments, editForm.departmentId).map(d => <option key={d.id} value={d.id}>{departmentLabel(d)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">指派給</label>
                <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={editForm.assignedTo} onChange={e => setEditForm(p => ({ ...p, assignedTo: e.target.value }))}>
                  <option value="">無</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                </LookupSelect>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="text-sm font-medium">存放位置</label><Input value={editForm.location} onChange={e => setEditForm(p => ({ ...p, location: e.target.value }))} /></div>
              <div><label className="text-sm font-medium">序號</label><Input value={editForm.serialNumber} onChange={e => setEditForm(p => ({ ...p, serialNumber: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="text-sm font-medium">保固到期</label><Input type="date" value={editForm.warrantyExpiry} onChange={e => setEditForm(p => ({ ...p, warrantyExpiry: e.target.value }))} /></div>
              <div><label className="text-sm font-medium">備註</label><Input value={editForm.remarks} onChange={e => setEditForm(p => ({ ...p, remarks: e.target.value }))} /></div>
            </div>
          </div>
      </DocWindow>

      <DocWindow
        open={disposeOpen} onClose={() => setDisposeOpen(false)}
        name="資產處分" number={detailItem?.assetNumber} description={detailItem?.name}
        footer={<>
          <Button variant="outline" onClick={() => setDisposeOpen(false)}>取消</Button>
          <Button variant="destructive" onClick={handleDispose}>確認處分</Button>
        </>}
      >
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">處分方式</label>
              <select className="w-full border rounded-md px-3 py-2 text-sm" value={disposeForm.type} onChange={e => setDisposeForm(p => ({ ...p, type: e.target.value }))}>
                <option value="Scrapped">報廢</option>
                <option value="Sold">出售</option>
              </select>
            </div>
            <div><label className="text-sm font-medium">處分日期</label><Input type="date" value={disposeForm.disposalDate} onChange={e => setDisposeForm(p => ({ ...p, disposalDate: e.target.value }))} /></div>
            {disposeForm.type === "Sold" && (
              <>
                <div><label className="text-sm font-medium">出售金額</label><Input type="number" min="0" value={disposeForm.disposalAmount} onChange={e => setDisposeForm(p => ({ ...p, disposalAmount: e.target.value }))} /></div>
                <div><label className="text-sm font-medium">收款帳戶</label><CashAccountSelect value={saleCashAccountId} onChange={setSaleCashAccountId} /></div>
              </>
            )}
            {detailItem && (
              <div className="text-sm text-gray-500">
                帳面價值：${detailItem.currentValue.toLocaleString()}
                {disposeForm.type === "Sold" && Number(disposeForm.disposalAmount) > 0 && (
                  <span className="ml-2">
                    {Number(disposeForm.disposalAmount) > detailItem.currentValue ? "處分利益" : "處分損失"}：
                    ${Math.abs(Number(disposeForm.disposalAmount) - detailItem.currentValue).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
      </DocWindow>

      <DocWindow
        open={transferOpen} onClose={() => setTransferOpen(false)}
        name="資產調撥" number={detailItem?.assetNumber} description={detailItem?.name}
        footer={<>
          <Button variant="outline" onClick={() => setTransferOpen(false)}>取消</Button>
          <Button onClick={handleTransfer} disabled={!transferForm.toDepartmentId && !transferForm.toLocation}>確認調撥</Button>
        </>}
      >
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">目標部門</label>
              <select className="w-full border rounded-md px-3 py-2 text-sm" value={transferForm.toDepartmentId} onChange={e => setTransferForm(p => ({ ...p, toDepartmentId: e.target.value }))}>
                <option value="">選擇部門</option>
                {selectableDepartments(departments, transferForm.toDepartmentId).map(d => <option key={d.id} value={d.id}>{departmentLabel(d)}</option>)}
              </select>
            </div>
            <div><label className="text-sm font-medium">目標位置</label><Input value={transferForm.toLocation} onChange={e => setTransferForm(p => ({ ...p, toLocation: e.target.value }))} placeholder="新位置" /></div>
            <div><label className="text-sm font-medium">調撥日期</label><Input type="date" value={transferForm.movementDate} onChange={e => setTransferForm(p => ({ ...p, movementDate: e.target.value }))} /></div>
            <div><label className="text-sm font-medium">調撥原因</label><Input value={transferForm.reason} onChange={e => setTransferForm(p => ({ ...p, reason: e.target.value }))} placeholder="調撥原因" /></div>
          </div>
      </DocWindow>

      <DocWindow
        open={adjustOpen} onClose={() => setAdjustOpen(false)}
        name="價值調整" number={detailItem?.assetNumber} description={detailItem?.name}
        footer={<>
          <Button variant="outline" onClick={() => setAdjustOpen(false)}>取消</Button>
          <Button onClick={handleAdjust} disabled={!adjustForm.newValue || !adjustForm.reason}>確認調整</Button>
        </>}
      >
          <div className="space-y-4">
            {detailItem && <div className="text-sm text-gray-500">目前帳面價值：${detailItem.currentValue.toLocaleString()}</div>}
            <div><label className="text-sm font-medium">新帳面價值 *</label><Input type="number" min="0" value={adjustForm.newValue} onChange={e => setAdjustForm(p => ({ ...p, newValue: e.target.value }))} /></div>
            <div><label className="text-sm font-medium">調整原因 *</label><Input value={adjustForm.reason} onChange={e => setAdjustForm(p => ({ ...p, reason: e.target.value }))} placeholder="調整原因" /></div>
            <div><label className="text-sm font-medium">調整日期</label><Input type="date" value={adjustForm.adjustmentDate} onChange={e => setAdjustForm(p => ({ ...p, adjustmentDate: e.target.value }))} /></div>
            {detailItem && adjustForm.newValue && (
              <div className="text-sm">
                調整金額：<span className={Number(adjustForm.newValue) > detailItem.currentValue ? "text-green-600" : "text-red-600"}>
                  ${(Number(adjustForm.newValue) - detailItem.currentValue).toLocaleString()}
                </span>
              </div>
            )}
          </div>
      </DocWindow>
    </div>
  );
}
