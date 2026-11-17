import { useState, useEffect } from "react";
import { clockInLocationsApi, type ClockInLocation, type GeofenceExemption } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pencil, Trash2, MapPin, LocateFixed } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAutoReloadKey } from "@/lib/auto-refresh";

const EMPTY_FORM = { name: "", latitude: "", longitude: "", radiusMeters: "300", isActive: true };

export default function ClockInLocationsPage() {
  const { toast } = useToast();
  const reloadKey = useAutoReloadKey();
  const [locations, setLocations] = useState<ClockInLocation[]>([]);
  const [exemptions, setExemptions] = useState<GeofenceExemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClockInLocation | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [locs, exs] = await Promise.all([clockInLocationsApi.list(), clockInLocationsApi.listExemptions()]);
      setLocations(locs);
      setExemptions(exs);
    } catch { /* 權限不足時保持空清單 */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, [reloadKey]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setError(null); setDialogOpen(true); };

  const openEdit = (l: ClockInLocation) => {
    setEditing(l);
    setForm({ name: l.name, latitude: String(l.latitude), longitude: String(l.longitude), radiusMeters: String(l.radiusMeters), isActive: l.isActive });
    setError(null);
    setDialogOpen(true);
  };

  const useCurrentPosition = () => {
    if (!navigator.geolocation) { setError("此瀏覽器不支援定位"); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setForm(f => ({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) }));
        setLocating(false);
      },
      () => { setError("無法取得目前位置，請確認已允許定位權限"); setLocating(false); },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const save = async () => {
    setError(null);
    const payload = {
      name: form.name.trim(),
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      radiusMeters: Number(form.radiusMeters),
      isActive: form.isActive,
    };
    try {
      if (editing) await clockInLocationsApi.update(editing.id, payload);
      else await clockInLocationsApi.create(payload);
      setDialogOpen(false);
      load();
    } catch (e: any) {
      setError(e.message || "儲存失敗");
    }
  };

  const remove = async (l: ClockInLocation) => {
    if (!confirm(`確定刪除打卡地點「${l.name}」？`)) return;
    try { await clockInLocationsApi.delete(l.id); load(); } catch (e: any) { toast({ title: "刪除失敗", description: e.message || undefined, variant: "destructive" }); }
  };

  const toggleActive = async (l: ClockInLocation) => {
    try { await clockInLocationsApi.update(l.id, { isActive: !l.isActive }); load(); } catch (e: any) { toast({ title: "更新失敗", description: e.message || undefined, variant: "destructive" }); }
  };

  const toggleExemption = async (emp: GeofenceExemption) => {
    try {
      await clockInLocationsApi.setExemption(emp.id, !emp.geofenceExempt);
      setExemptions(prev => prev.map(e => e.id === emp.id ? { ...e, geofenceExempt: !emp.geofenceExempt } : e));
    } catch (e: any) { toast({ title: "更新失敗", description: e.message || undefined, variant: "destructive" }); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="打卡地點設定"
        description="設定 GPS 圍欄：員工必須位於任一啟用地點的半徑範圍內才能打卡；未設定任何地點時不限制"
        onAdd={openCreate}
        addLabel="新增地點"
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            data={locations}
            isLoading={loading}
            emptyMessage="尚未設定打卡地點（目前不限制打卡位置）"
            columns={[
              { header: "名稱", accessor: (l: ClockInLocation) => <span className="font-medium flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-blue-500" /> {l.name}</span> },
              { header: "緯度", accessor: (l: ClockInLocation) => l.latitude.toFixed(6), className: "font-mono text-sm" },
              { header: "經度", accessor: (l: ClockInLocation) => l.longitude.toFixed(6), className: "font-mono text-sm" },
              { header: "允許半徑", accessor: (l: ClockInLocation) => `${l.radiusMeters} 公尺`, className: "text-right" },
              {
                header: "狀態",
                accessor: (l: ClockInLocation) => (
                  <button onClick={() => toggleActive(l)} className="cursor-pointer">
                    <Badge variant={l.isActive ? "default" : "secondary"}>{l.isActive ? "啟用" : "停用"}</Badge>
                  </button>
                ),
              },
              {
                header: "",
                accessor: (l: ClockInLocation) => (
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(l)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(l)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                  </div>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">外勤例外名單</CardTitle>
          <p className="text-sm text-gray-500">開啟後該員工不受打卡範圍限制（例如外勤、業務人員）</p>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            data={exemptions}
            isLoading={loading}
            emptyMessage="沒有在職員工"
            columns={[
              { header: "員工編號", accessor: (e: GeofenceExemption) => e.employeeId, className: "font-mono text-sm" },
              { header: "姓名", accessor: (e: GeofenceExemption) => `${e.firstName}${e.lastName}` },
              {
                header: "不受範圍限制",
                accessor: (e: GeofenceExemption) => (
                  <Switch checked={e.geofenceExempt} onCheckedChange={() => toggleExemption(e)} />
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "編輯打卡地點" : "新增打卡地點"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">名稱</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：公司總部" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">緯度</label>
                <Input value={form.latitude} onChange={e => setForm({ ...form, latitude: e.target.value })} placeholder="25.033964" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">經度</label>
                <Input value={form.longitude} onChange={e => setForm({ ...form, longitude: e.target.value })} placeholder="121.564468" />
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={useCurrentPosition} disabled={locating}>
              <LocateFixed className="h-4 w-4 mr-2" /> {locating ? "定位中…" : "使用目前位置"}
            </Button>
            <div>
              <label className="text-sm font-medium mb-1 block">允許半徑（公尺）</label>
              <Input type="number" value={form.radiusMeters} onChange={e => setForm({ ...form, radiusMeters: e.target.value })} placeholder="300" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.isActive} onCheckedChange={v => setForm({ ...form, isActive: v })} />
              <span className="text-sm">啟用此地點</span>
            </div>
            {error && <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button onClick={save}>儲存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
