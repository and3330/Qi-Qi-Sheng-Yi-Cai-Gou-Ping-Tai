import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { MasterLookup, useMasterRows } from "@/components/shared/master-lookup";
import { ProjectField } from "@/components/shared/project-field";
import { ItemLines, emptyLine, type ItemLine } from "@/components/shared/item-lines";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Check, Plus, ShoppingCart, X } from "lucide-react";
import { call, money, post, selectClass, todayText } from "@/lib/call";

interface Request {
  id: number; requestNumber: string; requestDate: string; neededBy: string | null; requesterName: string; projectId: number; projectName: string | null;
  departmentId: number | null; status: string; items: Array<{ itemId: number; itemName: string; quantity: number; note?: string }>;
  reason: string | null; reviewedBy: string | null; reviewNote: string | null; purchaseOrderId: number | null; purchaseOrderNumber: string | null; createdBy: string | null;
}
const STATUS: Record<string, string> = { Submitted: "待核准", Approved: "已核准", Rejected: "已退回", Ordered: "已轉採購", Cancelled: "已取消" };
const APPROVERS = ["owner", "admin", "manager", "finance_admin", "super_admin"];
const emptyForm = { projectId: "", neededBy: "", reason: "", lines: [{ ...emptyLine }] as ItemLine[] };

