import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminOrders,
  getListAdminOrdersQueryKey,
  useUpdateAdminOrderStatus,
  getGetAdminStatsQueryKey,
  getListAdminProductsQueryKey,
  getListAdminStockMovementsQueryKey,
  type AdminOrder,
  type ListAdminOrdersParams,
} from "@workspace/api-client-react";
import { Search, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

const statusLabel: Record<string, string> = {
  pending: "待付款",
  paid: "已付款",
  shipped: "已出貨",
  completed: "已完成",
  cancelled: "已取消",
};

const statusClass: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  paid: "border-blue-200 bg-blue-50 text-blue-700",
  shipped: "border-indigo-200 bg-indigo-50 text-indigo-700",
  completed: "border-green-200 bg-green-50 text-green-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

const paymentLabel: Record<string, string> = {
  bank_transfer: "匯款",
  cod: "貨到付款",
  wallet: "錢包扣款",
};

const tierLabel: Record<string, string> = {
  hospital: "A 醫院",
  clinic: "B 診所/藥局",
  consumer: "C 消費者",
};

// next actions per current status
const NEXT_ACTIONS: Record<string, { status: string; label: string; danger?: boolean }[]> = {
  pending: [
    { status: "paid", label: "標記已付款" },
    { status: "cancelled", label: "取消訂單", danger: true },
  ],
  paid: [
    { status: "shipped", label: "標記已出貨" },
    { status: "cancelled", label: "取消訂單", danger: true },
  ],
  shipped: [{ status: "completed", label: "標記完成" }],
  completed: [],
  cancelled: [],
};

export default function AdminOrdersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detail, setDetail] = useState<AdminOrder | null>(null);

  const params = useMemo(() => {
    const p: ListAdminOrdersParams = {};
    if (search) p.search = search;
    if (statusFilter !== "all")
      p.status = statusFilter as ListAdminOrdersParams["status"];
    return p;
  }, [search, statusFilter]);

  const { data: orders, isLoading } = useListAdminOrders(params, {
    query: { queryKey: getListAdminOrdersQueryKey(params) },
  });

  const updateStatus = useUpdateAdminOrderStatus({
    mutation: {
      onSuccess: (order) => {
        queryClient.invalidateQueries({
          queryKey: getListAdminOrdersQueryKey(),
          exact: false,
        });
        queryClient.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getListAdminProductsQueryKey(),
          exact: false,
        });
        queryClient.invalidateQueries({
          queryKey: getListAdminStockMovementsQueryKey(),
          exact: false,
        });
        toast({ title: "已更新訂單狀態" });
        setDetail(order);
      },
      onError: (err: any) =>
        toast({
          title: "更新失敗",
          description: err?.data?.error ?? "請稍後再試",
          variant: "destructive",
        }),
    },
  });

  return (
    <AdminLayout title="訂單管理">
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
            placeholder="搜尋訂單編號、會員姓名…（按 Enter）"
            className="bg-white pl-9"
            data-testid="input-order-search"
          />
        </form>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full bg-white sm:w-40" data-testid="select-order-status">
            <SelectValue placeholder="全部狀態" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部狀態</SelectItem>
            {Object.entries(statusLabel).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : !orders?.length ? (
        <div className="rounded-2xl border border-dashed bg-white py-16 text-center text-muted-foreground">
          找不到符合條件的訂單
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">訂單編號</th>
                  <th className="px-4 py-3 font-medium">會員</th>
                  <th className="px-4 py-3 font-medium">付款方式</th>
                  <th className="px-4 py-3 text-right font-medium">金額</th>
                  <th className="px-4 py-3 font-medium">狀態</th>
                  <th className="px-4 py-3 font-medium">建立時間</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b last:border-0 hover:bg-muted/30"
                    data-testid={`row-order-${o.id}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{o.orderNo}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{o.memberName}</p>
                      <p className="text-xs text-muted-foreground">
                        {tierLabel[o.memberTier ?? ""] ?? ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {paymentLabel[o.paymentMethod] ?? o.paymentMethod}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      NT${o.totalAmount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={statusClass[o.status] ?? ""}>
                        {statusLabel[o.status] ?? o.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(o.createdAt).toLocaleString("zh-TW")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDetail(o)}
                        data-testid={`button-view-order-${o.id}`}
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

      {/* Order detail dialog */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              訂單 {detail?.orderNo}
              {detail && (
                <Badge variant="outline" className={statusClass[detail.status] ?? ""}>
                  {statusLabel[detail.status] ?? detail.status}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <p>
                  <span className="text-muted-foreground">會員：</span>
                  {detail.memberName}（{tierLabel[detail.memberTier ?? ""] ?? "—"}）
                </p>
                <p>
                  <span className="text-muted-foreground">付款方式：</span>
                  {paymentLabel[detail.paymentMethod] ?? detail.paymentMethod}
                </p>
                <p>
                  <span className="text-muted-foreground">收件人：</span>
                  {detail.receiverName || "—"} {detail.receiverPhone || ""}
                </p>
                <p>
                  <span className="text-muted-foreground">建立：</span>
                  {new Date(detail.createdAt).toLocaleString("zh-TW")}
                </p>
                <p className="col-span-2">
                  <span className="text-muted-foreground">配送地址：</span>
                  {detail.shippingAddress || "—"}
                </p>
                {detail.note && (
                  <p className="col-span-2">
                    <span className="text-muted-foreground">備註：</span>
                    {detail.note}
                  </p>
                )}
              </div>
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">商品</th>
                      <th className="px-3 py-2 text-right font-medium">單價</th>
                      <th className="px-3 py-2 text-right font-medium">數量</th>
                      <th className="px-3 py-2 text-right font-medium">小計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((i) => (
                      <tr key={i.id} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <p className="font-medium">{i.productName}</p>
                          <p className="text-xs text-muted-foreground">{i.productCode}</p>
                        </td>
                        <td className="px-3 py-2 text-right">
                          NT${i.unitPrice.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right">{i.quantity}</td>
                        <td className="px-3 py-2 text-right font-medium">
                          NT${(i.unitPrice * i.quantity).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-right text-sm">
                合計：
                <span className="text-base font-bold">
                  NT${detail.totalAmount.toLocaleString()}
                </span>
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            {detail &&
              (NEXT_ACTIONS[detail.status] ?? []).map((action) => (
                <Button
                  key={action.status}
                  variant={action.danger ? "outline" : "default"}
                  className={action.danger ? "text-destructive" : ""}
                  disabled={updateStatus.isPending}
                  onClick={() =>
                    updateStatus.mutate({
                      id: detail.id,
                      data: { status: action.status as any },
                    })
                  }
                  data-testid={`button-order-${action.status}`}
                >
                  {action.label}
                </Button>
              ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
