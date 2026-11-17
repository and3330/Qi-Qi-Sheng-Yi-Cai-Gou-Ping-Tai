import { useState } from "react";
import { PaymentTermField } from "@/components/shared/payment-term";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { ExportMenu } from "@/components/shared/export-menu";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DocWindow } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, Pencil, Trash2 } from "lucide-react";
import { useLocation } from "wouter";
import type { ExportOptions } from "@/lib/export-utils";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = (p: string) => `/erp-api/${p}`;

type SupForm = {
  supplierCode: string; name: string; shortName: string; email: string;
  phone: string; mobile: string; contactPerson: string;
  address: string; city: string; country: string; taxId: string; category: string; paymentTermId: string;
};
const emptyForm: SupForm = {
  supplierCode: "", name: "", shortName: "", email: "", phone: "", mobile: "",
  contactPerson: "", address: "", city: "", country: "", paymentTermId: "", taxId: "", category: "一般供應商",
};

export default function SuppliersPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<SupForm>(emptyForm);
  // 停用的供應商資料都還在，只是開單時選不到；這裡可以切換著看
  const [activeFilter, setActiveFilter] = useState("active");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["/erp-api/suppliers", search, activeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (activeFilter !== "active") params.set("includeInactive", "1");
      const q = params.toString();
      const res = await fetch(api(`suppliers${q ? `?${q}` : ""}`));
      if (!res.ok) throw new Error("載入供應商失敗");
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      return activeFilter === "inactive" ? list.filter((s: any) => s.isActive === false) : list;
    },
  });

  const batch = useBatchSelection(suppliers);
  const batchFields: BatchField[] = [{key:"status",label:"狀態",type:"select",options:[{value:"Active",label:"活躍"},{value:"Inactive",label:"停用"}]}];

  const saveMut = useMutation({
    mutationFn: async (data: { id?: number; body: SupForm }) => {
      const url = data.id ? api(`suppliers/${data.id}`) : api("suppliers");
      const res = await fetch(url, {
        method: data.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data.body),
      });
      if (!res.ok) throw new Error((await res.json()).error || "操作失敗");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/erp-api/suppliers"] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(api(`suppliers/${id}`), { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "刪除失敗");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/erp-api/suppliers"] }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, supplierCode: `S-${Date.now().toString().slice(-6)}` });
    setOpen(true);
  };
  const openEdit = (s: any) => {
    setEditing(s);
    setForm({
      supplierCode: s.supplierCode || "", name: s.name || "", shortName: s.shortName || "",
      email: s.email || "", phone: s.phone || "", mobile: s.mobile || "",
      contactPerson: s.contactPerson || "",
      address: s.address || "", city: s.city || "", country: s.country || "",
      taxId: s.taxId || "", category: s.category || "一般供應商",
      paymentTermId: s.paymentTermId ? String(s.paymentTermId) : "",
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name) { toast({ title: "請填寫供應商名稱", variant: "destructive" }); return; }
    try {
      await saveMut.mutateAsync({ id: editing?.id, body: form });
      toast({ title: editing ? "供應商已更新" : "供應商已建立" });
      setOpen(false);
    } catch (err: any) {
      toast({ title: "操作失敗", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (s: any) => {
    if (!confirm(`確定刪除供應商「${s.name}」？`)) return;
    try {
      await deleteMut.mutateAsync(s.id);
      toast({ title: "供應商已刪除" });
    } catch (err: any) {
      toast({ title: "刪除失敗", description: err.message, variant: "destructive" });
    }
  };

  const F = (key: keyof SupForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [key]: e.target.value }));

  const buildExport = (): ExportOptions => ({
    title: "供應商清單",
    fileName: "供應商清單",
    headers: ["編號", "供應商名稱", "簡稱", "聯絡人", "電話", "地址"],
    columnKeys: ["code", "name", "shortName", "contactPerson", "phone", "address"],
    rows: suppliers.map((s: any) => ({
      code: s.supplierCode || "-",
      name: s.name || "-",
      shortName: s.shortName || "-",
      contactPerson: s.contactPerson || "-",
      phone: s.phone || s.mobile || "-",
      address: s.address || "-",
    })),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="供應商管理" description={`共 ${suppliers.length} 家供應商`}>
        <ExportMenu getExportOptions={buildExport} />
        <Button onClick={openCreate}><Plus size={16} className="mr-1" />新增供應商</Button>
      </PageHeader>

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="供應商"
          entityEndpoint="suppliers"
          ids={batch.ids}
          batchFields={batchFields}
          onClear={batch.clearSelection}
          onComplete={() => qc.invalidateQueries({ queryKey: ["/erp-api/suppliers"] })}
        />
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="搜尋供應商名稱、編號、簡稱..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select aria-label="啟用狀態" className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm w-full sm:w-32" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)} data-testid="select-active-filter">
          <option value="active">啟用中</option>
          <option value="inactive">已停用</option>
          <option value="all">全部</option>
        </select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                  <th className="text-left px-4 py-3 font-medium">編號</th>
                  <th className="text-left px-4 py-3 font-medium">供應商名稱</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">簡稱</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">聯絡人</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">電話</th>
                  <th className="text-left px-4 py-3 font-medium hidden xl:table-cell">地址</th>
                  <th className="text-left px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">載入中...</td></tr>
                ) : suppliers.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">無資料</td></tr>
                ) : (
                  suppliers.map((s: any) => (
                    <tr key={s.id} className="border-b hover:bg-muted/30">
                      <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(s.id)} onChange={() => batch.toggle(s.id)} /></td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{s.supplierCode || "-"}</td>
                      <td className="px-4 py-2.5 font-medium">{s.name}{s.isActive === false && <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">已停用</span>}</td>
                      <td className="px-4 py-2.5 hidden md:table-cell text-muted-foreground">{s.shortName || "-"}</td>
                      <td className="px-4 py-2.5 hidden md:table-cell">{s.contactPerson || "-"}</td>
                      <td className="px-4 py-2.5 hidden lg:table-cell">{s.phone || s.mobile || "-"}</td>
                      <td className="px-4 py-2.5 hidden xl:table-cell text-xs text-muted-foreground max-w-[200px] truncate">{s.address || "-"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="whitespace-nowrap" onClick={() => navigate(`/purchasing/orders?supplierId=${s.id}`)}>開採購單</Button>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(s)}><Pencil size={14} /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(s)}><Trash2 size={14} className="text-destructive" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 新增／編輯供應商：外框用全系統共用的單據視窗 */}
      <DocWindow
        open={open}
        onClose={() => setOpen(false)}
        name={editing ? "編輯供應商" : "新增供應商"}
        footer={<>
            {editing && (
              <Button type="button" variant="ghost" className="mr-auto" data-testid="button-toggle-active" onClick={async () => {
                const next = editing.isActive === false;
                if (!next && !confirm(`確定停用「${editing.name}」？\n資料和歷史單據都會保留，只是開單時不會再出現在選單裡，之後可以隨時恢復。`)) return;
                const res = await fetch(api(`suppliers/${editing.id}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: next }) });
                if (!res.ok) { toast({ title: "操作失敗", variant: "destructive" }); return; }
                toast({ title: next ? "已恢復啟用" : "已停用" });
                qc.invalidateQueries({ queryKey: ["/erp-api/suppliers"] });
                setOpen(false);
              }}>{editing.isActive === false ? "恢復啟用" : "停用這個供應商"}</Button>
            )}
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saveMut.isPending}>
              {saveMut.isPending ? "處理中..." : editing ? "更新" : "建立"}
            </Button>
        </>}
      >
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>供應商編號</Label><Input value={form.supplierCode} onChange={F("supplierCode")} /></div>
              <div><Label>供應商名稱 *</Label><Input value={form.name} onChange={F("name")} /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>簡稱</Label><Input value={form.shortName} onChange={F("shortName")} /></div>
              <div><Label>聯絡人</Label><Input value={form.contactPerson} onChange={F("contactPerson")} /></div>
            </div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={F("email")} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>電話</Label><Input value={form.phone} onChange={F("phone")} /></div>
              <div><Label>手機</Label><Input value={form.mobile} onChange={F("mobile")} /></div>
            </div>
            <div><Label>地址</Label><Input value={form.address} onChange={F("address")} /></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><Label>城市</Label><Input value={form.city} onChange={F("city")} /></div>
              <div><Label>國家</Label><Input value={form.country} onChange={F("country")} /></div>
              <div><Label>統編</Label><Input value={form.taxId} onChange={F("taxId")} /></div>
            </div>
            <PaymentTermField value={form.paymentTermId} onChange={(value) => setForm({ ...form, paymentTermId: value })} label="預設付款條件" />
          </div>
      </DocWindow>
    </div>
  );
}
