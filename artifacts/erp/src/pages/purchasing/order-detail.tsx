import { useState, useEffect, useCallback, useRef } from "react";
import { RelatedDocs } from "@/components/shared/related-docs";
import { PurchaseOrderFormDialog } from "@/components/purchasing/purchase-order-edit-dialog";
import { Pencil } from "lucide-react";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, FileText, Calendar, Building2, FolderKanban, Truck, Coins, Phone, Mail, User, Hash, PackageCheck, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAutoReloadKey } from "@/lib/auto-refresh";

const BASE_URL = import.meta.env.BASE_URL;
const BASE = BASE_URL.endsWith("/") ? BASE_URL : BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;
const statusMap: Record<string, string> = { Draft: "草稿", "To Receive": "待收貨", Completed: "已完成", Cancelled: "已取消" };
const receiptStatusMap: Record<string, string> = { Draft: "草稿", Submitted: "已提交", Completed: "已完成", Cancelled: "已取消" };

function InfoCard({ icon: Icon, label, value }: { icon?: any; label: string; value: string | number | null | undefined }) {
  if (!value && value !== 0) return null;
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          {Icon && <Icon className="h-4 w-4" />}{label}
        </div>
        <p className="font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function PurchaseOrderDetail() {
  const reloadKey = useAutoReloadKey();
  const [, params] = useRoute("/purchasing/orders/:id");
  const [, navigate] = useLocation();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editReload, setEditReload] = useState(0);
  const [deptName, setDeptName] = useState("");
  const [projName, setProjName] = useState("");
  const [receipts, setReceipts] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();

  const loadReceipts = useCallback(async () => {
    if (!params?.id) return;
    try {
      const res = await fetch(api(`purchase-orders/${params.id}/receipts`));
      if (res.ok) setReceipts(await res.json());
    } catch {}
  }, [params?.id]);

  useEffect(() => {
    if (!params?.id) return;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(api(`purchase-orders/${params.id}`));
        if (res.ok) {
          const data = await res.json();
          setOrder(data);

          try {
            const [dRes, pRes] = await Promise.all([
              fetch(api("departments")),
              fetch(api("projects")),
            ]);
            if (dRes.ok) {
              const depts = await dRes.json();
              if (data.departmentId) {
                const d = depts.find((x: any) => x.id === data.departmentId);
                if (d) setDeptName(d.name);
              }
            }
            if (pRes.ok) {
              const projs = await pRes.json();
              if (data.projectId) {
                const p = projs.find((x: any) => x.id === data.projectId);
                if (p) setProjName(p.name);
              }
            }
          } catch (e) {
            console.warn("Failed to load department/project names", e);
          }
        }
      } catch (e) {
        console.error("Failed to load purchase order", e);
      }
      setLoading(false);
    };
    load();
    loadReceipts();
  }, [params?.id, loadReceipts, reloadKey, editReload]);

  const [editOpen, setEditOpen] = useState(false);
  // 開始編輯當下的那張單：頁面自動重新整理時，視窗裡打到一半的內容不會被洗掉
  const [editOrder, setEditOrder] = useState<any>(null);
  const editOpenedFromUrl = useRef(false);
  const openEdit = () => {
    setEditOrder(order);
    setEditOpen(true);
  };
  useEffect(() => {
    if (!order || editOpenedFromUrl.current || new URLSearchParams(window.location.search).get("edit") !== "1") return;
    editOpenedFromUrl.current = true;
    openEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);
  // 編輯視窗和採購訂單清單用的是同一個；三種畫面都放在同一個位置，重新載入時視窗不會被關掉
  const editDialog = (
    <PurchaseOrderFormDialog open={editOpen} onOpenChange={setEditOpen} order={editOrder} onSaved={() => setEditReload(k => k + 1)} />
  );

  if (loading) {
    return (
      <>
        <div className="space-y-4 p-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
        {editDialog}
      </>
    );
  }

  if (!order) {
    return (
      <>
        <div className="p-8 text-center">
          <p className="text-muted-foreground">找不到此採購單</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/purchasing/orders")}>
            <ArrowLeft className="h-4 w-4 mr-1" />返回列表
          </Button>
        </div>
        {editDialog}
      </>
    );
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const currency = order.currency || "TWD";
  const currSymbol = currency === "TWD" ? "NT$" : currency;
  const exRate = Number(order.exchangeRate) || 1;

  // Receipt fulfilment summary
  const orderQty: Record<string, number> = {};
  for (const it of items) {
    const key = String(it.itemId ?? it.itemName ?? "");
    orderQty[key] = (orderQty[key] || 0) + Number(it.quantity || 0);
  }
  const receivedQty: Record<string, number> = {};
  for (const r of receipts) {
    if (r.status !== "Submitted" && r.status !== "Completed") continue;
    for (const it of (r.items || [])) {
      const key = String(it.itemId ?? it.itemName ?? "");
      receivedQty[key] = (receivedQty[key] || 0) + Number(it.quantity || 0);
    }
  }

  return (
    <>
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/purchasing/orders")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">採購單明細</h1>
          <p className="text-sm text-muted-foreground">{order.orderNumber}</p>
        </div>
        <Button variant="outline" size="sm" onClick={openEdit} data-testid="button-edit-purchase-order"><Pencil className="h-3.5 w-3.5 mr-1" />編輯</Button>
        <Badge variant={order.status === "Completed" ? "default" : order.status === "Cancelled" ? "destructive" : "secondary"} className="text-sm px-3 py-1">
          {statusMap[order.status] || order.status}
        </Badge>
      </div>

      {order.extraFields?.legacy === true && (
        <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          這是從舊系統 Ecount 搬過來的歷史採購單（原單號 {order.extraFields.legacyDocNumber || "—"}{order.extraFields.legacyStaff ? `・承辦人 ${order.extraFields.legacyStaff}` : ""}{order.extraFields.legacyNote ? `・${order.extraFields.legacyNote}` : ""}）。可以按「編輯」補專案、部門、到貨日、標題與備註；供應商、品項、金額不能改。
          舊系統的採購單和進貨單沒有互相連結，所以這裡看不到收貨進度；進貨紀錄請到進貨單查。
          {order.extraFields.legacyTitle && <div className="mt-1">標題：{order.extraFields.legacyTitle}</div>}
          {order.extraFields.legacyRemarks && <div className="mt-1 whitespace-pre-wrap">備註：{order.extraFields.legacyRemarks}</div>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <InfoCard icon={FileText} label="採購單號" value={order.orderNumber} />
        <InfoCard icon={Calendar} label="訂單日期" value={order.orderDate} />
        <InfoCard icon={Truck} label="供應商" value={order.supplierName} />
        <InfoCard icon={Calendar} label="預計到貨日" value={order.expectedDate} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <InfoCard icon={Building2} label="部門" value={deptName} />
        <InfoCard icon={FolderKanban} label="專案" value={projName} />
        <InfoCard icon={Coins} label="幣別" value={currency} />
        {exRate !== 1 && <InfoCard label="匯率" value={exRate} />}
      </div>

      {(order.supplierContactPerson || order.supplierPhone || order.supplierEmail || order.supplierTaxId || order.supplierCode) && (
        <>
          <h3 className="text-lg font-semibold text-gray-700 border-b pb-2">供應商資訊</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <InfoCard icon={Hash} label="供應商代號" value={order.supplierCode} />
            <InfoCard icon={User} label="聯絡人" value={order.supplierContactPerson} />
            <InfoCard icon={Phone} label="電話" value={order.supplierPhone} />
            <InfoCard icon={Mail} label="Email" value={order.supplierEmail} />
            <InfoCard icon={Hash} label="統一編號" value={order.supplierTaxId} />
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">採購品項明細</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>品項名稱</TableHead>
                  <TableHead className="text-right">訂購量</TableHead>
                  <TableHead className="text-right">已收量</TableHead>
                  <TableHead className="text-right">單價</TableHead>
                  <TableHead className="text-right">金額</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length > 0 ? items.map((item: any, idx: number) => {
                  const key = String(item.itemId ?? item.itemName ?? "");
                  const ordered = Number(item.quantity || 0);
                  const received = receivedQty[key] || 0;
                  const fulfilled = received >= ordered && ordered > 0;
                  return (
                    <TableRow key={idx}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-medium">
                        {item.itemName || item.name || "-"}
                        {(item.specification || item.summary) && <div className="text-xs font-normal text-muted-foreground">{[item.specification, item.summary].filter(Boolean).join("・")}</div>}
                        {item.originalCurrency && <div className="text-xs font-normal text-muted-foreground">原幣 {item.originalCurrency} {Number(item.originalAmount).toLocaleString()}（匯率 {item.originalRate}）</div>}
                      </TableCell>
                      <TableCell className="text-right">{ordered.toLocaleString()}</TableCell>
                      {order.extraFields?.legacy === true ? <TableCell className="text-right text-muted-foreground">—</TableCell> : <TableCell className={`text-right ${fulfilled ? "text-emerald-600 font-medium" : received > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                        {received.toLocaleString()}
                        {ordered > 0 && (
                          <span className="text-xs ml-1">({Math.round(received / ordered * 100)}%)</span>
                        )}
                      </TableCell>}
                      <TableCell className="text-right">{currSymbol} {Number(item.rate || item.unitPrice || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">{currSymbol} {Number(item.amount || (ordered * (item.rate || item.unitPrice || 0)) || 0).toLocaleString()}</TableCell>
                    </TableRow>
                  );
                }) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">無品項資料</TableCell>
                  </TableRow>
                )}
                {items.length > 0 && (
                  <TableRow className="bg-muted/20 font-bold">
                    <TableCell colSpan={5} className="text-right">合計</TableCell>
                    <TableCell className="text-right">{currSymbol} {Number(order.totalAmount || 0).toLocaleString()}</TableCell>
                  </TableRow>
                )}
                {items.length > 0 && exRate !== 1 && (
                  <TableRow className="bg-muted/10">
                    <TableCell colSpan={5} className="text-right text-sm text-muted-foreground">合計 (TWD)</TableCell>
                    <TableCell className="text-right text-sm">NT$ {Number(order.totalAmountTWD || 0).toLocaleString()}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <PackageCheck className="h-5 w-5" />
            收貨紀錄 ({receipts.length})
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(`/purchasing/receipts`)}>
              前往收貨管理
            </Button>
            <Button
              size="sm"
              disabled={creating || order.status === "Completed" || order.status === "Cancelled"}
              onClick={async () => {
                setCreating(true);
                try {
                  const res = await fetch(api(`purchase-receipts/from-order/${order.id}`), { method: "POST" });
                  if (res.ok) {
                    const created = await res.json();
                    toast({ title: "已建立收貨單", description: created.receiptNumber });
                    await loadReceipts();
                    const refreshed = await fetch(api(`purchase-orders/${order.id}`));
                    if (refreshed.ok) setOrder(await refreshed.json());
                  } else {
                    const err = await res.json().catch(() => ({}));
                    toast({ title: "建立失敗", description: err.error || "未知錯誤", variant: "destructive" });
                  }
                } catch (e: any) {
                  toast({ title: "建立失敗", description: e?.message || String(e), variant: "destructive" });
                }
                setCreating(false);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />從此採購單建立收貨單
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>收貨單號</TableHead>
                  <TableHead>收貨日期</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead className="text-right">金額</TableHead>
                  <TableHead>備註</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.length > 0 ? receipts.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.receiptNumber}</TableCell>
                    <TableCell>{r.receiptDate}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "Completed" ? "default" : r.status === "Cancelled" ? "destructive" : "secondary"}>
                        {receiptStatusMap[r.status] || r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{currSymbol} {Number(r.totalAmount).toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{r.remarks || "-"}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">尚無收貨紀錄</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <RelatedDocs type="purchase_order" id={order.id} />
        </CardContent>
      </Card>
    </div>
    {editDialog}
    </>
  );
}
