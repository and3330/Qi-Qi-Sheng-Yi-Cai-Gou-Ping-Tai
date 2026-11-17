import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { MasterLookup } from "@/components/shared/master-lookup";
import { ProjectField } from "@/components/shared/project-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PackageCheck, Plus, Send, Undo2 } from "lucide-react";
import { call, money, post, selectClass, todayText } from "@/lib/call";

interface Material { itemId: number; itemName: string; unit: string; perUnit: number; requiredQty: number; issuedQty: number; consumedQty: number; returnedQty: number; lossQty: number; atVendor: number; remainingToIssue: number }
interface Order {
  id: number; orderNumber: string; supplierId: number; supplierName: string | null; itemId: number; itemName: string | null; itemCode: string | null;
  projectName: string | null; quantity: number; receivedQuantity: number; remainingQuantity: number; unitFee: number; taxable: boolean;
  status: string; orderDate: string; expectedDate: string | null; remarks: string | null; materials: Material[];
  materialCost: number; feeAmount: number; lossAmount: number; unitCost: number; vendorWarehouseName?: string | null;
  invoices?: Array<{ id: number; invoiceNumber: string; invoiceDate: string; status: string; totalAmount: number; outstandingAmount: number }>;
}
interface VendorStock { warehouseId: number; supplierName: string | null; warehouseName: string; totalAmount: number; lines: Array<{ itemId: number; itemName: string; unit: string; quantity: number; amount: number }> }

const STATUS: Record<string, string> = { Open: "進行中", Completed: "已交齊", Closed: "已結案", Cancelled: "已取消" };
const INVOICE_STATUS: Record<string, string> = { Unpaid: "未付", "Partially Paid": "部分已付", Paid: "已付清", Cancelled: "已取消" };
const emptyForm = { supplierId: "", itemId: "", projectId: "", quantity: "", unitFee: "", taxable: true, expectedDate: "", remarks: "" };
type Action = "issue" | "receive" | "close" | null;
const ownWarehouse = (row: Record<string, unknown>) => !row.subcontractorSupplierId;

