import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Copy,
  ExternalLink,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMe,
  useListMyLinktreeLinks,
  useCreateMyLinktreeLink,
  useUpdateMyLinktreeLink,
  useDeleteMyLinktreeLink,
  useGetMyLinktreeSettings,
  useUpdateMyLinktreeSettings,
  getListMyLinktreeLinksQueryKey,
  getGetMyLinktreeSettingsQueryKey,
  type MemberLink,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { LinktreeView } from "@/components/LinktreeView";

const LINK_TYPES = [
  { value: "link", label: "一般連結" },
  { value: "social", label: "社群" },
  { value: "video", label: "影片" },
  { value: "music", label: "音樂" },
];

const THEMES = [
  { value: "default", label: "預設" },
  { value: "dark", label: "深色" },
  { value: "gradient", label: "漸層" },
  { value: "pastel", label: "粉彩" },
];

const BUTTON_STYLES = [
  { value: "rounded", label: "圓角" },
  { value: "pill", label: "膠囊" },
  { value: "square", label: "方形" },
  { value: "outline", label: "外框" },
];

type LinkForm = {
  title: string;
  subtitle: string;
  url: string;
  icon: string;
  linkType: string;
};

const EMPTY_FORM: LinkForm = { title: "", subtitle: "", url: "", icon: "", linkType: "link" };

function LinkDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: MemberLink | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { mutateAsync: createLink, isPending: creating } = useCreateMyLinktreeLink();
  const { mutateAsync: updateLink, isPending: updating } = useUpdateMyLinktreeLink();
  const [form, setForm] = useState<LinkForm>(EMPTY_FORM);

  useEffect(() => {
    if (open) {
      setForm(
        editing
          ? {
              title: editing.title,
              subtitle: editing.subtitle || "",
              url: editing.url,
              icon: editing.icon || "",
              linkType: editing.linkType,
            }
          : EMPTY_FORM,
      );
    }
  }, [open, editing]);

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.url.trim()) {
      toast({ title: "標題和 URL 為必填", variant: "destructive" });
      return;
    }
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(form.url.trim())) {
      toast({ title: "URL 需以 http(s)://、mailto: 或 tel: 開頭", variant: "destructive" });
      return;
    }
    try {
      const data = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        url: form.url.trim(),
        icon: form.icon.trim() || null,
        linkType: form.linkType as any,
      };
      if (editing) {
        await updateLink({ id: editing.id, data });
      } else {
        await createLink({ data });
      }
      onSaved();
      onOpenChange(false);
      toast({ title: editing ? "連結已更新" : "連結已新增" });
    } catch {
      toast({ title: "儲存失敗", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-[420px] rounded-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "編輯連結" : "新增連結"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>標題 *</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              data-testid="input-link-title"
            />
          </div>
          <div className="space-y-1.5">
            <Label>副標</Label>
            <Input
              value={form.subtitle}
              onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
              data-testid="input-link-subtitle"
            />
          </div>
          <div className="space-y-1.5">
            <Label>URL *</Label>
            <Input
              placeholder="https://..."
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              data-testid="input-link-url"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>圖示（emoji）</Label>
              <Input
                placeholder="🔗"
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                data-testid="input-link-icon"
              />
            </div>
            <div className="space-y-1.5">
              <Label>類型</Label>
              <Select
                value={form.linkType}
                onValueChange={(v) => setForm({ ...form, linkType: v })}
              >
                <SelectTrigger data-testid="select-link-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINK_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            className="mt-2 w-full"
            onClick={handleSubmit}
            disabled={creating || updating}
            data-testid="button-save-link"
          >
            儲存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function MemberLinktreePage() {
  const { data: me } = useGetMe();
  const { data: links, isLoading: linksLoading } = useListMyLinktreeLinks();
  const { data: settings, isLoading: settingsLoading } = useGetMyLinktreeSettings();
  const { mutateAsync: updateLink } = useUpdateMyLinktreeLink();
  const { mutateAsync: deleteLink } = useDeleteMyLinktreeLink();
  const { mutateAsync: saveSettings, isPending: savingSettings } =
    useUpdateMyLinktreeSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MemberLink | null>(null);
  const [form, setForm] = useState({
    customTitle: "",
    subtitle: "",
    bio: "",
    theme: "default",
    buttonStyle: "rounded",
    backgroundColor: "",
    buttonColor: "",
    buttonTextColor: "",
    showAvatar: true,
  });
  const [formLoaded, setFormLoaded] = useState(false);

  useEffect(() => {
    if (settings && !formLoaded) {
      setForm({
        customTitle: settings.customTitle || "",
        subtitle: settings.subtitle || "",
        bio: settings.bio || "",
        theme: settings.theme || "default",
        buttonStyle: settings.buttonStyle || "rounded",
        backgroundColor: settings.backgroundColor || "",
        buttonColor: settings.buttonColor || "",
        buttonTextColor: settings.buttonTextColor || "",
        showAvatar: settings.showAvatar !== false,
      });
      setFormLoaded(true);
    }
  }, [settings, formLoaded]);

  const invalidateLinks = () =>
    queryClient.invalidateQueries({ queryKey: getListMyLinktreeLinksQueryKey() });

  const publicUrl = me
    ? `${window.location.origin}${import.meta.env.BASE_URL}u/${me.id}`
    : "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast({ title: "已複製公開網址" });
    } catch {
      toast({ title: "複製失敗，請手動複製", variant: "destructive" });
    }
  };

  const handleMove = async (idx: number, dir: -1 | 1) => {
    if (!links) return;
    const target = idx + dir;
    if (target < 0 || target >= links.length) return;
    const a = links[idx];
    const b = links[target];
    try {
      await Promise.all([
        updateLink({ id: a.id, data: { sortOrder: target } }),
        updateLink({ id: b.id, data: { sortOrder: idx } }),
      ]);
      invalidateLinks();
    } catch {
      toast({ title: "排序失敗", variant: "destructive" });
    }
  };

  const handleToggle = async (link: MemberLink, isActive: boolean) => {
    try {
      await updateLink({ id: link.id, data: { isActive } });
      invalidateLinks();
    } catch {
      toast({ title: "更新失敗", variant: "destructive" });
    }
  };

  const handleDelete = async (link: MemberLink) => {
    if (!window.confirm(`確定刪除「${link.title}」？`)) return;
    try {
      await deleteLink({ id: link.id });
      invalidateLinks();
      toast({ title: "已刪除連結" });
    } catch {
      toast({ title: "刪除失敗", variant: "destructive" });
    }
  };

  const handleSaveSettings = async () => {
    try {
      await saveSettings({
        data: {
          customTitle: form.customTitle.trim() || null,
          subtitle: form.subtitle.trim() || null,
          bio: form.bio.trim() || null,
          theme: form.theme as any,
          buttonStyle: form.buttonStyle as any,
          backgroundColor: form.backgroundColor.trim() || null,
          buttonColor: form.buttonColor.trim() || null,
          buttonTextColor: form.buttonTextColor.trim() || null,
          showAvatar: form.showAvatar,
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetMyLinktreeSettingsQueryKey() });
      toast({ title: "外觀設定已儲存" });
    } catch {
      toast({ title: "儲存失敗", variant: "destructive" });
    }
  };

  const previewSettings = {
    customTitle: form.customTitle || null,
    subtitle: form.subtitle || null,
    bio: form.bio || null,
    theme: form.theme,
    buttonStyle: form.buttonStyle,
    backgroundColor: form.backgroundColor || null,
    buttonColor: form.buttonColor || null,
    buttonTextColor: form.buttonTextColor || null,
    showAvatar: form.showAvatar,
  };
  const activeLinks = (links || []).filter((l) => l.isActive && !l.isBlocked);

  if (linksLoading || settingsLoading) {
    return (
      <div className="min-h-screen space-y-4 bg-gray-50 px-4 pb-20 pt-6">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 pb-20 animate-in fade-in">
      <div className="bg-primary px-4 pb-6 pt-safe text-white">
        <div className="flex items-center gap-3 pt-4">
          <Link href="/member" className="rounded-full p-1 hover:bg-white/20">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-lg font-bold">我的連結頁</h1>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-white/10 p-3 backdrop-blur-sm">
          <p className="min-w-0 flex-1 truncate text-xs" data-testid="text-public-url">
            {publicUrl}
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 rounded-full px-2 text-xs"
            onClick={handleCopy}
            data-testid="button-copy-url"
          >
            <Copy size={12} className="mr-1" /> 複製
          </Button>
          <a href={publicUrl} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="secondary" className="h-7 rounded-full px-2 text-xs">
              <ExternalLink size={12} />
            </Button>
          </a>
        </div>
      </div>

      <div className="px-4 pt-4">
        <Tabs defaultValue="links">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="links" data-testid="tab-links">連結</TabsTrigger>
            <TabsTrigger value="appearance" data-testid="tab-appearance">外觀</TabsTrigger>
            <TabsTrigger value="preview" data-testid="tab-preview">預覽</TabsTrigger>
          </TabsList>

          <TabsContent value="links" className="mt-4 space-y-3">
            <Button
              className="w-full rounded-xl"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              data-testid="button-add-link"
            >
              <Plus size={16} className="mr-1" /> 新增連結
            </Button>
            {(links || []).length === 0 && (
              <p className="py-10 text-center text-sm text-gray-400">
                尚無連結，點擊上方按鈕新增你的第一個連結。
              </p>
            )}
            {(links || []).map((link, idx) => (
              <div
                key={link.id}
                className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm"
                data-testid={`card-link-${link.id}`}
              >
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-gray-800">
                      {link.icon ? `${link.icon} ` : ""}
                      {link.title}
                    </p>
                    <p className="truncate text-xs text-gray-400">{link.url}</p>
                    {link.isBlocked && (
                      <p className="mt-0.5 text-[10px] font-bold text-destructive">
                        此連結已被管理員停用，如有疑問請聯繫客服
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={link.isActive && !link.isBlocked}
                    disabled={link.isBlocked}
                    onCheckedChange={(v) => handleToggle(link, v)}
                    data-testid={`switch-link-active-${link.id}`}
                  />
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={idx === 0}
                    onClick={() => handleMove(idx, -1)}
                    data-testid={`button-move-up-${link.id}`}
                  >
                    <ArrowUp size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={idx === (links || []).length - 1}
                    onClick={() => handleMove(idx, 1)}
                    data-testid={`button-move-down-${link.id}`}
                  >
                    <ArrowDown size={14} />
                  </Button>
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setEditing(link);
                      setDialogOpen(true);
                    }}
                    data-testid={`button-edit-link-${link.id}`}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => handleDelete(link)}
                    data-testid={`button-delete-link-${link.id}`}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="appearance" className="mt-4">
            <div className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="space-y-1.5">
                <Label>自訂標題</Label>
                <Input
                  placeholder={me?.name || ""}
                  value={form.customTitle}
                  onChange={(e) => setForm({ ...form, customTitle: e.target.value })}
                  data-testid="input-custom-title"
                />
              </div>
              <div className="space-y-1.5">
                <Label>副標</Label>
                <Input
                  value={form.subtitle}
                  onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>自我介紹（bio）</Label>
                <Textarea
                  rows={2}
                  value={form.bio}
                  onChange={(e) => setForm({ ...form, bio: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>主題</Label>
                  <Select
                    value={form.theme}
                    onValueChange={(v) => setForm({ ...form, theme: v })}
                  >
                    <SelectTrigger data-testid="select-theme">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {THEMES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>按鈕樣式</Label>
                  <Select
                    value={form.buttonStyle}
                    onValueChange={(v) => setForm({ ...form, buttonStyle: v })}
                  >
                    <SelectTrigger data-testid="select-button-style">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BUTTON_STYLES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">背景色</Label>
                  <Input
                    type="color"
                    value={form.backgroundColor || "#f9fafb"}
                    onChange={(e) => setForm({ ...form, backgroundColor: e.target.value })}
                    className="h-9 p-1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">按鈕色</Label>
                  <Input
                    type="color"
                    value={form.buttonColor || "#ffffff"}
                    onChange={(e) => setForm({ ...form, buttonColor: e.target.value })}
                    className="h-9 p-1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">按鈕文字色</Label>
                  <Input
                    type="color"
                    value={form.buttonTextColor || "#1f2937"}
                    onChange={(e) => setForm({ ...form, buttonTextColor: e.target.value })}
                    className="h-9 p-1"
                  />
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() =>
                  setForm({ ...form, backgroundColor: "", buttonColor: "", buttonTextColor: "" })
                }
              >
                清除自訂顏色（使用主題預設）
              </Button>
              <div className="flex items-center justify-between">
                <Label>顯示頭像與標題</Label>
                <Switch
                  checked={form.showAvatar}
                  onCheckedChange={(v) => setForm({ ...form, showAvatar: v })}
                  data-testid="switch-show-avatar"
                />
              </div>
              <Button
                className="w-full"
                onClick={handleSaveSettings}
                disabled={savingSettings}
                data-testid="button-save-settings"
              >
                儲存外觀設定
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="mt-4">
            <div className="overflow-hidden rounded-2xl border border-gray-200 shadow-sm">
              <LinktreeView
                compact
                displayName={me?.name || me?.username || ""}
                links={activeLinks}
                settings={previewSettings}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <LinkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={invalidateLinks}
      />
    </div>
  );
}
