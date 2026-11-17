import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Building2, Power, PowerOff } from "lucide-react";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const apiFetch = (path: string, opts?: RequestInit) =>
  fetch(`/erp-api${path}`, { headers: { "Content-Type": "application/json" }, ...opts }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "請求失敗");
    if (r.status === 204) return null;
    return r.json();
  });

const emptyForm = { name: "", taxId: "", address: "", contactPerson: "", tel: "" };

export default function BrandsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: brands = [], isLoading } = useQuery({
    queryKey: ["/erp-api/brands"],
    queryFn: () => apiFetch("/brands"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/erp-api/brands"] });

  const saveMut = useMutation({
    mutationFn: (data: any) => editingId
      ? apiFetch(`/brands/${editingId}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch("/brands", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      invalidate();
      toast({ title: editingId ? "品牌已更新" : "品牌已建立" });
      setShowDialog(false);
      setEditingId(null);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast({ title: "錯誤", description: e.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: (b: any) => apiFetch(`/brands/${b.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !b.isActive }) }),
    onSuccess: () => { invalidate(); toast({ title: "已更新狀態" }); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/brands/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "品牌已刪除" }); },
    onError: (e: Error) => toast({ title: "刪除失敗", description: e.message, variant: "destructive" }),
  });

  const openEdit = (b: any) => {
    setForm({ name: b.name || "", taxId: b.taxId || "", address: b.address || "", contactPerson: b.contactPerson || "", tel: b.tel || "" });
    setEditingId(b.id);
    setShowDialog(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="品牌管理" description="管理報價單等文件使用的公司品牌資訊">
        <Button size="sm" onClick={() => { setForm(emptyForm); setEditingId(null); setShowDialog(true); }}>
          <Plus className="h-4 w-4 mr-1" />新增品牌
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-4 py-3 font-medium">品牌／公司名稱</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">統一編號</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">地址</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">承辦人</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">電話</th>
                  <th className="text-center px-4 py-3 font-medium">狀態</th>
                  <th className="text-right px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">載入中...</td></tr>
                ) : brands.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">尚未建立品牌，點右上「新增品牌」開始</td></tr>
                ) : (
                  brands.map((b: any) => (
                    <tr key={b.id} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-medium">
                        <div className="flex items-center gap-2">
                          <Building2 className={`h-4 w-4 ${b.isActive ? "text-blue-500" : "text-gray-400"}`} />
                          <span className={b.isActive ? "" : "text-gray-400 line-through"}>{b.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 hidden sm:table-cell font-mono text-xs">{b.taxId || "-"}</td>
                      <td className="px-4 py-2.5 hidden md:table-cell">{b.address || "-"}</td>
                      <td className="px-4 py-2.5 hidden md:table-cell">{b.contactPerson || "-"}</td>
                      <td className="px-4 py-2.5 hidden lg:table-cell">{b.tel || "-"}</td>
                      <td className="px-4 py-2.5 text-center">
                        {b.isActive ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100">啟用</Badge> : <Badge variant="secondary">已停用</Badge>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" title={b.isActive ? "停用" : "啟用"} onClick={() => toggleMut.mutate(b)}>
                            {b.isActive ? <PowerOff className="h-4 w-4 text-orange-500" /> : <Power className="h-4 w-4 text-green-600" />}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(b)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => { if (confirm("確定刪除此品牌？")) deleteMut.mutate(b.id); }}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "編輯品牌" : "新增品牌"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>品牌／公司名稱 <span className="text-red-500">*</span></Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="如 詠勝教育文化事業有限公司" /></div>
            <div><Label>統一編號</Label><Input value={form.taxId} onChange={e => setForm(f => ({ ...f, taxId: e.target.value }))} /></div>
            <div><Label>地址</Label><Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>承辦人</Label><Input value={form.contactPerson} onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))} /></div>
              <div><Label>電話</Label><Input value={form.tel} onChange={e => setForm(f => ({ ...f, tel: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>取消</Button>
            <Button onClick={() => saveMut.mutate(form)} disabled={!form.name.trim() || saveMut.isPending}>{editingId ? "更新" : "建立"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
