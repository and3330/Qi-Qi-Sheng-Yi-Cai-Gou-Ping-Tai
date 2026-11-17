import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Shield, ShieldCheck, Trash2, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { navGroups, topLevelNavs, type NavGroup } from "@/components/layout/sidebar";
import { ROLE_LABELS } from "@/lib/roles";

type Action = "view" | "create" | "edit" | "delete";
const ACTIONS: { key: Action; label: string }[] = [
  { key: "view", label: "檢視" },
  { key: "create", label: "新增" },
  { key: "edit", label: "修改" },
  { key: "delete", label: "刪除" },
];

interface CustomRole {
  id: string;
  name: string;
  description: string;
  baseRole: string;
  permissions: Record<string, Action[]>;
  userIds: number[];
}
interface AccountRow { id: number; username: string; displayName: string; role: string; customRoleId: string | null; customRoleName: string | null }
interface PageRow { group: string; folder: string; label: string; path: string; roles: readonly string[] | null }

const BASE_ROLE_HINT: Record<string, string> = {
  manager: "主管：可用大部分營運功能，不含薪資與會計帳",
  hr_admin: "人資管理員：員工、出勤、薪資相關功能",
  finance_admin: "財務管理員：會計、收付款、報表與薪資",
  accountant: "會計：會計、收付款與財務報表",
  viewer: "一般員工：基礎最少，適合只需要少數功能的人",
};
const BUILT_IN_HINT: Record<string, string> = {
  owner: "公司負責人，全部功能都能用，不能被限制",
  admin: "系統管理員，全部功能都能用，不能被限制",
  ...BASE_ROLE_HINT,
  viewer: "一般員工：只能檢視資料，不能新增、修改、刪除",
  employee: "員工自助：只能用自己的打卡、請假與個人資料",
};
const UNASSIGNABLE = ["owner", "admin", "super_admin", "employee"];

