import { useEffect, useMemo, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminOrders,
  getListAdminOrdersQueryKey,
  useUpdateAdminOrderStatus,
  useBulkUpdateAdminOrderStatus,
  useBulkDeleteAdminOrders,
  useUpdateShipmentPhotos,
  getGetAdminStatsQueryKey,
  getListAdminProductsQueryKey,
  getListAdminStockMovementsQueryKey,
  type AdminOrder,
  type ListAdminOrdersParams,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { Search, Eye, X, UploadCloud, Trash2, CheckSquare } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  returned: "已退貨",
  cancelled: "已取消",
};

const statusClass: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  paid: "border-blue-200 bg-blue-50 text-blue-700",
  shipped: "border-indigo-200 bg-indigo-50 text-indigo-700",
  completed: "border-green-200 bg-green-50 text-green-700",
  returned: "border-gray-300 bg-gray-100 text-gray-700",
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

function ShipmentPhotosManager({ order }: { order: AdminOrder }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { mutateAsync: updatePhotos, isPending: saving } = useUpdateShipmentPhotos();
  const { uploadFile, isUploading } = useUpload();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const photos = order.shipmentPhotos || [];
  
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    if (photos.length + files.length > 10) {
      toast({ title: "最多只能上傳 10 張照片", variant: "destructive" });
      return;
    }
    
    try {
      const newPaths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const res = await uploadFile(file);
        if (res?.objectPath) {
          newPaths.push(res.objectPath);
        }
      }
      
      if (newPaths.length > 0) {
        await updatePhotos({ id: order.id, data: { photos: [...photos, ...newPaths] } });
        queryClient.invalidateQueries({ queryKey: getListAdminOrdersQueryKey(), exact: false });
        toast({ title: "照片上傳成功" });
      }
    } catch (err: any) {
      toast({ title: "照片上傳失敗", variant: "destructive" });
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };
  
  const removePhoto = async (index: number) => {
    try {
      const updatedPhotos = [...photos];
      updatedPhotos.splice(index, 1);
      await updatePhotos({ id: order.id, data: { photos: updatedPhotos } });
      queryClient.invalidateQueries({ queryKey: getListAdminOrdersQueryKey(), exact: false });
      toast({ title: "照片已移除" });
    } catch (err: any) {
      toast({ title: "移除失敗", variant: "destructive" });
    }
  };

  return (
    <div className="border rounded-xl p-4 bg-gray-50/50 mt-4">
      <div className="flex justify-between items-center mb-3">
        <h4 className="font-bold text-sm">出貨照片存證</h4>
        <div className="text-xs text-muted-foreground">{photos.length}/10</div>
      </div>
      
      <div className="grid grid-cols-4 gap-2 mb-3">
        {photos.map((p, idx) => (
          <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border bg-white group">
            <img src={`/api/storage${p}`} alt="Shipment" className="w-full h-full object-cover" />
            <button 
              className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
              onClick={() => removePhoto(idx)}
              disabled={saving}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {photos.length < 10 && (
          <button 
            className="aspect-square rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:text-primary hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || saving}
          >
            <UploadCloud size={20} className="mb-1" />
            <span className="text-[10px]">{isUploading ? "上傳中..." : "上傳照片"}</span>
          </button>
        )}
      </div>
      <input 
        type="file" 
        multiple 
        accept="image/*" 
        className="hidden" 
        ref={fileInputRef} 
        onChange={handleFileChange}
      />
    </div>
  );
}

export default function AdminOrdersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detail, setDetail] = useState<AdminOrder | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmAction, setConfirmAction] = useState<
    { type: "status"; status: string; label: string } | { type: "delete" } | null
  >(null);

  const params = useMemo(() => {
    const p: ListAdminOrdersParams = {};
    if (search) p.search = search;
    if (statusFilter !== "all")
      p.status = statusFilter as ListAdminOrdersParams["status"];
    return p;
  }, [search, statusFilter]);

  // 搜尋/篩選條件改變時清空選取，避免對「已看不到的訂單」執行批量操作
  useEffect(() => {
    setSelectedIds(new Set());
  }, [search, statusFilter]);

  const { data: orders, isLoading } = useListAdminOrders(params, {
    query: { queryKey: getListAdminOrdersQueryKey(params) },
  });

  const invalidateOrderQueries = () => {
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
  };

  const bulkStatus = useBulkUpdateAdminOrderStatus({
    mutation: {
      onSuccess: (result) => {
        invalidateOrderQueries();
        setSelectedIds(new Set(result.skipped.map((s) => s.id)));
        const desc = result.skipped.length
          ? result.skipped
              .slice(0, 5)
              .map((s) => `${s.orderNo ?? `#${s.id}`}：${s.reason}`)
              .join("\n") + (result.skipped.length > 5 ? `\n…共 ${result.skipped.length} 筆未處理` : "")
          : undefined;
        toast({
          title: `已更新 ${result.updated.length} 筆訂單${result.skipped.length ? `，${result.skipped.length} 筆未處理` : ""}`,
          description: desc,
          variant: result.updated.length === 0 && result.skipped.length ? "destructive" : undefined,
        });
      },
      onError: (err: any) =>
        toast({
          title: "批量更新失敗",
          description: err?.data?.error ?? "請稍後再試",
          variant: "destructive",
        }),
    },
  });

  const bulkDelete = useBulkDeleteAdminOrders({
    mutation: {
      onSuccess: (result) => {
        invalidateOrderQueries();
        setSelectedIds(new Set(result.skipped.map((s) => s.id)));
        const desc = result.skipped.length
          ? result.skipped
              .slice(0, 5)
              .map((s) => `${s.orderNo ?? `#${s.id}`}：${s.reason}`)
              .join("\n") + (result.skipped.length > 5 ? `\n…共 ${result.skipped.length} 筆未刪除` : "")
          : undefined;
        toast({
          title: `已刪除 ${result.deletedIds.length} 筆訂單${result.skipped.length ? `，${result.skipped.length} 筆未刪除` : ""}`,
          description: desc,
          variant: result.deletedIds.length === 0 && result.skipped.length ? "destructive" : undefined,
        });
      },
      onError: (err: any) =>
        toast({
          title: "批量刪除失敗",
          description: err?.data?.error ?? "請稍後再試",
          variant: "destructive",
        }),
    },
  });

  const bulkPending = bulkStatus.isPending || bulkDelete.isPending;

  const allSelected =
    !!orders?.length && orders.every((o) => selectedIds.has(o.id));
  const toggleAll = () => {
    if (!orders?.length) return;
    setSelectedIds((prev) => {
      if (orders.every((o) => prev.has(o.id))) return new Set();
      return new Set(orders.map((o) => o.id));
    });
  };
  const toggleOne = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 批量狀態選項：依所選訂單的目前狀態，列出至少對一筆有效的動作
  const bulkActions = useMemo(() => {
    if (!orders) return [];
    const selected = orders.filter((o) => selectedIds.has(o.id));
    const possible = new Map<string, string>();
    for (const o of selected) {
      for (const a of NEXT_ACTIONS[o.status] ?? []) {
        if (!possible.has(a.status)) possible.set(a.status, a.label);
      }
      if (o.status === "shipped" || o.status === "completed") {
        possible.set("returned", "標記退貨");
      }
    }
    return [...possible.entries()].map(([status, label]) => ({ status, label }));
  }, [orders, selectedIds]);

  const runConfirmedAction = () => {
    const ids = [...selectedIds];
    if (!ids.length || !confirmAction) return;
    if (confirmAction.type === "delete") {
      bulkDelete.mutate({ data: { ids } });
    } else {
      bulkStatus.mutate({ data: { ids, status: confirmAction.status as any } });
    }
    setConfirmAction(null);
  };

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

      {selectedIds.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <CheckSquare size={16} className="text-primary" />
            已選 {selectedIds.size} 筆
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {bulkActions.map((a) => (
              <Button
                key={a.status}
                size="sm"
                variant={a.status === "cancelled" || a.status === "returned" ? "outline" : "default"}
                className={a.status === "cancelled" || a.status === "returned" ? "text-destructive" : ""}
                disabled={bulkPending}
                onClick={() => {
                  if (a.status === "cancelled" || a.status === "returned") {
                    setConfirmAction({ type: "status", status: a.status, label: a.label });
                  } else {
                    bulkStatus.mutate({
                      data: { ids: [...selectedIds], status: a.status as any },
                    });
                  }
                }}
                data-testid={`button-bulk-${a.status}`}
              >
                {a.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              disabled={bulkPending}
              onClick={() => setConfirmAction({ type: "delete" })}
              data-testid="button-bulk-delete"
            >
              <Trash2 size={14} className="mr-1" /> 刪除
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={bulkPending}
              onClick={() => setSelectedIds(new Set())}
              data-testid="button-bulk-clear"
            >
              取消選取
            </Button>
          </div>
        </div>
      )}

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
                  <th className="w-10 px-4 py-3">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="全選"
                      data-testid="checkbox-select-all"
                    />
                  </th>
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
                    className={`border-b last:border-0 hover:bg-muted/30 ${selectedIds.has(o.id) ? "bg-primary/5" : ""}`}
                    data-testid={`row-order-${o.id}`}
                  >
                    <td className="px-4 py-3">
                      <Checkbox
                        checked={selectedIds.has(o.id)}
                        onCheckedChange={() => toggleOne(o.id)}
                        aria-label={`選取訂單 ${o.orderNo}`}
                        data-testid={`checkbox-order-${o.id}`}
                      />
                    </td>
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

      {/* Bulk action confirm dialog */}
      <AlertDialog
        open={!!confirmAction}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === "delete"
                ? `確定刪除選取的 ${selectedIds.size} 筆訂單？`
                : `確定將選取的 ${selectedIds.size} 筆訂單${confirmAction?.type === "status" ? confirmAction.label : ""}？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === "delete"
                ? "只有「已取消」或「已退貨」的訂單會被刪除（財務與庫存已沖回），其他狀態的訂單會自動跳過並回報。刪除後無法復原。"
                : "系統會逐筆檢查訂單狀態，不符合流程的訂單會自動跳過並回報原因；取消／退貨會自動退款並回補庫存。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>返回</AlertDialogCancel>
            <AlertDialogAction
              className={confirmAction?.type === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
              onClick={runConfirmedAction}
              data-testid="button-bulk-confirm"
            >
              確定執行
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                          <p className="font-medium">
                            {i.productName}
                            {i.variantName && <span className="ml-1 text-[10px] bg-muted px-1 py-0.5 rounded text-muted-foreground">規格：{i.variantName}</span>}
                          </p>
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
              
              <ShipmentPhotosManager order={detail} />
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
