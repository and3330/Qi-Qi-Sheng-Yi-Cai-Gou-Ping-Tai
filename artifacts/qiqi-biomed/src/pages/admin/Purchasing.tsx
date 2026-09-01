import { useMemo, useState } from "react";
import {
  useListAdminPurchaseOrders,
  useListAdminSuppliers,
  type AdminPurchaseOrder,
  type ListAdminPurchaseOrdersParams,
} from "@workspace/api-client-react";
import { AlertCircle, Eye } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminLayout } from "./AdminLayout";

const statusLabel: Record<string, string> = {
  draft: "草稿", ordered: "已下單", received: "已收貨", cancelled: "已取消",
};
const statusClass: Record<string, string> = {
  draft: "border-gray-200 bg-gray-50 text-gray-600",
  ordered: "border-blue-200 bg-blue-50 text-blue-700",
  received: "border-green-200 bg-green-50 text-green-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

export default function AdminPurchasingPage() {
  const [status, setStatus] = useState("all");
  const [detail, setDetail] = useState<AdminPurchaseOrder | null>(null);
  const params = useMemo<ListAdminPurchaseOrdersParams>(
    () => status === "all" ? {} : { status: status as ListAdminPurchaseOrdersParams["status"] },
    [status],
  );
  const { data: orders, isLoading } = useListAdminPurchaseOrders(params);
  const { data: suppliers, isLoading: suppliersLoading } = useListAdminSuppliers({});

  return (
    <AdminLayout title="採購進貨">
      <Alert className="mb-5 border-blue-200 bg-blue-50 text-blue-900">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>作業入口已移轉</AlertTitle>
        <AlertDescription>採購與收貨作業已移至 ERP 系統（採購 › 採購單／採購收貨），此頁僅供查閱。</AlertDescription>
      </Alert>
      <Tabs defaultValue="orders">
        <TabsList className="mb-4"><TabsTrigger value="orders">採購單</TabsTrigger><TabsTrigger value="suppliers">供應商</TabsTrigger></TabsList>
        <TabsContent value="orders">
          <div className="mb-4"><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-40 bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部狀態</SelectItem>{Object.entries(statusLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
          {isLoading ? <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}</div>
            : !orders?.length ? <div className="rounded-2xl border border-dashed bg-white py-16 text-center text-muted-foreground">尚無採購單</div>
            : <div className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground"><th className="px-4 py-3 font-medium">單號</th><th className="px-4 py-3 font-medium">供應商</th><th className="px-4 py-3 font-medium">品項數</th><th className="px-4 py-3 text-right font-medium">金額</th><th className="px-4 py-3 font-medium">狀態</th><th className="px-4 py-3 font-medium">建立時間</th><th className="px-4 py-3 text-right font-medium">操作</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id} className="border-b last:border-0 hover:bg-muted/30"><td className="px-4 py-3 font-mono text-xs">{order.poNo}</td><td className="px-4 py-3">{order.supplierName}</td><td className="px-4 py-3">{order.items.length}</td><td className="px-4 py-3 text-right font-semibold">NT${order.totalAmount.toLocaleString()}</td><td className="px-4 py-3"><Badge variant="outline" className={statusClass[order.status]}>{statusLabel[order.status]}</Badge></td><td className="px-4 py-3 text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleString("zh-TW")}</td><td className="px-4 py-3 text-right"><Button size="sm" variant="outline" onClick={() => setDetail(order)}><Eye size={14} className="mr-1" />詳情</Button></td></tr>)}</tbody></table></div></div>}
        </TabsContent>
        <TabsContent value="suppliers">
          {suppliersLoading ? <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}</div>
            : !suppliers?.length ? <div className="rounded-2xl border border-dashed bg-white py-16 text-center text-muted-foreground">尚無供應商資料</div>
            : <div className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground"><th className="px-4 py-3 font-medium">名稱</th><th className="px-4 py-3 font-medium">聯絡人</th><th className="px-4 py-3 font-medium">電話 / Email</th><th className="px-4 py-3 font-medium">付款條件</th><th className="px-4 py-3 font-medium">狀態</th></tr></thead><tbody>{suppliers.map((supplier) => <tr key={supplier.id} className="border-b last:border-0"><td className="px-4 py-3 font-medium">{supplier.name}</td><td className="px-4 py-3">{supplier.contactPerson || "—"}</td><td className="px-4 py-3 text-xs text-muted-foreground"><div>{supplier.phone || "—"}</div><div>{supplier.email}</div></td><td className="px-4 py-3">{supplier.paymentTerms || "—"}</td><td className="px-4 py-3"><Badge variant="outline" className={supplier.isActive ? "border-green-200 bg-green-50 text-green-700" : "border-gray-200 bg-gray-50 text-gray-500"}>{supplier.isActive ? "合作中" : "停用"}</Badge></td></tr>)}</tbody></table></div></div>}
        </TabsContent>
      </Tabs>
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle className="flex items-center gap-2">採購單 {detail?.poNo}{detail && <Badge variant="outline" className={statusClass[detail.status]}>{statusLabel[detail.status]}</Badge>}</DialogTitle></DialogHeader>
          {detail && <div className="space-y-4"><div className="grid grid-cols-2 gap-2 text-sm"><p><span className="text-muted-foreground">供應商：</span>{detail.supplierName}</p><p><span className="text-muted-foreground">建立：</span>{new Date(detail.createdAt).toLocaleString("zh-TW")}</p>{detail.note && <p className="col-span-2"><span className="text-muted-foreground">備註：</span>{detail.note}</p>}</div><div className="overflow-hidden rounded-xl border"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/50"><th className="px-3 py-2 text-left">商品</th><th className="px-3 py-2 text-right">進價</th><th className="px-3 py-2 text-right">數量</th><th className="px-3 py-2 text-right">小計</th></tr></thead><tbody>{detail.items.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="px-3 py-2"><div className="font-medium">{item.productName}</div><div className="text-xs text-muted-foreground">{item.variantName || item.productCode}</div></td><td className="px-3 py-2 text-right">NT${item.unitCost.toLocaleString()}</td><td className="px-3 py-2 text-right">{item.quantity}</td><td className="px-3 py-2 text-right font-medium">NT${(item.unitCost * item.quantity).toLocaleString()}</td></tr>)}</tbody></table></div><p className="text-right font-bold">合計：NT${detail.totalAmount.toLocaleString()}</p></div>}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}