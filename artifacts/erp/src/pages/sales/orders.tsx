import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetErpSalesOrderQueryKey, getListErpSalesOrdersQueryKey, useCreateErpSalesOrder, useGetErpSalesOrder,
  useListErpCustomers, useListErpHrEmployees, useListErpItems, useListErpSalesOrders, useListErpWarehouses, useUpdateErpSalesOrderStatus,
  type ErpSalesOrderStatusUpdateStatus,
} from "@workspace/api-client-react";
import { Eye, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const statuses: Record<string, string> = { draft: "草稿", confirmed: "已確認", shipped: "已出貨", completed: "已完成", cancelled: "已取消", returned: "已退貨" };
const sources: Record<string, string> = { shop: "商城", erp: "ERP", quotation: "報價轉單" };
const colors: Record<string, string> = { draft: "bg-slate-100", confirmed: "bg-blue-100 text-blue-700", shipped: "bg-amber-100 text-amber-700", completed: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700", returned: "bg-purple-100 text-purple-700" };
const errorMessage = (e: any) => e?.response?.data?.error || e?.data?.error || e?.message || "發生未知錯誤";
type Line = { productId: string; variantId: string; quantity: string; unitPrice: string };
const emptyLine = (): Line => ({ productId: "", variantId: "", quantity: "1", unitPrice: "" });

export default function SalesOrdersPage() {
  const { toast } = useToast(); const queryClient = useQueryClient();
  const [page, setPage] = useState(1); const [status, setStatus] = useState("all"); const [source, setSource] = useState("all");
  const [detailId, setDetailId] = useState<number | null>(null); const [createOpen, setCreateOpen] = useState(false);
  const [customerId, setCustomerId] = useState(""); const [warehouseId, setWarehouseId] = useState("default"); const [note, setNote] = useState(""); const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [creatorEmployeeId, setCreatorEmployeeId] = useState("");
  const params = { page, status: status === "all" ? undefined : status, source: source === "all" ? undefined : source };
  const { data, isLoading } = useListErpSalesOrders(params); const { data: customers } = useListErpCustomers(); const { data: products } = useListErpItems(); const { data: warehouses } = useListErpWarehouses(); const { data: employees, isLoading: employeesLoading } = useListErpHrEmployees();
  const activeEmployees = employees?.filter((employee) => employee.status === "active") ?? [];
  const creatorName = (id?: number | null) => employees?.find((employee) => employee.id === id)?.name || "—";
  const { data: detail, isLoading: detailLoading } = useGetErpSalesOrder(detailId ?? 0, { query: { queryKey: getGetErpSalesOrderQueryKey(detailId ?? 0), enabled: detailId !== null } });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListErpSalesOrdersQueryKey() });
  const reset = () => { setCustomerId(""); setWarehouseId("default"); setNote(""); setCreatorEmployeeId(""); setLines([emptyLine()]); };
  const create = useCreateErpSalesOrder({ mutation: { onSuccess: () => { invalidate(); toast({ title: "已建立銷貨單" }); setCreateOpen(false); reset(); }, onError: (e: any) => toast({ title: "建立失敗", description: errorMessage(e), variant: "destructive" }) } });
  const update = useUpdateErpSalesOrderStatus({ mutation: { onSuccess: () => { invalidate(); queryClient.invalidateQueries({ queryKey: getGetErpSalesOrderQueryKey(detailId ?? 0) }); toast({ title: "銷貨單狀態已更新" }); }, onError: (e: any) => toast({ title: "更新失敗", description: errorMessage(e), variant: "destructive" }) } });
  const changeStatus = (next: ErpSalesOrderStatusUpdateStatus) => detail && update.mutate({ id: detail.id, data: { status: next } });
  const submit = () => {
    const items = lines.filter((x) => x.productId).map((x) => ({ productId: Number(x.productId), variantId: x.variantId ? Number(x.variantId) : null, quantity: Number(x.quantity), unitPrice: x.unitPrice === "" ? null : Number(x.unitPrice) }));
    const invalidVariant = lines.some((x) => { const p = products?.find((item) => item.id === Number(x.productId)); return !!p?.variants.length && !x.variantId; });
    if (!customerId || !items.length || items.some((x) => x.quantity < 1 || (x.unitPrice !== null && x.unitPrice < 0)) || invalidVariant) { toast({ title: "請完整填寫銷貨資料", description: invalidVariant ? "有規格的品項必須選擇規格" : "數量至少為 1，單價不可小於 0", variant: "destructive" }); return; }
    create.mutate({ data: { customerId: Number(customerId), warehouseId: warehouseId === "default" ? null : Number(warehouseId), creatorEmployeeId: creatorEmployeeId ? Number(creatorEmployeeId) : null, note: note || null, items } });
  };
  const actions = detail ? (detail.source === "erp"
    ? detail.status === "draft" ? [["confirmed", "確認（扣庫存）"], ["cancelled", "取消"]] : detail.status === "confirmed" ? [["shipped", "出貨"], ["cancelled", "取消"]] : detail.status === "shipped" ? [["completed", "完成"]] : []
    : detail.status === "confirmed" ? [["shipped", "出貨"], ["cancelled", "取消"]] : detail.status === "shipped" ? [["completed", "完成"], ["cancelled", "取消"]] : []) as [ErpSalesOrderStatusUpdateStatus, string][] : [];

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2">
      <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部狀態</SelectItem>{Object.entries(statuses).map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select>
      <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部來源</SelectItem>{Object.entries(sources).map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select>
    </div><Button onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" />建立銷貨單</Button></div>
    <Card className="overflow-hidden border-t-2 border-t-primary"><Table><TableHeader className="bg-secondary/50"><TableRow><TableHead>單號</TableHead><TableHead>來源</TableHead><TableHead>客戶</TableHead><TableHead className="text-right">金額</TableHead><TableHead>狀態</TableHead><TableHead>製單人</TableHead><TableHead>建立時間</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>{isLoading ? <TableRow><TableCell colSpan={8} className="h-32 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></TableCell></TableRow> : !data?.items.length ? <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">查無銷貨單</TableCell></TableRow> : data.items.map((o) => <TableRow key={o.id}><TableCell className="font-medium">{o.soNo}</TableCell><TableCell>{sources[o.source] || o.source}</TableCell><TableCell>{o.customerName}</TableCell><TableCell className="text-right">NT$ {o.totalAmount.toLocaleString()}</TableCell><TableCell><Badge variant="outline" className={colors[o.status]}>{statuses[o.status] || o.status}</Badge></TableCell><TableCell>{creatorName(o.creatorEmployeeId)}</TableCell><TableCell>{new Date(o.createdAt).toLocaleDateString("zh-TW")}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => setDetailId(o.id)}><Eye className="mr-1 h-4 w-4" />明細</Button></TableCell></TableRow>)}</TableBody>
    </Table></Card>
    {data && data.total > data.pageSize && <div className="flex justify-end gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一頁</Button><span className="self-center text-sm">第 {page} 頁</span><Button variant="outline" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>下一頁</Button></div>}

    <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) reset(); }}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>建立銷貨單</DialogTitle></DialogHeader>
      <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>客戶 *</Label><Select value={customerId} onValueChange={setCustomerId}><SelectTrigger><SelectValue placeholder="選擇客戶" /></SelectTrigger><SelectContent>{customers?.filter((c) => c.isActive).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.code}－{c.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label>出貨倉</Label><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">預設倉</SelectItem>{warehouses?.filter((w) => w.isActive && w.isSellable).map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>製單人（選填）</Label><Select value={creatorEmployeeId} onValueChange={setCreatorEmployeeId} disabled={employeesLoading || !activeEmployees.length}><SelectTrigger><SelectValue placeholder={employeesLoading ? "載入員工中…" : activeEmployees.length ? "選擇製單人" : "無在職員工"} /></SelectTrigger><SelectContent>{activeEmployees.map((employee) => <SelectItem key={employee.id} value={String(employee.id)}>{employee.employeeNo}－{employee.name}</SelectItem>)}</SelectContent></Select></div></div>
        <div className="space-y-2"><Label>品項 *</Label>{lines.map((line, index) => { const product = products?.find((p) => p.id === Number(line.productId)); return <div key={index} className="grid grid-cols-12 gap-2">
          <Select value={line.productId} onValueChange={(v) => setLines(lines.map((x,i) => i === index ? {...x, productId:v, variantId:""} : x))}><SelectTrigger className="col-span-4"><SelectValue placeholder="品項" /></SelectTrigger><SelectContent>{products?.filter((p) => p.isActive).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code}－{p.name}</SelectItem>)}</SelectContent></Select>
          <Select value={line.variantId || "none"} onValueChange={(v) => setLines(lines.map((x,i) => i === index ? {...x, variantId:v === "none" ? "" : v} : x))}><SelectTrigger className="col-span-3"><SelectValue placeholder="規格" /></SelectTrigger><SelectContent>{!product?.variants.length && <SelectItem value="none">無規格</SelectItem>}{product?.variants.filter((v) => v.isActive).map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent></Select>
          <Input className="col-span-2" type="number" min="1" placeholder="數量" value={line.quantity} onChange={(e) => setLines(lines.map((x,i) => i === index ? {...x,quantity:e.target.value}:x))} />
          <Input className="col-span-2" type="number" min="0" placeholder="單價（選填）" value={line.unitPrice} onChange={(e) => setLines(lines.map((x,i) => i === index ? {...x,unitPrice:e.target.value}:x))} />
          <Button className="col-span-1" size="icon" variant="ghost" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_,i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
        </div>;})}<p className="text-xs text-muted-foreground">單價留空時，系統將套用客戶價格表或牌價。</p><Button size="sm" variant="outline" onClick={() => setLines([...lines, emptyLine()])}><Plus className="mr-1 h-4 w-4" />新增品項</Button></div>
        <div className="space-y-2"><Label>備註</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button disabled={create.isPending} onClick={submit}>建立</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>銷貨單明細 {detail?.soNo}</DialogTitle></DialogHeader>
      {detailLoading ? <Loader2 className="mx-auto my-12 h-6 w-6 animate-spin" /> : detail && <div className="space-y-4">
        <div className="flex gap-2"><Badge variant="outline" className={colors[detail.status]}>{statuses[detail.status]}</Badge><Badge variant="outline">{sources[detail.source] || detail.source}</Badge></div>
        {detail.orderId && <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">此單與商城訂單 {detail.orderNo} 連動</div>}
        <div className="rounded-lg bg-muted/40 p-4 text-sm">客戶：{detail.customerName}<div className="mt-2">製單人：{creatorName(detail.creatorEmployeeId)}</div>{detail.note && <div className="mt-2">備註：{detail.note}</div>}</div>
        <Table><TableHeader><TableRow><TableHead>品項</TableHead><TableHead>規格</TableHead><TableHead className="text-right">單價</TableHead><TableHead className="text-right">數量</TableHead><TableHead className="text-right">小計</TableHead></TableRow></TableHeader><TableBody>{detail.items.map((i) => <TableRow key={i.id}><TableCell>{i.productCode}－{i.productName} {i.isVirtual && <Badge className="ml-1" variant="secondary">虛擬</Badge>}</TableCell><TableCell>{i.variantName || "—"}</TableCell><TableCell className="text-right">NT$ {i.unitPrice.toLocaleString()}</TableCell><TableCell className="text-right">{i.quantity}</TableCell><TableCell className="text-right">NT$ {(i.unitPrice*i.quantity).toLocaleString()}</TableCell></TableRow>)}</TableBody></Table>
        <div className="text-right text-lg font-bold">總計：NT$ {detail.totalAmount.toLocaleString()}</div>
        <div className="flex justify-end gap-2">{actions.map(([value,label]) => <Button key={value} variant={value === "cancelled" ? "destructive" : "default"} disabled={update.isPending} onClick={() => changeStatus(value)}>{label}</Button>)}</div>
      </div>}
    </DialogContent></Dialog>
  </div>;
}