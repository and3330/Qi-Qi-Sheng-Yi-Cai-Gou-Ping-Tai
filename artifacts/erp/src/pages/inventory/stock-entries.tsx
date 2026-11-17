import { useState } from "react";
import { ProjectField } from "@/components/shared/project-field";
import { useListStockEntries } from "@workspace/erp-api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LegacyStockDialog } from "@/components/inventory/legacy-stock-dialog";
import { Textarea } from "@/components/ui/textarea";
import { call, post } from "@/lib/call";
import { Plus } from "lucide-react";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { MasterLookup, useMasterRows } from "@/components/shared/master-lookup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DocWindow, DocFields, DocLines } from "@/components/shared/doc-window";
import { TransferButton } from "@/components/inventory/transfer-dialog";

const typeMap: Record<string, string> = { Receipt: "入庫", Receive: "入庫", Issue: "出庫", Transfer: "調撥" };
const sourceMap: Record<string, string> = { transfer: "調撥", count: "盤點", receipt: "進貨", delivery: "出貨", return: "退貨", "work-order": "工單", manual: "手動" };
const money = (n: unknown) => `$${(Number(n) || 0).toLocaleString()}`;
const emptyForm = { entryType: "Receipt", itemId: "", warehouseId: "", quantity: "", rate: "", remarks: "", projectId: "" };

