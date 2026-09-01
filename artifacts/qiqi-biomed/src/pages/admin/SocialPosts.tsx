import { useEffect, useState } from "react";
import {
  useListSocialAccounts,
  useListSocialPosts,
  useCreateSocialPost,
  useUpdateSocialPost,
  useDeleteSocialPost,
  usePublishSocialPost,
  usePreviewSocialPost,
  useGenerateSocialContent,
  useGenerateSocialImage,
  useSocialAiPlanner,
  useBatchCreateSocialPosts,
  getListSocialPostsQueryKey,
  type SocialPost,
  type SocialPlannedPost,
  type SocialAccount,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  Send,
  Sparkles,
  Image as ImageIcon,
  Eye,
  CalendarClock,
  Bot,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PLATFORMS: Array<{ value: string; label: string; limit: number }> = [
  { value: "facebook", label: "Facebook", limit: 5000 },
  { value: "instagram", label: "Instagram", limit: 2200 },
  { value: "threads", label: "Threads", limit: 500 },
  { value: "twitter", label: "X (Twitter)", limit: 280 },
];

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "draft":
      return <Badge variant="outline" className="bg-gray-100 text-gray-600">草稿</Badge>;
    case "scheduled":
      return <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200">已排程</Badge>;
    case "publishing":
      return <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">發布中</Badge>;
    case "published":
      return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200">已發布</Badge>;
    case "failed":
      return <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200">失敗</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

type FormState = {
  content: string;
  hashtags: string;
  platforms: string[];
  imageUrls: string[];
  targetAccountIds: Record<string, string>;
  scheduledAt: string; // datetime-local value
};

const emptyForm: FormState = {
  content: "",
  hashtags: "",
  platforms: ["facebook"],
  imageUrls: [],
  targetAccountIds: {},
  scheduledAt: "",
};

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PostEditorDialog({
  post,
  onClose,
}: {
  post: SocialPost | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(
    post
      ? {
          content: post.content,
          hashtags: post.hashtags ?? "",
          platforms: post.platforms,
          imageUrls: post.imageUrls,
          targetAccountIds: post.targetAccountIds,
          scheduledAt: toLocalInput(post.scheduledAt),
        }
      : emptyForm,
  );
  const [aiTopic, setAiTopic] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [previews, setPreviews] = useState<
    Array<{ platform: string; charLimit: number; text: string }> | null
  >(null);

  const { data: accountData } = useListSocialAccounts();
  const createMutation = useCreateSocialPost();
  const updateMutation = useUpdateSocialPost();
  const previewMutation = usePreviewSocialPost();
  const genContent = useGenerateSocialContent();
  const genImage = useGenerateSocialImage();
  const activeAccounts = (accountData?.accounts ?? []).filter((account) => account.isActive);

  useEffect(() => {
    if (!activeAccounts.length) return;
    setForm((current) => {
      const nextTargets = { ...current.targetAccountIds };
      let changed = false;
      for (const platform of current.platforms) {
        if (nextTargets[platform]) continue;
        const matches = activeAccounts.filter((account) => account.platform === platform);
        if (matches.length === 1) {
          nextTargets[platform] = matches[0].id;
          changed = true;
        }
      }
      return changed ? { ...current, targetAccountIds: nextTargets } : current;
    });
  }, [accountData]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListSocialPostsQueryKey() }).catch(() => {});

  const togglePlatform = (p: string) =>
    setForm((f) => ({
      ...f,
      platforms: f.platforms.includes(p)
        ? f.platforms.filter((x) => x !== p)
        : [...f.platforms, p],
    }));

  const save = () => {
    if (!form.content.trim() || !form.platforms.length) {
      toast({ title: "請填寫內容並選擇平台", variant: "destructive" });
      return;
    }
    if (
      form.scheduledAt &&
      form.platforms.some((platform) => !form.targetAccountIds[platform])
    ) {
      toast({
        title: "排程前請為每個平台指定發布帳號",
        description: "沒有可選帳號的平台請先至「社群帳號」完成連接。",
        variant: "destructive",
      });
      return;
    }
    const selectedTargets = Object.fromEntries(
      form.platforms
        .filter((platform) => form.targetAccountIds[platform])
        .map((platform) => [platform, form.targetAccountIds[platform]]),
    );
    const body = {
      content: form.content,
      hashtags: form.hashtags || null,
      platforms: form.platforms,
      imageUrls: form.imageUrls,
      targetAccountIds: selectedTargets,
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
    };
    const opts = {
      onSuccess: () => {
        invalidate();
        toast({ title: post ? "貼文已更新" : "貼文已建立" });
        onClose();
      },
      onError: (err: any) =>
        toast({ title: "儲存失敗", description: err?.data?.error, variant: "destructive" }),
    };
    if (post) updateMutation.mutate({ id: post.id, data: body }, opts);
    else createMutation.mutate({ data: body }, opts);
  };

  const runPreview = () =>
    previewMutation.mutate(
      { data: { content: form.content, hashtags: form.hashtags || null, platforms: form.platforms } },
      { onSuccess: (res) => setPreviews(res.previews) },
    );

  const runGenerate = () => {
    if (!aiTopic.trim()) return;
    genContent.mutate(
      { data: { topic: aiTopic, platforms: form.platforms } },
      {
        onSuccess: (res) =>
          setForm((f) => ({ ...f, content: res.content, hashtags: res.hashtags })),
        onError: (err: any) =>
          toast({ title: "AI 文案產生失敗", description: err?.data?.error, variant: "destructive" }),
      },
    );
  };

  const runGenerateImage = () => {
    if (!imagePrompt.trim()) return;
    genImage.mutate(
      { data: { prompt: imagePrompt } },
      {
        onSuccess: (res) =>
          setForm((f) => ({ ...f, imageUrls: [res.imageUrl] })),
        onError: (err: any) =>
          toast({ title: "AI 圖片產生失敗", description: err?.data?.error, variant: "destructive" }),
      },
    );
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{post ? "編輯貼文" : "建立貼文"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* AI 產生器 */}
          <div className="rounded-xl border bg-violet-50/50 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-violet-700">
              <Sparkles size={16} /> AI 文案產生器
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="輸入主題，例如：新品維他命 C 上市"
                value={aiTopic}
                onChange={(e) => setAiTopic(e.target.value)}
                data-testid="input-ai-topic"
              />
              <Button
                variant="outline"
                onClick={runGenerate}
                disabled={genContent.isPending || !aiTopic.trim()}
                data-testid="button-ai-generate"
              >
                {genContent.isPending ? <Loader2 size={16} className="animate-spin" /> : "產生文案"}
              </Button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">貼文內容</label>
            <Textarea
              rows={6}
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              placeholder="輸入貼文內容…"
              data-testid="input-post-content"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Hashtags（逗號分隔）</label>
            <Input
              value={form.hashtags}
              onChange={(e) => setForm((f) => ({ ...f, hashtags: e.target.value }))}
              placeholder="保健,七期生醫,健康生活"
              data-testid="input-post-hashtags"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">發布平台</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => togglePlatform(p.value)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    form.platforms.includes(p.value)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-white text-muted-foreground"
                  }`}
                  data-testid={`button-platform-${p.value}`}
                >
                  {p.label}（{p.limit} 字）
                </button>
              ))}
            </div>
            {form.platforms.includes("instagram") && !form.imageUrls.length && (
              <p className="mt-1 text-xs text-amber-600">Instagram 發文必須附圖片</p>
            )}
            <div className="mt-3 space-y-2">
              {form.platforms.map((platform) => {
                const meta = PLATFORMS.find((item) => item.value === platform);
                const accounts = activeAccounts.filter(
                  (account) => account.platform === platform,
                );
                return (
                  <div
                    key={platform}
                    className="grid grid-cols-[120px_1fr] items-center gap-2"
                  >
                    <span className="text-sm text-muted-foreground">
                      {meta?.label ?? platform} 帳號
                    </span>
                    {accounts.length ? (
                      <select
                        className="h-9 rounded-md border bg-background px-3 text-sm"
                        value={form.targetAccountIds[platform] ?? ""}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            targetAccountIds: {
                              ...current.targetAccountIds,
                              [platform]: event.target.value,
                            },
                          }))
                        }
                        data-testid={`select-account-${platform}`}
                      >
                        <option value="">請選擇發布帳號</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.accountName}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p
                        className="text-xs text-amber-600"
                        data-testid={`text-no-account-${platform}`}
                      >
                        尚未連接可用帳號；可先存草稿，但排程或發布前必須連接。
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 圖片 */}
          <div className="rounded-xl border p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ImageIcon size={16} /> 貼文圖片
            </div>
            {form.imageUrls.length > 0 && (
              <div className="flex items-center gap-3">
                <img src={form.imageUrls[0]} alt="" className="h-24 w-24 rounded-lg object-cover border" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setForm((f) => ({ ...f, imageUrls: [] }))}
                >
                  移除圖片
                </Button>
              </div>
            )}
            <div className="flex gap-2">
              <Input
                placeholder="AI 圖片描述，例如：清新風格的維他命 C 產品形象"
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                data-testid="input-image-prompt"
              />
              <Button
                variant="outline"
                onClick={runGenerateImage}
                disabled={genImage.isPending || !imagePrompt.trim()}
                data-testid="button-ai-generate-image"
              >
                {genImage.isPending ? <Loader2 size={16} className="animate-spin" /> : "AI 產圖"}
              </Button>
            </div>
            <Input
              placeholder="或貼上公開圖片 URL"
              value={form.imageUrls[0] ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, imageUrls: e.target.value ? [e.target.value] : [] }))
              }
              data-testid="input-image-url"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">排程時間（留空 = 草稿，手動發布）</label>
            <Input
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              data-testid="input-scheduled-at"
            />
          </div>

          {/* 平台預覽 */}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={runPreview}
              disabled={previewMutation.isPending || !form.content.trim()}
              data-testid="button-preview"
            >
              <Eye size={14} className="mr-1" /> 預覽各平台裁切結果
            </Button>
            {previews && (
              <div className="mt-2 space-y-2">
                {previews
                  .filter((p) => form.platforms.includes(p.platform))
                  .map((p) => (
                    <div key={p.platform} className="rounded-lg border bg-muted/30 p-3">
                      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-medium">
                          {PLATFORMS.find((x) => x.value === p.platform)?.label ?? p.platform}
                        </span>
                        <span>
                          {p.text.length} / {p.charLimit} 字
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm">{p.text}</p>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={save} disabled={saving} data-testid="button-save-post">
              {saving ? <Loader2 size={16} className="animate-spin" /> : post ? "儲存變更" : "建立貼文"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlannerDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [input, setInput] = useState("");
  const [plan, setPlan] = useState<SocialPlannedPost[] | null>(null);
  const [targetAccountIds, setTargetAccountIds] = useState<Record<string, string>>({});
  const { data: accountData } = useListSocialAccounts();
  const plannerMutation = useSocialAiPlanner();
  const batchMutation = useBatchCreateSocialPosts();

  const send = () => {
    const content = input.trim();
    if (!content) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    plannerMutation.mutate(
      { data: { messages: next } },
      {
        onSuccess: (res) => {
          setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
          if (res.plan?.length) {
            setPlan(res.plan);
            const neededPlatforms = [...new Set(res.plan.flatMap((item) => item.platforms))];
            const nextTargets: Record<string, string> = {};
            for (const platform of neededPlatforms) {
              const matches = (accountData?.accounts ?? []).filter(
                (account) => account.isActive && account.platform === platform,
              );
              if (matches.length === 1) nextTargets[platform] = matches[0].id;
            }
            setTargetAccountIds(nextTargets);
          }
        },
        onError: (err: any) =>
          toast({ title: "AI 回覆失敗", description: err?.data?.error, variant: "destructive" }),
      },
    );
  };

  const createAll = () => {
    if (!plan?.length) return;
    const missing = [
      ...new Set(plan.flatMap((item) => item.platforms)),
    ].filter((platform) => !targetAccountIds[platform]);
    if (missing.length) {
      toast({
        title: "請先指定所有發布帳號",
        description: `尚未指定：${missing.join("、")}`,
        variant: "destructive",
      });
      return;
    }
    batchMutation.mutate(
      {
        data: {
          posts: plan.map((p) => ({
            content: p.content,
            hashtags: p.hashtags || null,
            platforms: p.platforms,
            targetAccountIds: Object.fromEntries(
              p.platforms.map((platform) => [platform, targetAccountIds[platform]]),
            ),
            scheduledAt: p.scheduledAt,
          })),
        },
      },
      {
        onSuccess: (res) => {
          queryClient
            .invalidateQueries({ queryKey: getListSocialPostsQueryKey() })
            .catch(() => {});
          toast({
            title: `已批次建立 ${res.posts.length} 則排程貼文`,
            description: res.skipped.length ? `略過 ${res.skipped.length} 則` : undefined,
          });
          onClose();
        },
        onError: (err: any) =>
          toast({ title: "批次建立失敗", description: err?.data?.error, variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl rounded-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot size={18} /> AI 內容排程規劃
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-3 min-h-[240px] max-h-[45vh] pr-1">
          {!messages.length && (
            <p className="text-sm text-muted-foreground p-4 text-center">
              告訴 AI 你想規劃的內容，例如：「幫我規劃下週的社群內容，主打益生菌系列」
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`rounded-xl p-3 text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-primary/10 ml-8" : "bg-muted/50 mr-8"
              }`}
            >
              {m.content}
            </div>
          ))}
          {plannerMutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
              <Loader2 size={16} className="animate-spin" /> AI 規劃中…
            </div>
          )}
          {plan && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
              <p className="text-sm font-medium text-emerald-700">
                已產生 {plan.length} 則排程計畫：
              </p>
              {plan.map((p, i) => (
                <div key={i} className="rounded-lg bg-white border p-2 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <CalendarClock size={12} />
                    <span>{new Date(p.scheduledAt).toLocaleString("zh-TW")}</span>
                    <span className="text-muted-foreground">{p.platforms.join("、")}</span>
                  </div>
                  <p className="line-clamp-2">{p.content}</p>
                </div>
              ))}
              <div className="rounded-lg border bg-white p-3 space-y-2">
                <p className="text-xs font-medium">指定各平台發布帳號</p>
                {[...new Set(plan.flatMap((item) => item.platforms))].map((platform) => {
                  const accounts = (accountData?.accounts ?? []).filter(
                    (account) => account.isActive && account.platform === platform,
                  );
                  return (
                    <div
                      key={platform}
                      className="grid grid-cols-[100px_1fr] items-center gap-2"
                    >
                      <span className="text-xs">
                        {PLATFORMS.find((item) => item.value === platform)?.label ??
                          platform}
                      </span>
                      {accounts.length ? (
                        <select
                          className="h-8 rounded-md border bg-background px-2 text-xs"
                          value={targetAccountIds[platform] ?? ""}
                          onChange={(event) =>
                            setTargetAccountIds((current) => ({
                              ...current,
                              [platform]: event.target.value,
                            }))
                          }
                          data-testid={`select-planner-account-${platform}`}
                        >
                          <option value="">請選擇</option>
                          {accounts.map((account: SocialAccount) => (
                            <option key={account.id} value={account.id}>
                              {account.accountName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-amber-600">
                          尚未連接可用帳號
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <Button
                size="sm"
                onClick={createAll}
                disabled={
                  batchMutation.isPending ||
                  [...new Set(plan.flatMap((item) => item.platforms))].some(
                    (platform) => !targetAccountIds[platform],
                  )
                }
                data-testid="button-batch-create"
              >
                {batchMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <>一鍵建立 {plan.length} 則排程貼文</>
                )}
              </Button>
            </div>
          )}
        </div>
        <div className="flex gap-2 border-t pt-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && send()}
            placeholder="輸入訊息與 AI 討論內容規劃…"
            data-testid="input-planner-message"
          />
          <Button onClick={send} disabled={plannerMutation.isPending || !input.trim()} data-testid="button-planner-send">
            <Send size={16} />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminSocialPostsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: posts, isLoading } = useListSocialPosts();
  const deleteMutation = useDeleteSocialPost();
  const publishMutation = usePublishSocialPost();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SocialPost | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListSocialPostsQueryKey() }).catch(() => {});

  const publish = (post: SocialPost) => {
    if (!window.confirm("確定要立即發布此貼文到所選平台？")) return;
    publishMutation.mutate(
      { id: post.id },
      {
        onSuccess: (res) => {
          invalidate();
          toast({
            title: res.errors.length ? "部分平台發布失敗" : "貼文已發布",
            description: res.errors.length ? res.errors.join("；") : undefined,
            variant: res.errors.length ? "destructive" : undefined,
          });
        },
        onError: (err: any) =>
          toast({ title: "發布失敗", description: err?.data?.error, variant: "destructive" }),
      },
    );
  };

  return (
    <AdminLayout title="社群貼文管理">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            排程貼文由系統每分鐘自動檢查並發布到期貼文
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPlannerOpen(true)} data-testid="button-open-planner">
              <Bot size={16} className="mr-1" /> AI 內容規劃
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
              data-testid="button-new-post"
            >
              <Plus size={16} className="mr-1" /> 建立貼文
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border bg-white">
          {isLoading ? (
            <div className="p-5 space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : !posts?.length ? (
            <p className="p-10 text-center text-muted-foreground" data-testid="text-no-posts">
              尚無貼文，點「建立貼文」或使用「AI 內容規劃」開始
            </p>
          ) : (
            <div className="divide-y">
              {posts.map((p) => {
                const results = (p.platformResults ?? {}) as Record<
                  string,
                  { success?: boolean; error?: string }
                >;
                return (
                  <div key={p.id} className="px-5 py-4" data-testid={`row-social-post-${p.id}`}>
                    <div className="flex items-start gap-3">
                      {p.imageUrls.length > 0 && (
                        <img src={p.imageUrls[0]} alt="" className="h-16 w-16 rounded-lg object-cover border shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <StatusBadge status={p.status} />
                          {p.platforms.map((pl) => (
                            <Badge key={pl} variant="outline" className="text-xs">
                              {PLATFORMS.find((x) => x.value === pl)?.label ?? pl}
                            </Badge>
                          ))}
                          {p.scheduledAt && p.status === "scheduled" && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <CalendarClock size={12} />
                              {new Date(p.scheduledAt).toLocaleString("zh-TW")}
                            </span>
                          )}
                        </div>
                        <p className="line-clamp-2 text-sm whitespace-pre-wrap">{p.content}</p>
                        {p.hashtags && (
                          <p className="mt-0.5 text-xs text-primary truncate">
                            {p.hashtags.split(",").map((t) => `#${t.trim()}`).join(" ")}
                          </p>
                        )}
                        {/* 各平台發布結果 */}
                        {Object.keys(results).length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {Object.entries(results).map(([pl, r]) => (
                              <span
                                key={pl}
                                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                                  r.success
                                    ? "bg-emerald-50 text-emerald-600"
                                    : "bg-red-50 text-red-600"
                                }`}
                                title={r.error}
                              >
                                {r.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                                {PLATFORMS.find((x) => x.value === pl)?.label ?? pl}
                                {!r.success && r.error ? `：${r.error.slice(0, 60)}` : ""}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        {p.status !== "published" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => publish(p)}
                              disabled={publishMutation.isPending}
                              data-testid={`button-publish-${p.id}`}
                            >
                              <Send size={14} className="mr-1" /> 發布
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditing(p);
                                setEditorOpen(true);
                              }}
                              data-testid={`button-edit-${p.id}`}
                            >
                              <Pencil size={14} />
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600"
                          onClick={() => {
                            if (window.confirm("確定要刪除此貼文？")) {
                              deleteMutation.mutate({ id: p.id }, { onSuccess: invalidate });
                            }
                          }}
                          data-testid={`button-delete-${p.id}`}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {editorOpen && (
        <PostEditorDialog post={editing} onClose={() => { setEditorOpen(false); setEditing(null); invalidate(); }} />
      )}
      {plannerOpen && <PlannerDialog onClose={() => setPlannerOpen(false)} />}
    </AdminLayout>
  );
}
