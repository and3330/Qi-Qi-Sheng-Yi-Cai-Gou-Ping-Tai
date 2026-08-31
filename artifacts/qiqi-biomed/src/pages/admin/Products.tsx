import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminProducts,
  getListAdminProductsQueryKey,
  useCreateAdminProduct,
  useUpdateAdminProduct,
  useListAdminProductVariants,
  getListAdminProductVariantsQueryKey,
  useCreateAdminProductVariant,
  useUpdateAdminProductVariant,
  useDeleteAdminProductVariant,
  type AdminProduct,
  type AdminProductVariant,
  type ListAdminProductsParams,
} from "@workspace/api-client-react";
import { Search, Plus, Pencil, PackageX, PackageCheck, AlertTriangle, Trash2, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "./AdminLayout";

const CATEGORIES = ["保健食品", "醫療耗材", "保養清潔", "院所專區"];

type FormState = {
  id: number | null;
  code: string;
  name: string;
  category: string;
  spec: string;
  description: string;
  imageUrl: string;
  priceHospital: string;
  priceClinic: string;
  priceConsumer: string;
  costPrice: string;
  stock: string;
  isHot: boolean;
  isNew: boolean;
  isActive: boolean;
  allowedGrades: string[];
};

const emptyForm: FormState = {
  id: null,
  code: "",
  name: "",
  category: CATEGORIES[0],
  spec: "",
  description: "",
  imageUrl: "",
  priceHospital: "",
  priceClinic: "",
  priceConsumer: "",
  costPrice: "",
  stock: "0",
  isHot: false,
  isNew: true,
  isActive: true,
  allowedGrades: [],
};

function VariantsManager({ productId }: { productId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: variants, isLoading } = useListAdminProductVariants(productId, { query: { queryKey: getListAdminProductVariantsQueryKey(productId) } });
  
  const createMut = useCreateAdminProductVariant();
  const updateMut = useUpdateAdminProductVariant();
  const deleteMut = useDeleteAdminProductVariant();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  
  const [vForm, setVForm] = useState({
    name: "",
    priceHospital: "",
    priceClinic: "",
    priceConsumer: "",
    costPrice: "",
    initialStock: "0"
  });

  const resetForm = () => {
    setVForm({ name: "", priceHospital: "", priceClinic: "", priceConsumer: "", costPrice: "", initialStock: "0" });
    setAdding(false);
    setEditingId(null);
  };

  const fillEdit = (v: AdminProductVariant) => {
    setVForm({
      name: v.name,
      priceHospital: String(v.priceHospital),
      priceClinic: String(v.priceClinic),
      priceConsumer: String(v.priceConsumer),
      costPrice: String(v.costPrice),
      initialStock: "0" // not editable
    });
    setEditingId(v.id);
    setAdding(false);
  };

  const handleSave = () => {
    const nums = {
      priceHospital: Number(vForm.priceHospital),
      priceClinic: Number(vForm.priceClinic),
      priceConsumer: Number(vForm.priceConsumer),
      costPrice: Number(vForm.costPrice),
      initialStock: Number(vForm.initialStock)
    };
    if (!vForm.name.trim() || Object.values(nums).some(n => !Number.isInteger(n) || n < 0)) {
      toast({ title: "請確認欄位", description: "名稱與售價為必填，且金額需為非負整數", variant: "destructive" });
      return;
    }
    
    if (editingId) {
      updateMut.mutate({
        id: editingId,
        data: {
          name: vForm.name.trim(),
          priceHospital: nums.priceHospital,
          priceClinic: nums.priceClinic,
          priceConsumer: nums.priceConsumer,
          costPrice: nums.costPrice
        }
      }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAdminProductVariantsQueryKey(productId) });
          resetForm();
          toast({ title: "儲存成功" });
        }
      });
    } else {
      createMut.mutate({
        id: productId,
        data: {
          name: vForm.name.trim(),
          priceHospital: nums.priceHospital,
          priceClinic: nums.priceClinic,
          priceConsumer: nums.priceConsumer,
          costPrice: nums.costPrice,
          stock: nums.initialStock
        }
      }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAdminProductVariantsQueryKey(productId) });
          resetForm();
          toast({ title: "新增成功" });
        }
      });
    }
  };
  
  const toggleActive = (id: number, current: boolean) => {
    updateMut.mutate({ id, data: { isActive: !current } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAdminProductVariantsQueryKey(productId) })
    });
  };

  const handleDelete = (id: number) => {
    deleteMut.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminProductVariantsQueryKey(productId) });
        toast({ title: "已刪除規格" });
      },
      onError: (err: any) => {
        toast({ title: "刪除失敗", description: err?.data?.error || "該規格可能有訂單記錄", variant: "destructive" });
      }
    });
  };

  return (
    <div className="border rounded-xl bg-gray-50/50 p-4 mt-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-sm">多規格管理</h3>
        {!adding && !editingId && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus size={14} className="mr-1" /> 新增規格
          </Button>
        )}
      </div>

      {(adding || editingId) && (
        <div className="bg-white p-3 rounded-lg border shadow-sm mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">規格名稱 *</Label>
              <Input className="h-8" value={vForm.name} onChange={e => setVForm({...vForm, name: e.target.value})} placeholder="例如：大盒裝" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">消費者價 *</Label>
              <Input className="h-8" type="number" value={vForm.priceConsumer} onChange={e => setVForm({...vForm, priceConsumer: e.target.value})} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">診所價 *</Label>
              <Input className="h-8" type="number" value={vForm.priceClinic} onChange={e => setVForm({...vForm, priceClinic: e.target.value})} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">醫院價 *</Label>
              <Input className="h-8" type="number" value={vForm.priceHospital} onChange={e => setVForm({...vForm, priceHospital: e.target.value})} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">進貨成本</Label>
              <Input className="h-8" type="number" value={vForm.costPrice} onChange={e => setVForm({...vForm, costPrice: e.target.value})} />
            </div>
            {adding && (
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">期初庫存</Label>
                <Input className="h-8" type="number" value={vForm.initialStock} onChange={e => setVForm({...vForm, initialStock: e.target.value})} />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" className="h-8" onClick={resetForm}>取消</Button>
            <Button size="sm" className="h-8" onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>儲存</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="space-y-2">
          {variants?.map(v => (
            <div key={v.id} className="bg-white border rounded-lg p-3 flex justify-between items-center group">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-sm">{v.name}</span>
                  {!v.isActive && <Badge variant="secondary" className="text-[10px] px-1 h-4">停售</Badge>}
                </div>
                <div className="text-[11px] text-muted-foreground flex gap-3">
                  <span>C: ${v.priceConsumer}</span>
                  <span>Cl: ${v.priceClinic}</span>
                  <span>H: ${v.priceHospital}</span>
                  <span className="font-medium text-foreground ml-2 border-l pl-3">庫存: {v.stock}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                <Switch checked={v.isActive} onCheckedChange={() => toggleActive(v.id, v.isActive)} title="上架狀態" />
                <div className="w-1" />
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => fillEdit(v)}><Pencil size={14} /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(v.id)}><Trash2 size={14} /></Button>
              </div>
            </div>
          ))}
          {!variants?.length && !adding && <div className="text-center text-xs text-muted-foreground py-4">無規格。請新增規格。</div>}
        </div>
      )}
    </div>
  );
}

