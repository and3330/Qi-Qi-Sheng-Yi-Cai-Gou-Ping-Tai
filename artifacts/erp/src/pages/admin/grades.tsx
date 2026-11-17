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
import { adminApi, type Grade } from "@/lib/api";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useAutoReloadKey } from "@/lib/auto-refresh";

export default function GradesPage() {
  const reloadKey = useAutoReloadKey();
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Grade | null>(null);
  const [form, setForm] = useState({ name: "", level: "", minSalary: "", maxSalary: "", description: "" });
  const { toast } = useToast();
  const batch = useBatchSelection(grades);

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminApi.listGrades();
      setGrades(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, [reloadKey]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", level: "", minSalary: "", maxSalary: "", description: "" });
    setDialogOpen(true);
  };

  const openEdit = (g: Grade) => {
    setEditing(g);
    setForm({
      name: g.name,
      level: String(g.level),
      minSalary: g.minSalary ? String(g.minSalary) : "",
      maxSalary: g.maxSalary ? String(g.maxSalary) : "",
      description: g.description || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      const data = {
        name: form.name,
        level: Number(form.level),
        minSalary: form.minSalary ? Number(form.minSalary) : null,
        maxSalary: form.maxSalary ? Number(form.maxSalary) : null,
        description: form.description || null,
      };
      if (editing) {
        await adminApi.updateGrade(editing.id, data);
        toast({ title: "已更新職級" });
      } else {
        await adminApi.createGrade(data);
        toast({ title: "已新增職級" });
      }
      setDialogOpen(false);
      load();
    } catch (e: unknown) {
      toast({ title: "操作失敗", description: e instanceof Error ? e.message : "未知錯誤", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("確定要刪除此職級嗎？")) return;
    try {
      await adminApi.deleteGrade(id);
      toast({ title: "已刪除職級" });
      load();
    } catch (e: unknown) {
      toast({ title: "刪除失敗", description: e instanceof Error ? e.message : "未知錯誤", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="職級管理" description="設定公司職級與薪資範圍" onAdd={openCreate} addLabel="新增職級" />
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="職級"
          entityEndpoint="grades"
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
                  <TableHead>等級</TableHead>
                  <TableHead>職級名稱</TableHead>
                  <TableHead className="hidden sm:table-cell">最低薪資</TableHead>
                  <TableHead className="hidden sm:table-cell">最高薪資</TableHead>
                  <TableHead className="hidden md:table-cell">說明</TableHead>
                  <TableHead>在職人數</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : grades.length > 0 ? (
                  grades.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell><CheckboxCell checked={batch.selectedIds.has(g.id)} onChange={() => batch.toggle(g.id)} /></TableCell>
                      <TableCell>
                        <Badge variant="outline">L{g.level}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{g.name}</TableCell>
                      <TableCell className="hidden sm:table-cell">{g.minSalary ? `$${Number(g.minSalary).toLocaleString()}` : "-"}</TableCell>
                      <TableCell className="hidden sm:table-cell">{g.maxSalary ? `$${Number(g.maxSalary).toLocaleString()}` : "-"}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-sm">{g.description || "-"}</TableCell>
                      <TableCell>{(g as any).employeeCount ?? 0} 人</TableCell>
                      <TableCell>
                        <Badge variant={g.isActive ? "default" : "secondary"}>
                          {g.isActive ? "啟用" : "停用"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(g)}><Pencil size={16} /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(g.id)}><Trash2 size={16} className="text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">尚無職級資料</TableCell>
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
            <DialogTitle>{editing ? "編輯職級" : "新增職級"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">職級名稱 *</Label>
                <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例：G3 - 中級" />
              </div>
              <div>
                <Label htmlFor="level">等級 *</Label>
                <Input id="level" type="number" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} placeholder="1" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="minSalary">最低薪資</Label>
                <Input id="minSalary" type="number" value={form.minSalary} onChange={(e) => setForm({ ...form, minSalary: e.target.value })} placeholder="30000" />
              </div>
              <div>
                <Label htmlFor="maxSalary">最高薪資</Label>
                <Input id="maxSalary" type="number" value={form.maxSalary} onChange={(e) => setForm({ ...form, maxSalary: e.target.value })} placeholder="50000" />
              </div>
            </div>
            <div>
              <Label htmlFor="description">說明</Label>
              <Input id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="職級說明" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={!form.name || !form.level}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
