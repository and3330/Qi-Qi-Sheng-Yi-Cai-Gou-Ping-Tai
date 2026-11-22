import { useState, useMemo } from "react";
import { TablePagination } from "@/components/shared/table-pagination";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { ExportMenu } from "@/components/shared/export-menu";
import { PageHint } from "@/components/page-hint";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocWindow, DocStatus } from "@/components/shared/doc-window";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, Eye } from "lucide-react";
import type { ExportOptions } from "@/lib/export-utils";
import { MasterLookup } from "@/components/shared/master-lookup";
import { ItemImageEditor, ItemThumb, useItemImages } from "@/components/inventory/item-image";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;

const FALLBACK_TYPE_COLORS: Record<string, string> = {
  "商品": "bg-blue-100 text-blue-800",
  "無形商品": "bg-purple-100 text-purple-800",
  "產品": "bg-green-100 text-green-800",
  "原料": "bg-orange-100 text-orange-800",
  "半成品": "bg-yellow-100 text-yellow-800",
  "輔助材料": "bg-gray-100 text-gray-800",
};


export default function ItemsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("q") || "");
  const [typeFilter, setTypeFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  // 停用的品項資料都還在，只是開單時選不到；這裡可以切換著看
  const [activeFilter, setActiveFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const { data: allItems = [], isLoading } = useQuery({
    // 品項管理要看得到停用的；用不同的快取名稱，才不會跟開單選單（只有啟用中的）混在一起
    queryKey: ["items", "all"],
    queryFn: () => fetch(api("items?includeInactive=1")).then(r => r.json()),
  });


  const { data: categories = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["item-categories"],
    queryFn: () => fetch(api("item-categories"), { credentials: "include" }).then(r => r.json()),
  });
  const groups = useMemo(() => categories.map((c) => c.name), [categories]);
  const itemImages = useItemImages();

  const { data: itemTypes = [] } = useQuery<{ id: number; name: string; label: string | null; colorClass: string | null }[]>({
    queryKey: ["item-types"],
    queryFn: () => fetch(api("item-types"), { credentials: "include" }).then(r => r.json()),
  });
  const TYPE_LABELS = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of itemTypes) m[t.name] = t.label || t.name;
    return m;
  }, [itemTypes]);
  const TYPE_COLORS = useMemo(() => {
    const m: Record<string, string> = { ...FALLBACK_TYPE_COLORS };
    for (const t of itemTypes) if (t.colorClass) m[t.name] = t.colorClass;
    return m;
  }, [itemTypes]);

  const itemsBatchFields: BatchField[] = useMemo(() => [
    { key: "status", label: "狀態", type: "select", options: [{ value: "Active", label: "啟用" }, { value: "Inactive", label: "停用" }] },
    { key: "itemGroup", label: "分類", type: "select", options: [{ value: "__none__", label: "（未分類）" }, ...categories.map((c) => ({ value: c.name, label: c.name }))] },
    { key: "itemType", label: "類型", type: "select", options: [{ value: "__none__", label: "（未分類）" }, ...itemTypes.map((t) => ({ value: t.name, label: t.label || t.name }))] },
    { key: "unit", label: "單位", type: "text" },
    { key: "supplierName", label: "供應商", type: "text" },
  ], [categories, itemTypes]);

  const { data: types = [] } = useQuery({
    queryKey: ["items-distinct-types"],
    queryFn: () => fetch(api("items/types")).then(r => r.json()),
  });

  const filtered = useMemo(() => {
    let items = allItems;
    if (search) {
      const s = search.toLowerCase();
      items = items.filter((i: any) =>
        i.itemCode?.toLowerCase().includes(s) ||
        i.itemName?.toLowerCase().includes(s) ||
        i.supplierName?.toLowerCase().includes(s)
      );
    }
    if (typeFilter !== "all") items = items.filter((i: any) => i.itemType === typeFilter);
    if (groupFilter !== "all") items = items.filter((i: any) => i.itemGroup === groupFilter);
    if (activeFilter !== "all") items = items.filter((i: any) => (i.status === "Inactive") === (activeFilter === "inactive"));
    return items;
  }, [allItems, search, typeFilter, groupFilter, activeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const batch = useBatchSelection(paged);

  const createMut = useMutation({
    mutationFn: (data: any) => fetch(api("items"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => fetch(api(`items/${id}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => fetch(api(`items/${id}`), { method: "DELETE" }).then(r => { if (!r.ok) throw new Error("Failed"); }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });

  const emptyForm = () => ({
    itemCode: "", itemName: "", itemGroup: "", itemType: "", specification: "", description: "",
    unit: "Nos", sellingPrice: "0", buyingPrice: "0", totalCost: "0",
    materialCost: "0", expenseCost: "0", outsourcingCost: "0", laborCost: "0",
    internalPrice: "0", wholesalePrice: "0", retailPrice: "0",
    svipPrice: "0", peerPrice: "0", dealerPrice: "0",
    supplierName: "", summary: "", currentStock: "0", reorderLevel: "0",
    isVirtual: "false",
  });

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm(), itemCode: `ITM-${Date.now().toString().slice(-6)}` }); setOpen(true); };
  const openEdit = (item: any) => {
    setEditing(item);
    const f: Record<string, string> = {};
    for (const key of Object.keys(emptyForm())) {
      f[key] = String(item[key] ?? emptyForm()[key as keyof ReturnType<typeof emptyForm>] ?? "");
    }
    setForm(f);
    setOpen(true);
  };

  const openDetail = (item: any) => { setDetailItem(item); setDetailOpen(true); };

  const handleSave = async () => {
    if (!form.itemCode || !form.itemName) {
      toast({ title: "請填寫品項代碼與名稱", variant: "destructive" }); return;
    }
    try {
      const payload: any = { ...form, isVirtual: form.isVirtual === "true" };
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: payload });
        toast({ title: "品項已更新" });
      } else {
        await createMut.mutateAsync(payload);
        toast({ title: "品項已建立" });
      }
      setOpen(false);
    } catch (err: any) {
      toast({ title: "操作失敗", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (item: any) => {
    if (!confirm(`確定刪除品項「${item.itemName}」？`)) return;
    try {
      await deleteMut.mutateAsync(item.id);
      toast({ title: "品項已刪除" });
    } catch (err: any) {
      toast({ title: "刪除失敗", description: err.message, variant: "destructive" });
    }
  };

  const F = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [key]: e.target.value }));

  const fmtPrice = (v: number) => v ? `$${v.toLocaleString()}` : "-";

  const buildExport = (): ExportOptions => ({
    title: "品項清單",
    fileName: "品項清單",
    headers: ["品項編碼", "品項名稱", "分類", "類型", "單位", "庫存量", "移動平均成本", "批發價", "終端售價", "供應商"],
    columnKeys: ["code", "name", "group", "type", "unit", "stock", "cost", "wholesalePrice", "retailPrice", "supplier"],
    rows: filtered.map((item: any) => ({
      code: item.itemCode || "-",
      name: item.itemName || "-",
      group: item.itemGroup || "-",
      type: item.itemType ? TYPE_LABELS[item.itemType] || item.itemType : "-",
      unit: item.unit || "-",
      stock: item.currentStock ?? "-",
      cost: fmtPrice(Number(item.movingAvgCost)),
      wholesalePrice: fmtPrice(item.wholesalePrice),
      retailPrice: fmtPrice(item.retailPrice),
      supplier: item.supplierName || "-",
    })),
  });

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allItems.forEach((i: any) => { counts[i.itemType || "未分類"] = (counts[i.itemType || "未分類"] || 0) + 1; });
    return counts;
  }, [allItems]);

  return (
    <div className="space-y-6">
      <PageHeader title="品項管理" description={`共 ${allItems.length} 筆品項`} hint={<PageHint hintKey="inventory-items">這裡維護商品、材料與服務的基本資料，供報價、訂單與庫存共用。新增後請填妥名稱、單位、售價及適用的庫存設定。小提醒：重複建立同一品項會讓庫存與報表被拆開，請先搜尋再新增。</PageHint>}>
        <ExportMenu getExportOptions={buildExport} />
        <Button onClick={openCreate}><Plus size={16} className="mr-1" />新增品項</Button>
      </PageHeader>

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="品項"
          entityEndpoint="items"
          ids={batch.ids}
          batchFields={itemsBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ["items"] })}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
          <Card key={type} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => { setTypeFilter(type === "未分類" ? "all" : type); setPage(1); }}>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold">{count}</div>
              <div className="text-xs text-muted-foreground">{TYPE_LABELS[type] || type}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="搜尋品項代碼、名稱、供應商..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-10" />
          </div>
        </div>
        <div className="w-[120px]">
          <Select value={activeFilter} onValueChange={v => { setActiveFilter(v); setPage(1); }}>
            <SelectTrigger aria-label="啟用狀態" data-testid="select-item-active-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">啟用中</SelectItem>
              <SelectItem value="inactive">已停用</SelectItem>
              <SelectItem value="all">全部</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[160px]">
          <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="品項類型" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部類型</SelectItem>
              {types.map((t: string) => <SelectItem key={t} value={t}>{TYPE_LABELS[t] || t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-[220px]">
          <SearchableSelect
            value={groupFilter}
            onValueChange={(v) => { setGroupFilter(v); setPage(1); }}
            placeholder="分類"
            searchPlaceholder="搜尋分類..."
            options={[{ value: "all", label: "全部分類" }, ...groups.map((g: string) => ({ value: g, label: g }))]}
            data-testid="select-group-filter"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></TableHead>
                  <TableHead className="w-[120px]">品項編碼</TableHead>
                  <TableHead>品項名稱</TableHead>
                  <TableHead className="hidden lg:table-cell">分類</TableHead>
                  <TableHead className="w-[80px]">類型</TableHead>
                   <TableHead className="text-right hidden md:table-cell">移動平均成本</TableHead>
                  <TableHead className="text-right hidden md:table-cell">批發價</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">終端售價</TableHead>
                  <TableHead className="hidden xl:table-cell">供應商</TableHead>
                  <TableHead className="w-[100px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 10 }).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
                  ))
                ) : paged.length > 0 ? (
                  paged.map((item: any) => (
                    <TableRow key={item.id} className="cursor-pointer hover:bg-muted/30" onClick={(e) => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; openDetail(item); }}>
                      <TableCell className="px-2"><CheckboxCell checked={batch.selectedIds.has(item.id)} onChange={() => batch.toggle(item.id)} /></TableCell>
                      <TableCell className="font-mono text-xs">{item.itemCode}</TableCell>
                      <TableCell className="max-w-[300px] truncate">
                        <ItemThumb attachmentId={itemImages.get(item.id)} name={item.itemName} />
                        {item.itemName}
                        {item.status === "Inactive" && <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">已停用</span>}
                        {item.isVirtual && <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-violet-100 text-violet-700 align-middle">虛擬服務</span>}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-[150px] truncate">{item.itemGroup || "-"}</TableCell>
                      <TableCell>
                        {item.itemType ? (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[item.itemType] || "bg-gray-100 text-gray-800"}`}>
                            {TYPE_LABELS[item.itemType] || item.itemType}
                          </span>
                        ) : "-"}
                      </TableCell>
                      <TableCell className="text-right hidden md:table-cell">{fmtPrice(Number(item.movingAvgCost))}</TableCell>
                      <TableCell className="text-right hidden md:table-cell">{fmtPrice(item.wholesalePrice)}</TableCell>
                      <TableCell className="text-right hidden sm:table-cell">{fmtPrice(item.retailPrice)}</TableCell>
                      <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">{item.supplierName || "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDetail(item)}><Eye size={14} /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}><Pencil size={14} /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(item)}><Trash2 size={14} className="text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">尚無資料</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <TablePagination
            total={filtered.length}
            page={safePage}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          />
        </CardContent>
      </Card>

      {/* 品項內容：外框用全系統共用的單據視窗 */}
      <DocWindow
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        name={detailItem?.itemName ? `品項：${detailItem.itemName}` : "品項"} layoutKey="品項"
        number={detailItem?.itemCode}
        status={detailItem?.status === "Inactive" ? <DocStatus label="已停用" tone="outline" /> : undefined}
        footer={<>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>關閉</Button>
            <Button onClick={() => { setDetailOpen(false); openEdit(detailItem); }}>編輯</Button>
        </>}
      >
          {detailItem && (
            <div className="space-y-4">
              <ItemImageEditor itemId={detailItem.id} name={detailItem.itemName} attachmentId={itemImages.get(detailItem.id)} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label className="text-muted-foreground text-xs">品項編碼</Label><div className="font-mono">{detailItem.itemCode}</div></div>
                <div><Label className="text-muted-foreground text-xs">品項類型</Label><div>{detailItem.itemType ? <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[detailItem.itemType] || ""}`}>{detailItem.itemType}</span> : "-"}</div></div>
                <div><Label className="text-muted-foreground text-xs">分類</Label><div>{detailItem.itemGroup || "-"}</div></div>
                <div><Label className="text-muted-foreground text-xs">規格資訊</Label><div>{detailItem.specification || "-"}</div></div>
                <div className="col-span-2"><Label className="text-muted-foreground text-xs">供應商</Label><div>{detailItem.supplierName || "-"}</div></div>
                {detailItem.summary && <div className="col-span-2"><Label className="text-muted-foreground text-xs">摘要</Label><div className="text-sm">{detailItem.summary}</div></div>}
              </div>
              <div>
                <Label className="text-muted-foreground text-xs mb-2 block">成本結構</Label>
                <div className="grid grid-cols-5 gap-2">
                  {[
                    ["總成本", detailItem.totalCost],
                    ["材料費", detailItem.materialCost],
                    ["經費", detailItem.expenseCost],
                    ["外包費", detailItem.outsourcingCost],
                    ["勞務費", detailItem.laborCost],
                  ].map(([label, val]) => (
                    <div key={label as string} className="text-center p-2 bg-muted/30 rounded">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="font-medium">{fmtPrice(val as number)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs mb-2 block">價格方案</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {[
                    ["內部轉撥價", detailItem.internalPrice],
                    ["批發價/員工價", detailItem.wholesalePrice],
                    ["B端終端售價", detailItem.retailPrice],
                    ["大盤價(SVIP)", detailItem.svipPrice],
                    ["同行價(中盤)", detailItem.peerPrice],
                    ["經銷價(小盤)", detailItem.dealerPrice],
                  ].map(([label, val]) => (
                    <div key={label as string} className="text-center p-2 bg-blue-50/50 rounded border border-blue-100">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="font-medium text-blue-700">{fmtPrice(val as number)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label className="text-muted-foreground text-xs">庫存</Label><div>{detailItem.currentStock}</div></div>
                <div><Label className="text-muted-foreground text-xs">安全庫存</Label><div>{detailItem.reorderLevel}</div></div>
                 <div><Label className="text-muted-foreground text-xs">移動平均成本</Label><div>{fmtPrice(Number(detailItem.movingAvgCost))}</div></div>
              </div>
            </div>
          )}
      </DocWindow>

      {/* 新增／編輯品項 */}
      <DocWindow
        open={open}
        onClose={() => setOpen(false)}
        name={editing ? "編輯品項" : "新增品項"}
        number={editing?.itemCode}
        footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
              {createMut.isPending || updateMut.isPending ? "處理中..." : editing ? "更新" : "建立"}
            </Button>
        </>}
      >
          <Tabs defaultValue="basic">
            <TabsList className="w-full">
              <TabsTrigger value="basic" className="flex-1">基本資訊</TabsTrigger>
              <TabsTrigger value="cost" className="flex-1">成本</TabsTrigger>
              <TabsTrigger value="price" className="flex-1">價格</TabsTrigger>
            </TabsList>
            <TabsContent value="basic" className="space-y-3 mt-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>品項代碼 *</Label><Input value={form.itemCode || ""} onChange={F("itemCode")} /></div>
                <div><Label>品項名稱 *</Label><Input value={form.itemName || ""} onChange={F("itemName")} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>分類</Label>
                  <SearchableSelect
                    value={form.itemGroup || ""}
                    onValueChange={(v) => setForm((p) => ({ ...p, itemGroup: v === "__none__" ? "" : v }))}
                    placeholder="請選擇分類"
                    searchPlaceholder="搜尋分類..."
                    emptyText="找不到此分類，請先到「品項分類」新增"
                    options={[{ value: "__none__", label: "（未分類）" }, ...groups.map((g: string) => ({ value: g, label: g }))]}
                    data-testid="select-form-group"
                  />
                </div>
                <div>
                  <Label>品項類型</Label>
                  <SearchableSelect
                    value={form.itemType || ""}
                    onValueChange={(v) => setForm((p) => ({ ...p, itemType: v === "__none__" ? "" : v }))}
                    placeholder="請選擇類型"
                    searchPlaceholder="搜尋類型..."
                    emptyText="找不到此類型，請先到「品項類型」新增"
                    options={[
                      { value: "__none__", label: "（未指定）" },
                      ...itemTypes.map((t) => ({ value: t.name, label: t.label || t.name })),
                    ]}
                    data-testid="select-form-type"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>規格資訊</Label><Input value={form.specification || ""} onChange={F("specification")} /></div>
                <div><Label>單位</Label><Input value={form.unit || "Nos"} onChange={F("unit")} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>供應商</Label><MasterLookup source="suppliers" valueKey="name" value={form.supplierName || ""} onValueChange={v => setForm(p => ({ ...p, supplierName: v }))} placeholder="選擇供應商" /></div>
                <div><Label>庫存</Label><Input type="number" value={form.currentStock || "0"} onChange={F("currentStock")} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={form.isVirtual === "true"}
                  onChange={e => setForm(p => ({ ...p, isVirtual: e.target.checked ? "true" : "false" }))}
                  data-testid="checkbox-is-virtual"
                />
                是虛擬服務（不需出貨、不追蹤庫存，如課程、顧問服務）
              </label>
              <div><Label>摘要</Label><textarea className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px]" value={form.summary || ""} onChange={F("summary")} /></div>
            </TabsContent>
            <TabsContent value="cost" className="space-y-3 mt-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>總成本</Label><Input type="number" value={form.totalCost || "0"} onChange={F("totalCost")} /></div>
                <div><Label>材料費標準成本</Label><Input type="number" value={form.materialCost || "0"} onChange={F("materialCost")} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>經費標準成本</Label><Input type="number" value={form.expenseCost || "0"} onChange={F("expenseCost")} /></div>
                <div><Label>外包費標準成本</Label><Input type="number" value={form.outsourcingCost || "0"} onChange={F("outsourcingCost")} /></div>
              </div>
              <div><Label>勞務費標準成本</Label><Input type="number" value={form.laborCost || "0"} onChange={F("laborCost")} /></div>
            </TabsContent>
            <TabsContent value="price" className="space-y-3 mt-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>內部轉撥價格</Label><Input type="number" value={form.internalPrice || "0"} onChange={F("internalPrice")} /></div>
                <div><Label>總批發價/員工價</Label><Input type="number" value={form.wholesalePrice || "0"} onChange={F("wholesalePrice")} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>B端終端售價</Label><Input type="number" value={form.retailPrice || "0"} onChange={F("retailPrice")} /></div>
                <div><Label>大盤價(SVIP)</Label><Input type="number" value={form.svipPrice || "0"} onChange={F("svipPrice")} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>同行價格(中盤)</Label><Input type="number" value={form.peerPrice || "0"} onChange={F("peerPrice")} /></div>
                <div><Label>經銷價格(小盤)</Label><Input type="number" value={form.dealerPrice || "0"} onChange={F("dealerPrice")} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>售價</Label><Input type="number" value={form.sellingPrice || "0"} onChange={F("sellingPrice")} /></div>
                <div><Label>進價</Label><Input type="number" value={form.buyingPrice || "0"} onChange={F("buyingPrice")} /></div>
              </div>
            </TabsContent>
          </Tabs>
      </DocWindow>
    </div>
  );
}