export default function StockEntriesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: entries, isLoading } = useListStockEntries();
  const { data: items = [] } = useMasterRows("items");
  const [open, setOpen] = useState(false);
  // 舊系統（Ecount）的調撥與領用：只供查看與補備註，不算進現在的分倉數量
  const { data: legacyLines } = useQuery({ queryKey: ["/stock-entries/legacy-lines"], queryFn: () => call<any[]>("stock-entries/legacy-lines"), staleTime: 5 * 60 * 1000 });
  const [legacyTarget, setLegacyTarget] = useState<{ type: "movement" | "count"; id: number } | null>(null);
  const [viewing, setViewing] = useState<any>(null);
  const [viewRemarks, setViewRemarks] = useState("");
  const [savingRemarks, setSavingRemarks] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [scope, setScope] = useState("all");
  const allRows: any[] = [
    // 新系統的異動：最新的排前面
    ...(Array.isArray(entries) ? [...entries].reverse() : []),
    ...(Array.isArray(legacyLines) ? legacyLines : []),
  ];
  const term = keyword.trim().toLowerCase();
  const tableRows = allRows.filter(row =>
    (scope === "all" || (scope === "legacy" ? row.legacy === true : row.legacy !== true))
    && (!term || [row.itemName, row.docNumber, row.warehouseName, row.fromWarehouse, row.toWarehouse, row.remarks, row.note].some(v => String(v ?? "").toLowerCase().includes(term))));
  const openRow = (row: any) => {
    if (row.legacy) { setLegacyTarget({ type: "movement", id: row.legacyDocumentId }); return; }
    setViewRemarks(row.remarks || ""); setViewing(row);
  };
  const saveRemarks = async () => {
    if (!viewing) return;
    setSavingRemarks(true);
    try {
      await post(`stock-entries/${viewing.id}`, { remarks: viewRemarks }, "PATCH");
      toast({ title: "備註已儲存" });
      setViewing(null);
      queryClient.invalidateQueries({ queryKey: ["/erp-api/stock-entries"] });
    } catch (e) {
      toast({ title: "沒有成功", description: e instanceof Error ? e.message : "請稍後再試", variant: "destructive" });
    } finally { setSavingRemarks(false); }
  };
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const item = items.find(i => String(i.id) === form.itemId);
  const currentCost = Number(item?.movingAvgCost) || Number(item?.buyingPrice) || 0;
  const isReceipt = form.entryType === "Receipt";
  const quantity = Number(form.quantity);
  const valid = !!form.itemId && !!form.warehouseId && quantity > 0;

  const pickItem = (itemId: string) => {
    const picked = items.find(i => String(i.id) === itemId);
    const cost = Number(picked?.movingAvgCost) || Number(picked?.buyingPrice) || 0;
    setForm(f => ({ ...f, itemId, rate: cost ? String(cost) : "" }));
  };

  const submit = async () => {
    if (!form.projectId) {
      toast({ title: "請選擇歸屬專案", description: "盤盈、盤損會記到這個專案", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/erp-api/stock-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          entryType: form.entryType,
          itemId: Number(form.itemId),
          warehouseId: Number(form.warehouseId),
          quantity,
          rate: Number(form.rate) || 0,
          remarks: form.remarks || undefined,
          projectId: Number(form.projectId),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "庫存異動失敗");
      toast({ title: "已建立庫存異動", description: Number(body?.amount) > 0 ? `已同步入帳 ${money(body.amount)}` : "金額為 0，未產生分錄" });
      setOpen(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["/erp-api/stock-entries"] });
      queryClient.invalidateQueries({ queryKey: ["master-lookup", "items"] });
    } catch (error) {
      toast({ title: "庫存異動失敗", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="庫存異動" description="各倉庫的進出紀錄；進貨、出貨、退貨、工單、調撥、盤點都會自動出現在這裡" />
        <div className="flex flex-wrap gap-2">
          <TransferButton />
          <Button onClick={() => { setForm(emptyForm); setOpen(true); }} data-testid="button-new-stock-entry"><Plus className="mr-1.5 h-4 w-4" />新增異動</Button>
        </div>
      </div>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[200px] flex-1 space-y-1">
            <Label htmlFor="stock-search">搜尋</Label>
            <Input id="stock-search" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="品項、單號、倉庫、備註…" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="stock-scope">範圍</Label>
            <select id="stock-scope" className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm" value={scope} onChange={e => setScope(e.target.value)}>
              <option value="all">全部</option>
              <option value="current">只看新系統的</option>
              <option value="legacy">只看舊系統（Ecount）的</option>
            </select>
          </div>
          <p className="basis-full text-xs text-muted-foreground">共 {tableRows.length.toLocaleString()} 筆。標「歷史」的是舊系統的調撥與領用紀錄，只供查看與補備註，不算進現在各倉庫的數量。點任何一列可以看內容。</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={tableRows as any}
            onRowClick={(row: any) => openRow(row)}
            emptyMessage="尚無庫存異動"
            columns={[
              { header: "類型", accessor: (r: any) => r.legacy
                ? <span className="flex items-center gap-1.5 whitespace-nowrap"><Badge variant="outline">{r.kind}</Badge><span className="ml-1.5 inline-block rounded border px-1 text-[10px] font-normal text-muted-foreground align-middle" title="舊系統 Ecount 的紀錄，不影響現在的庫存數量">歷史</span></span>
                : <span className="flex items-center gap-1.5"><Badge variant="outline">{typeMap[r.entryType] || r.entryType}</Badge>{sourceMap[(r as any).source] && <span className="text-xs text-muted-foreground">{sourceMap[(r as any).source]}</span>}</span> },
              { header: "日期", accessor: (r: any) => r.legacy ? (r.docDate || "-") : (r.createdAt ? String(r.createdAt).slice(0, 10) : "-") },
              { header: "品項", accessor: (r: any) => r.legacy ? <div><span>{r.itemName}</span><span className="block font-mono text-xs text-muted-foreground">{r.docNumber}</span></div> : r.itemName },
              { header: "數量", accessor: (r: any) => Number(r.quantity).toLocaleString(), className: "text-right" },
              { header: "單位成本", accessor: (r: any) => r.legacy ? "—" : money(r.rate), className: "text-right hidden sm:table-cell" },
              { header: "金額", accessor: (r: any) => r.legacy && !r.amount ? "—" : money(r.amount), className: "text-right hidden sm:table-cell" },
              { header: "倉庫", accessor: (r: any) => r.legacy ? `${r.fromWarehouse || "-"}${r.toWarehouse ? ` → ${r.toWarehouse}` : ""}` : (r.warehouseName || "-"), className: "hidden md:table-cell" },
              { header: "備註", accessor: (r: any) => (r.legacy ? [r.remarks, r.note].filter(Boolean).join("｜") : r.remarks) || "-", className: "hidden lg:table-cell" },
            ]}
          />
        </CardContent>
      </Card>

      <LegacyStockDialog target={legacyTarget} onClose={() => setLegacyTarget(null)} />

      {/* 點開一筆異動：跟其他單據同一種視窗（components/shared/doc-window） */}
      <DocWindow
        open={viewing !== null}
        onClose={() => setViewing(null)}
        name="庫存異動"
        description="數量與金額已經入帳，不能改；數量有誤請另建一筆反向異動沖回。備註可以補。"
        footer={
          <>
            <Button variant="outline" onClick={() => setViewing(null)}>關閉</Button>
            <Button onClick={saveRemarks} disabled={savingRemarks || !viewing || viewRemarks === (viewing?.remarks || "")}>{savingRemarks ? "儲存中…" : "儲存備註"}</Button>
          </>
        }
      >
        {viewing && (
          <>
            <DocFields items={[
              ["類型", `${typeMap[viewing.entryType] || viewing.entryType}${sourceMap[viewing.source] ? `（${sourceMap[viewing.source]}）` : ""}`],
              ["日期", viewing.createdAt ? String(viewing.createdAt).slice(0, 10) : "-"],
            ]} />
            <DocLines<any>
              rows={[viewing]}
              columns={[
                { header: "品項", cell: row => row.itemName || "-" },
                { header: "倉庫", cell: row => row.warehouseName || "-" },
                { header: "數量", align: "right", cell: row => Number(row.quantity).toLocaleString() },
                { header: "單位成本", align: "right", cell: row => money(row.rate) },
                { header: "金額", align: "right", cell: row => money(row.amount) },
              ]}
            />
            <div className="space-y-1.5"><Label htmlFor="stock-entry-remarks">備註</Label><Textarea id="stock-entry-remarks" rows={2} value={viewRemarks} onChange={e => setViewRemarks(e.target.value)} /></div>
          </>
        )}
      </DocWindow>

      <DocWindow open={open} onClose={() => setOpen(false)} name="新增庫存異動" description={<>用於單一品項的臨時調整。整批盤點請用「盤點」，搬倉請用「倉庫調撥」；進貨、出貨、工單領料請從各自的單據操作。</>}
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={submit} disabled={!valid || saving}>建立</Button>
        </>}>
          <div className="grid gap-4">
            <div>
              <Label>類型 *</Label>
              <Select value={form.entryType} onValueChange={v => setForm(f => ({ ...f, entryType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Receipt">入庫（盤盈）</SelectItem>
                  <SelectItem value="Issue">出庫（盤損）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>品項 *</Label>
              <MasterLookup source="items" value={form.itemId} onValueChange={pickItem} filter={(r) => !r.isVirtual} clearable={false} placeholder="選擇品項" data-testid="select-stock-entry-item" />
              {item && <p className="mt-1 text-xs text-muted-foreground">目前庫存 {Number(item.currentStock) || 0}，單位成本 {money(currentCost)}</p>}
            </div>
            <div>
              <Label>倉庫 *</Label>
              <MasterLookup source="warehouses" value={form.warehouseId} onValueChange={v => setForm(f => ({ ...f, warehouseId: v }))} clearable={false} placeholder="選擇倉庫" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>數量 *</Label><Input type="number" min="0" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} /></div>
              <div>
                <Label>單位成本</Label>
                <Input type="number" min="0" value={isReceipt ? form.rate : String(currentCost || form.rate)} disabled={!isReceipt && currentCost > 0} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {isReceipt ? "入庫會依這個成本更新品項的移動平均成本，並入帳：借 存貨／貸 存貨盤盈。" : "出庫一律以目前的移動平均成本計價，並入帳：借 存貨盤損／貸 存貨。"}
            </p>
            <ProjectField value={form.projectId} onChange={v => setForm(f => ({ ...f, projectId: v }))} />
            <div><Label>備註</Label><Input value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="例如：年度盤點" /></div>
          </div>
      </DocWindow>
    </div>
  );
}
