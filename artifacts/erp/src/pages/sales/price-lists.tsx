import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Eye, X } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useAutoReloadKey } from "@/lib/auto-refresh";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface PriceList {
  id: number; name: string; currency: string; customerGroup: string | null;
  isActive: string; remarks: string | null; createdAt: string;
}
interface PriceListDetail extends PriceList {
  items: PriceListItemEntry[];
}
interface PriceListItemEntry {
  id: number; priceListId: number; itemId: number; itemName: string; itemCode: string;
  price: number; minQuantity: number; validFrom: string | null; validTo: string | null;
}
interface Item { id: number; itemName: string; itemCode: string; sellingPrice: string }

export default function PriceListsPage() {
  const reloadKey = useAutoReloadKey();
  const [lists, setLists] = useState<PriceList[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<PriceListDetail | null>(null);
  const { toast } = useToast();

  const batch = useBatchSelection(lists);
  const plBatchFields: BatchField[] = [
    {key:"status",label:"狀態",type:"select",options:[{value:"Active",label:"啟用"},{value:"Inactive",label:"停用"}]},
  ];

  const [form, setForm] = useState({ name: "", currency: "TWD", customerGroup: "", remarks: "" });
  const [itemForm, setItemForm] = useState({ itemId: "", price: "", minQuantity: "1" });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [listsRes, itemsRes] = await Promise.all([
      fetch(`/erp-api/price-lists`), fetch(`/erp-api/items`),
    ]);
    setLists(await listsRes.json());
    setItems(await itemsRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const handleCreate = async () => {
    const res = await fetch(`/erp-api/price-lists`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, currency: form.currency, customerGroup: form.customerGroup || null, remarks: form.remarks || null }),
    });
    if (res.ok) {
      toast({ title: "價目表已建立" });
      setOpen(false);
      setForm({ name: "", currency: "TWD", customerGroup: "", remarks: "" });
      fetchAll();
    } else {
      toast({ title: "建立失敗", variant: "destructive" });
    }
  };

  const viewDetail = async (id: number) => {
    const res = await fetch(`/erp-api/price-lists/${id}`);
    if (res.ok) {
      setDetail(await res.json());
      setDetailOpen(true);
    }
  };

  const addItemToList = async () => {
    if (!detail) return;
    const res = await fetch(`/erp-api/price-lists/${detail.id}/items`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: Number(itemForm.itemId), price: Number(itemForm.price), minQuantity: Number(itemForm.minQuantity) }),
    });
    if (res.ok) {
      toast({ title: "品項已加入" });
      setItemForm({ itemId: "", price: "", minQuantity: "1" });
      viewDetail(detail.id);
    }
  };

  const removeItemFromList = async (itemEntryId: number) => {
    if (!detail) return;
    await fetch(`/erp-api/price-lists/${detail.id}/items/${itemEntryId}`, { method: "DELETE" });
    toast({ title: "品項已移除" });
    viewDetail(detail.id);
  };

  const deleteList = async (id: number) => {
    await fetch(`/erp-api/price-lists/${id}`, { method: "DELETE" });
    toast({ title: "價目表已刪除" });
    fetchAll();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="價目表" description="管理不同客群或幣別的產品定價" />

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="價目表"
          entityEndpoint="price-lists"
          ids={batch.ids}
          batchFields={plBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" />新增價目表</Button>
          </DialogTrigger>
          <DialogContent className="md:max-w-md">
            <DialogHeader><DialogTitle>新增價目表</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">名稱 *</label>
                <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="例：VIP客戶價目表" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">幣別</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}>
                    <option value="TWD">TWD 新台幣</option>
                    <option value="USD">USD 美元</option>
                    <option value="CNY">CNY 人民幣</option>
                    <option value="JPY">JPY 日圓</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">客群</label>
                  <Input value={form.customerGroup} onChange={e => setForm(p => ({ ...p, customerGroup: e.target.value }))} placeholder="VIP / 一般" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">備註</label>
                <Input value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} placeholder="備註" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={!form.name}>建立</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="py-3 border-b"><CardTitle>價目表列表</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                  <th className="text-left px-4 py-2.5 font-semibold">名稱</th>
                  <th className="text-left px-4 py-2.5 font-semibold">幣別</th>
                  <th className="text-left px-4 py-2.5 font-semibold">客群</th>
                  <th className="text-left px-4 py-2.5 font-semibold">狀態</th>
                  <th className="text-center px-4 py-2.5 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
                ) : lists.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
                ) : lists.map(l => (
                  <tr key={l.id} className="border-b hover:bg-gray-50">
                    <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(l.id)} onChange={() => batch.toggle(l.id)} /></td>
                    <td className="px-4 py-2 font-medium">{l.name}</td>
                    <td className="px-4 py-2">{l.currency}</td>
                    <td className="px-4 py-2">{l.customerGroup || "-"}</td>
                    <td className="px-4 py-2"><Badge variant={l.isActive === "Y" ? "default" : "secondary"}>{l.isActive === "Y" ? "啟用" : "停用"}</Badge></td>
                    <td className="px-4 py-2 text-center">
                      <div className="flex gap-1 justify-center">
                        <Button size="sm" variant="outline" onClick={() => viewDetail(l.id)} title="檢視明細"><Eye className="h-3 w-3" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteList(l.id)} title="刪除"><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="md:max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.name} - 品項明細</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="text-sm font-medium">品項</label>
                  <LookupSelect className="w-full border rounded-md px-2 py-1.5 text-sm" value={itemForm.itemId} onChange={e => {
                    const found = items.find(it => it.id === Number(e.target.value));
                    setItemForm(p => ({ ...p, itemId: e.target.value, price: found ? String(found.sellingPrice) : "" }));
                  }}>
                    <option value="">選擇品項</option>
                    {items.map(it => <option key={it.id} value={it.id}>{it.itemCode} - {it.itemName}</option>)}
                  </LookupSelect>
                </div>
                <div className="w-28">
                  <label className="text-sm font-medium">價格</label>
                  <Input type="number" value={itemForm.price} onChange={e => setItemForm(p => ({ ...p, price: e.target.value }))} />
                </div>
                <div className="w-20">
                  <label className="text-sm font-medium">最低量</label>
                  <Input type="number" value={itemForm.minQuantity} onChange={e => setItemForm(p => ({ ...p, minQuantity: e.target.value }))} />
                </div>
                <Button size="sm" onClick={addItemToList} disabled={!itemForm.itemId || !itemForm.price}><Plus className="h-3 w-3" /></Button>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50/50">
                    <th className="text-left px-3 py-2 font-semibold">品項代碼</th>
                    <th className="text-left px-3 py-2 font-semibold">品名</th>
                    <th className="text-right px-3 py-2 font-semibold">價格</th>
                    <th className="text-right px-3 py-2 font-semibold">最低量</th>
                    <th className="text-center px-3 py-2 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">尚未設定品項</td></tr>
                  ) : detail.items.map(item => (
                    <tr key={item.id} className="border-b">
                      <td className="px-3 py-2 font-mono text-xs">{item.itemCode}</td>
                      <td className="px-3 py-2">{item.itemName}</td>
                      <td className="px-3 py-2 text-right font-mono">${item.price.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{item.minQuantity}</td>
                      <td className="px-3 py-2 text-center">
                        <Button size="sm" variant="ghost" onClick={() => removeItemFromList(item.id)}><X className="h-3 w-3" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
