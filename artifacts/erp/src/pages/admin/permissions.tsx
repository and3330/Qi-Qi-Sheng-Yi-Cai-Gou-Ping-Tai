import { useState, useEffect } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Trash2, Shield, ShieldCheck, Link2 } from "lucide-react";
import { adminApi, type AdminUser } from "@/lib/api";
import { useListEmployees } from "@workspace/erp-api-client-react";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/roles";

import { LookupSelect } from "@/components/shared/lookup-select";
const roleLabels = ROLE_LABELS;

export default function PermissionsPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [form, setForm] = useState({ username: "", password: "", displayName: "", role: "admin", employeeId: "" as string });
  const { toast } = useToast();
  const { data: employees } = useListEmployees();

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminApi.listUsers();
      setUsers(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ username: "", password: "", displayName: "", role: "admin", employeeId: "" });
    setDialogOpen(true);
  };

  const openEdit = (u: AdminUser) => {
    setEditing(u);
    setForm({ username: u.username, password: "", displayName: u.displayName, role: u.role, employeeId: u.employeeId ? String(u.employeeId) : "" });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        const updates: Record<string, unknown> = {
          displayName: form.displayName,
          role: form.role,
          employeeId: form.employeeId ? Number(form.employeeId) : null,
        };
        if (form.password) updates.password = form.password;
        await adminApi.updateUser(editing.id, updates);
        toast({ title: "已更新管理員" });
      } else {
        await adminApi.createUser({
          username: form.username,
          password: form.password,
          displayName: form.displayName,
          role: form.role,
          employeeId: form.employeeId ? Number(form.employeeId) : null,
        });
        toast({ title: "已新增管理員" });
      }
      setDialogOpen(false);
      load();
    } catch (e: unknown) {
      toast({ title: "操作失敗", description: e instanceof Error ? e.message : "未知錯誤", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("確定要刪除此管理員嗎？")) return;
    try {
      await adminApi.deleteUser(id);
      toast({ title: "已刪除管理員" });
      load();
    } catch (e: unknown) {
      toast({ title: "刪除失敗", description: e instanceof Error ? e.message : "未知錯誤", variant: "destructive" });
    }
  };

  const toggleActive = async (u: AdminUser) => {
    try {
      await adminApi.updateUser(u.id, { isActive: !u.isActive });
      toast({ title: u.isActive ? "已停用帳號" : "已啟用帳號" });
      load();
    } catch (e: unknown) {
      toast({ title: "操作失敗", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="帳號管理" description="管理登入帳號與內建角色；要自訂每個功能的權限，請到「角色管理」" onAdd={openCreate} addLabel="新增帳號" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck size={18} className="text-primary" />
            管理員帳號列表
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>帳號</TableHead>
                  <TableHead>顯示名稱</TableHead>
                  <TableHead>綁定員工</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : users.length > 0 ? (
                  users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-mono text-sm">{u.username}</TableCell>
                      <TableCell className="font-medium">{u.displayName}</TableCell>
                      <TableCell>
                        {u.employeeName ? (
                          <Badge variant="outline" className="gap-1">
                            <Link2 size={12} />
                            {u.employeeName}
                            <span className="font-mono text-xs text-muted-foreground ml-1">{u.employeeCode}</span>
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">未綁定</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1">
                          <Shield size={12} />
                          {roleLabels[u.role] || u.role}
                        </Badge>
                        {(u as any).customRoleName && (
                          <Badge className="ml-1.5" data-testid={`badge-custom-role-${u.id}`}>自訂：{(u as any).customRoleName}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={u.isActive ? "default" : "secondary"}
                          className="cursor-pointer"
                          onClick={() => toggleActive(u)}
                        >
                          {u.isActive ? "啟用" : "停用"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(u)}><Pencil size={16} /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(u.id)}><Trash2 size={16} className="text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">尚無管理員</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">角色說明</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(roleLabels).map(([key, label]) => (
              <div key={key} className="border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Shield size={14} className="text-primary" />
                  <span className="font-medium text-sm">{label}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {ROLE_DESCRIPTIONS[key]}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "編輯管理員" : "新增管理員"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="username">帳號 *</Label>
              <Input
                id="username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="輸入帳號"
                disabled={!!editing}
              />
            </div>
            <div>
              <Label htmlFor="password">{editing ? "新密碼（留空則不變更）" : "密碼 *"}</Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={editing ? "留空則不變更" : "輸入密碼"}
              />
            </div>
            <div>
              <Label htmlFor="displayName">顯示名稱 *</Label>
              <Input
                id="displayName"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="輸入顯示名稱"
              />
            </div>
            <div>
              <Label htmlFor="role">角色</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(roleLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="employeeId">綁定員工（選填）</Label>
              <LookupSelect value={form.employeeId || "__none__"} onValueChange={(v) => setForm({ ...form, employeeId: v === "__none__" ? "" : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="未綁定" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未綁定</SelectItem>
                  {(employees || []).map((e: any) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.firstName}{e.lastName}（{e.employeeId}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </LookupSelect>
              <p className="text-xs text-muted-foreground mt-1">綁定後此帳號將與員工資料連動，刪除員工會自動停用對應帳號。</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button
              onClick={handleSave}
              disabled={!form.displayName || (!editing && (!form.username || !form.password))}
            >
              儲存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
