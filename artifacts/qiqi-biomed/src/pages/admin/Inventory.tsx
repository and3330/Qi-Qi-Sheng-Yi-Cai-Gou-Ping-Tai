import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminProducts,
  getListAdminProductsQueryKey,
  useListAdminStockMovements,
  getListAdminStockMovementsQueryKey,
  useAdjustAdminStock,
  type AdminProduct,
  type ListAdminStockMovementsParams,
} from "@workspace/api-client-react";
import { Search, SlidersHorizontal, AlertTriangle } from "lucide-react";
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

const LOW_STOCK = 10;

const movementTypeLabel: Record<string, string> = {
  purchase: "進貨",
  sale: "銷售出貨",
  adjust: "調整",
};

const movementTypeClass: Record<string, string> = {
  purchase: "border-green-200 bg-green-50 text-green-700",
  sale: "border-blue-200 bg-blue-50 text-blue-700",
  adjust: "border-amber-200 bg-amber-50 text-amber-700",
};

type AdjustState = {
  product: AdminProduct;
  direction: "in" | "out";
  quantity: string;
  reason: string;
  note: string;
};

export default function AdminInventoryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [adjust, setAdjust] = useState<AdjustState | null>(null);

  const [movementProduct, setMovementProduct] = useState("all");
  const [movementType, setMovementType] = useState("all");

  const productParams = useMemo(
    () => (search ? { search } : {}),
    [search],
  );
  const { data: products, isLoading } = useListAdminProducts(productParams, {
    query: { queryKey: getListAdminProductsQueryKey(productParams) },
  });

  const movementParams = useMemo(() => {
    const p: ListAdminStockMovementsParams = {};
    if (movementProduct !== "all") p.productId = Number(movementProduct);
    if (movementType !== "all")
      p.type = movementType as ListAdminStockMovementsParams["type"];
    return p;
  }, [movementProduct, movementType]);
  const { data: movements, isLoading: movementsLoading } =
    useListAdminStockMovements(movementParams, {
      query: { queryKey: getListAdminStockMovementsQueryKey(movementParams) },
    });

  const adjustMutation = useAdjustAdminStock({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListAdminProductsQueryKey(),
          exact: false,
        });
        queryClient.invalidateQueries({
          queryKey: getListAdminStockMovementsQueryKey(),
          exact: false,
        });
        toast({ title: "已調整庫存" });
        setAdjust(null);
      },
      onError: (err: any) =>
        toast({
          title: "調整失敗",
          description: err?.data?.error ?? "請稍後再試",
          variant: "destructive",
        }),
    },
  });

  const rows = useMemo(() => {
    const list = products ?? [];
    return lowOnly ? list.filter((p) => p.stock <= LOW_STOCK) : list;
  }, [products, lowOnly]);

  const lowCount = (products ?? []).filter((p) => p.stock <= LOW_STOCK).length;

  const submitAdjust = () => {
    if (!adjust) return;
    const qty = Number(adjust.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      toast({ title: "請輸入正確的數量", variant: "destructive" });
      return;
    }
    if (!adjust.reason) {
      toast({ title: "請選擇調整原因", variant: "destructive" });
      return;
    }
    adjustMutation.mutate({
      data: {
        productId: adjust.product.id,
        quantity: adjust.direction === "in" ? qty : -qty,
        reason: adjust.reason,
        note: adjust.note.trim() || null,
      },
    });
  };

  return (
    <AdminLayout title="進銷存 — 庫存管理">
      <Tabs defaultValue="stock">
        <TabsList className="mb-4">
          <TabsTrigger value="stock" data-testid="tab-stock">
            庫存總覽
          </TabsTrigger>
          <TabsTrigger value="movements" data-testid="tab-movements">
            異動紀錄
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
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
                data-testid="input-stock-search"
              />
            </form>
            <Button
              variant={lowOnly ? "default" : "outline"}
              onClick={() => setLowOnly(!lowOnly)}
              data-testid="button-low-stock-filter"
            >
              <AlertTriangle size={15} className="mr-1" />
              低庫存（{lowCount}）
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-2xl" />
              ))}
            </div>
          ) : !rows.length ? (
            <div className="rounded-2xl border border-dashed bg-white py-16 text-center text-muted-foreground">
              沒有符合條件的商品
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-medium">商品</th>
                      <th className="px-4 py-3 font-medium">分類</th>
                      <th className="px-4 py-3 text-right font-medium">成本價</th>
                      <th className="px-4 py-3 text-right font-medium">即時庫存</th>
                      <th className="px-4 py-3 font-medium">狀態</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b last:border-0 hover:bg-muted/30"
                        data-testid={`row-stock-${p.id}`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.code}</p>
                        </td>
                        <td className="px-4 py-3 text-xs">{p.category}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          NT${p.costPrice.toLocaleString()}
                        </td>
                        <td
                          className="px-4 py-3 text-right font-semibold"
                          data-testid={`text-stock-${p.id}`}
                        >
                          {p.stock}
                        </td>
                        <td className="px-4 py-3">
                          {p.stock <= LOW_STOCK ? (
                            <Badge
                              variant="outline"
                              className="gap-1 border-red-200 bg-red-50 text-red-700"
                            >
                              <AlertTriangle size={12} /> 低庫存
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-green-200 bg-green-50 text-green-700"
                            >
                              正常
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setAdjust({
                                product: p,
                                direction: "in",
                                quantity: "",
                                reason: "盤點",
                                note: "",
                              })
                            }
                            data-testid={`button-adjust-${p.id}`}
                          >
                            <SlidersHorizontal size={14} className="mr-1" /> 調整
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

        <TabsContent value="movements">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row">
            <Select value={movementProduct} onValueChange={setMovementProduct}>
              <SelectTrigger className="w-full bg-white sm:w-56" data-testid="select-movement-product">
                <SelectValue placeholder="全部商品" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部商品</SelectItem>
                {(products ?? []).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.code} {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={movementType} onValueChange={setMovementType}>
              <SelectTrigger className="w-full bg-white sm:w-40" data-testid="select-movement-type">
                <SelectValue placeholder="全部類型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部類型</SelectItem>
                <SelectItem value="purchase">進貨</SelectItem>
                <SelectItem value="sale">銷售出貨</SelectItem>
                <SelectItem value="adjust">調整</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {movementsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-2xl" />
              ))}
            </div>
          ) : !movements?.length ? (
            <div className="rounded-2xl border border-dashed bg-white py-16 text-center text-muted-foreground">
              尚無庫存異動紀錄
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-medium">時間</th>
                      <th className="px-4 py-3 font-medium">商品</th>
                      <th className="px-4 py-3 font-medium">類型</th>
                      <th className="px-4 py-3 text-right font-medium">數量</th>
                      <th className="px-4 py-3 text-right font-medium">異動後庫存</th>
                      <th className="px-4 py-3 font-medium">原因 / 單號</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b last:border-0 hover:bg-muted/30"
                        data-testid={`row-movement-${m.id}`}
                      >
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(m.createdAt).toLocaleString("zh-TW")}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{m.productName}</p>
                          <p className="text-xs text-muted-foreground">{m.productCode}</p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={movementTypeClass[m.type] ?? ""}>
                            {movementTypeLabel[m.type] ?? m.type}
                          </Badge>
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold ${
                            m.quantity > 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                        </td>
                        <td className="px-4 py-3 text-right">{m.stockAfter}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {m.reason || "—"}
                          {m.refNo ? `（${m.refNo}）` : ""}
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

      {/* Adjust dialog */}
      <Dialog open={!!adjust} onOpenChange={(open) => !open && setAdjust(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>調整庫存 — {adjust?.product.name}</DialogTitle>
          </DialogHeader>
          {adjust && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                目前庫存：<span className="font-semibold text-foreground">{adjust.product.stock}</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>方向</Label>
                  <Select
                    value={adjust.direction}
                    onValueChange={(v) =>
                      setAdjust({ ...adjust, direction: v as "in" | "out" })
                    }
                  >
                    <SelectTrigger data-testid="select-adjust-direction">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in">入庫（+）</SelectItem>
                      <SelectItem value="out">出庫（−）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>數量</Label>
                  <Input
                    type="number"
                    min={1}
                    value={adjust.quantity}
                    onChange={(e) => setAdjust({ ...adjust, quantity: e.target.value })}
                    data-testid="input-adjust-quantity"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>原因</Label>
                <Select
                  value={adjust.reason}
                  onValueChange={(v) => setAdjust({ ...adjust, reason: v })}
                >
                  <SelectTrigger data-testid="select-adjust-reason">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="盤點">盤點</SelectItem>
                    <SelectItem value="報廢">報廢</SelectItem>
                    <SelectItem value="樣品">樣品</SelectItem>
                    <SelectItem value="其他">其他</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>備註</Label>
                <Input
                  value={adjust.note}
                  onChange={(e) => setAdjust({ ...adjust, note: e.target.value })}
                  data-testid="input-adjust-note"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjust(null)}>
              取消
            </Button>
            <Button
              onClick={submitAdjust}
              disabled={adjustMutation.isPending}
              data-testid="button-save-adjust"
            >
              {adjustMutation.isPending ? "儲存中…" : "確認調整"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