export default function MaterialRequestsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canApprove = APPROVERS.includes(user?.role || "");
  const canOrder = canApprove || user?.role === "accountant";
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [ordering, setOrdering] = useState<Request | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: requests, isLoading } = useQuery({ queryKey: ["/material-requests", status], queryFn: () => call<Request[]>(`material-requests${status ? `?status=${status}` : ""}`) });
  const { data: items = [] } = useMasterRows("items", !!ordering);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/material-requests"] });
  const fail = (error: unknown) => toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });

  const create = async () => {
    setBusy(true);
    try {
      const created = await post<Request>("material-requests", {
        projectId: Number(form.projectId), neededBy: form.neededBy || undefined, reason: form.reason,
        items: form.lines.filter(l => l.itemId).map(l => ({ itemId: Number(l.itemId), quantity: Number(l.quantity), note: l.note })),
      });
      toast({ title: "已送出請購單", description: created.requestNumber });
      setOpen(false);
      setForm(emptyForm);
      refresh();
    } catch (error) { fail(error); } finally { setBusy(false); }
  };
  const review = async (request: Request, decision: "approve" | "reject") => {
    const note = decision === "reject" ? prompt("退回原因：") : "";
    if (decision === "reject" && !note?.trim()) return;
    try { await post(`material-requests/${request.id}/review`, { decision, note: note || undefined }); toast({ title: decision === "approve" ? "已核准" : "已退回" }); refresh(); } catch (error) { fail(error); }
  };
  const cancel = async (request: Request) => {
    if (!confirm(`確定取消請購單 ${request.requestNumber}？`)) return;
    try { await post(`material-requests/${request.id}/cancel`); toast({ title: "已取消" }); refresh(); } catch (error) { fail(error); }
  };

  const costOf = (itemId: number) => { const item = items.find(i => Number(i.id) === itemId); return Number(item?.buyingPrice) || 0; };
  const estimate = ordering ? ordering.items.reduce((s, i) => s + i.quantity * costOf(i.itemId), 0) : 0;
  // 轉採購單：走一般的採購單流程（會送簽核），成功後把請購單標成已轉採購
  const convert = async () => {
    if (!ordering) return;
    setBusy(true);
    try {
      const order = await post<{ id: number; orderNumber: string }>("purchase-orders", {
        supplierId: Number(supplierId), orderDate: todayText(), expectedDate: ordering.neededBy || undefined,
        projectId: ordering.projectId, departmentId: ordering.departmentId ?? undefined,
        items: ordering.items.map(i => ({ itemId: i.itemId, quantity: i.quantity, rate: costOf(i.itemId) })),
      });
      await post(`material-requests/${ordering.id}/ordered`, { purchaseOrderId: order.id });
      toast({ title: "已建立採購單", description: `${order.orderNumber}。單價帶的是品項的進價，請到採購單確認。` });
      setOrdering(null);
      setSupplierId("");
      refresh();
    } catch (error) { fail(error); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="請購單" description="需要買東西時先提請購，主管核准後再轉成採購單"
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />提出請購</Button>} />
      <div className="w-40">
        <Label htmlFor="mr-status" className="text-xs">狀態</Label>
        <select id="mr-status" className={selectClass} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部</option>
          {Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={requests}
            emptyMessage="沒有請購單"
            columns={[
              { header: "單號", accessor: (r: Request) => <div><span className="font-medium">{r.requestNumber}</span><span className="block text-xs text-muted-foreground">{r.requestDate}・{r.requesterName}</span></div> },
              { header: "品項", accessor: (r: Request) => <div className="text-sm">{r.items.map(i => `${i.itemName} × ${i.quantity}`).join("、")}{r.reason && <span className="block text-xs text-muted-foreground">{r.reason}</span>}</div> },
              { header: "專案", accessor: (r: Request) => r.projectName || "—", className: "hidden md:table-cell" },
              { header: "需要日期", accessor: (r: Request) => r.neededBy || "—", className: "hidden md:table-cell" },
              { header: "狀態", accessor: (r: Request) => <div><Badge variant={r.status === "Approved" || r.status === "Ordered" ? "default" : r.status === "Submitted" ? "secondary" : "outline"}>{STATUS[r.status] || r.status}</Badge>{r.purchaseOrderNumber && <span className="block text-xs text-muted-foreground mt-0.5">{r.purchaseOrderNumber}</span>}{r.status === "Rejected" && r.reviewNote && <span className="block text-xs text-muted-foreground mt-0.5">{r.reviewNote}</span>}</div> },
              {
                header: "操作",
                accessor: (r: Request) => (
                  <div className="flex flex-wrap gap-1">
                    {r.status === "Submitted" && canApprove && <Button size="sm" className="h-8" onClick={() => review(r, "approve")}><Check className="h-3.5 w-3.5 mr-1" />核准</Button>}
                    {r.status === "Submitted" && canApprove && <Button size="sm" variant="outline" className="h-8" onClick={() => review(r, "reject")}><X className="h-3.5 w-3.5 mr-1" />退回</Button>}
                    {r.status === "Approved" && canOrder && <Button size="sm" className="h-8" onClick={() => { setSupplierId(""); setOrdering(r); }}><ShoppingCart className="h-3.5 w-3.5 mr-1" />轉採購單</Button>}
                    {["Submitted", "Approved"].includes(r.status) && (canApprove || r.createdBy === user?.username) && <Button size="sm" variant="ghost" className="h-8 text-red-600 dark:text-red-400" onClick={() => cancel(r)}>取消</Button>}
                  </div>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-lg max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>提出請購</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <ProjectField value={form.projectId} onChange={v => setForm({ ...form, projectId: v })} />
            <div className="space-y-1.5"><Label>要買什麼 *</Label><ItemLines lines={form.lines} onChange={lines => setForm({ ...form, lines })} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="mr-needed">需要日期</Label><Input id="mr-needed" type="date" min={todayText()} value={form.neededBy} onChange={e => setForm({ ...form, neededBy: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="mr-reason">用途</Label><Input id="mr-reason" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="例如：12 月課程教材" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={create} disabled={busy || !form.projectId || !form.lines.some(l => l.itemId && Number(l.quantity) > 0)}>{busy ? "處理中…" : "送出"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!ordering} onOpenChange={(o) => { if (!o) setOrdering(null); }}>
        <DialogContent className="md:max-w-md max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>轉成採購單</DialogTitle>
            <DialogDescription>{ordering?.requestNumber}：{ordering?.items.map(i => `${i.itemName} × ${i.quantity}`).join("、")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>供應商 *</Label>
              <MasterLookup source="suppliers" value={supplierId} onValueChange={setSupplierId} clearable={false} placeholder="選擇供應商" />
            </div>
            <p className="text-sm text-muted-foreground">單價先帶品項主檔的進價，估計 {money(estimate)}。採購單建立後是草稿並送簽核，可以再改單價。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrdering(null)}>取消</Button>
            <Button onClick={convert} disabled={busy || !supplierId}>{busy ? "處理中…" : "建立採購單"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