const api = async (path: string, init?: RequestInit) => {
  const response = await fetch(`/erp-api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "操作失敗");
  return data;
};

/** 把選單攤平成一頁一列，權限表就照選單的分類排 */
function flattenPages(): PageRow[] {
  const rows: PageRow[] = [];
  const groups = [{ groupLabel: "AI", items: topLevelNavs } as NavGroup, ...navGroups.filter((g) => g.groupLabel !== "員工自助")];
  for (const group of groups) {
    for (const item of group.items) {
      if (item.children?.length) {
        for (const child of item.children) {
          if (child.path) rows.push({ group: group.groupLabel, folder: item.label, label: child.label, path: child.path, roles: child.roles ?? item.roles ?? null });
        }
      } else if (item.path) {
        rows.push({ group: group.groupLabel, folder: "", label: item.label, path: item.path, roles: item.roles ?? null });
      }
    }
  }
  // 同一頁可能出現在兩個地方（例如打卡），只留一列
  return rows.filter((row, i) => rows.findIndex((r) => r.path === row.path) === i);
}

const emptyForm = { name: "", description: "", baseRole: "viewer", permissions: {} as Record<string, Action[]>, userIds: [] as number[] };

export default function RolesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const pages = useMemo(flattenPages, []);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [keyword, setKeyword] = useState("");

  const { data, isLoading } = useQuery<{ roles: CustomRole[]; baseRoles: string[] }>({ queryKey: ["/erp-api/roles"], queryFn: () => api("/roles") });
  const { data: accounts = [] } = useQuery<AccountRow[]>({ queryKey: ["/erp-api/admin/users"], queryFn: () => api("/admin/users") });
  const roles = data?.roles || [];
  const baseRoles = data?.baseRoles || Object.keys(BASE_ROLE_HINT);

  /** 基礎角色本來就進不去的頁面，勾了也沒用，所以鎖起來 */
  const usable = (row: PageRow) => !row.roles || row.roles.includes(form.baseRole);
  const usablePages = pages.filter(usable);

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setKeyword(""); setOpen(true); };
  const openEdit = (role: CustomRole) => {
    setEditingId(role.id);
    setForm({ name: role.name, description: role.description, baseRole: role.baseRole, permissions: { ...role.permissions }, userIds: [...role.userIds] });
    setKeyword("");
    setOpen(true);
  };

  const has = (path: string, action: Action) => (form.permissions[path] || []).includes(action);
  const setActions = (path: string, actions: Action[]) =>
    setForm((f) => {
      const permissions = { ...f.permissions };
      if (actions.length === 0) delete permissions[path]; else permissions[path] = actions;
      return { ...f, permissions };
    });
  const toggle = (path: string, action: Action) => {
    const current = form.permissions[path] || [];
    if (current.includes(action)) {
      // 拿掉「檢視」等於整頁都不能用
      setActions(path, action === "view" ? [] : current.filter((a) => a !== action));
    } else {
      // 要能新增、修改、刪除，一定要先看得到
      setActions(path, ACTIONS.map((a) => a.key).filter((a) => a === action || a === "view" || current.includes(a)));
    }
  };
  const fill = (rows: PageRow[], actions: Action[]) =>
    setForm((f) => {
      const permissions = { ...f.permissions };
      for (const row of rows) { if (actions.length === 0) delete permissions[row.path]; else permissions[row.path] = actions; }
      return { ...f, permissions };
    });

  const saveMutation = useMutation({
    mutationFn: () => {
      // 只送出基礎角色用得到的頁面
      const permissions: Record<string, Action[]> = {};
      for (const row of usablePages) if (form.permissions[row.path]?.length) permissions[row.path] = form.permissions[row.path];
      const body = JSON.stringify({ name: form.name, description: form.description, baseRole: form.baseRole, permissions, userIds: form.userIds });
      return editingId ? api(`/roles/${editingId}`, { method: "PATCH", body }) : api("/roles", { method: "POST", body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/erp-api/roles"] });
      queryClient.invalidateQueries({ queryKey: ["/erp-api/admin/users"] });
      setOpen(false);
      toast({ title: editingId ? "角色已更新" : "角色已建立", description: "套用這個角色的人重新整理頁面後生效" });
    },
    onError: (e: Error) => toast({ title: "儲存失敗", description: e.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/roles/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/erp-api/roles"] }); toast({ title: "角色已刪除" }); },
    onError: (e: Error) => toast({ title: "刪除失敗", description: e.message, variant: "destructive" }),
  });

  const submit = () => {
    if (!form.name.trim()) { toast({ title: "請填寫角色名稱", variant: "destructive" }); return; }
    if (!usablePages.some((row) => form.permissions[row.path]?.length)) {
      toast({ title: "請至少勾選一個功能", description: "一個功能都沒勾的角色登入後什麼都不能做", variant: "destructive" });
      return;
    }
    saveMutation.mutate();
  };

  const words = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visiblePages = pages.filter((row) => words.every((w) => `${row.group} ${row.folder} ${row.label}`.toLowerCase().includes(w)));
  const grouped = visiblePages.reduce<Record<string, PageRow[]>>((acc, row) => { (acc[row.group] ||= []).push(row); return acc; }, {});
  const assignable = accounts.filter((a) => !UNASSIGNABLE.includes(a.role));
  const checkedCount = usablePages.filter((row) => form.permissions[row.path]?.length).length;

  return (
    <div className="space-y-6">
      <PageHeader title="角色管理" description="自己建立角色，逐一勾選每個功能可以檢視、新增、修改或刪除" onAdd={openCreate} addLabel="新增角色" />

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck size={18} className="text-primary" />自訂角色</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">載入中…</p>
          ) : roles.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-10 text-center">
              <p className="mb-3 text-sm text-muted-foreground">還沒有自訂角色。例如可以建立「倉管」：只能看庫存、新增進貨單，其他都看不到。</p>
              <Button onClick={openCreate}><Plus size={16} className="mr-1" />新增第一個角色</Button>
            </div>
          ) : (
            <ul className="space-y-2.5" data-testid="custom-role-list">
              {roles.map((role) => {
                const pageCount = Object.keys(role.permissions).length;
                const members = accounts.filter((a) => role.userIds.includes(a.id));
                return (
                  <li key={role.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold">{role.name}</span>
                        <Badge variant="outline">基礎：{ROLE_LABELS[role.baseRole] || role.baseRole}</Badge>
                      </div>
                      {role.description && <p className="mt-0.5 text-sm text-muted-foreground">{role.description}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">
                        可用 {pageCount} 個功能　·　{members.length > 0 ? `套用：${members.map((m) => m.displayName).join("、")}` : "尚未套用到任何帳號"}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={() => openEdit(role)}><Pencil size={14} className="mr-1" />編輯</Button>
                      <Button
                        variant="outline" size="sm" className="text-red-600" disabled={deleteMutation.isPending}
                        onClick={() => { if (confirm(`確定刪除角色「${role.name}」？`)) deleteMutation.mutate(role.id); }}
                      >
                        <Trash2 size={14} className="mr-1" />刪除
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Shield size={18} className="text-muted-foreground" />內建角色（固定，不能修改）</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {Object.entries(BUILT_IN_HINT).map(([key, hint]) => (
              <div key={key} className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium">{ROLE_LABELS[key] || key}</dt>
                <dd className="text-muted-foreground">{hint.replace(/^[^：]+：/, "")}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-4xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "編輯角色" : "新增角色"}</DialogTitle></DialogHeader>

          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="role-name">角色名稱 <span className="text-red-500">*</span></Label>
                <Input id="role-name" value={form.name} maxLength={30} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="例如：倉管、業務助理" />
              </div>
              <div>
                <Label htmlFor="role-desc">說明</Label>
                <Input id="role-desc" value={form.description} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="這個角色負責什麼（選填）" />
              </div>
            </div>

            <div>
              <Label htmlFor="role-base">基礎角色</Label>
              <select
                id="role-base"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.baseRole}
                onChange={(e) => setForm((f) => ({ ...f, baseRole: e.target.value }))}
              >
                {baseRoles.map((key) => <option key={key} value={key}>{BASE_ROLE_HINT[key] || ROLE_LABELS[key] || key}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">基礎角色決定「最多能用到哪些功能」，下面的勾選只會再縮小範圍。灰色的功能表示這個基礎角色本來就不能用。</p>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Label className="mr-auto">功能權限 <span className="font-normal text-muted-foreground">（已勾 {checkedCount}／{usablePages.length} 個功能）</span></Label>
                <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜尋功能" className="h-9 w-36" aria-label="搜尋功能" />
                <Button type="button" variant="outline" size="sm" onClick={() => fill(usablePages, ["view"])}>全部只能檢視</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => fill(usablePages, ["view", "create", "edit", "delete"])}>全部勾選</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => fill(pages, [])}>全部清除</Button>
              </div>

              <div className="overflow-hidden rounded-lg border" data-no-cards>
                <div className="max-h-[45dvh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-muted">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">功能</th>
                        {ACTIONS.map((a) => <th key={a.key} className="w-14 px-1 py-2 text-center font-medium">{a.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(grouped).map(([group, rows]) => {
                        const groupUsable = rows.filter(usable);
                        return [
                          <tr key={`g-${group}`} className="border-t bg-muted/40">
                            <td className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">{group}</td>
                            <td colSpan={4} className="px-2 py-1 text-right">
                              <button type="button" className="mr-3 text-xs text-primary underline-offset-2 hover:underline" onClick={() => fill(groupUsable, ["view", "create", "edit", "delete"])}>整區勾選</button>
                              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => fill(rows, [])}>整區清除</button>
                            </td>
                          </tr>,
                          ...rows.map((row) => {
                            const disabled = !usable(row);
                            return (
                              <tr key={row.path} className={`border-t ${disabled ? "opacity-45" : ""}`}>
                                <td className="px-3 py-1.5">
                                  {row.folder && <span className="text-muted-foreground">{row.folder}／</span>}
                                  {row.label}
                                  {disabled && <span className="ml-2 text-xs text-muted-foreground">基礎角色不能用</span>}
                                </td>
                                {ACTIONS.map((a) => (
                                  <td key={a.key} className="px-1 py-1 text-center">
                                    <label className="inline-flex h-9 w-9 cursor-pointer items-center justify-center">
                                      <Checkbox
                                        checked={!disabled && has(row.path, a.key)}
                                        disabled={disabled}
                                        onCheckedChange={() => toggle(row.path, a.key)}
                                        aria-label={`${row.label} ${a.label}`}
                                      />
                                    </label>
                                  </td>
                                ))}
                              </tr>
                            );
                          }),
                        ];
                      })}
                      {visiblePages.length === 0 && (
                        <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">找不到符合的功能</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div>
              <Label className="flex items-center gap-1.5"><Users size={14} />套用到哪些帳號</Label>
              <p className="mb-2 mt-1 text-xs text-muted-foreground">擁有者、管理員、員工自助帳號不能套用自訂角色，所以不會出現在這裡。一個帳號只能有一個自訂角色。</p>
              {assignable.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">目前沒有可套用的帳號，請先到「帳號管理」新增。</p>
              ) : (
                <div className="grid gap-1 sm:grid-cols-2">
                  {assignable.map((account) => {
                    const checked = form.userIds.includes(account.id);
                    const elsewhere = account.customRoleId && account.customRoleId !== editingId ? account.customRoleName : null;
                    return (
                      <label key={account.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => setForm((f) => ({ ...f, userIds: checked ? f.userIds.filter((id) => id !== account.id) : [...f.userIds, account.id] }))}
                        />
                        <span className="min-w-0 flex-1 truncate">{account.displayName}<span className="ml-1.5 text-xs text-muted-foreground">{account.username}</span></span>
                        {elsewhere && <span className="shrink-0 text-xs text-amber-600">目前是「{elsewhere}」</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={submit} disabled={saveMutation.isPending}>{saveMutation.isPending ? "儲存中…" : editingId ? "儲存" : "建立角色"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
