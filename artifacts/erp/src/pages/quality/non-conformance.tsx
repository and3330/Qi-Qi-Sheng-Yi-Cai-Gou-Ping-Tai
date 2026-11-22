import { useState, useEffect, useCallback } from "react";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DocWindow, DocStatus, DocFields, DocNote, statusTone } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";
import { Plus, Eye, Search } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface Ncr { id: number; reportNumber: string; title: string; itemId: number | null; itemName: string; severity: string; status: string; description: string; rootCause: string | null; correctiveAction: string | null; reportedBy: string | null; reportDate: string; closedDate: string | null; remarks: string | null }
interface Item { id: number; itemName: string; itemCode: string }

const severityMap: Record<string, string> = { Minor: "輕微", Major: "重大", Critical: "嚴重" };
const statusMap: Record<string, string> = { Open: "開放", "Under Investigation": "調查中", "Resolution In Progress": "改善中", Closed: "已結案" };
const statusColor = (s: string) => s === "Closed" ? "secondary" : s === "Open" ? "destructive" : "default";

export default function NonConformancePage() {
  const reloadKey = useAutoReloadKey();
  const [reports, setReports] = useState<Ncr[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Ncr | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState({ title: "", itemId: "", severity: "Minor", description: "", rootCause: "", correctiveAction: "", reportedBy: "", reportDate: new Date().toISOString().slice(0, 10), remarks: "" });
  const { toast } = useToast();
  const ncrBatchFields: BatchField[] = [{key:"status",label:"狀態",type:"select",options:[{value:"Open",label:"開啟"},{value:"In Progress",label:"處理中"},{value:"Resolved",label:"已解決"},{value:"Closed",label:"已關閉"}]}];

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [nRes, iRes] = await Promise.all([fetch(`/erp-api/non-conformance-reports`), fetch(`/erp-api/items`)]);
    setReports(await nRes.json()); setItems(await iRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const handleCreate = async () => {
    const payload = { title: form.title, itemId: form.itemId ? Number(form.itemId) : null, severity: form.severity, description: form.description, rootCause: form.rootCause || null, correctiveAction: form.correctiveAction || null, reportedBy: form.reportedBy || null, reportDate: form.reportDate, remarks: form.remarks || null };
    const res = await fetch(`/erp-api/non-conformance-reports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) { toast({ title: "NCR 已建立" }); setOpen(false); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const viewDetail = async (id: number) => {
    const res = await fetch(`/erp-api/non-conformance-reports/${id}`);
    if (res.ok) setDetail(await res.json());
  };

  const updateStatus = async (id: number, status: string) => {
    const res = await fetch(`/erp-api/non-conformance-reports/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (res.ok) { toast({ title: "狀態已更新" }); fetchAll(); if (detail?.id === id) viewDetail(id); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const filtered = reports.filter(r => {
    if (searchTerm && !r.reportNumber.includes(searchTerm) && !r.title.includes(searchTerm)) return false;
    return true;
  });

  const batch = useBatchSelection(filtered);

  return (
    <div className="space-y-6">
      <PageHeader title="不符合報告 (NCR)" description="追蹤品質異常事件與根因分析" />
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="NCR"
          entityEndpoint="non-conformance"
          ids={batch.ids}
          batchFields={ncrBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input className="pl-9" placeholder="搜尋..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />新增 NCR</Button>
        <DocWindow
          open={open} onClose={() => setOpen(false)} name="新增不符合報告"
          footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={!form.title || !form.description}>建立</Button>
          </>}
        >
            <div className="space-y-4">
              <div><label className="text-sm font-medium">標題 *</label><Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">嚴重度</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.severity} onChange={e => setForm(p => ({ ...p, severity: e.target.value }))}>
                    {Object.entries(severityMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div><label className="text-sm font-medium">報告日期 *</label><Input type="date" value={form.reportDate} onChange={e => setForm(p => ({ ...p, reportDate: e.target.value }))} /></div>
              </div>
              <div>
                <label className="text-sm font-medium">品項</label>
                <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.itemId} onChange={e => setForm(p => ({ ...p, itemId: e.target.value }))}>
                  <option value="">無</option>
                  {items.map(i => <option key={i.id} value={i.id}>{i.itemCode} - {i.itemName}</option>)}
                </LookupSelect>
              </div>
              <div><label className="text-sm font-medium">描述 *</label><textarea className="w-full border rounded-md px-3 py-2 text-sm min-h-[80px]" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
              <div><label className="text-sm font-medium">根因分析</label><textarea className="w-full border rounded-md px-3 py-2 text-sm min-h-[60px]" value={form.rootCause} onChange={e => setForm(p => ({ ...p, rootCause: e.target.value }))} /></div>
              <div><label className="text-sm font-medium">矯正措施</label><textarea className="w-full border rounded-md px-3 py-2 text-sm min-h-[60px]" value={form.correctiveAction} onChange={e => setForm(p => ({ ...p, correctiveAction: e.target.value }))} /></div>
              <div><label className="text-sm font-medium">報告人</label><Input value={form.reportedBy} onChange={e => setForm(p => ({ ...p, reportedBy: e.target.value }))} /></div>
            </div>
        </DocWindow>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50/50">
              <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
              <th className="text-left px-4 py-2.5 font-semibold">報告編號</th>
              <th className="text-left px-4 py-2.5 font-semibold">標題</th>
              <th className="text-center px-4 py-2.5 font-semibold">嚴重度</th>
              <th className="text-left px-4 py-2.5 font-semibold">日期</th>
              <th className="text-center px-4 py-2.5 font-semibold">狀態</th>
              <th className="text-center px-4 py-2.5 font-semibold">操作</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
              : filtered.map(r => (
                <tr key={r.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={e => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; viewDetail(r.id); }} data-testid={`ncr-row-${r.id}`}>
                  <td className="px-2" onClick={e => e.stopPropagation()}><CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} /></td>
                  <td className="px-4 py-2 font-mono">{r.reportNumber}</td>
                  <td className="px-4 py-2">{r.title}</td>
                  <td className="px-4 py-2 text-center"><Badge variant={r.severity === "Critical" ? "destructive" : r.severity === "Major" ? "default" : "secondary"}>{severityMap[r.severity]}</Badge></td>
                  <td className="px-4 py-2">{r.reportDate}</td>
                  <td className="px-4 py-2 text-center"><Badge variant={statusColor(r.status)}>{statusMap[r.status] || r.status}</Badge></td>
                  <td className="px-4 py-2 text-center"><Button size="sm" variant="outline" onClick={() => viewDetail(r.id)}><Eye className="h-3 w-3" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <DocWindow
        open={!!detail} onClose={() => setDetail(null)}
        name="不符合報告" number={detail?.reportNumber}
        status={detail ? <DocStatus label={statusMap[detail.status] || detail.status} tone={statusTone(detail.status)} /> : undefined}
        footer={detail && <>
          <Button variant="outline" onClick={() => setDetail(null)}>關閉</Button>
          {detail.status === "Open" && <Button onClick={() => updateStatus(detail.id, "Under Investigation")}>開始調查</Button>}
          {detail.status === "Under Investigation" && <Button onClick={() => updateStatus(detail.id, "Resolution In Progress")}>開始改善</Button>}
          {detail.status === "Resolution In Progress" && <Button onClick={() => updateStatus(detail.id, "Closed")}>結案</Button>}
        </>}
      >
        {detail && (
          <>
            <DocFields items={[
              ["標題", detail.title],
              ["嚴重度", <Badge variant={detail.severity === "Critical" ? "destructive" : "secondary"}>{severityMap[detail.severity]}</Badge>],
              ["品項", detail.itemName || "-"],
              ["報告人", detail.reportedBy || "-"],
              ["報告日期", detail.reportDate],
              ["結案日期", detail.closedDate],
            ]} />
            <DocNote label="描述">{detail.description}</DocNote>
            <DocNote label="根因分析">{detail.rootCause}</DocNote>
            <DocNote label="矯正措施">{detail.correctiveAction}</DocNote>
          </>
        )}
      </DocWindow>
    </div>
  );
}
