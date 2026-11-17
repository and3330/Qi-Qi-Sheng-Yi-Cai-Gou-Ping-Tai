import { useState, useEffect, useCallback } from "react";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Eye, Trash2, Play, CheckCircle, Search } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface WoItem { id: number; workOrderNumber: string; bomNumber: string; itemName: string; plannedQuantity: number; completedQuantity: number; status: string; priority: string; plannedStartDate: string | null; plannedEndDate: string | null }
interface WoDetail extends WoItem { items: { id: number; itemId: number; itemName: string; itemCode: string; requiredQuantity: number; issuedQuantity: number; unit: string }[]; actualStartDate: string | null; actualEndDate: string | null; remarks: string | null; salesOrderId: number | null }
interface Bom { id: number; bomNumber: string; itemName: string; status: string }

const statusMap: Record<string, string> = { Draft: "草稿", "In Progress": "進行中", Completed: "已完成", Cancelled: "已取消" };
const statusColor = (s: string) => s === "In Progress" ? "default" : s === "Completed" ? "secondary" : s === "Cancelled" ? "destructive" : "outline";
const priorityMap: Record<string, string> = { Low: "低", Medium: "中", High: "高", Urgent: "緊急" };

export default function WorkOrdersPage() {
  const reloadKey = useAutoReloadKey();
  const [orders, setOrders] = useState<WoItem[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<WoDetail | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishQty, setFinishQty] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueItemId, setIssueItemId] = useState("");
  const [issueQty, setIssueQty] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [form, setForm] = useState({ bomId: "", plannedQuantity: "", priority: "Medium", plannedStartDate: "", plannedEndDate: "", remarks: "" });
  const { toast } = useToast();
  const woBatchFields: BatchField[] = [{key:"status",label:"狀態",type:"select",options:[{value:"Draft",label:"草稿"},{value:"In Progress",label:"進行中"},{value:"Completed",label:"已完成"}]},{key:"priority",label:"優先順序",type:"select",options:[{value:"Low",label:"低"},{value:"Medium",label:"中"},{value:"High",label:"高"}]}];

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [wRes, bRes] = await Promise.all([fetch(`/erp-api/work-orders`), fetch(`/erp-api/boms`)]);
    setOrders(await wRes.json()); setBoms((await bRes.json()).filter((b: Bom) => b.status === "Active"));
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const handleCreate = async () => {
    const payload = { bomId: Number(form.bomId), plannedQuantity: Number(form.plannedQuantity), priority: form.priority, plannedStartDate: form.plannedStartDate || null, plannedEndDate: form.plannedEndDate || null, remarks: form.remarks || null };
    const res = await fetch(`/erp-api/work-orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) { toast({ title: "工單已建立" }); setOpen(false); setForm({ bomId: "", plannedQuantity: "", priority: "Medium", plannedStartDate: "", plannedEndDate: "", remarks: "" }); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error || "建立失敗", variant: "destructive" }); }
  };

  const viewDetail = async (id: number) => {
    const res = await fetch(`/erp-api/work-orders/${id}`);
    if (res.ok) setDetail(await res.json());
  };

  const updateStatus = async (id: number, status: string, extra?: Record<string, unknown>) => {
    const res = await fetch(`/erp-api/work-orders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, ...extra }) });
    if (res.ok) { toast({ title: `狀態已更新` }); fetchAll(); if (detail?.id === id) viewDetail(id); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const handleIssueMaterial = async () => {
    if (!detail) return;
    const res = await fetch(`/erp-api/work-orders/${detail.id}/issue-material`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: Number(issueItemId), quantity: Number(issueQty) }) });
    if (res.ok) {
      const done = await res.json().catch(() => null);
      toast({ title: "材料已領用", description: done?.issuedCost > 0 ? `已入帳：在製品 $${Number(done.issuedCost).toLocaleString()}` : "這個材料沒有成本，未產生分錄" });
      setIssueOpen(false); setIssueItemId(""); setIssueQty(""); viewDetail(detail.id); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const handleFinish = async () => {
    if (!detail) return;
    const res = await fetch(`/erp-api/work-orders/${detail.id}/finish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: Number(finishQty) }) });
    if (res.ok) {
      const done = await res.json().catch(() => null);
      toast({ title: "成品入庫完成", description: done?.finishedCost > 0 ? `已入帳：製成品 $${Number(done.finishedCost).toLocaleString()}` : "尚未發料，沒有成本可轉入製成品" });
      setFinishOpen(false); viewDetail(detail.id); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/erp-api/work-orders/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "已刪除" }); fetchAll(); setDetail(null); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const filtered = orders.filter(o => {
    if (searchTerm && !o.workOrderNumber.includes(searchTerm) && !o.itemName.includes(searchTerm)) return false;
    if (filterStatus && o.status !== filterStatus) return false;
    return true;
  });

  const batch = useBatchSelection(filtered);

  return (
    <div className="space-y-6">
      <PageHeader title="工單" description="管理生產工單，追蹤生產進度" />
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="工單"
          entityEndpoint="work-orders"
          ids={batch.ids}
          batchFields={woBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input className="pl-9" placeholder="搜尋工單..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <select className="border rounded-md px-3 py-2 text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">所有狀態</option>
          {Object.entries(statusMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />新增工單</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>新增工單</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">BOM *</label>
                <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.bomId} onChange={e => setForm(p => ({ ...p, bomId: e.target.value }))}>
                  <option value="">選擇 BOM</option>
                  {boms.map(b => <option key={b.id} value={b.id}>{b.bomNumber} - {b.itemName}</option>)}
                </LookupSelect>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">計畫數量 *</label><Input type="number" min="1" value={form.plannedQuantity} onChange={e => setForm(p => ({ ...p, plannedQuantity: e.target.value }))} /></div>
                <div>
                  <label className="text-sm font-medium">優先順序</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
                    <option value="Low">低</option><option value="Medium">中</option><option value="High">高</option><option value="Urgent">緊急</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">計畫開始日</label><Input type="date" value={form.plannedStartDate} onChange={e => setForm(p => ({ ...p, plannedStartDate: e.target.value }))} /></div>
                <div><label className="text-sm font-medium">計畫完成日</label><Input type="date" value={form.plannedEndDate} onChange={e => setForm(p => ({ ...p, plannedEndDate: e.target.value }))} /></div>
              </div>
              <div><label className="text-sm font-medium">備註</label><Input value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={!form.bomId || !form.plannedQuantity}>建立</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50/50">
              <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
              <th className="text-left px-4 py-2.5 font-semibold">工單號</th>
              <th className="text-left px-4 py-2.5 font-semibold">成品</th>
              <th className="text-center px-4 py-2.5 font-semibold">優先</th>
              <th className="text-right px-4 py-2.5 font-semibold">計畫</th>
              <th className="text-right px-4 py-2.5 font-semibold">完成</th>
              <th className="text-center px-4 py-2.5 font-semibold">狀態</th>
              <th className="text-center px-4 py-2.5 font-semibold">操作</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
              : filtered.map(o => (
                <tr key={o.id} className="border-b hover:bg-gray-50">
                  <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(o.id)} onChange={() => batch.toggle(o.id)} /></td>
                  <td className="px-4 py-2 font-mono">{o.workOrderNumber}</td>
                  <td className="px-4 py-2">{o.itemName}</td>
                  <td className="px-4 py-2 text-center"><Badge variant="outline">{priorityMap[o.priority]}</Badge></td>
                  <td className="px-4 py-2 text-right">{o.plannedQuantity}</td>
                  <td className="px-4 py-2 text-right">{o.completedQuantity}</td>
                  <td className="px-4 py-2 text-center"><Badge variant={statusColor(o.status)}>{statusMap[o.status]}</Badge></td>
                  <td className="px-4 py-2 text-center">
                    <div className="flex gap-1 justify-center">
                      <Button size="sm" variant="outline" onClick={() => viewDetail(o.id)}><Eye className="h-3 w-3" /></Button>
                      {o.status === "Draft" && <Button size="sm" variant="ghost" onClick={() => handleDelete(o.id)}><Trash2 className="h-3 w-3" /></Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={v => { if (!v) setDetail(null); }}>
        <DialogContent className="md:max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>工單明細 - {detail?.workOrderNumber}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div><span className="text-gray-500">成品：</span>{detail.itemName}</div>
                <div><span className="text-gray-500">BOM：</span>{detail.bomNumber}</div>
                <div><span className="text-gray-500">狀態：</span><Badge variant={statusColor(detail.status)}>{statusMap[detail.status]}</Badge></div>
                <div><span className="text-gray-500">計畫數量：</span>{detail.plannedQuantity}</div>
                <div><span className="text-gray-500">已完成：</span>{detail.completedQuantity}</div>
                <div><span className="text-gray-500">優先順序：</span>{priorityMap[detail.priority]}</div>
                {detail.plannedStartDate && <div><span className="text-gray-500">計畫開始：</span>{detail.plannedStartDate}</div>}
                {detail.plannedEndDate && <div><span className="text-gray-500">計畫完成：</span>{detail.plannedEndDate}</div>}
                {detail.actualStartDate && <div><span className="text-gray-500">實際開始：</span>{detail.actualStartDate}</div>}
                {detail.actualEndDate && <div><span className="text-gray-500">實際完成：</span>{detail.actualEndDate}</div>}
              </div>
              {detail.items.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">所需材料</h4>
                  <table className="w-full text-xs">
                    <thead><tr className="border-b bg-gray-50">
                      <th className="text-left px-2 py-1">品項</th>
                      <th className="text-right px-2 py-1">需求</th>
                      <th className="text-right px-2 py-1">已領</th>
                      <th className="text-left px-2 py-1">單位</th>
                    </tr></thead>
                    <tbody>
                      {detail.items.map(i => (
                        <tr key={i.id} className="border-b">
                          <td className="px-2 py-1">{i.itemCode} - {i.itemName}</td>
                          <td className="px-2 py-1 text-right">{i.requiredQuantity}</td>
                          <td className="px-2 py-1 text-right">{i.issuedQuantity}</td>
                          <td className="px-2 py-1">{i.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex gap-2 justify-end flex-wrap">
                {detail.status === "Draft" && (
                  <>
                    <Button onClick={() => updateStatus(detail.id, "In Progress")}><Play className="h-3 w-3 mr-1" />開始生產</Button>
                    <Button variant="destructive" onClick={() => handleDelete(detail.id)}>刪除</Button>
                  </>
                )}
                {detail.status === "In Progress" && (
                  <>
                    <Button variant="outline" onClick={() => setIssueOpen(true)}>領料</Button>
                    <Button variant="outline" onClick={() => { setFinishQty(String(detail.plannedQuantity)); setFinishOpen(true); }}><CheckCircle className="h-3 w-3 mr-1" />成品入庫</Button>
                    <Button onClick={() => updateStatus(detail.id, "Completed", { completedQuantity: detail.completedQuantity })}>完工結案</Button>
                    <Button variant="destructive" onClick={() => updateStatus(detail.id, "Cancelled")}>取消</Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={finishOpen} onOpenChange={setFinishOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>成品入庫</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><label className="text-sm font-medium">入庫數量</label><Input type="number" min="1" value={finishQty} onChange={e => setFinishQty(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinishOpen(false)}>取消</Button>
            <Button onClick={handleFinish}>確認入庫</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>領料</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">品項</label>
                <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={issueItemId} onChange={e => setIssueItemId(e.target.value)}>
                  <option value="">選擇材料</option>
                  {detail.items.map(i => (
                    <option key={i.id} value={i.itemId}>{i.itemCode} - {i.itemName}（需求: {i.requiredQuantity}, 已領: {i.issuedQuantity}）</option>
                  ))}
                </LookupSelect>
              </div>
              <div><label className="text-sm font-medium">領用數量</label><Input type="number" min="1" value={issueQty} onChange={e => setIssueQty(e.target.value)} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueOpen(false)}>取消</Button>
            <Button onClick={handleIssueMaterial} disabled={!issueItemId || !issueQty}>確認領料</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
