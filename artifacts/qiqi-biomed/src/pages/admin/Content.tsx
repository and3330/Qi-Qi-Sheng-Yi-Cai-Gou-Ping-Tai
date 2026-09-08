import { useState } from "react";
import { 
  useListAdminArticles,
  useCreateAdminArticle,
  useUpdateAdminArticle,
  useListAdminAnnouncements,
  useCreateAdminAnnouncement,
  useUpdateAdminAnnouncement,
  useListAdminContentRevisions,
  useGetAdminContentRevisionComparison,
  useRestoreAdminContentRevision,
  getListAdminArticlesQueryKey,
  getListAdminAnnouncementsQueryKey,
  getListAdminContentRevisionsQueryKey,
  type AdminArticle,
  type AdminAnnouncement,
  type ContentRevision,
  type ContentRevisionSnapshot
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, History, FileText, Bell, Archive, RotateCcw, GitCompareArrows } from "lucide-react";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { diffText } from "@/lib/textDiff";

function StatusBadge({ status }: { status: string }) {
  switch(status) {
    case 'draft': return <Badge variant="outline" className="bg-gray-100 text-gray-600">草稿</Badge>;
    case 'review': return <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200">送審中</Badge>;
    case 'published': return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200">已上架</Badge>;
    case 'archived': return <Badge variant="outline" className="bg-slate-100 text-slate-500">已下架</Badge>;
    default: return <Badge>{status}</Badge>;
  }
}

function DiffValue({ before, after, side }: { before: string | null | undefined; after: string | null | undefined; side: "before" | "after" }) {
  const oldValue = before || "";
  const newValue = after || "";
  if (oldValue === newValue) return <span>{oldValue || "—"}</span>;
  const visible = diffText(oldValue, newValue).filter((part) =>
    part.kind === "same" || (side === "before" ? part.kind === "removed" : part.kind === "added")
  );
  return (
    <span>
      {!visible.length ? <span className="text-muted-foreground">—</span> : visible.map((part, index) => (
        <span
          key={index}
          className={part.kind === "removed"
            ? "rounded-sm bg-red-100 px-0.5 text-red-800 line-through decoration-red-500"
            : part.kind === "added"
              ? "rounded-sm bg-emerald-100 px-0.5 text-emerald-800"
              : undefined}
        >
          {part.value}
        </span>
      ))}
    </span>
  );
}

