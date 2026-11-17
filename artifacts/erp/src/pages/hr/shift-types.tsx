import { useState, useEffect } from "react";
import { payrollApi, type ShiftType } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useAutoReloadKey } from "@/lib/auto-refresh";

export default function ShiftTypesPage() {
  const reloadKey = useAutoReloadKey();
  const [shifts, setShifts] = useState<ShiftType[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftType | null>(null);
  const [form, setForm] = useState({ name: "", startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00", workingHours: "8" });

  const load = async () => {
    setLoading(true);
    try { setShifts(await payrollApi.listShiftTypes()); } catch { setShifts([]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [reloadKey]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00", workingHours: "8" });
    setDialogOpen(true);
  };

  const openEdit = (s: ShiftType) => {
    setEditing(s);
    setForm({ name: s.name, startTime: s.startTime, endTime: s.endTime, breakStart: s.breakStart || "", breakEnd: s.breakEnd || "", workingHours: s.workingHours });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (editing) {
      await payrollApi.updateShiftType(editing.id, form);
    } else {
      await payrollApi.createShiftType(form);
    }
    setDialogOpen(false);
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("確定刪除此班制？")) return;
    await payrollApi.deleteShiftType(id);
    load();
  };

  const batch = useBatchSelection(shifts);

  return (
    <div className="space-y-6">
      <PageHeader title="班制設定" description="管理公司班制與工作時間" action={
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" /> 新增班制</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "編輯班制" : "新增班制"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">班制名稱</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例：標準班制" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">上班時間</label>
                  <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">下班時間</label>
                  <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">午休開始</label>
                  <Input type="time" value={form.breakStart} onChange={(e) => setForm({ ...form, breakStart: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">午休結束</label>
                  <Input type="time" value={form.breakEnd} onChange={(e) => setForm({ ...form, breakEnd: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">每日工時</label>
                <Input value={form.workingHours} onChange={(e) => setForm({ ...form, workingHours: e.target.value })} />
              </div>
              <Button onClick={handleSave} className="w-full">{editing ? "更新" : "建立"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      } />

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="班制"
          entityEndpoint="shift-types"
          ids={batch.ids}
          batchFields={[]}
          onClear={batch.clearSelection}
          onComplete={() => load()}
        />
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={loading}
            data={shifts}
            emptyMessage="尚無班制資料"
            columns={[
              {
                header: () => <CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} />,
                accessor: (r) => <CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} />,
                className: "w-10 px-2",
              },
              { header: "班制名稱", accessor: "name" },
              { header: "上班", accessor: "startTime" },
              { header: "下班", accessor: "endTime" },
              { header: "午休", accessor: (r) => r.breakStart && r.breakEnd ? `${r.breakStart}-${r.breakEnd}` : "—" },
              { header: "工時", accessor: (r) => `${r.workingHours} 小時` },
              { header: "狀態", accessor: (r) => <Badge variant={r.status === "active" ? "default" : "secondary"}>{r.status === "active" ? "啟用" : "停用"}</Badge> },
              {
                header: "操作",
                accessor: (r) => (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                  </div>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
