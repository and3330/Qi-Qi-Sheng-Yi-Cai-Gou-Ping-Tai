import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListNewsletterSubscribers,
  getListNewsletterSubscribersQueryKey,
  useCreateNewsletterSubscriber,
  useUpdateNewsletterSubscriber,
  useDeleteNewsletterSubscriber,
  useImportNewsletterSubscribers,
  type NewsletterSubscriber,
} from "@workspace/api-client-react";
import { Plus, Search, Trash2, Pencil, Upload, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "./AdminLayout";
import { ResendConfigBanner } from "./NewsletterDomains";

function errMessage(e: unknown, fallback: string) {
  const anyE = e as any;
  return anyE?.data?.error || anyE?.message || fallback;
}

function parseTags(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,;、\s]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  );
}

export default function NewsletterSubscribers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: subscribers, isLoading } = useListNewsletterSubscribers();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListNewsletterSubscribersQueryKey() });

  const createSub = useCreateNewsletterSubscriber();
  const updateSub = useUpdateNewsletterSubscriber();
  const deleteSub = useDeleteNewsletterSubscriber();
  const importSubs = useImportNewsletterSubscribers();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NewsletterSubscriber | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [status, setStatus] = useState("subscribed");

  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [importTags, setImportTags] = useState("");

  const allTags = useMemo(() => {
    const s = new Set<string>();
    subscribers?.forEach((sub) => sub.tags?.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [subscribers]);
  const [tagFilter, setTagFilter] = useState<string>("all");

  const list = (subscribers ?? []).filter((s) => {
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    if (tagFilter !== "all" && !s.tags?.includes(tagFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.email.toLowerCase().includes(q) && !(s.name ?? "").toLowerCase().includes(q))
        return false;
    }
    return true;
  });

  const openCreate = () => {
    setEditing(null);
    setEmail("");
    setName("");
    setTagsRaw("");
    setStatus("subscribed");
    setFormOpen(true);
  };
  const openEdit = (s: NewsletterSubscriber) => {
    setEditing(s);
    setEmail(s.email);
    setName(s.name ?? "");
    setTagsRaw((s.tags ?? []).join(", "));
    setStatus(s.status);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast({ title: "請輸入有效的 Email", variant: "destructive" });
      return;
    }
    try {
      if (editing) {
        await updateSub.mutateAsync({
          id: editing.id,
          data: {
            email: email.trim(),
            name: name.trim() || null,
            tags: parseTags(tagsRaw),
            status: status as "subscribed" | "unsubscribed",
          },
        });
        toast({ title: "訂閱者已更新" });
      } else {
        await createSub.mutateAsync({
          data: { email: email.trim(), name: name.trim() || null, tags: parseTags(tagsRaw) },
        });
        toast({ title: "訂閱者已新增", description: "已自動加入啟用中的自動序列" });
      }
      setFormOpen(false);
      invalidate();
    } catch (e) {
      toast({ title: "儲存失敗", description: errMessage(e, ""), variant: "destructive" });
    }
  };

  const handleImport = async () => {
    if (!csv.trim()) {
      toast({ title: "請貼上 CSV 內容或選擇檔案", variant: "destructive" });
      return;
    }
    try {
      const result = await importSubs.mutateAsync({
        data: { csv, tags: parseTags(importTags) },
      });
      toast({
        title: `匯入完成：成功 ${result.imported} 筆，略過 ${result.skipped} 筆`,
        description: result.errors?.length ? result.errors.slice(0, 3).join("；") : undefined,
      });
      setImportOpen(false);
      setCsv("");
      setImportTags("");
      invalidate();
    } catch (e) {
      toast({ title: "匯入失敗", description: errMessage(e, ""), variant: "destructive" });
    }
  };

  return (
    <AdminLayout title="電子報・訂閱者">
      <ResendConfigBanner />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-56 pl-9"
            placeholder="搜尋 Email 或姓名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-subscriber-search"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32" data-testid="select-subscriber-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部狀態</SelectItem>
            <SelectItem value="subscribed">已訂閱</SelectItem>
            <SelectItem value="unsubscribed">已退訂</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tagFilter} onValueChange={setTagFilter}>
          <SelectTrigger className="w-36" data-testid="select-subscriber-tag">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部標籤</SelectItem>
            {allTags.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} data-testid="button-import-subscribers">
            <Upload size={16} /> CSV 匯入
          </Button>
          <Button size="sm" onClick={openCreate} data-testid="button-add-subscriber">
            <Plus size={16} /> 新增訂閱者
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-white">
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : !list.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground" data-testid="text-no-subscribers">
            {subscribers?.length ? "沒有符合條件的訂閱者" : "尚無訂閱者，可手動新增或用 CSV 匯入。"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="p-3">Email</th>
                  <th className="p-3">姓名</th>
                  <th className="p-3">標籤</th>
                  <th className="p-3">狀態</th>
                  <th className="p-3">來源</th>
                  <th className="p-3">加入時間</th>
                  <th className="p-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className="border-b last:border-0" data-testid={`row-subscriber-${s.id}`}>
                    <td className="p-3 font-medium">{s.email}</td>
                    <td className="p-3">{s.name ?? "-"}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {(s.tags ?? []).map((t) => (
                          <Badge key={t} variant="secondary" className="text-xs">
                            <Tag size={10} className="mr-1" />
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-3">
                      {s.status === "subscribed" ? (
                        <Badge className="bg-green-100 text-green-700" variant="secondary">已訂閱</Badge>
                      ) : (
                        <Badge className="bg-muted text-muted-foreground" variant="secondary">已退訂</Badge>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {s.source === "import" ? "匯入" : s.source === "api" ? "API" : "手動"}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : "-"}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(s)} data-testid={`button-edit-subscriber-${s.id}`}>
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600"
                          onClick={async () => {
                            if (!confirm(`確定刪除 ${s.email}？`)) return;
                            try {
                              await deleteSub.mutateAsync({ id: s.id });
                              invalidate();
                              toast({ title: "已刪除訂閱者" });
                            } catch (e) {
                              toast({ title: "刪除失敗", description: errMessage(e, ""), variant: "destructive" });
                            }
                          }}
                          data-testid={`button-delete-subscriber-${s.id}`}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "編輯訂閱者" : "新增訂閱者"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" data-testid="input-subscriber-email" />
            </div>
            <div className="space-y-1.5">
              <Label>姓名（選填）</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-subscriber-name" />
            </div>
            <div className="space-y-1.5">
              <Label>標籤（以逗號分隔）</Label>
              <Input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="vip, 診所" data-testid="input-subscriber-tags" />
            </div>
            {editing && (
              <div className="space-y-1.5">
                <Label>狀態</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger data-testid="select-edit-subscriber-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="subscribed">已訂閱</SelectItem>
                    <SelectItem value="unsubscribed">已退訂</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={createSub.isPending || updateSub.isPending} data-testid="button-save-subscriber">
              儲存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>CSV 匯入訂閱者</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>CSV 檔案</Label>
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = () => setCsv(String(reader.result ?? ""));
                  reader.readAsText(f);
                }}
                data-testid="input-import-file"
              />
            </div>
            <div className="space-y-1.5">
              <Label>或直接貼上內容</Label>
              <Textarea
                rows={6}
                placeholder={"email,姓名,標籤\nuser@example.com,王小明,vip;診所"}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                data-testid="textarea-import-csv"
              />
              <p className="text-xs text-muted-foreground">
                每行一筆：Email, 姓名（選填）, 標籤（選填，以 ; 分隔）。重複 Email 會自動略過。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>另外套用標籤（選填，以逗號分隔）</Label>
              <Input value={importTags} onChange={(e) => setImportTags(e.target.value)} data-testid="input-import-tags" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>取消</Button>
            <Button onClick={handleImport} disabled={importSubs.isPending} data-testid="button-confirm-import">
              {importSubs.isPending ? "匯入中…" : "開始匯入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
