import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminSuppliers,
  getListAdminSuppliersQueryKey,
  useCreateAdminSupplier,
  useUpdateAdminSupplier,
  useListAdminPurchaseOrders,
  getListAdminPurchaseOrdersQueryKey,
  useCreateAdminPurchaseOrder,
  useUpdateAdminPurchaseOrderStatus,
  useReceiveAdminPurchaseOrder,
  useListAdminProducts,
  getListAdminProductsQueryKey,
  getListAdminStockMovementsQueryKey,
  type Supplier,
  type AdminPurchaseOrder,
  type ListAdminPurchaseOrdersParams,
} from "@workspace/api-client-react";
import { Plus, Pencil, Trash2, PackageCheck, Send, XCircle, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { PoLineItem } from "@/components/PoLineItem";

const poStatusLabel: Record<string, string> = {
  draft: "草稿",
  ordered: "已下單",
  received: "已收貨",
  cancelled: "已取消",
};

const poStatusClass: Record<string, string> = {
  draft: "border-gray-200 bg-gray-50 text-gray-600",
  ordered: "border-blue-200 bg-blue-50 text-blue-700",
  received: "border-green-200 bg-green-50 text-green-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

type SupplierForm = {
  id: number | null;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  paymentTerms: string;
  note: string;
  isActive: boolean;
};

type PoLine = { productId: string; variantId: string; unitCost: string; quantity: string };

export default function AdminPurchasingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ----- Suppliers -----
  const { data: suppliers, isLoading: suppliersLoading } = useListAdminSuppliers(
    {},
    { query: { queryKey: getListAdminSuppliersQueryKey({}) } },
  );
  const [supplierForm, setSupplierForm] = useState<SupplierForm | null>(null);

  const invalidateSuppliers = () =>
    queryClient.invalidateQueries({
      queryKey: getListAdminSuppliersQueryKey(),
      exact: false,
    });

  const createSupplier = useCreateAdminSupplier({
    mutation: {
      onSuccess: () => {
        invalidateSuppliers();
        toast({ title: "已新增供應商" });
        setSupplierForm(null);
      },
      onError: (err: any) =>
        toast({
          title: "新增失敗",
          description: err?.data?.error ?? "請稍後再試",
          variant: "destructive",
        }),
    },
  });
  const updateSupplier = useUpdateAdminSupplier({
    mutation: {
      onSuccess: () => {
        invalidateSuppliers();
        toast({ title: "已更新供應商" });
        setSupplierForm(null);
      },
      onError: (err: any) =>
        toast({
          title: "更新失敗",
          description: err?.data?.error ?? "請稍後再試",
          variant: "destructive",
        }),
    },
  });

  const submitSupplier = () => {
    if (!supplierForm) return;
    if (!supplierForm.name.trim()) {
      toast({ title: "請填寫供應商名稱", variant: "destructive" });
      return;
    }
    const data = {
      name: supplierForm.name.trim(),
      contactPerson: supplierForm.contactPerson.trim() || null,
      phone: supplierForm.phone.trim() || null,
      email: supplierForm.email.trim() || null,
      address: supplierForm.address.trim() || null,
      paymentTerms: supplierForm.paymentTerms.trim() || null,
      note: supplierForm.note.trim() || null,
    };
    if (supplierForm.id === null) {
      createSupplier.mutate({ data });
    } else {
      updateSupplier.mutate({
        id: supplierForm.id,
        data: { ...data, isActive: supplierForm.isActive },
      });
    }
  };

  // ----- Purchase orders -----
  const [poStatusFilter, setPoStatusFilter] = useState("all");
  const poParams = useMemo(() => {
    const p: ListAdminPurchaseOrdersParams = {};
    if (poStatusFilter !== "all")
      p.status = poStatusFilter as ListAdminPurchaseOrdersParams["status"];
    return p;
  }, [poStatusFilter]);
  const { data: pos, isLoading: posLoading } = useListAdminPurchaseOrders(poParams, {
    query: { queryKey: getListAdminPurchaseOrdersQueryKey(poParams) },
  });

  const { data: products } = useListAdminProducts(
    {},
    { query: { queryKey: getListAdminProductsQueryKey({}) } },
  );

  const [poCreateOpen, setPoCreateOpen] = useState(false);
  const [poSupplier, setPoSupplier] = useState("");
  const [poNote, setPoNote] = useState("");
  const [poLines, setPoLines] = useState<PoLine[]>([
    { productId: "", variantId: "", unitCost: "", quantity: "" },
  ]);
  const [poDetail, setPoDetail] = useState<AdminPurchaseOrder | null>(null);

  const invalidatePos = () => {
    queryClient.invalidateQueries({
      queryKey: getListAdminPurchaseOrdersQueryKey(),
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: getListAdminProductsQueryKey(),
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: getListAdminStockMovementsQueryKey(),
      exact: false,
    });
  };

  const createPo = useCreateAdminPurchaseOrder({
    mutation: {
      onSuccess: () => {
        invalidatePos();
        toast({ title: "已建立採購單" });
        setPoCreateOpen(false);
        setPoSupplier("");
        setPoNote("");
        setPoLines([{ productId: "", variantId: "", unitCost: "", quantity: "" }]);
      },
      onError: (err: any) =>
        toast({
          title: "建立失敗",
          description: err?.data?.error ?? "請稍後再試",
          variant: "destructive",
        }),
    },
  });

  const updatePoStatus = useUpdateAdminPurchaseOrderStatus({
    mutation: {
      onSuccess: (po) => {
        invalidatePos();
        toast({ title: "已更新採購單狀態" });
        setPoDetail(po);
      },
      onError: (err: any) =>
        toast({
          title: "更新失敗",
          description: err?.data?.error ?? "請稍後再試",
          variant: "destructive",
        }),
    },
  });

  const receivePo = useReceiveAdminPurchaseOrder({
    mutation: {
      onSuccess: (po) => {
        invalidatePos();
        toast({ title: "已收貨入庫", description: "庫存與商品成本已更新" });
        setPoDetail(po);
      },
      onError: (err: any) =>
        toast({
          title: "收貨失敗",
          description: err?.data?.error ?? "請稍後再試",
          variant: "destructive",
        }),
    },
  });

  const poTotal = poLines.reduce((sum, l) => {
    const cost = Number(l.unitCost);
    const qty = Number(l.quantity);
    return sum + (cost > 0 && qty > 0 ? cost * qty : 0);
  }, 0);

  const submitPo = () => {
    if (!poSupplier) {
      toast({ title: "請選擇供應商", variant: "destructive" });
      return;
    }
    const items = poLines
      .filter((l) => l.productId)
      .map((l) => ({
        productId: Number(l.productId),
        variantId: l.variantId ? Number(l.variantId) : undefined,
        unitCost: Number(l.unitCost),
        quantity: Number(l.quantity),
      }));
    if (
      !items.length ||
      items.some(
        (i) =>
          !Number.isInteger(i.unitCost) ||
          i.unitCost < 0 ||
          !Number.isInteger(i.quantity) ||
          i.quantity < 1,
      )
    ) {
      toast({
        title: "請確認採購明細",
        description: "至少一個品項，進價需為非負整數、數量需大於 0",
        variant: "destructive",
      });
      return;
    }
    createPo.mutate({
      data: {
        supplierId: Number(poSupplier),
        note: poNote.trim() || null,
        items,
      },
    });
  };

  const poActionPending =
    updatePoStatus.isPending || receivePo.isPending;

  return (
    <AdminLayout title="採購進貨">
      <Tabs defaultValue="orders">
        <TabsList className="mb-4">
          <TabsTrigger value="orders" data-testid="tab-purchase-orders">
            採購單
          </TabsTrigger>
          <TabsTrigger value="suppliers" data-testid="tab-suppliers">
            供應商
          </TabsTrigger>
        </TabsList>

        {/* ---------- Purchase orders tab ---------- */}
        <TabsContent value="orders">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select value={poStatusFilter} onValueChange={setPoStatusFilter}>
              <SelectTrigger className="w-full bg-white sm:w-40" data-testid="select-po-status">
                <SelectValue placeholder="全部狀態" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部狀態</SelectItem>
                <SelectItem value="draft">草稿</SelectItem>
                <SelectItem value="ordered">已下單</SelectItem>
                <SelectItem value="received">已收貨</SelectItem>
                <SelectItem value="cancelled">已取消</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <Button onClick={() => setPoCreateOpen(true)} data-testid="button-create-po">
              <Plus size={16} className="mr-1" /> 建立採購單
            </Button>
          </div>

          {posLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-2xl" />
              ))}
            </div>
          ) : !pos?.length ? (
            <div className="rounded-2xl border border-dashed bg-white py-16 text-center text-muted-foreground">
              尚無採購單，點擊「建立採購單」開始
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-medium">單號</th>
                      <th className="px-4 py-3 font-medium">供應商</th>
                      <th className="px-4 py-3 font-medium">品項數</th>
                      <th className="px-4 py-3 text-right font-medium">金額</th>
                      <th className="px-4 py-3 font-medium">狀態</th>
                      <th className="px-4 py-3 font-medium">建立時間</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pos.map((po) => (
                      <tr
                        key={po.id}
                        className="border-b last:border-0 hover:bg-muted/30"
                        data-testid={`row-po-${po.id}`}
                      >
                        <td className="px-4 py-3 font-mono text-xs">{po.poNo}</td>
                        <td className="px-4 py-3">{po.supplierName}</td>
                        <td className="px-4 py-3">{po.items.length}</td>
                        <td className="px-4 py-3 text-right font-semibold">
                          NT${po.totalAmount.toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={poStatusClass[po.status] ?? ""}>
                            {poStatusLabel[po.status] ?? po.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(po.createdAt).toLocaleString("zh-TW")}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPoDetail(po)}
                            data-testid={`button-view-po-${po.id}`}
                          >
                            <Eye size={14} className="mr-1" /> 詳情
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ---------- Suppliers tab ---------- */}
        <TabsContent value="suppliers">
          <div className="mb-4 flex justify-end">
            <Button
              onClick={() =>
                setSupplierForm({
                  id: null,
                  name: "",
                  contactPerson: "",
                  phone: "",
                  email: "",
                  address: "",
                  paymentTerms: "",
                  note: "",
                  isActive: true,
                })
              }
              data-testid="button-create-supplier"
            >
              <Plus size={16} className="mr-1" /> 新增供應商
            </Button>
          </div>
          {suppliersLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-2xl" />
              ))}
            </div>
          ) : !suppliers?.length ? (
            <div className="rounded-2xl border border-dashed bg-white py-16 text-center text-muted-foreground">
              尚無供應商資料
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-medium">名稱</th>
                      <th className="px-4 py-3 font-medium">聯絡人</th>
                      <th className="px-4 py-3 font-medium">電話 / Email</th>
                      <th className="px-4 py-3 font-medium">付款條件</th>
                      <th className="px-4 py-3 font-medium">狀態</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((s) => (
                      <tr
                        key={s.id}
                        className="border-b last:border-0 hover:bg-muted/30"
                        data-testid={`row-supplier-${s.id}`}
                      >
                        <td className="px-4 py-3 font-medium">{s.name}</td>
                        <td className="px-4 py-3">{s.contactPerson || "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <p>{s.phone || "—"}</p>
                          <p>{s.email || ""}</p>
                        </td>
                        <td className="px-4 py-3 text-xs">{s.paymentTerms || "—"}</td>
                        <td className="px-4 py-3">
                          {s.isActive ? (
                            <Badge
                              variant="outline"
                              className="border-green-200 bg-green-50 text-green-700"
                            >
                              合作中
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-gray-200 bg-gray-50 text-gray-500"
                            >
                              停用
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setSupplierForm({
                                id: s.id,
                                name: s.name,
                                contactPerson: s.contactPerson ?? "",
                                phone: s.phone ?? "",
                                email: s.email ?? "",
                                address: s.address ?? "",
                                paymentTerms: s.paymentTerms ?? "",
                                note: s.note ?? "",
                                isActive: s.isActive,
                              })
                            }
                            data-testid={`button-edit-supplier-${s.id}`}
                          >
                            <Pencil size={14} className="mr-1" /> 編輯
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Supplier dialog */}
      <Dialog
        open={!!supplierForm}
        onOpenChange={(open) => !open && setSupplierForm(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {supplierForm?.id === null ? "新增供應商" : "編輯供應商"}
            </DialogTitle>
          </DialogHeader>
          {supplierForm && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>名稱 *</Label>
                <Input
                  value={supplierForm.name}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, name: e.target.value })
                  }
                  data-testid="input-supplier-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>聯絡人</Label>
                  <Input
                    value={supplierForm.contactPerson}
                    onChange={(e) =>
                      setSupplierForm({
                        ...supplierForm,
                        contactPerson: e.target.value,
                      })
                    }
                    data-testid="input-supplier-contact"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>電話</Label>
                  <Input
                    value={supplierForm.phone}
                    onChange={(e) =>
                      setSupplierForm({ ...supplierForm, phone: e.target.value })
                    }
                    data-testid="input-supplier-phone"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  value={supplierForm.email}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, email: e.target.value })
                  }
                  data-testid="input-supplier-email"
                />
              </div>
              <div className="space-y-1.5">
                <Label>地址</Label>
                <Input
                  value={supplierForm.address}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, address: e.target.value })
                  }
                  data-testid="input-supplier-address"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>付款條件</Label>
                  <Input
                    value={supplierForm.paymentTerms}
                    placeholder="如 月結30天"
                    onChange={(e) =>
                      setSupplierForm({
                        ...supplierForm,
                        paymentTerms: e.target.value,
                      })
                    }
                    data-testid="input-supplier-terms"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>備註</Label>
                  <Input
                    value={supplierForm.note}
                    onChange={(e) =>
                      setSupplierForm({ ...supplierForm, note: e.target.value })
                    }
                    data-testid="input-supplier-note"
                  />
                </div>
              </div>
              {supplierForm.id !== null && (
                <div className="flex items-center justify-between rounded-xl border p-3">
                  <p className="text-sm font-medium">合作中</p>
                  <Button
                    size="sm"
                    variant={supplierForm.isActive ? "outline" : "default"}
                    onClick={() =>
                      setSupplierForm({
                        ...supplierForm,
                        isActive: !supplierForm.isActive,
                      })
                    }
                    data-testid="button-toggle-supplier-active"
                  >
                    {supplierForm.isActive ? "停用" : "啟用"}
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupplierForm(null)}>
              取消
            </Button>
            <Button
              onClick={submitSupplier}
              disabled={createSupplier.isPending || updateSupplier.isPending}
              data-testid="button-save-supplier"
            >
              {createSupplier.isPending || updateSupplier.isPending
                ? "儲存中…"
                : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO create dialog */}
      <Dialog open={poCreateOpen} onOpenChange={setPoCreateOpen}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>建立採購單</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>供應商 *</Label>
                <Select value={poSupplier} onValueChange={setPoSupplier}>
                  <SelectTrigger data-testid="select-po-supplier">
                    <SelectValue placeholder="選擇供應商" />
                  </SelectTrigger>
                  <SelectContent>
                    {(suppliers ?? [])
                      .filter((s: Supplier) => s.isActive)
                      .map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>備註</Label>
                <Input
                  value={poNote}
                  onChange={(e) => setPoNote(e.target.value)}
                  data-testid="input-po-note"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>採購明細 *</Label>
              {poLines.map((line, idx) => (
                <PoLineItem
                  key={idx}
                  idx={idx}
                  line={line}
                  products={products ?? []}
                  canRemove={poLines.length > 1}
                  onChange={(index, nextLine) => {
                    const next = [...poLines];
                    next[index] = nextLine;
                    setPoLines(next);
                  }}
                  onRemove={(index) => {
                    setPoLines(poLines.filter((_, i) => i !== index));
                  }}
                />
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setPoLines([
                    ...poLines,
                    { productId: "", variantId: "", unitCost: "", quantity: "" },
                  ])
                }
                data-testid="button-add-po-line"
              >
                <Plus size={14} className="mr-1" /> 新增品項
              </Button>
            </div>

            <p className="text-right text-sm">
              合計：
              <span className="text-base font-bold">
                NT${poTotal.toLocaleString()}
              </span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPoCreateOpen(false)}>
              取消
            </Button>
            <Button
              onClick={submitPo}
              disabled={createPo.isPending}
              data-testid="button-save-po"
            >
              {createPo.isPending ? "建立中…" : "建立採購單（草稿）"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO detail dialog */}
      <Dialog open={!!poDetail} onOpenChange={(open) => !open && setPoDetail(null)}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              採購單 {poDetail?.poNo}
              {poDetail && (
                <Badge variant="outline" className={poStatusClass[poDetail.status] ?? ""}>
                  {poStatusLabel[poDetail.status] ?? poDetail.status}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {poDetail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <p>
                  <span className="text-muted-foreground">供應商：</span>
                  {poDetail.supplierName}
                </p>
                <p>
                  <span className="text-muted-foreground">建立：</span>
                  {new Date(poDetail.createdAt).toLocaleString("zh-TW")}
                </p>
                {poDetail.orderedAt && (
                  <p>
                    <span className="text-muted-foreground">下單：</span>
                    {new Date(poDetail.orderedAt).toLocaleString("zh-TW")}
                  </p>
                )}
                {poDetail.receivedAt && (
                  <p>
                    <span className="text-muted-foreground">收貨：</span>
                    {new Date(poDetail.receivedAt).toLocaleString("zh-TW")}
                  </p>
                )}
                {poDetail.note && (
                  <p className="col-span-2">
                    <span className="text-muted-foreground">備註：</span>
                    {poDetail.note}
                  </p>
                )}
              </div>
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">商品</th>
                      <th className="px-3 py-2 text-right font-medium">進價</th>
                      <th className="px-3 py-2 text-right font-medium">數量</th>
                      <th className="px-3 py-2 text-right font-medium">小計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poDetail.items.map((i) => (
                      <tr key={i.id} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <p className="font-medium">{i.productName}</p>
                          <p className="text-xs text-muted-foreground">{i.productCode}</p>
                        </td>
                        <td className="px-3 py-2 text-right">
                          NT${i.unitCost.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right">{i.quantity}</td>
                        <td className="px-3 py-2 text-right font-medium">
                          NT${(i.unitCost * i.quantity).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-right text-sm">
                合計：
                <span className="text-base font-bold">
                  NT${poDetail.totalAmount.toLocaleString()}
                </span>
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            {poDetail?.status === "draft" && (
              <>
                <Button
                  variant="outline"
                  className="text-destructive"
                  disabled={poActionPending}
                  onClick={() =>
                    updatePoStatus.mutate({
                      id: poDetail.id,
                      data: { status: "cancelled" },
                    })
                  }
                  data-testid="button-cancel-po"
                >
                  <XCircle size={15} className="mr-1" /> 取消採購單
                </Button>
                <Button
                  disabled={poActionPending}
                  onClick={() =>
                    updatePoStatus.mutate({
                      id: poDetail.id,
                      data: { status: "ordered" },
                    })
                  }
                  data-testid="button-order-po"
                >
                  <Send size={15} className="mr-1" /> 確認下單
                </Button>
              </>
            )}
            {poDetail?.status === "ordered" && (
              <>
                <Button
                  variant="outline"
                  className="text-destructive"
                  disabled={poActionPending}
                  onClick={() =>
                    updatePoStatus.mutate({
                      id: poDetail.id,
                      data: { status: "cancelled" },
                    })
                  }
                  data-testid="button-cancel-po"
                >
                  <XCircle size={15} className="mr-1" /> 取消
                </Button>
                <Button
                  disabled={poActionPending}
                  onClick={() => receivePo.mutate({ id: poDetail.id })}
                  data-testid="button-receive-po"
                >
                  <PackageCheck size={15} className="mr-1" />
                  {receivePo.isPending ? "入庫中…" : "收貨入庫"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