export default function SubcontractOrdersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [receive, setReceive] = useState({ quantity: "", date: todayText() });
  const [warehouseId, setWarehouseId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: orders, isLoading } = useQuery({ queryKey: ["/subcontract-orders", status], queryFn: () => call<Order[]>(`subcontract-orders${status ? `?status=${status}` : ""}`) });
  const { data: vendorStock = [] } = useQuery({ queryKey: ["/subcontract-orders/vendor-stock"], queryFn: () => call<VendorStock[]>("subcontract-orders/vendor-stock") });
  const { data: detail } = useQuery({ queryKey: ["/subcontract-orders", "detail", detailId], queryFn: () => call<Order>(`subcontract-orders/${detailId}`), enabled: detailId !== null });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/subcontract-orders"] });
  const fail = (error: unknown) => toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
  const run = async (work: () => Promise<void>) => { setBusy(true); try { await work(); refresh(); queryClient.invalidateQueries({ queryKey: ["/subcontract-orders/vendor-stock"] }); } catch (error) { fail(error); } finally { setBusy(false); } };

  const create = () => run(async () => {
    const created = await post<Order>("subcontract-orders", {
      supplierId: Number(form.supplierId), itemId: Number(form.itemId), projectId: Number(form.projectId),
      quantity: Number(form.quantity), unitFee: Number(form.unitFee) || 0, taxable: form.taxable,
      expectedDate: form.expectedDate || undefined, remarks: form.remarks || undefined,
    });
    toast({ title: "已開立外包單", description: `${created.orderNumber}。下一步：發料給代工廠。` });
    setCreating(false);
    setForm(emptyForm);
    setDetailId(created.id);
  });

  const openAction = (next: Exclude<Action, null>) => {
    if (!detail) return;
    setWarehouseId("");
    if (next === "issue") setQuantities(Object.fromEntries(detail.materials.map(m => [m.itemId, m.remainingToIssue > 0 ? String(m.remainingToIssue) : ""])));
    if (next === "close") setQuantities(Object.fromEntries(detail.materials.map(m => [m.itemId, m.atVendor > 0 ? String(m.atVendor) : ""])));
    if (next === "receive") setReceive({ quantity: String(detail.remainingQuantity), date: todayText() });
    setAction(next);
  };

  const submitIssue = () => run(async () => {
    const lines = Object.entries(quantities).map(([itemId, quantity]) => ({ itemId: Number(itemId), quantity: Number(quantity) || 0 })).filter(l => l.quantity > 0);
    const result = await post<Order & { warning: string | null }>(`subcontract-orders/${detailId}/issue`, { lines, fromWarehouseId: warehouseId ? Number(warehouseId) : undefined });
    toast({ title: "已發料給代工廠", description: result.warning || "材料已移到代工廠倉，仍是公司的庫存。" });
    setAction(null);
  });
  const submitReceive = () => run(async () => {
    const result = await post<Order & { receipt: { finishedCost: number; unitCost: number; payable: number; invoiceNumber: string | null } }>(
      `subcontract-orders/${detailId}/receive`, { quantity: Number(receive.quantity), date: receive.date, warehouseId: warehouseId ? Number(warehouseId) : undefined });
    toast({ title: "成品已入庫", description: `成本 ${money(result.receipt.finishedCost)}（每個 ${money(result.receipt.unitCost)}）${result.receipt.invoiceNumber ? `；應付加工費 ${money(result.receipt.payable)}，發票 ${result.receipt.invoiceNumber}` : ""}` });
    setAction(null);
  });
  const submitClose = () => run(async () => {
    const returns = Object.entries(quantities).map(([itemId, quantity]) => ({ itemId: Number(itemId), quantity: Number(quantity) || 0 })).filter(l => l.quantity > 0);
    const result = await post<Order>(`subcontract-orders/${detailId}/close`, { returns, toWarehouseId: warehouseId ? Number(warehouseId) : undefined });
    toast({ title: "已結案", description: result.lossAmount > 0 ? `加工損耗 ${money(result.lossAmount)} 已入帳。` : "剩料已退回倉庫。" });
    setAction(null);
  });
  const cancel = () => {
    if (!detail || !confirm(`確定取消外包單 ${detail.orderNumber}？已發出去的材料會全部退回倉庫。`)) return;
    run(async () => { await post(`subcontract-orders/${detail.id}/cancel`); toast({ title: "已取消" }); });
  };

  const closeLoss = detail ? detail.materials.reduce((count, m) => count + (m.atVendor - (Number(quantities[m.itemId]) || 0) > 0.0001 ? 1 : 0), 0) : 0;
  const fee = (Number(form.quantity) || 0) * (Number(form.unitFee) || 0);

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="外包單" description="自己供料、發給代工廠加工：發料、收成品、算成本、付加工費"
        action={<Button onClick={() => { setForm(emptyForm); setCreating(true); }} data-testid="button-new-subcontract"><Plus className="h-4 w-4 mr-1" />開外包單</Button>} />

      {vendorStock.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-medium">目前放在代工廠的材料</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {vendorStock.map(vendor => (
                <div key={vendor.warehouseId} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{vendor.supplierName || vendor.warehouseName}</span><span className="text-muted-foreground">約 {money(vendor.totalAmount)}</span></div>
                  <p className="mt-1 text-muted-foreground">{vendor.lines.map(l => `${l.itemName} ${l.quantity}${l.unit ? " " + l.unit : ""}`).join("、")}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="w-40">
        <Label htmlFor="sub-status" className="text-xs">狀態</Label>
        <select id="sub-status" className={selectClass} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部</option>
          {Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={orders}
            emptyMessage="還沒有外包單"
            onRowClick={(r: Order) => setDetailId(r.id)}
            columns={[
              { header: "單號", accessor: (r: Order) => <div><span className="font-medium">{r.orderNumber}</span><span className="block text-xs text-muted-foreground">{r.orderDate}・{r.supplierName || "—"}</span></div> },
              { header: "成品", accessor: (r: Order) => <div className="text-sm">{r.itemName || "—"}<span className="block text-xs text-muted-foreground">已交 {r.receivedQuantity} / {r.quantity}</span></div> },
              { header: "專案", accessor: (r: Order) => r.projectName || "—", className: "hidden xl:table-cell" },
              { header: "預計交貨", accessor: (r: Order) => r.expectedDate || "—", className: "hidden xl:table-cell" },
              { header: "單位成本", accessor: (r: Order) => r.receivedQuantity > 0 ? money(r.unitCost) : "—", className: "hidden lg:table-cell" },
              { header: "狀態", accessor: (r: Order) => <Badge variant={r.status === "Open" ? "default" : r.status === "Completed" ? "secondary" : "outline"}>{STATUS[r.status] || r.status}</Badge> },
            ]}
          />
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="md:max-w-lg max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>開外包單</DialogTitle>
            <DialogDescription>要給代工廠的材料會依成品的物料清單自動算出來。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>代工廠 *</Label><MasterLookup source="suppliers" value={form.supplierId} onValueChange={v => setForm({ ...form, supplierId: v })} clearable={false} placeholder="選擇代工廠（供應商）" /></div>
            <div><Label>要加工的成品 *</Label><MasterLookup source="items" value={form.itemId} onValueChange={v => setForm({ ...form, itemId: v })} filter={(r) => !r.isVirtual} clearable={false} placeholder="選擇成品" /></div>
            <ProjectField value={form.projectId} onChange={v => setForm({ ...form, projectId: v })} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="sub-qty">數量 *</Label><Input id="sub-qty" type="number" inputMode="decimal" min="0" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="sub-fee">加工單價（未稅）</Label><Input id="sub-fee" type="number" inputMode="decimal" min="0" value={form.unitFee} onChange={e => setForm({ ...form, unitFee: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="sub-date">預計交貨日</Label><Input id="sub-date" type="date" min={todayText()} value={form.expectedDate} onChange={e => setForm({ ...form, expectedDate: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="sub-note">備註</Label><Input id="sub-note" value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm min-h-11"><input type="checkbox" className="h-4 w-4" checked={form.taxable} onChange={e => setForm({ ...form, taxable: e.target.checked })} />加工費另加 5% 營業稅</label>
            {fee > 0 && <p className="text-sm text-muted-foreground">加工費合計 {money(fee)}{form.taxable ? `，含稅 ${money(fee * 1.05)}` : ""}。成品交回時才會變成應付帳款。</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>取消</Button>
            <Button onClick={create} disabled={busy || !form.supplierId || !form.itemId || !form.projectId || !(Number(form.quantity) > 0)}>{busy ? "處理中…" : "開立"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailId !== null && action === null} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="md:max-w-2xl max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail ? `${detail.orderNumber}　${STATUS[detail.status] || detail.status}` : "外包單"}</DialogTitle>
            <DialogDescription>{detail ? `${detail.supplierName || ""} 加工 ${detail.itemName || ""}・專案 ${detail.projectName || "—"}` : "讀取中…"}</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><p className="text-xs text-muted-foreground">已交 / 數量</p><p className="font-medium">{detail.receivedQuantity} / {detail.quantity}</p></div>
                <div><p className="text-xs text-muted-foreground">加工單價</p><p className="font-medium">{money(detail.unitFee)}{detail.taxable ? "（未稅）" : ""}</p></div>
                <div><p className="text-xs text-muted-foreground">已入庫成本</p><p className="font-medium">{money(detail.materialCost + detail.feeAmount)}</p></div>
                <div><p className="text-xs text-muted-foreground">每個成本</p><p className="font-medium">{detail.receivedQuantity > 0 ? money(detail.unitCost) : "—"}</p></div>
              </div>
              {detail.receivedQuantity > 0 && <p className="text-muted-foreground">成本＝用掉的材料 {money(detail.materialCost)} ＋ 加工費 {money(detail.feeAmount)}{detail.lossAmount > 0 ? `；另有加工損耗 ${money(detail.lossAmount)}` : ""}</p>}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr><th className="px-3 py-2 text-left">材料</th><th className="px-3 py-2 text-right">需求</th><th className="px-3 py-2 text-right">已發</th><th className="px-3 py-2 text-right">已用</th><th className="px-3 py-2 text-right">在代工廠</th></tr>
                  </thead>
                  <tbody>
                    {detail.materials.map(m => (
                      <tr key={m.itemId} className="border-t">
                        <td className="px-3 py-2">{m.itemName}{(m.returnedQty > 0 || m.lossQty > 0) && <span className="block text-xs text-muted-foreground">{m.returnedQty > 0 ? `退回 ${m.returnedQty}` : ""}{m.returnedQty > 0 && m.lossQty > 0 ? "、" : ""}{m.lossQty > 0 ? `損耗 ${m.lossQty}` : ""}</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.requiredQty}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${m.remainingToIssue > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>{m.issuedQty}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.consumedQty}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{m.atVendor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {detail.invoices && detail.invoices.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">加工費發票（到「財務 → 付款單」付款）</p>
                  {detail.invoices.map(inv => <p key={inv.id}>{inv.invoiceNumber}・{inv.invoiceDate}・{money(inv.totalAmount)}・{INVOICE_STATUS[inv.status] || inv.status}{inv.outstandingAmount > 0 && inv.status !== "Cancelled" ? `（未付 ${money(inv.outstandingAmount)}）` : ""}</p>)}
                </div>
              )}
              {detail.remarks && <p className="text-muted-foreground">備註：{detail.remarks}</p>}
            </div>
          )}
          <DialogFooter className="gap-2">
            {detail?.status === "Open" && detail.receivedQuantity === 0 && <Button variant="ghost" className="text-red-600 dark:text-red-400 md:mr-auto" onClick={cancel} disabled={busy}>取消這張單</Button>}
            {(detail?.status === "Open" || detail?.status === "Completed") && <Button variant="outline" onClick={() => openAction("close")}><Undo2 className="h-4 w-4 mr-1" />結案</Button>}
            {detail?.status === "Open" && <Button variant="outline" onClick={() => openAction("issue")}><Send className="h-4 w-4 mr-1" />發料</Button>}
            {detail?.status === "Open" && <Button onClick={() => openAction("receive")}><PackageCheck className="h-4 w-4 mr-1" />收成品</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={action === "issue"} onOpenChange={(o) => { if (!o) setAction(null); }}>
        <DialogContent className="md:max-w-md max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>發料給代工廠</DialogTitle><DialogDescription>材料只是換位置，仍是公司的庫存，不會產生分錄。</DialogDescription></DialogHeader>
          <div className="space-y-3">
            {detail?.materials.map(m => (
              <div key={m.itemId} className="grid grid-cols-[1fr_7rem] items-center gap-3">
                <Label htmlFor={`issue-${m.itemId}`} className="font-normal">{m.itemName}<span className="block text-xs text-muted-foreground">需求 {m.requiredQty}、已發 {m.issuedQty}</span></Label>
                <Input id={`issue-${m.itemId}`} type="number" inputMode="decimal" min="0" value={quantities[m.itemId] || ""} onChange={e => setQuantities({ ...quantities, [m.itemId]: e.target.value })} />
              </div>
            ))}
            <div><Label>從哪一間倉庫發</Label><MasterLookup source="warehouses" value={warehouseId} onValueChange={setWarehouseId} filter={ownWarehouse} placeholder="預設第一間倉庫" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>返回</Button>
            <Button onClick={submitIssue} disabled={busy || !Object.values(quantities).some(q => Number(q) > 0)}>{busy ? "處理中…" : "發料"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={action === "receive"} onOpenChange={(o) => { if (!o) setAction(null); }}>
        <DialogContent className="md:max-w-md max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>收成品</DialogTitle><DialogDescription>成品入庫，同時扣掉用掉的材料，加工費變成應付帳款。</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="recv-qty">交回數量 *</Label><Input id="recv-qty" type="number" inputMode="decimal" min="0" value={receive.quantity} onChange={e => setReceive({ ...receive, quantity: e.target.value })} /><p className="text-xs text-muted-foreground">還剩 {detail?.remainingQuantity} 沒交</p></div>
              <div className="space-y-1.5"><Label htmlFor="recv-date">交貨日期</Label><Input id="recv-date" type="date" max={todayText()} value={receive.date} onChange={e => setReceive({ ...receive, date: e.target.value })} /></div>
            </div>
            <div><Label>入庫到哪一間倉庫</Label><MasterLookup source="warehouses" value={warehouseId} onValueChange={setWarehouseId} filter={ownWarehouse} placeholder="預設第一間倉庫" /></div>
            {detail && Number(receive.quantity) > 0 && <p className="text-sm text-muted-foreground">這批加工費 {money(Number(receive.quantity) * detail.unitFee)}{detail.taxable ? `，含稅 ${money(Number(receive.quantity) * detail.unitFee * 1.05)}` : ""}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>返回</Button>
            <Button onClick={submitReceive} disabled={busy || !(Number(receive.quantity) > 0) || Number(receive.quantity) > (detail?.remainingQuantity ?? 0)}>{busy ? "處理中…" : "入庫"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={action === "close"} onOpenChange={(o) => { if (!o) setAction(null); }}>
        <DialogContent className="md:max-w-md max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>結案</DialogTitle><DialogDescription>填代工廠退回多少剩料。沒退回的部分會算成加工損耗，從庫存扣掉並入帳。</DialogDescription></DialogHeader>
          <div className="space-y-3">
            {detail?.materials.filter(m => m.atVendor > 0).length === 0 && <p className="text-sm text-muted-foreground">代工廠手上沒有剩料，可以直接結案。</p>}
            {detail?.materials.filter(m => m.atVendor > 0).map(m => (
              <div key={m.itemId} className="grid grid-cols-[1fr_7rem] items-center gap-3">
                <Label htmlFor={`close-${m.itemId}`} className="font-normal">{m.itemName}<span className="block text-xs text-muted-foreground">在代工廠 {m.atVendor}</span></Label>
                <Input id={`close-${m.itemId}`} type="number" inputMode="decimal" min="0" max={m.atVendor} value={quantities[m.itemId] || ""} onChange={e => setQuantities({ ...quantities, [m.itemId]: e.target.value })} />
              </div>
            ))}
            <div><Label>退回到哪一間倉庫</Label><MasterLookup source="warehouses" value={warehouseId} onValueChange={setWarehouseId} filter={ownWarehouse} placeholder="預設第一間倉庫" /></div>
            {closeLoss > 0 && <p className="text-sm text-amber-700 dark:text-amber-400">有 {closeLoss} 項材料沒有全數退回，差額會記成加工損耗。</p>}
            {detail && detail.remainingQuantity > 0 && <p className="text-sm text-amber-700 dark:text-amber-400">成品還有 {detail.remainingQuantity} 沒交，結案後就不能再收貨。</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>返回</Button>
            <Button onClick={submitClose} disabled={busy}>{busy ? "處理中…" : "結案"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
