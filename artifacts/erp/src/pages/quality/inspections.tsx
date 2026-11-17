import { useState, useEffect, useCallback } from "react";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Eye, Search } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

import { LookupSelect } from "@/components/shared/lookup-select";
import { MasterLookup, type MasterSource } from "@/components/shared/master-lookup";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface Inspection { id: number; inspectionNumber: string; inspectionType: string; itemId: number | null; itemName: string; status: string; result: string | null; inspectorName: string | null; inspectionDate: string; inspectedQuantity: number; acceptedQuantity: number; rejectedQuantity: number; results: { name: string; specification?: string; result?: string; status?: string }[]; remarks: string | null; templateId: number | null; referenceType: string | null; referenceId: number | null; referenceNumber?: string | null }
interface Template { id: number; name: string; inspectionType: string }
interface Item { id: number; itemName: string; itemCode: string }

const typeMap: Record<string, string> = { Incoming: "進料檢驗", "In Process": "製程檢驗", Outgoing: "出貨檢驗" };
const statusMap: Record<string, string> = { Draft: "草稿", Submitted: "已提交", Accepted: "合格", Rejected: "不合格" };
const statusColor = (s: string) => s === "Accepted" ? "default" : s === "Rejected" ? "destructive" : "secondary";

const REFERENCE_SOURCES: Record<string, MasterSource> = { "Purchase Receipt": "purchase-receipts", "Delivery Note": "delivery-notes", "Work Order": "work-orders" };
const REFERENCE_LABELS: Record<string, string> = { "Purchase Receipt": "進貨單", "Delivery Note": "送貨單", "Work Order": "工單" };
const REFERENCE_ACTIONS: Record<string, string> = { "Purchase Receipt": "入庫", "Delivery Note": "出貨", "Work Order": "完工入庫" };

