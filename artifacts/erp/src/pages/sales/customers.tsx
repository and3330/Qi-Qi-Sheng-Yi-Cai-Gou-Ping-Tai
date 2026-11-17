import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, Pencil, Trash2 } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useLocation } from "wouter";
import { ExportMenu } from "@/components/shared/export-menu";
import type { ExportOptions } from "@/lib/export-utils";

import { LookupSelect } from "@/components/shared/lookup-select";
import { CustomerFormDialog, CUSTOMER_CATEGORIES as categories, readJsonResponse } from "@/components/sales/customer-form-dialog";
const api = (p: string) => `/erp-api/${p}`;

export default function CustomersPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  // 停用的客戶資料都還在，只是開單時選不到；這裡可以切換著看
  const [activeFilter, setActiveFilter] = useState("active");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: customers = [], isLoading, isError, error: listError, refetch } = useQuery<any[]>({
    queryKey: ["/erp-api/customers", search, catFilter, activeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (catFilter) params.set("category", catFilter);
      if (activeFilter !== "active") params.set("includeInactive", "1");
      const q = params.toString();
      const res = await fetch(api(`customers${q ? `?${q}` : ""}`));
      const payload = await readJsonResponse<unknown>(res, "無法載入客戶資料，請稍後再試。");
      if (!Array.isArray(payload)) throw new Error("客戶資料格式不正確，請稍後再試。");
      return activeFilter === "inactive" ? payload.filter((c: any) => c.isActive === false) : payload;
    },
  });

  const batch = useBatchSelection(customers);
  const customerBatchFields: BatchField[] = [
    {key:"status",label:"狀態",type:"select",options:[{value:"Active",label:"活躍"},{value:"Inactive",label:"停用"}]},
  ];

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(api(`customers/${id}`), { method: "DELETE" });
      if (!res.ok) await readJsonResponse(res, "無法刪除客戶，請稍後再試。");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/erp-api/customers"] }),
  });

  // 新增和編輯開的是全系統共用的客戶視窗，存檔由視窗自己處理
  const openCreate = () => { setEditing(null); setOpen(true); };
  const openEdit = (c: any) => { setEditing(c); setOpen(true); };

  const handleDelete = async (c: any) => {
    if (deleteMut.isPending) return;
    if (!confirm(`確定刪除客戶「${c.name}」？`)) return;
    try {
      await deleteMut.mutateAsync(c.id);
      toast({ title: "客戶已刪除" });
    } catch (err: any) {
      toast({ title: "刪除失敗", description: err.message, variant: "destructive" });
    }
  };

  const buildExport = (): ExportOptions => ({
    title: "客戶管理",
    fileName: "客戶清單",
    headers: ["編號", "客戶名稱", "簡稱", "分類", "統編", "聯絡人", "電話", "Email", "業務"],
    columnKeys: ["customerCode", "name", "shortName", "category", "taxId", "contactPerson", "phone", "email", "salesPerson"],
    rows: customers.map((c: any) => ({
      customerCode: c.customerCode || "-",
      name: c.name || "-",
      shortName: c.shortName || "-",
      category: c.category || "一般",
      taxId: c.taxId || "-",
      contactPerson: c.contactPerson || "-",
      phone: c.phone || c.mobile || "-",
      email: c.email || "-",
      salesPerson: c.salesPerson || "-",
    })),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="客戶管理" description={isError ? "目前無法取得客戶數量" : `共 ${customers.length} 位客戶`}>
        {!isError && <ExportMenu getExportOptions={buildExport} />}
        <Button onClick={openCreate}><Plus size={16} className="mr-1" />新增客戶</Button>
      </PageHeader>

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="客戶"
          entityEndpoint="customers"
          ids={batch.ids}
          batchFields={customerBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => qc.invalidateQueries({ queryKey: ["/erp-api/customers"] })}
        />
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="搜尋客戶名稱、編號、簡稱、聯絡人..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <LookupSelect className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm w-full sm:w-40" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">全部分類</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </LookupSelect>
        <select aria-label="啟用狀態" className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm w-full sm:w-32" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)} data-testid="select-active-filter">
          <option value="active">啟用中</option>
          <option value="inactive">已停用</option>
          <option value="all">全部</option>
        </select>
      </div>

      {isError && (
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <p className="font-medium text-destructive">客戶資料載入失敗</p>
            <p className="text-sm text-muted-foreground">
              {listError instanceof Error ? listError.message : "無法載入客戶資料，請稍後再試。"}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>重新載入</Button>
          </CardContent>
        </Card>
      )}

      <div className="md:hidden space-y-3">
        {isLoading && <Card><CardContent className="p-6 text-center text-muted-foreground">載入中...</CardContent></Card>}
        {!isLoading && !isError && customers.length === 0 && <Card><CardContent className="p-6 text-center text-muted-foreground">無資料</CardContent></Card>}
        {!isLoading && !isError && customers.map((c: any) => (
          <Card key={c.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={batch.selectedIds.has(c.id)}
                    onChange={() => batch.toggle(c.id)}
                  />
                  <div>
                    <div className="font-medium">{c.name}{c.isActive === false && <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">已停用</span>}</div>
                    <div className="text-xs text-muted-foreground font-mono">{c.customerCode || "-"}</div>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${
                  c.category === "企業客戶" ? "bg-blue-100 text-blue-700" :
                  c.category === "學校客戶" ? "bg-green-100 text-green-700" :
                  c.category === "補教機構" ? "bg-purple-100 text-purple-700" :
                  c.category === "個人客戶" ? "bg-gray-100 text-gray-700" :
                  "bg-amber-100 text-amber-700"
                }`}>{c.category || "一般"}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {c.contactPerson && <><div className="text-muted-foreground">聯絡人</div><div className="text-right">{c.contactPerson}</div></>}
                {(c.phone || c.mobile) && <><div className="text-muted-foreground">電話</div><div className="text-right">{c.phone || c.mobile}</div></>}
                {c.salesPerson && <><div className="text-muted-foreground">業務</div><div className="text-right">{c.salesPerson}</div></>}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Button variant="outline" size="sm" className="h-8" onClick={() => navigate(`/sales/quotations?customerId=${c.id}`)}>開報價單</Button>
                <Button variant="outline" size="sm" className="h-8" onClick={() => navigate(`/sales/orders?customerId=${c.id}`)}>開訂單</Button>
                <Button variant="ghost" size="sm" className="h-8" onClick={() => openEdit(c)}><Pencil size={14} className="mr-1" />編輯</Button>
                <Button variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => handleDelete(c)}><Trash2 size={14} className="mr-1" />刪除</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                  <th className="text-left px-4 py-3 font-medium">編號</th>
                  <th className="text-left px-4 py-3 font-medium">客戶名稱</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">簡稱</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">分類</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">聯絡人</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">電話</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">業務</th>
                  <th className="text-left px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">載入中...</td></tr>
                ) : isError ? (
                  <tr><td colSpan={9} className="text-center py-8 text-destructive">載入失敗，請使用上方按鈕重新載入</td></tr>
                ) : customers.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">無資料</td></tr>
                ) : (
                  customers.map((c: any) => (
                    <tr key={c.id} className="border-b hover:bg-muted/30">
                      <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(c.id)} onChange={() => batch.toggle(c.id)} /></td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{c.customerCode || "-"}</td>
                      <td className="px-4 py-2.5 font-medium">{c.name}{c.isActive === false && <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">已停用</span>}</td>
                      <td className="px-4 py-2.5 hidden md:table-cell text-muted-foreground">{c.shortName || "-"}</td>
                      <td className="px-4 py-2.5 hidden lg:table-cell">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          c.category === "企業客戶" ? "bg-blue-100 text-blue-700" :
                          c.category === "學校客戶" ? "bg-green-100 text-green-700" :
                          c.category === "補教機構" ? "bg-purple-100 text-purple-700" :
                          c.category === "個人客戶" ? "bg-gray-100 text-gray-700" :
                          "bg-amber-100 text-amber-700"
                        }`}>{c.category || "一般"}</span>
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell">{c.contactPerson || "-"}</td>
                      <td className="px-4 py-2.5 hidden lg:table-cell">{c.phone || c.mobile || "-"}</td>
                      <td className="px-4 py-2.5 hidden sm:table-cell text-muted-foreground">{c.salesPerson || "-"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="whitespace-nowrap" onClick={() => navigate(`/sales/quotations?customerId=${c.id}`)}>開報價單</Button>
                          <Button variant="ghost" size="sm" className="whitespace-nowrap" onClick={() => navigate(`/sales/orders?customerId=${c.id}`)}>開訂單</Button>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil size={14} /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(c)}><Trash2 size={14} className="text-destructive" /></Button>
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

      <CustomerFormDialog
        open={open}
        onOpenChange={setOpen}
        customer={editing}
        onSaved={() => qc.invalidateQueries({ queryKey: ["/erp-api/customers"] })}
      />
    </div>
  );
}
