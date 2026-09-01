import { useMemo, useState } from "react";
import {
  useListAdminProducts,
  getListAdminProductsQueryKey,
  useListAdminStockMovements,
  getListAdminStockMovementsQueryKey,
  type ListAdminStockMovementsParams,
} from "@workspace/api-client-react";
import { Search, AlertTriangle, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export default function AdminInventoryPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
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

  const rows = useMemo(() => {
    const list = products ?? [];
    return lowOnly ? list.filter((p) => p.stock <= LOW_STOCK) : list;
  }, [products, lowOnly]);

  const lowCount = (products ?? []).filter((p) => p.stock <= LOW_STOCK).length;

  return (
    <AdminLayout title="進銷存 — 庫存管理">
      <Alert className="mb-5 border-blue-200 bg-blue-50 text-blue-900">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>作業入口已移轉</AlertTitle>
        <AlertDescription>庫存調整已移至 ERP 系統（庫存 › 品項），此頁僅供查閱。</AlertDescription>
      </Alert>
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

    </AdminLayout>
  );
}