function ComparisonDialog({ revision, onClose, onRestore }: { revision: ContentRevision; onClose: () => void; onRestore: (revision: ContentRevision) => void }) {
  const { data, isLoading, isError } = useGetAdminContentRevisionComparison(revision.id);
  const fields: Array<{ key: keyof ContentRevisionSnapshot; label: string; multiline?: boolean }> = [
    { key: "title", label: "標題" },
    { key: "category", label: "分類" },
    ...(revision.entityKind === "article" ? [{ key: "summary" as const, label: "摘要", multiline: true }] : []),
    { key: "content", label: "內文", multiline: true },
    { key: "status", label: "狀態" },
  ];
  const changedCount = data
    ? fields.filter(({ key }) => (data.revision[key] || "") !== (data.current[key] || "")).length
    : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden rounded-2xl p-0">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>比較版本與目前內容</DialogTitle>
          <p className="text-sm text-muted-foreground">
            紅色刪除線是此版本將移除的內容，綠色是還原後將加入的內容。
          </p>
        </DialogHeader>
        <div className="max-h-[calc(90vh-150px)] overflow-y-auto px-4 py-4 sm:px-6">
          {isLoading ? <Skeleton className="h-72 w-full" /> : isError || !data ? (
            <p className="py-12 text-center text-sm text-destructive">無法載入差異，請稍後再試。</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={changedCount ? "secondary" : "outline"}>
                  {changedCount ? `${changedCount} 個欄位不同` : "內容完全相同"}
                </Badge>
                <span className="text-muted-foreground">版本時間：{new Date(data.revision.createdAt).toLocaleString("zh-TW")}</span>
              </div>
              {fields.map(({ key, label, multiline }) => {
                const before = data.revision[key];
                const after = data.current[key];
                const changed = (before || "") !== (after || "");
                return (
                  <section key={key} className={`overflow-hidden rounded-xl border ${changed ? "border-amber-200" : "border-border"}`}>
                    <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                      <h3 className="text-sm font-semibold">{label}</h3>
                      <Badge variant="outline" className={changed ? "border-amber-300 bg-amber-50 text-amber-700" : "text-muted-foreground"}>
                        {changed ? (!before ? "新增" : !after ? "刪除" : "變更") : "未變更"}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                      <div className={`min-w-0 p-3 ${key === "status" && changed ? "bg-emerald-50/60" : ""}`}>
                        <div className="mb-2 text-xs font-medium text-muted-foreground">指定版本（還原後）</div>
                        {key === "status" ? <StatusBadge status={String(before)} /> : (
                          <div className={`${multiline ? "max-h-64 overflow-y-auto whitespace-pre-wrap" : ""} break-words text-sm leading-6`}>
                            <DiffValue before={after} after={before} side="after" />
                          </div>
                        )}
                      </div>
                      <div className={`min-w-0 p-3 ${key === "status" && changed ? "bg-red-50/60" : "bg-slate-50/60"}`}>
                        <div className="mb-2 text-xs font-medium text-muted-foreground">目前內容</div>
                        {key === "status" ? <StatusBadge status={String(after)} /> : (
                          <div className={`${multiline ? "max-h-64 overflow-y-auto whitespace-pre-wrap" : ""} break-words text-sm leading-6`}>
                            <DiffValue before={after} after={before} side="before" />
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter className="border-t px-5 py-3">
          <Button variant="outline" onClick={onClose}>關閉</Button>
          <Button disabled={!data} onClick={() => onRestore(revision)}>
            <RotateCcw size={14} className="mr-1" /> 還原此版本
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevisionsDialog({ entityKind, entityId, onClose }: { entityKind: "article" | "announcement", entityId: number, onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: revisions, isLoading } = useListAdminContentRevisions({ entityKind, entityId });
  const restoreRevision = useRestoreAdminContentRevision();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [comparisonTarget, setComparisonTarget] = useState<ContentRevision | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ContentRevision | null>(null);
  const [error, setError] = useState("");

  async function handleRestore() {
    if (!restoreTarget) return;
    setError("");
    try {
      await restoreRevision.mutateAsync({ id: restoreTarget.id });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getListAdminContentRevisionsQueryKey({ entityKind, entityId }),
        }),
        queryClient.invalidateQueries({
          queryKey: entityKind === "article"
            ? getListAdminArticlesQueryKey()
            : getListAdminAnnouncementsQueryKey(),
        }),
      ]);
      setRestoreTarget(null);
    } catch {
      setError("還原失敗，請稍後再試。");
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !restoreRevision.isPending && onClose()}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle>版本紀錄</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !revisions?.length ? (
            <p className="text-center text-muted-foreground py-8">無版本紀錄</p>
          ) : (
            <div className="relative border-l border-muted ml-3 space-y-6">
              {revisions.map((r: ContentRevision) => (
                <div key={r.id} className="relative pl-6">
                  <div className="absolute -left-1.5 top-1.5 w-3 h-3 rounded-full bg-primary/20 border-2 border-primary" />
                  <div className="text-xs text-muted-foreground mb-1">
                    {new Date(r.createdAt).toLocaleString('zh-TW')}
                  </div>
                  <div className="font-medium text-sm text-gray-900 mb-1">{r.title}</div>
                  <div className="flex gap-2 items-center">
                    <StatusBadge status={r.status} />
                    {r.note && <span className="text-xs text-muted-foreground bg-muted/30 px-2 py-0.5 rounded">{r.note}</span>}
                  </div>
                   <div className="mt-3 flex flex-wrap gap-2">
                     <Button type="button" size="sm" variant="outline" onClick={() => setComparisonTarget(r)}>
                       <GitCompareArrows size={14} className="mr-1" /> 比較目前版本
                     </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                      {expandedId === r.id ? "收合內容" : "查看完整內容"}
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => { setError(""); setRestoreTarget(r); }}>
                      <RotateCcw size={14} className="mr-1" /> 還原此版本
                    </Button>
                  </div>
                  {expandedId === r.id && (
                    <div className="mt-3 space-y-3 rounded-xl border bg-muted/20 p-4 text-sm">
                      <div><span className="font-medium">標題：</span>{r.title}</div>
                      <div><span className="font-medium">分類：</span>{r.category || "—"}</div>
                      {entityKind === "article" && (
                        <div>
                          <div className="font-medium mb-1">摘要：</div>
                          <div className="whitespace-pre-wrap break-words">{r.summary || "—"}</div>
                        </div>
                      )}
                      <div>
                        <div className="font-medium mb-1">完整內容：</div>
                        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3">
                          {r.content || "—"}
                        </div>
                      </div>
                      <div><span className="font-medium">狀態：</span><StatusBadge status={r.status} /></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
      </Dialog>
      {comparisonTarget && (
        <ComparisonDialog
          revision={comparisonTarget}
          onClose={() => setComparisonTarget(null)}
          onRestore={(revision) => {
            setComparisonTarget(null);
            setError("");
            setRestoreTarget(revision);
          }}
        />
      )}
      <AlertDialog open={Boolean(restoreTarget)} onOpenChange={(open) => !open && !restoreRevision.isPending && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定要還原這個版本？</AlertDialogTitle>
            <AlertDialogDescription>
              將把目前內容改為「{restoreTarget?.title}」的版本，並新增一筆還原紀錄；既有版本不會被覆蓋或刪除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoreRevision.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoreRevision.isPending}
              onClick={(event) => {
                event.preventDefault();
                void handleRestore();
              }}
            >
              {restoreRevision.isPending ? "還原中…" : "確認還原"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type EditableContent =
  | { kind: "article"; item: AdminArticle }
  | { kind: "announcement"; item: AdminAnnouncement };

function ContentDialog({
  kind,
  item,
  onClose,
}: {
  kind: "article" | "announcement";
  item?: AdminArticle | AdminAnnouncement;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const createArticle = useCreateAdminArticle();
  const updateArticle = useUpdateAdminArticle();
  const createAnnouncement = useCreateAdminAnnouncement();
  const updateAnnouncement = useUpdateAdminAnnouncement();
  const article = kind === "article" && item ? item as AdminArticle : undefined;
  const [articleKind, setArticleKind] = useState<"article" | "faq">(article?.kind ?? "article");
  const [title, setTitle] = useState(item?.title ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [content, setContent] = useState(item?.content ?? "");
  const [imageUrl, setImageUrl] = useState(item?.imageUrl ?? "");
  const [status, setStatus] = useState<"draft" | "review" | "published" | "archived">(item?.status ?? "draft");
  const [error, setError] = useState("");
  const isEditing = Boolean(item);
  const isPending = createArticle.isPending || updateArticle.isPending
    || createAnnouncement.isPending || updateAnnouncement.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    try {
      if (kind === "article") {
        const data = {
          kind: articleKind,
          title: title.trim(),
          category: category.trim(),
          summary: summary.trim() || null,
          content: content.trim() || null,
          imageUrl: imageUrl.trim() || null,
          status,
        };
        if (item) await updateArticle.mutateAsync({ id: item.id, data });
        else await createArticle.mutateAsync({ data });
        await queryClient.invalidateQueries({ queryKey: getListAdminArticlesQueryKey() });
      } else {
        const data = {
          title: title.trim(),
          category: category.trim(),
          content: content.trim() || null,
          imageUrl: imageUrl.trim() || null,
          status,
        };
        if (item) await updateAnnouncement.mutateAsync({ id: item.id, data });
        else await createAnnouncement.mutateAsync({ data });
        await queryClient.invalidateQueries({ queryKey: getListAdminAnnouncementsQueryKey() });
      }
      if (item) {
        await queryClient.invalidateQueries({
          queryKey: getListAdminContentRevisionsQueryKey({
            entityKind: kind,
            entityId: item.id,
          }),
        });
      }
      onClose();
    } catch {
      setError(`${isEditing ? "儲存" : "建立"}失敗，請確認欄位內容後再試一次。`);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "編輯" : "新增"}{kind === "article" ? "文章／FAQ" : "公告"}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {kind === "article" && (
            <div className="space-y-2">
              <Label htmlFor="content-kind">內容類型</Label>
              <select
                id="content-kind"
                value={articleKind}
                onChange={(event) => setArticleKind(event.target.value as "article" | "faq")}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="article">文章</option>
                <option value="faq">FAQ</option>
              </select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="content-title">標題</Label>
            <Input
              id="content-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="content-category">分類</Label>
            <Input
              id="content-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              maxLength={50}
              required
            />
          </div>
          {kind === "article" && (
            <div className="space-y-2">
              <Label htmlFor="content-summary">摘要</Label>
              <Textarea
                id="content-summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                maxLength={500}
                rows={3}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="content-body">內容（Markdown）</Label>
            <Textarea
              id="content-body"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="content-image">圖片網址</Label>
            <Input
              id="content-image"
              type="url"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              maxLength={500}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="content-status">狀態</Label>
            <select
              id="content-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="draft">草稿</option>
              <option value="review">送審中</option>
              <option value="published">立即上架</option>
              {isEditing && <option value="archived">下架</option>}
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              取消
            </Button>
            <Button type="submit" disabled={isPending || !title.trim() || !category.trim()}>
              {isPending ? "儲存中…" : isEditing ? "儲存變更" : "建立"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveContentDialog({
  target,
  onClose,
}: {
  target: EditableContent;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const updateArticle = useUpdateAdminArticle();
  const updateAnnouncement = useUpdateAdminAnnouncement();
  const [error, setError] = useState("");
  const isPending = updateArticle.isPending || updateAnnouncement.isPending;

  async function handleArchive() {
    setError("");
    try {
      if (target.kind === "article") {
        await updateArticle.mutateAsync({ id: target.item.id, data: { status: "archived" } });
        await queryClient.invalidateQueries({ queryKey: getListAdminArticlesQueryKey() });
      } else {
        await updateAnnouncement.mutateAsync({ id: target.item.id, data: { status: "archived" } });
        await queryClient.invalidateQueries({ queryKey: getListAdminAnnouncementsQueryKey() });
      }
      await queryClient.invalidateQueries({
        queryKey: getListAdminContentRevisionsQueryKey({
          entityKind: target.kind,
          entityId: target.item.id,
        }),
      });
      onClose();
    } catch {
      setError("下架失敗，請稍後再試。");
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>確定要下架這筆內容？</AlertDialogTitle>
          <AlertDialogDescription>
            「{target.item.title}」下架後將不再對外顯示，但資料與版本紀錄都會保留，之後仍可重新編輯上架。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={(event) => {
              event.preventDefault();
              void handleArchive();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? "下架中…" : "確認下架"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function AdminContentPage() {
  const [tab, setTab] = useState<"articles" | "announcements">("articles");
  const [revTarget, setRevTarget] = useState<{kind: "article"|"announcement", id: number} | null>(null);
  const [createKind, setCreateKind] = useState<"article" | "announcement" | null>(null);
  const [editTarget, setEditTarget] = useState<EditableContent | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<EditableContent | null>(null);

  const { data: articles, isLoading: loadingArticles } = useListAdminArticles();
  const { data: announcements, isLoading: loadingAnnouncements } = useListAdminAnnouncements();

  return (
    <AdminLayout title="內容管理 (CMS)">
      <div className="mb-6 flex gap-4 border-b">
        <button
          className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${tab === 'articles' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => setTab('articles')}
        >
          <FileText size={16} /> 文章與 FAQ
        </button>
        <button
          className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${tab === 'announcements' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => setTab('announcements')}
        >
          <Bell size={16} /> 平台公告
        </button>
      </div>

      <div className="flex justify-between items-center mb-4">
        <h2 className="font-bold text-lg">{tab === 'articles' ? '文章列表' : '公告列表'}</h2>
        <Button
          type="button"
          size="sm"
          className="rounded-xl"
          onClick={() => setCreateKind(tab === "articles" ? "article" : "announcement")}
        >
          <Plus size={16} className="mr-1" /> 新增{tab === 'articles' ? '文章' : '公告'}
        </Button>
      </div>

      <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-muted/50 border-b">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">標題</th>
                <th className="px-4 py-3 font-medium">分類</th>
                <th className="px-4 py-3 font-medium">狀態</th>
                <th className="px-4 py-3 font-medium">發布時間</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {tab === 'articles' ? (
                loadingArticles ? (
                  <tr><td colSpan={5} className="p-4"><Skeleton className="h-10 w-full" /></td></tr>
                ) : !articles?.length ? (
                  <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">目前無文章</td></tr>
                ) : (
                  articles.map((a: AdminArticle) => (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">
                        <div className="flex items-center gap-2">
                          {a.kind === 'faq' ? <Badge variant="secondary" className="text-[10px]">FAQ</Badge> : null}
                          {a.title}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{a.category}</td>
                      <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {new Date(a.publishedAt || a.updatedAt).toLocaleString('zh-TW')}
                      </td>
                      <td className="px-4 py-3 text-right space-x-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setRevTarget({kind: 'article', id: a.id})}>
                          <History size={16} />
                        </Button>
                        <Button aria-label={`編輯 ${a.title}`} variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => setEditTarget({ kind: "article", item: a })}>
                          <Pencil size={16} />
                        </Button>
                        {a.status !== "archived" && (
                          <Button aria-label={`下架 ${a.title}`} variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setArchiveTarget({ kind: "article", item: a })}>
                            <Archive size={16} />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )
              ) : (
                loadingAnnouncements ? (
                  <tr><td colSpan={5} className="p-4"><Skeleton className="h-10 w-full" /></td></tr>
                ) : !announcements?.length ? (
                  <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">目前無公告</td></tr>
                ) : (
                  announcements.map((a: AdminAnnouncement) => (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{a.title}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.category}</td>
                      <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {new Date(a.publishedAt || a.updatedAt).toLocaleString('zh-TW')}
                      </td>
                      <td className="px-4 py-3 text-right space-x-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setRevTarget({kind: 'announcement', id: a.id})}>
                          <History size={16} />
                        </Button>
                        <Button aria-label={`編輯 ${a.title}`} variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => setEditTarget({ kind: "announcement", item: a })}>
                          <Pencil size={16} />
                        </Button>
                        {a.status !== "archived" && (
                          <Button aria-label={`下架 ${a.title}`} variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setArchiveTarget({ kind: "announcement", item: a })}>
                            <Archive size={16} />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      {revTarget && (
        <RevisionsDialog 
          entityKind={revTarget.kind} 
          entityId={revTarget.id} 
          onClose={() => setRevTarget(null)} 
        />
      )}
      {createKind && (
        <ContentDialog kind={createKind} onClose={() => setCreateKind(null)} />
      )}
      {editTarget && (
        <ContentDialog
          key={`${editTarget.kind}-${editTarget.item.id}`}
          kind={editTarget.kind}
          item={editTarget.item}
          onClose={() => setEditTarget(null)}
        />
      )}
      {archiveTarget && (
        <ArchiveContentDialog target={archiveTarget} onClose={() => setArchiveTarget(null)} />
      )}
    </AdminLayout>
  );
}