export default function InspectionsPage() {
  const reloadKey = useAutoReloadKey();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Inspection | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("");
  const [form, setForm] = useState({ templateId: "", inspectionType: "Incoming", itemId: "", inspectionDate: new Date().toISOString().slice(0, 10), inspectedQuantity: "", inspectorName: "", referenceType: "", referenceId: "", remarks: "" });
  const { toast } = useToast();
  const inspBatchFields: BatchField[] = [{key:"status",label:"狀態",type:"select",options:[{value:"Draft",label:"草稿"},{value:"In Progress",label:"進行中"},{value:"Accepted",label:"合格"},{value:"Rejected",label:"不合格"}]}];

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [iRes, tRes, itRes] = await Promise.all([fetch(`/erp-api/quality-inspections`), fetch(`/erp-api/quality-inspection-templates`), fetch(`/erp-api/items`)]);
    setInspections(await iRes.json()); setTemplates(await tRes.json()); setItems(await itRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const handleCreate = async () => {
    const payload = {
      templateId: form.templateId ? Number(form.templateId) : null,
      inspectionType: form.inspectionType,
      itemId: form.itemId ? Number(form.itemId) : null,
      inspectionDate: form.inspectionDate,
      inspectedQuantity: Number(form.inspectedQuantity) || 0,
      inspectorName: form.inspectorName || null,
      referenceType: form.referenceType || null,
      referenceId: form.referenceId ? Number(form.referenceId) : null,
      remarks: form.remarks || null,
    };
    const res = await fetch(`/erp-api/quality-inspections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) { toast({ title: "檢驗記錄已建立" }); setOpen(false); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const viewDetail = async (id: number) => {
    const res = await fetch(`/erp-api/quality-inspections/${id}`);
    if (res.ok) setDetail(await res.json());
  };

  const updateStatus = async (id: number, status: string, extra?: Record<string, unknown>) => {
    const res = await fetch(`/erp-api/quality-inspections/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, ...extra }) });
    if (res.ok) { toast({ title: "狀態已更新" }); fetchAll(); if (detail?.id === id) viewDetail(id); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const filtered = inspections.filter(i => {
    if (searchTerm && !i.inspectionNumber.includes(searchTerm) && !(i.itemName || "").includes(searchTerm)) return false;
    if (filterType && i.inspectionType !== filterType) return false;
    return true;
  });

  const batch = useBatchSelection(filtered);

  return (
    <div className="space-y-6">
      <PageHeader title="品質檢驗" description="記錄進料、製程、出貨檢驗結果" />
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="檢驗"
          entityEndpoint="quality-inspections"
          ids={batch.ids}
          batchFields={inspBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input className="pl-9" placeholder="搜尋..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <select className="border rounded-md px-3 py-2 text-sm" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">所有類型</option>
          {Object.entries(typeMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />新增檢驗</Button></DialogTrigger>
          <DialogContent className="md:max-w-lg">
            <DialogHeader><DialogTitle>新增品質檢驗</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">檢驗範本</label>
                <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.templateId} onChange={e => { setForm(p => ({ ...p, templateId: e.target.value })); const tpl = templates.find(t => t.id === Number(e.target.value)); if (tpl) setForm(p => ({ ...p, inspectionType: tpl.inspectionType })); }}>
                  <option value="">不使用範本</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </LookupSelect>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">類型</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.inspectionType} onChange={e => setForm(p => ({ ...p, inspectionType: e.target.value }))}>
                    {Object.entries(typeMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div><label className="text-sm font-medium">檢驗日期 *</label><Input type="date" value={form.inspectionDate} onChange={e => setForm(p => ({ ...p, inspectionDate: e.target.value }))} /></div>
              </div>
              <div>
                <label className="text-sm font-medium">品項</label>
                <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.itemId} onChange={e => setForm(p => ({ ...p, itemId: e.target.value }))}>
                  <option value="">選擇品項</option>
                  {items.map(i => <option key={i.id} value={i.id}>{i.itemCode} - {i.itemName}</option>)}
                </LookupSelect>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">檢驗數量</label><Input type="number" min="0" value={form.inspectedQuantity} onChange={e => setForm(p => ({ ...p, inspectedQuantity: e.target.value }))} /></div>
                <div><label className="text-sm font-medium">檢驗人員</label><MasterLookup source="employees" valueKey="name" value={form.inspectorName} onValueChange={v => setForm(p => ({ ...p, inspectorName: v }))} placeholder="選擇員工" /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">參考類型</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.referenceType} onChange={e => setForm(p => ({ ...p, referenceType: e.target.value, referenceId: "" }))}>
                    <option value="">無</option>
                    <option value="Purchase Receipt">進貨單</option>
                    <option value="Delivery Note">送貨單</option>
                    <option value="Work Order">工單</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">參考單據</label>
                  {form.referenceType ? (
                    <MasterLookup
                      key={form.referenceType}
                      source={REFERENCE_SOURCES[form.referenceType]}
                      value={form.referenceId}
                      onValueChange={v => setForm(p => ({ ...p, referenceId: v }))}
                      placeholder="選擇單據"
                    />
                  ) : (
                    <Input disabled placeholder="先選參考類型" />
                  )}
                  {form.referenceType && <p className="mt-1 text-xs text-muted-foreground">連結後，這張檢驗單判定合格前，該單據無法{REFERENCE_ACTIONS[form.referenceType]}。</p>}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={!form.inspectionDate}>建立</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50/50">
              <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
              <th className="text-left px-4 py-2.5 font-semibold">檢驗編號</th>
              <th className="text-left px-4 py-2.5 font-semibold">類型</th>
              <th className="text-left px-4 py-2.5 font-semibold">品項</th>
              <th className="text-left px-4 py-2.5 font-semibold">日期</th>
              <th className="text-center px-4 py-2.5 font-semibold">數量</th>
              <th className="text-center px-4 py-2.5 font-semibold">結果</th>
              <th className="text-center px-4 py-2.5 font-semibold">狀態</th>
              <th className="text-center px-4 py-2.5 font-semibold">操作</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
              : filtered.map(i => (
                <tr key={i.id} className="border-b hover:bg-gray-50">
                  <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(i.id)} onChange={() => batch.toggle(i.id)} /></td>
                  <td className="px-4 py-2 font-mono">{i.inspectionNumber}</td>
                  <td className="px-4 py-2"><Badge variant="outline">{typeMap[i.inspectionType]}</Badge></td>
                  <td className="px-4 py-2">{i.itemName || "-"}</td>
                  <td className="px-4 py-2">{i.inspectionDate}</td>
                  <td className="px-4 py-2 text-center">{i.inspectedQuantity}</td>
                  <td className="px-4 py-2 text-center">{i.result || "-"}</td>
                  <td className="px-4 py-2 text-center"><Badge variant={statusColor(i.status)}>{statusMap[i.status] || i.status}</Badge></td>
                  <td className="px-4 py-2 text-center"><Button size="sm" variant="outline" onClick={() => viewDetail(i.id)}><Eye className="h-3 w-3" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={v => { if (!v) setDetail(null); }}>
        <DialogContent className="md:max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>檢驗明細 - {detail?.inspectionNumber}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div><span className="text-gray-500">類型：</span>{typeMap[detail.inspectionType]}</div>
                <div><span className="text-gray-500">品項：</span>{detail.itemName || "-"}</div>
                <div><span className="text-gray-500">狀態：</span><Badge variant={statusColor(detail.status)}>{statusMap[detail.status]}</Badge></div>
                <div><span className="text-gray-500">日期：</span>{detail.inspectionDate}</div>
                <div><span className="text-gray-500">檢驗人：</span>{detail.inspectorName || "-"}</div>
                <div><span className="text-gray-500">結果：</span>{detail.result || "-"}</div>
                <div><span className="text-gray-500">檢驗數量：</span>{detail.inspectedQuantity}</div>
                <div><span className="text-gray-500">合格數：</span>{detail.acceptedQuantity}</div>
                <div><span className="text-gray-500">不合格數：</span>{detail.rejectedQuantity}</div>
                {detail.referenceType && <div><span className="text-gray-500">參考：</span>{REFERENCE_LABELS[detail.referenceType] || detail.referenceType} {detail.referenceNumber || `#${detail.referenceId}`}</div>}
              </div>
              {detail.results && (detail.results as Array<{ name: string; status?: string }>).length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">檢驗項目</h4>
                  <table className="w-full text-xs">
                    <thead><tr className="border-b bg-gray-50">
                      <th className="text-left px-2 py-1">項目</th>
                      <th className="text-left px-2 py-1">結果</th>
                      <th className="text-center px-2 py-1">狀態</th>
                    </tr></thead>
                    <tbody>
                      {(detail.results as Array<{ name: string; result?: string; status?: string }>).map((r, i) => (
                        <tr key={i} className="border-b">
                          <td className="px-2 py-1">{r.name}</td>
                          <td className="px-2 py-1">{r.result || "-"}</td>
                          <td className="px-2 py-1 text-center">{r.status || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                {detail.status === "Draft" && (
                  <Button onClick={() => updateStatus(detail.id, "Submitted")}>提交</Button>
                )}
                {detail.status === "Submitted" && (
                  <>
                    <Button onClick={() => updateStatus(detail.id, "Accepted", { result: "Pass", acceptedQuantity: detail.inspectedQuantity })}>合格</Button>
                    <Button variant="destructive" onClick={() => updateStatus(detail.id, "Rejected", { result: "Fail", rejectedQuantity: detail.inspectedQuantity })}>不合格</Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
