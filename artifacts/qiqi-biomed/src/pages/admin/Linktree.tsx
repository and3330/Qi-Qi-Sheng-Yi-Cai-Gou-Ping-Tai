import { useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminLinktree,
  useModerateLinktreeLink,
  getListAdminLinktreeQueryKey,
} from "@workspace/api-client-react";
import { AdminLayout } from "./AdminLayout";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function AdminLinktreePage() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const { data: rows, isLoading } = useListAdminLinktree(
    query ? { search: query } : undefined,
  );
  const { mutateAsync: moderate } = useModerateLinktreeLink();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { me } = useAuth();
  const canModerate = me?.role === "admin" || me?.role === "ops";

  const handleToggle = async (linkId: number, isActive: boolean) => {
    try {
      await moderate({ id: linkId, data: { isActive } });
      queryClient.invalidateQueries({ queryKey: getListAdminLinktreeQueryKey() });
      toast({ title: isActive ? "已重新啟用連結" : "已停用連結" });
    } catch {
      toast({ title: "操作失敗", variant: "destructive" });
    }
  };

  return (
    <AdminLayout title="Linktree 管理">
      <div className="space-y-4">
        <form
          className="flex max-w-sm items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
        >
          <Input
            placeholder="搜尋會員姓名或帳號"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-linktree-search"
          />
          <Button type="submit" variant="outline" size="icon" data-testid="button-linktree-search">
            <Search size={16} />
          </Button>
        </form>

        {isLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : !rows || rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            尚無會員建立連結頁
          </p>
        ) : (
          <div className="space-y-4">
            {rows.map((m) => (
              <div
                key={m.memberId}
                className="rounded-xl border bg-white p-4"
                data-testid={`card-linktree-member-${m.memberId}`}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <p className="font-bold">{m.memberName}</p>
                  <span className="text-xs text-muted-foreground">@{m.username}</span>
                  {!m.isMemberActive && <Badge variant="destructive">會員已停用</Badge>}
                  <Badge variant="secondary">
                    {m.activeLinkCount}/{m.linkCount} 啟用
                  </Badge>
                  <div className="flex-1" />
                  <a
                    href={`${import.meta.env.BASE_URL}u/${m.memberId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" size="sm" data-testid={`button-preview-${m.memberId}`}>
                      <ExternalLink size={14} className="mr-1" /> 預覽公開頁
                    </Button>
                  </a>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>標題</TableHead>
                      <TableHead>URL</TableHead>
                      <TableHead>類型</TableHead>
                      <TableHead className="text-right">啟用</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {m.links.map((l) => (
                      <TableRow key={l.id} data-testid={`row-admin-link-${l.id}`}>
                        <TableCell className="font-medium">
                          {l.icon ? `${l.icon} ` : ""}
                          {l.title}
                          {l.subtitle && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              {l.subtitle}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[280px]">
                          <a
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate text-xs text-primary underline"
                          >
                            {l.url}
                          </a>
                        </TableCell>
                        <TableCell className="text-xs">
                          {l.linkType}
                          {!l.isActive && (
                            <Badge variant="outline" className="ml-1 text-[10px]">
                              會員自行關閉
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {/* 管理員停用開關（isBlocked，會員無法自行解除） */}
                          <Switch
                            checked={!l.isBlocked}
                            disabled={!canModerate}
                            onCheckedChange={(v) => handleToggle(l.id, v)}
                            data-testid={`switch-admin-link-${l.id}`}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