export default function AdminProductsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [zeroCostOnly, setZeroCostOnly] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const params = useMemo(() => {
    const p: ListAdminProductsParams = {};
    if (search) p.search = search;
    if (category !== "all") p.category = category;
    if (status !== "all") p.status = status as ListAdminProductsParams["status"];
    return p;
  }, [search, category, status]);

  const { data: products, isLoading } = useListAdminProducts(params, {
    query: { queryKey: getListAdminProductsQueryKey(params) },
  });

  const zeroCostCount = useMemo(
    () => products?.filter((p) => p.costPrice === 0).length ?? 0,
    [products],
  );
  const visibleProducts = useMemo(
    () => (zeroCostOnly ? products?.filter((p) => p.costPrice === 0) : products),
    [products, zeroCostOnly],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: getListAdminProductsQueryKey(),
      exact: false,
    });
  };

  const createMutation = useCreateAdminProduct({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "已新增商品" });
        setForm(null);
      },
      onError: (err: any) =>
        toast({
          title: "新增失敗",
          description: err?.data?.error ?? "請稍後再試",
          variant: "destructive",
        }),
    },
  });

  const updateMutation = useUpdateAdminProduct({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "已更新商品" });
        setForm(null);
      },
      onError: (err: any) =>
        toast({
          title: "更新失敗",
          description: err?.data?.error ?? "請稍後再試",
          variant: "destructive",
        }),
    },
  });

  const pending = createMutation.isPending || updateMutation.isPending;

  const openCreate = () => setForm({ ...emptyForm });
  const openEdit = (p: AdminProduct) =>
    setForm({
      id: p.id,
      code: p.code,
      name: p.name,
      category: p.category,
      spec: p.spec ?? "",
      description: p.description ?? "",
      imageUrl: p.imageUrl ?? "",
      priceHospital: String(p.priceHospital),
      priceClinic: String(p.priceClinic),
      priceConsumer: String(p.priceConsumer),
      costPrice: String(p.costPrice),
      stock: String(p.stock),
      isHot: p.isHot,
      isNew: p.isNew,
      isActive: p.isActive,
      allowedGrades: p.allowedGrades || [],
    });

  const submit = () => {
    if (!form) return;
    const nums = {
      priceHospital: Number(form.priceHospital),
      priceClinic: Number(form.priceClinic),
      priceConsumer: Number(form.priceConsumer),
      costPrice: Number(form.costPrice || 0),
    };
    if (
      !form.code.trim() ||
      !form.name.trim() ||
      Object.values(nums).some((n) => !Number.isInteger(n) || n < 0)
    ) {
      toast({
        title: "請確認必填欄位",
        description: "商品編號、名稱與三種售價為必填，金額需為非負整數",
        variant: "destructive",
      });
      return;
    }
    const common = {
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category,
      spec: form.spec.trim() || null,
      description: form.description.trim() || null,
      imageUrl: form.imageUrl.trim() || null,
      ...nums,
      isHot: form.isHot,
      isNew: form.isNew,
      isActive: form.isActive,
      allowedGrades: form.allowedGrades.length > 0 ? (form.allowedGrades as any[]) : null,
    };
    if (form.id === null) {
      const stock = Number(form.stock || 0);
      createMutation.mutate({
        data: { ...common, stock: Number.isInteger(stock) && stock > 0 ? stock : 0 },
      });
    } else {
      updateMutation.mutate({ id: form.id, data: common });
    }
  };

  const quickToggleActive = (p: AdminProduct) =>
    updateMutation.mutate({ id: p.id, data: { isActive: !p.isActive } });

  return (
    <AdminLayout title="商品管理">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <form
          className="relative flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜尋商品名稱、編號…（按 Enter）"
            className="bg-white pl-9"
            data-testid="input-product-search"
          />
        </form>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full bg-white sm:w-40" data-testid="select-product-category">
            <SelectValue placeholder="全部分類" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分類</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full bg-white sm:w-32" data-testid="select-product-status">
            <SelectValue placeholder="全部狀態" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部狀態</SelectItem>
            <SelectItem value="active">上架中</SelectItem>
            <SelectItem value="inactive">已下架</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={openCreate} data-testid="button-create-product">
          <Plus size={16} className="mr-1" /> 新增商品
        </Button>
      </div>

      {!isLoading && zeroCostCount > 0 && (
        <div
          className="mb-4 flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between"
          data-testid="banner-zero-cost-warning"
        >
          <div className="flex items-start gap-2 text-sm text-amber-800">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>
              有 <span className="font-semibold">{zeroCostCount}</span>{" "}
              項商品的成本價為 0，將導致損益報表的毛利數字失真。請補齊成本價（編輯商品，或透過採購收貨自動更新）。
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
            onClick={() => setZeroCostOnly((v) => !v)}
            data-testid="button-toggle-zero-cost-filter"
          >
            {zeroCostOnly ? "顯示全部商品" : "只看成本為 0 的商品"}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : !visibleProducts?.length ? (
        <div className="rounded-2xl border border-dashed bg-white py-16 text-center text-muted-foreground">
          找不到符合條件的商品
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">商品</th>
                  <th className="px-4 py-3 font-medium">分類</th>
                  <th className="px-4 py-3 text-right font-medium">A 醫院價</th>
                  <th className="px-4 py-3 text-right font-medium">B 診所價</th>
                  <th className="px-4 py-3 text-right font-medium">C 會員價</th>
                  <th className="px-4 py-3 text-right font-medium">成本價</th>
                  <th className="px-4 py-3 text-right font-medium">庫存</th>
                  <th className="px-4 py-3 font-medium">狀態</th>
                  <th className="px-4 py-3 font-medium">授權分級</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b last:border-0 hover:bg-muted/30 ${
                      p.costPrice === 0 ? "bg-amber-50/60" : ""
                    }`}
                    data-testid={`row-product-${p.id}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium" data-testid={`text-product-name-${p.id}`}>
                        {p.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.code}
                        {p.spec ? ` ・ ${p.spec}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs">{p.category}</td>
                    <td className="px-4 py-3 text-right">NT${p.priceHospital.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">NT${p.priceClinic.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">NT${p.priceConsumer.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      {p.costPrice === 0 ? (
                        <span
                          className="inline-flex items-center gap-1 font-semibold text-amber-600"
                          data-testid={`text-zero-cost-${p.id}`}
                        >
                          <AlertTriangle size={13} /> NT$0
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          NT${p.costPrice.toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={p.stock <= 10 ? "font-semibold text-red-600" : ""}>
                        {p.stock}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {p.isActive ? (
                        <Badge
                          variant="outline"
                          className="border-green-200 bg-green-50 text-green-700"
                        >
                          上架中
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-gray-200 bg-gray-50 text-gray-500"
                        >
                          已下架
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.allowedGrades && p.allowedGrades.length > 0 ? (
                        <div className="flex gap-1">
                          {p.allowedGrades.map((g) => (
                            <Badge key={g} variant="outline" className="text-xs bg-slate-50">
                              {g} 級
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">不限</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEdit(p)}
                          data-testid={`button-edit-product-${p.id}`}
                        >
                          <Pencil size={14} className="mr-1" /> 編輯
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className={p.isActive ? "text-destructive" : ""}
                          disabled={updateMutation.isPending}
                          onClick={() => quickToggleActive(p)}
                          data-testid={`button-toggle-product-${p.id}`}
                        >
                          {p.isActive ? (
                            <>
                              <PackageX size={14} className="mr-1" /> 下架
                            </>
                          ) : (
                            <>
                              <PackageCheck size={14} className="mr-1" /> 上架
                            </>
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id === null ? "新增商品" : "編輯商品"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>商品編號 *</Label>
                  <Input
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    data-testid="input-product-code"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>分類 *</Label>
                  <Select
                    value={form.category}
                    onValueChange={(v) => setForm({ ...form, category: v })}
                  >
                    <SelectTrigger data-testid="select-form-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>商品名稱 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  data-testid="input-product-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>規格</Label>
                  <Input
                    value={form.spec}
                    placeholder="如 90粒/瓶"
                    onChange={(e) => setForm({ ...form, spec: e.target.value })}
                    data-testid="input-product-spec"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>圖片網址</Label>
                  <Input
                    value={form.imageUrl}
                    onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                    data-testid="input-product-image"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>商品描述</Label>
                <Textarea
                  value={form.description}
                  rows={3}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  data-testid="input-product-description"
                />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  [
                    ["priceHospital", "A 醫院價 *"],
                    ["priceClinic", "B 診所價 *"],
                    ["priceConsumer", "C 會員價 *"],
                    ["costPrice", "成本價"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-1.5">
                    <Label>{label}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      data-testid={`input-product-${key}`}
                    />
                  </div>
                ))}
              </div>
              {Number(form.costPrice || 0) === 0 && (
                <p
                  className="flex items-center gap-1 text-xs text-amber-600"
                  data-testid="text-cost-zero-hint"
                >
                  <AlertTriangle size={13} className="shrink-0" />
                  成本價為 0 會使損益報表的毛利失真，建議填寫實際進貨成本（採購收貨時也會自動更新）
                </p>
              )}
              {form.id === null && (
                <div className="space-y-1.5">
                  <Label>期初庫存</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                    data-testid="input-product-stock"
                  />
                  <p className="text-xs text-muted-foreground">
                    建立後庫存請透過「進銷存」的採購進貨或手動調整變更
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label>授權可銷售機構分級 (留空代表不限)</Label>
                <div className="flex flex-wrap gap-2">
                  {["A", "B", "C"].map((g) => {
                    const selected = form.allowedGrades.includes(g);
                    return (
                      <Badge
                        key={g}
                        variant={selected ? "default" : "outline"}
                        className="cursor-pointer px-3 py-1"
                        onClick={() => {
                          setForm({
                            ...form,
                            allowedGrades: selected
                              ? form.allowedGrades.filter((x) => x !== g)
                              : [...form.allowedGrades, g],
                          });
                        }}
                      >
                        {g} 級
                      </Badge>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ["isHot", "熱銷"],
                    ["isNew", "新品"],
                    ["isActive", "上架"],
                  ] as const
                ).map(([key, label]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-xl border p-3"
                  >
                    <p className="text-sm font-medium">{label}</p>
                    <Switch
                      checked={form[key]}
                      onCheckedChange={(checked) => setForm({ ...form, [key]: checked })}
                      data-testid={`switch-product-${key}`}
                    />
                  </div>
                ))}
              </div>
              
              {form.id !== null && <VariantsManager productId={form.id} />}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              取消
            </Button>
            <Button onClick={submit} disabled={pending} data-testid="button-save-product">
              {pending ? "儲存中…" : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
