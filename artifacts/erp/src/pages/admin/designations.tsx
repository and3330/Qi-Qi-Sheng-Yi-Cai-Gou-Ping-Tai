import { useState, useEffect } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Trash2 } from "lucide-react";
import { adminApi, type Designation } from "@/lib/api";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useAutoReloadKey } from "@/lib/auto-refresh";

export default function DesignationsPage() {
  const reloadKey = useAutoReloadKey();
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Designation | null>(null);
  const [form, setForm] = useState({ title: "", description: "", departmentId: "" });
  const { toast } = useToast();
  const batch = useBatchSelection(designations);

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminApi.listDesignations();
      setDesignations(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, [reloadKey]);

  const openCreate = () => {
    setEditing(null);
    setForm({ title: "", description: "", departmentId: "" });
    setDialogOpen(true);
  };

  const openEdit = (d: Designation) => {
    setEditing(d);
    setForm({ title: d.title, description: d.description || "", departmentId: d.departmentId ? String(d.departmentId) : "" });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        await adminApi.updateDesignation(editing.id, {
          title: form.title,
          description: form.description || null,
          departmentId: form.departmentId ? Number(form.departmentId) : null,
        });
        toast({ title: "已更新職稱" });
      } else {
        await adminApi.createDesignation({
          title: form.title,
          description: form.description || null,
          departmentId: form.departmentId ? Number(form.departmentId) : null,
        });
        toast({ title: "已新增職稱" });
      }
      setDialogOpen(false);
      load();
    } catch (e: unknown) {
      toast({ title: "操作失敗", description: e instanceof Error ? e.message : "未知錯誤", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("確定要刪除此職稱嗎？")) return;
    try {
      await adminApi.deleteDesignation(id);
      toast({ title: "已刪除職稱" });
      load();
    } catch (e: unknown) {
      toast({ title: "刪除失敗", description: e instanceof Error ? e.message : "未知錯誤", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="職稱管理" description="設定公司所有職稱" onAdd={openCreate} addLabel="新增職稱" />
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="職稱"
          entityEndpoint="designations"
          ids={batch.ids}
          batchFields={[]}
          onClear={batch.clearSelection}
          onComplete={() => load()}
        />
      )}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-10"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></TableHead>
                  <TableHead>職稱</TableHead>
                  <TableHead className="hidden sm:table-cell">所屬部門</TableHead>
                  <TableHead className="hidden md:table-cell">說明</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : designations.length > 0 ? (
                  designations.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell><CheckboxCell checked={batch.selectedIds.has(d.id)} onChange={() => batch.toggle(d.id)} /></TableCell>
                      <TableCell className="font-medium">{d.title}</TableCell>
                      <TableCell className="hidden sm:table-cell">{d.departmentName || "-"}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-sm">{d.description || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={d.isActive ? "default" : "secondary"}>
                          {d.isActive ? "啟用" : "停用"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(d)}><Pencil size={16} /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(d.id)}><Trash2 size={16} className="text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">尚無職稱資料</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "編輯職稱" : "新增職稱"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="title">職稱名稱 *</Label>
              <Input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例：資深工程師" />
            </div>
            <div>
              <Label htmlFor="description">說明</Label>
              <Input id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="職稱說明" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={!form.title}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
