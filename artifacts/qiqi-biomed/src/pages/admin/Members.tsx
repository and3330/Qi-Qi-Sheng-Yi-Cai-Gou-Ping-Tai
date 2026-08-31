import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminMembers,
  getListAdminMembersQueryKey,
  useUpdateAdminMember,
  useGetMe,
  getGetMeQueryKey,
  type AdminMember,
  type ListAdminMembersParams,
} from "@workspace/api-client-react";
import { Search, ShieldCheck, Ban, CheckCircle2, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "./AdminLayout";

const tierLabels: Record<string, string> = {
  hospital: "A 醫院",
  clinic: "B 診所/藥局",
  consumer: "C 消費者",
};

const tierBadgeClass: Record<string, string> = {
  hospital: "bg-blue-50 text-blue-700 border-blue-200",
  clinic: "bg-indigo-50 text-indigo-700 border-indigo-200",
  consumer: "bg-gray-50 text-gray-700 border-gray-200",
};

type EditState = {
  member: AdminMember;
  name: string;
  email: string;
  phone: string;
  tier: string;
  role: string;
  isActive: boolean;
  institutionVerified: boolean;
};

export default function AdminMembersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [edit, setEdit] = useState<EditState | null>(null);

  const params = useMemo(() => {
    const p: ListAdminMembersParams = {};
    if (search) p.search = search;
    if (tierFilter !== "all")
      p.tier = tierFilter as ListAdminMembersParams["tier"];
    return p;
  }, [search, tierFilter]);

  const { data: members, isLoading } = useListAdminMembers(params, {
    query: { queryKey: getListAdminMembersQueryKey(params) },
  });

  const updateMutation = useUpdateAdminMember({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListAdminMembersQueryKey(),
          exact: false,
        });
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        toast({ title: "已更新會員資料" });
        setEdit(null);
      },
      onError: (err: any) => {
        toast({
          title: "更新失敗",
          description: err?.data?.error ?? "請稍後再試",
          variant: "destructive",
        });
      },
    },
  });

  const quickUpdate = (member: AdminMember, data: Record<string, unknown>) => {
    updateMutation.mutate({ id: member.id, data });
  };

  const openEdit = (m: AdminMember) =>
    setEdit({
      member: m,
      name: m.name,
      email: m.email ?? "",
      phone: m.phone ?? "",
      tier: m.tier,
      role: m.role,
      isActive: m.isActive,
      institutionVerified: m.institutionVerified ?? false,
    });

  const submitEdit = () => {
    if (!edit) return;
    updateMutation.mutate({
      id: edit.member.id,
      data: {
        name: edit.name.trim() || edit.member.name,
        email: edit.email.trim() || null,
        phone: edit.phone.trim() || null,
        tier: edit.tier as any,
        role: edit.role as any,
        isActive: edit.isActive,
        institutionVerified: edit.institutionVerified,
      },
    });
  };

  return (
    <AdminLayout title="使用者管理">
      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <form
          className="relative flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜尋帳號、姓名、Email、電話…（按 Enter）"
            className="bg-white pl-9"
            data-testid="input-member-search"
          />
        </form>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger
            className="w-full bg-white sm:w-44"
            data-testid="select-tier-filter"
          >
            <SelectValue placeholder="全部等級" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部等級</SelectItem>
            <SelectItem value="hospital">A 醫院</SelectItem>
            <SelectItem value="clinic">B 診所/藥局</SelectItem>
            <SelectItem value="consumer">C 消費者</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : !members?.length ? (
        <div className="rounded-2xl border border-dashed bg-white py-16 text-center text-muted-foreground">
          找不到符合條件的會員
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">會員</th>
                  <th className="px-4 py-3 font-medium">聯絡方式</th>
                  <th className="px-4 py-3 font-medium">等級 / 院所</th>
                  <th className="px-4 py-3 font-medium">角色</th>
                  <th className="px-4 py-3 font-medium">狀態</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const isSelf = me?.id === m.id;
                  return (
                    <tr
                      key={m.id}
                      className="border-b last:border-0 hover:bg-muted/30"
                      data-testid={`row-member-${m.id}`}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium" data-testid={`text-member-name-${m.id}`}>
                          {m.name}
                          {isSelf && (
                            <span className="ml-1 text-xs text-muted-foreground">（我）</span>
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <p>{m.email || "—"}</p>
                        <p>{m.phone || ""}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <Badge
                            variant="outline"
                            className={tierBadgeClass[m.tier] ?? ""}
                          >
                            {tierLabels[m.tier] ?? m.tier}
                          </Badge>
                          {m.boundInstitutionId && (
                            <Badge
                              variant="secondary"
                              className={m.institutionVerified 
                                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" 
                                : "bg-amber-50 text-amber-700 hover:bg-amber-100"}
                            >
                              {m.institutionVerified ? "已審核" : "待審核"}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {m.role === "admin" ? (
                          <Badge className="gap-1 bg-primary/10 text-primary hover:bg-primary/10">
                            <ShieldCheck size={12} /> 管理員
                          </Badge>
                        ) : m.role === "ops" ? (
                          <Badge className="gap-1 bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200">
                            營運
                          </Badge>
                        ) : m.role === "support" ? (
                          <Badge className="gap-1 bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200">
                            客服
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">一般會員</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {m.isActive ? (
                          <Badge
                            variant="outline"
                            className="gap-1 border-green-200 bg-green-50 text-green-700"
                          >
                            <CheckCircle2 size={12} /> 啟用
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="gap-1 border-red-200 bg-red-50 text-red-700"
                          >
                            <Ban size={12} /> 停用
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEdit(m)}
                            data-testid={`button-edit-member-${m.id}`}
                          >
                            <Pencil size={14} className="mr-1" /> 編輯
                          </Button>
                          {!isSelf && (
                            <Button
                              size="sm"
                              variant={m.isActive ? "outline" : "default"}
                              className={m.isActive ? "text-destructive" : ""}
                              disabled={updateMutation.isPending}
                              onClick={() =>
                                quickUpdate(m, { isActive: !m.isActive })
                              }
                              data-testid={`button-toggle-active-${m.id}`}
                            >
                              {m.isActive ? "停用" : "啟用"}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!edit} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>編輯會員 — {edit?.member.name}</DialogTitle>
          </DialogHeader>
          {edit && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>姓名</Label>
                <Input
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  data-testid="input-edit-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    value={edit.email}
                    onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                    data-testid="input-edit-email"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>電話</Label>
                  <Input
                    value={edit.phone}
                    onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
                    data-testid="input-edit-phone"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>會員等級</Label>
                <Select
                  value={edit.tier}
                  onValueChange={(v) => setEdit({ ...edit, tier: v })}
                >
                  <SelectTrigger data-testid="select-edit-tier">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hospital">A 醫院</SelectItem>
                    <SelectItem value="clinic">B 診所/藥局</SelectItem>
                    <SelectItem value="consumer">C 消費者</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>系統角色權限</Label>
                <Select
                  value={edit.role}
                  onValueChange={(v) => setEdit({ ...edit, role: v })}
                  disabled={me?.role !== "admin" || me?.id === edit.member.id}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">系統管理員 (Admin)</SelectItem>
                    <SelectItem value="ops">營運 (Ops)</SelectItem>
                    <SelectItem value="support">客服 (Support)</SelectItem>
                    <SelectItem value="member">一般會員 (Member)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  後台權限由系統管理員分配，不同的角色會看到不同的功能選單。
                </p>
              </div>
              <div className="flex items-center justify-between rounded-xl border p-3">
                <div>
                  <p className="text-sm font-medium">帳號啟用</p>
                  <p className="text-xs text-muted-foreground">
                    停用後無法登入使用平台功能
                  </p>
                </div>
                <Switch
                  checked={edit.isActive}
                  disabled={me?.id === edit.member.id}
                  onCheckedChange={(checked) =>
                    setEdit({ ...edit, isActive: checked })
                  }
                  data-testid="switch-edit-active"
                />
              </div>
              
              {edit.member.boundInstitutionId && (
                <div className="flex items-center justify-between rounded-xl border p-3">
                  <div>
                    <p className="text-sm font-medium">院所綁定審核</p>
                    <p className="text-xs text-muted-foreground">
                      審核通過後即可查看全院所訂單及統整資料
                    </p>
                  </div>
                  <Switch
                    checked={edit.institutionVerified}
                    onCheckedChange={(checked) =>
                      setEdit({ ...edit, institutionVerified: checked })
                    }
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>
              取消
            </Button>
            <Button
              onClick={submitEdit}
              disabled={updateMutation.isPending}
              data-testid="button-save-member"
            >
              {updateMutation.isPending ? "儲存中…" : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
