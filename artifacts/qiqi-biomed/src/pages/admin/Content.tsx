import { useState } from "react";
import { 
  useListAdminArticles,
  useCreateAdminArticle,
  useUpdateAdminArticle,
  useListAdminAnnouncements,
  useCreateAdminAnnouncement,
  useUpdateAdminAnnouncement,
  useListAdminContentRevisions,
  getListAdminArticlesQueryKey,
  getListAdminAnnouncementsQueryKey,
  type AdminArticle,
  type AdminAnnouncement,
  type ContentRevision
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, History, FileText, Bell } from "lucide-react";
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

function StatusBadge({ status }: { status: string }) {
  switch(status) {
    case 'draft': return <Badge variant="outline" className="bg-gray-100 text-gray-600">草稿</Badge>;
    case 'review': return <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200">送審中</Badge>;
    case 'published': return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200">已上架</Badge>;
    case 'archived': return <Badge variant="outline" className="bg-slate-100 text-slate-500">已下架</Badge>;
    default: return <Badge>{status}</Badge>;
  }
}

function RevisionsDialog({ entityKind, entityId, onClose }: { entityKind: "article" | "announcement", entityId: number, onClose: () => void }) {
  const { data: revisions, isLoading } = useListAdminContentRevisions({ entityKind, entityId });
  
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-2xl">
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
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ContentEditorDialog({
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
  const createAnnouncement = useCreateAdminAnnouncement();
  const updateArticle = useUpdateAdminArticle();
  const updateAnnouncement = useUpdateAdminAnnouncement();
  const articleItem = kind === "article" ? item as AdminArticle | undefined : undefined;
  const [articleKind, setArticleKind] = useState<"article" | "faq">(articleItem?.kind ?? "article");
  const [title, setTitle] = useState(item?.title ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [summary, setSummary] = useState(articleItem?.summary ?? "");
  const [content, setContent] = useState(item?.content ?? "");
  const [imageUrl, setImageUrl] = useState(item?.imageUrl ?? "");
  const [status, setStatus] = useState<"draft" | "review" | "published" | "archived">(item?.status ?? "draft");
  const [error, setError] = useState("");
  const isEditing = Boolean(item);
  const isPending =
    createArticle.isPending ||
    createAnnouncement.isPending ||
    updateArticle.isPending ||
    updateAnnouncement.isPending;

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
        if (item) {
          await updateArticle.mutateAsync({ id: item.id, data });
        } else {
          await createArticle.mutateAsync({ data });
        }
        await queryClient.invalidateQueries({ queryKey: getListAdminArticlesQueryKey() });
      } else {
        const data = {
          title: title.trim(),
          category: category.trim(),
          content: content.trim() || null,
          imageUrl: imageUrl.trim() || null,
          status,
        };
        if (item) {
          await updateAnnouncement.mutateAsync({ id: item.id, data });
        } else {
          await createAnnouncement.mutateAsync({ data });
        }
        await queryClient.invalidateQueries({ queryKey: getListAdminAnnouncementsQueryKey() });
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
          <DialogTitle>{isEditing ? "編輯" : "新增"}{kind === "article" ? "文章" : "公告"}</DialogTitle>
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
              <option value="archived">下架</option>
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

export default function AdminContentPage() {
  const [tab, setTab] = useState<"articles" | "announcements">("articles");
  const [revTarget, setRevTarget] = useState<{kind: "article"|"announcement", id: number} | null>(null);
  const [createKind, setCreateKind] = useState<"article" | "announcement" | null>(null);
  const [editTarget, setEditTarget] = useState<
    { kind: "article"; item: AdminArticle } |
    { kind: "announcement"; item: AdminAnnouncement } |
    null
  >(null);

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
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-primary"
                          aria-label={`編輯文章：${a.title}`}
                          onClick={() => setEditTarget({ kind: "article", item: a })}
                        >
                          <Pencil size={16} />
                        </Button>
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-primary"
                          aria-label={`編輯公告：${a.title}`}
                          onClick={() => setEditTarget({ kind: "announcement", item: a })}
                        >
                          <Pencil size={16} />
                        </Button>
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
        <ContentEditorDialog kind={createKind} onClose={() => setCreateKind(null)} />
      )}
      {editTarget && (
        <ContentEditorDialog
          key={`${editTarget.kind}-${editTarget.item.id}`}
          kind={editTarget.kind}
          item={editTarget.item}
          onClose={() => setEditTarget(null)}
        />
      )}
    </AdminLayout>
  );
}