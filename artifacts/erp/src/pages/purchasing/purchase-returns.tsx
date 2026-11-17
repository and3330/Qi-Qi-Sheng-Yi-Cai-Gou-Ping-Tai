import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Check, X, Eye, Search } from "lucide-react";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { DateRangePresets } from "@/components/shared/date-range-presets";
import { DocWindow, DocStatus, statusTone, DocFields, DocLines, DocSection } from "@/components/shared/doc-window";
import { RelatedDocs, useOpenFromUrl } from "@/components/shared/related-docs";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface ReturnItem { itemId: number; itemName: string; quantity: number; rate: number; amount: number }
interface PurchaseReturn {
  id: number; returnNumber: string; purchaseReceiptId: number | null; supplierId: number;
  supplierName: string; returnDate: string; reason: string | null; status: string;
  totalAmount: number; items: ReturnItem[]; remarks: string | null; createdAt: string;
}
interface Supplier { id: number; name: string }
interface PurchaseReceipt { id: number; receiptNumber: string; supplierId: number; supplierName: string; status: string; items: ReturnItem[] }
interface Department { id: number; name: string }
interface Project { id: number; name: string }

const statusMap: Record<string, string> = { Draft: "草稿", Submitted: "已確認", Completed: "已完成", Cancelled: "已取消" };
const statusColor = (s: string) => s === "Submitted" || s === "Completed" ? "default" : s === "Cancelled" ? "destructive" : "secondary";

function getMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}` };
}

export default function PurchaseReturnsPage() {
  const reloadKey = useAutoReloadKey();
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [receipts, setReceipts] = useState<PurchaseReceipt[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [projs, setProjs] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<PurchaseReturn | null>(null);
  const [editRemarks, setEditRemarks] = useState("");
  const { toast } = useToast();

  const defaultRange = useMemo(() => getMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return returns.filter(r => {
      if (dateFrom && r.returnDate < dateFrom) return false;
      if (dateTo && r.returnDate > dateTo) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(r.returnNumber.toLowerCase().includes(q) || r.supplierName.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [returns, dateFrom, dateTo, search]);

  const batch = useBatchSelection(filtered);
  // 退貨狀態流轉會連動庫存/扣項單/分錄，不提供批次修改狀態
  const batchFields: BatchField[] = [];

  const [form, setForm] = useState({ purchaseReceiptId: "", supplierId: "", returnDate: new Date().toISOString().slice(0, 10), reason: "", remarks: "", departmentId: "", projectId: "" });
  const [lineItems, setLineItems] = useState<{ itemId: number; itemName: string; quantity: string; rate: number; maxQty: number }[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [retRes, supRes, rcpRes, deptRes, projRes] = await Promise.all([
      fetch(`/erp-api/purchase-returns`), fetch(`/erp-api/suppliers`), fetch(`/erp-api/purchase-receipts`),
      fetch(`/erp-api/departments`), fetch(`/erp-api/projects`),
    ]);
    setReturns(await retRes.json());
    setSuppliers(await supRes.json());
    const allRcps = await rcpRes.json();
    setDepts(await deptRes.json());
    setProjs(await projRes.json());
    setReceipts(allRcps.filter((r: PurchaseReceipt) => r.status === "Submitted" || r.status === "Completed"));
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const onSelectReceipt = (rcpId: string) => {
    const rcp = receipts.find(r => r.id === Number(rcpId));
    if (!rcp) {
      setForm(p => ({ ...p, purchaseReceiptId: "", supplierId: "" }));
      setLineItems([]);
      return;
    }
    setForm(p => ({ ...p, purchaseReceiptId: rcpId, supplierId: String(rcp.supplierId) }));
    setLineItems(rcp.items.map(item => ({
      itemId: item.itemId, itemName: item.itemName, quantity: String(item.quantity), rate: item.rate, maxQty: item.quantity,
    })));
  };

  const handleCreate = async () => {
    if (!form.departmentId || !form.projectId) {
      toast({ title: "請選擇部門與專案", description: "部門與專案為必填欄位", variant: "destructive" }); return;
    }
    const payload = {
      purchaseReceiptId: Number(form.purchaseReceiptId), supplierId: Number(form.supplierId), returnDate: form.returnDate,
      reason: form.reason || null, remarks: form.remarks || null,
      departmentId: Number(form.departmentId), projectId: Number(form.projectId),
      items: lineItems.filter(l => Number(l.quantity) > 0).map(l => ({ itemId: l.itemId, quantity: Number(l.quantity), rate: l.rate })),
    };
    const res = await fetch(`/erp-api/purchase-returns`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) {
      toast({ title: "採購退貨單已建立" }); setOpen(false);
      setForm({ purchaseReceiptId: "", supplierId: "", returnDate: new Date().toISOString().slice(0, 10), reason: "", remarks: "", departmentId: "", projectId: "" });
      setLineItems([]); fetchAll();
    } else {
      const err = await res.json();
      toast({ title: err.error || "建立失敗", variant: "destructive" });
    }
  };

  const updateStatus = async (id: number, status: string) => {
    const res = await fetch(`/erp-api/purchase-returns/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    if (res.ok) {
      toast({ title: status === "Submitted" ? "已確認退貨，庫存已扣除，扣項單已建立" : `狀態已更新為${statusMap[status] || status}` });
      fetchAll(); if (detailItem?.id === id) viewDetail(id);
    } else {
      const err = await res.json();
      toast({ title: err.error || "操作失敗", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/erp-api/purchase-returns/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "已刪除" }); fetchAll(); setDetailItem(null); }
    else { const err = await res.json(); toast({ title: err.error || "刪除失敗", variant: "destructive" }); }
  };

  const saveRemarks = async () => {
    if (!detailItem) return;
    await fetch(`/erp-api/purchase-returns/${detailItem.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remarks: editRemarks }),
    });
    toast({ title: "備註已更新" }); viewDetail(detailItem.id); fetchAll();
  };

  useOpenFromUrl(returns, r => viewDetail(r.id));
  const viewDetail = async (id: number) => {
    const res = await fetch(`/erp-api/purchase-returns/${id}`);
    if (res.ok) { const d = await res.json(); setDetailItem(d); setEditRemarks(d.remarks || ""); }
  };

  const selectedSupplierName = suppliers.find(s => s.id === Number(form.supplierId))?.name || "";

  return (
    <div className="space-y-6">
      <PageHeader title="採購退貨" description="處理供應商退貨，需指定進貨單，確認後自動扣除庫存並建立扣項單" />
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />新增退貨單</Button>
        {/* 新增採購退貨單：外框用全系統共用的單據視窗 */}
        <DocWindow
          open={open}
          onClose={() => setOpen(false)}
          name="新增採購退貨單"
          wide
          footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={!form.purchaseReceiptId || lineItems.every(l => Number(l.quantity) <= 0)}>建立</Button>
          </>}
        >
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">來源進貨單 *</label>
                <SearchableSelect
                  value={form.purchaseReceiptId}
                  onValueChange={v => onSelectReceipt(v)}
                  options={receipts.map(r => ({ value: String(r.id), label: `${r.receiptNumber} - ${r.supplierName}` }))}
                  placeholder="選擇進貨單"
                  data-testid="select-return-receipt"
                />
              </div>
              {selectedSupplierName && <div className="text-sm text-gray-600">供應商：{selectedSupplierName}</div>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">退貨日期 *</label>
                  <Input type="date" value={form.returnDate} onChange={e => setForm(p => ({ ...p, returnDate: e.target.value }))} />
                </div>
                <div>
                  <label className="text-sm font-medium">退貨原因</label>
                  <Input value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} placeholder="退貨原因" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">部門 <span className="text-red-500">*</span></label>
                  <SearchableSelect
                    value={form.departmentId}
                    onValueChange={v => setForm(p => ({ ...p, departmentId: v }))}
                    options={depts.filter(d => (d as any).isActive !== false || String(d.id) === String(form.departmentId)).map(d => ({ value: String(d.id), label: `${d.name}${(d as any).isActive === false ? "（已停用）" : ""}` }))}
                    placeholder="請選擇部門"
                    triggerClassName={!form.departmentId ? "border-red-300 bg-red-50" : undefined}
                    data-testid="select-return-department"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">專案 <span className="text-red-500">*</span></label>
                  <SearchableSelect
                    value={form.projectId}
                    onValueChange={v => setForm(p => ({ ...p, projectId: v }))}
                    options={projs.filter(p => (p as any).isActive !== false || String(p.id) === String(form.projectId)).map(p => ({ value: String(p.id), label: `${p.name}${(p as any).isActive === false ? "（已停用）" : ""}` }))}
                    placeholder="請選擇專案"
                    triggerClassName={!form.projectId ? "border-red-300 bg-red-50" : undefined}
                    data-testid="select-return-project"
                  />
                </div>
              </div>
              <div><label className="text-sm font-medium">備註</label><Input value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} placeholder="備註說明" /></div>
              {lineItems.length > 0 && (
                <div>
                  <label className="text-sm font-medium">退貨品項（自進貨單帶入）</label>
                  {/* 手機版：卡片式品項編輯 */}
                  <div className="md:hidden space-y-3 mt-2">
                    {lineItems.map((line, i) => (
                      <div key={i} className="rounded-lg border p-3 space-y-2">
                        <div className="text-sm font-medium">{line.itemName}</div>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs text-muted-foreground shrink-0">退貨數量</Label>
                          <Input className="w-24" type="number" min="0" max={line.maxQty} value={line.quantity}
                            onChange={e => setLineItems(prev => { const c = [...prev]; c[i] = { ...c[i], quantity: e.target.value }; return c; })} />
                          <span className="text-xs text-gray-500">/ 最多 {line.maxQty}</span>
                        </div>
                        <div className="text-right text-sm font-medium">小計：${(Number(line.quantity) * line.rate).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                  {/* 桌面版：列式品項編輯 */}
                  <div className="hidden md:block space-y-2 mt-2">
                    {lineItems.map((line, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <span className="flex-1 text-sm">{line.itemName}</span>
                        <Input className="w-20" type="number" min="0" max={line.maxQty} value={line.quantity}
                          onChange={e => setLineItems(prev => { const c = [...prev]; c[i] = { ...c[i], quantity: e.target.value }; return c; })} />
                        <span className="text-xs text-gray-500">/ {line.maxQty}</span>
                        <span className="w-20 text-right text-sm font-mono">${(Number(line.quantity) * line.rate).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-right mt-2 font-bold">合計：${lineItems.reduce((s, l) => s + Number(l.quantity) * l.rate, 0).toLocaleString()}</div>
                </div>
              )}
            </div>
        </DocWindow>
      </div>

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="退貨單"
          entityEndpoint="purchase-returns"
          ids={batch.ids}
          batchFields={batchFields}
          onClear={batch.clearSelection}
          onComplete={fetchAll}
        />
      )}

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs text-muted-foreground">起始日期</Label>
              <Input type="date" className="w-40" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">結束日期</Label>
              <Input type="date" className="w-40" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <DateRangePresets from={dateFrom} to={dateTo} onChange={(r) => { setDateFrom(r.from); setDateTo(r.to); }} />
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">搜尋</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="單號、供應商名稱..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="text-sm text-muted-foreground pb-2">共 {filtered.length} 筆</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 border-b"><CardTitle>退貨單列表</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                  <th className="text-left px-4 py-2.5 font-semibold">單號</th>
                  <th className="text-left px-4 py-2.5 font-semibold">供應商</th>
                  <th className="text-left px-4 py-2.5 font-semibold">退貨日期</th>
                  <th className="text-left px-4 py-2.5 font-semibold">原因</th>
                  <th className="text-left px-4 py-2.5 font-semibold">狀態</th>
                  <th className="text-right px-4 py-2.5 font-semibold">金額</th>
                  <th className="text-center px-4 py-2.5 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
                ) : filtered.map(r => (
                  <tr key={r.id} className="border-b hover:bg-gray-50">
                    <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} /></td>
                    <td className="px-4 py-2 font-medium">{r.returnNumber}</td>
                    <td className="px-4 py-2">{r.supplierName}</td>
                    <td className="px-4 py-2">{r.returnDate}</td>
                    <td className="px-4 py-2 text-gray-500">{r.reason || "-"}</td>
                    <td className="px-4 py-2"><Badge variant={statusColor(r.status)}>{statusMap[r.status] || r.status}</Badge></td>
                    <td className="px-4 py-2 text-right font-mono">${r.totalAmount.toLocaleString()}</td>
                    <td className="px-4 py-2 text-center">
                      <div className="flex gap-1 justify-center">
                        <Button size="sm" variant="outline" onClick={() => viewDetail(r.id)} title="檢視"><Eye className="h-3 w-3" /></Button>
                        {r.status === "Draft" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => updateStatus(r.id, "Submitted")} title="確認退貨"><Check className="h-3 w-3" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)} title="刪除"><Trash2 className="h-3 w-3" /></Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 退貨單視窗：照全系統共用的單據版面（標題列 → 表頭欄位 → 明細 → 其他區塊 → 底部按鈕列） */}
      <DocWindow
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
        name="採購退貨單"
        number={detailItem?.returnNumber}
        // 「已確認」在共用顏色規則裡算完成（藍色），和列表上的徽章一致
        status={detailItem && <DocStatus label={statusMap[detailItem.status] || detailItem.status} tone={statusTone(detailItem.status === "Submitted" ? "Confirmed" : detailItem.status)} />}
        footer={detailItem && (
          <>
            {/* 左邊：刪除、取消這類要小心的 */}
            <div className="mr-auto flex flex-wrap gap-2">
              {detailItem.status === "Draft" && (
                <>
                  <Button variant="destructive" onClick={() => handleDelete(detailItem.id)}>刪除</Button>
                  <Button variant="outline" onClick={() => updateStatus(detailItem.id, "Cancelled")}>取消退貨</Button>
                </>
              )}
              {detailItem.status === "Submitted" && (
                <Button variant="destructive" onClick={() => { if (confirm("取消退貨將回補庫存，並作廢自動建立的扣項單與分錄，確定嗎？")) updateStatus(detailItem.id, "Cancelled"); }}>取消退貨</Button>
              )}
            </div>
            {/* 右邊：關閉和主要動作 */}
            <Button variant="outline" onClick={() => setDetailItem(null)}>關閉</Button>
            {detailItem.status === "Draft" && (
              <Button onClick={() => updateStatus(detailItem.id, "Submitted")}>確認退貨</Button>
            )}
            {detailItem.status === "Submitted" && (
              <Button onClick={() => updateStatus(detailItem.id, "Completed")}>標記完成</Button>
            )}
          </>
        )}
      >
        {detailItem && (
          <>
            <DocFields items={[
              ["供應商", detailItem.supplierName],
              ["退貨日期", detailItem.returnDate],
              ["金額", <span className="font-mono">${detailItem.totalAmount.toLocaleString()}</span>],
              ["退貨原因", detailItem.reason],
            ]} />
            <DocLines<ReturnItem>
              rows={(detailItem.items as ReturnItem[]) || []}
              columns={[
                { header: "品項", cell: (item) => item.itemName },
                { header: "數量", align: "right", cell: (item) => item.quantity },
                { header: "單價", align: "right", className: "font-mono", cell: (item) => `$${item.rate.toLocaleString()}` },
                { header: "金額", align: "right", className: "font-mono", cell: (item) => `$${item.amount.toLocaleString()}` },
              ]}
              total={{ value: <span className="font-mono">${detailItem.totalAmount.toLocaleString()}</span> }}
            />
            <DocSection title="備註">
              <div className="flex gap-2">
                <Input value={editRemarks} onChange={e => setEditRemarks(e.target.value)} placeholder="備註" />
                <Button size="sm" onClick={saveRemarks}>儲存</Button>
              </div>
            </DocSection>
            {/* 這張退貨單退的是哪張進貨單（進貨單沒有單張的網址，所以只顯示單號） */}
            <RelatedDocs type="purchase_return" id={detailItem.id} onNavigate={() => setDetailItem(null)} />
          </>
        )}
      </DocWindow>
    </div>
  );
}
