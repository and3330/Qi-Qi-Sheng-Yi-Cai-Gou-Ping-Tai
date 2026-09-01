import { useEffect } from "react";
import {
  useListSocialAccounts,
  useToggleSocialAccount,
  useDeleteSocialAccount,
  getSocialOAuthUrl,
  getListSocialAccountsQueryKey,
  type SocialAccount,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Facebook,
  Instagram,
  AtSign,
  Twitter,
  Link2,
  Trash2,
  Power,
  AlertTriangle,
} from "lucide-react";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const PLATFORM_META: Record<
  string,
  { label: string; icon: typeof Facebook; color: string }
> = {
  facebook: { label: "Facebook 粉專", icon: Facebook, color: "text-blue-600 bg-blue-50 border-blue-200" },
  instagram: { label: "Instagram 商業帳號", icon: Instagram, color: "text-pink-600 bg-pink-50 border-pink-200" },
  threads: { label: "Threads", icon: AtSign, color: "text-gray-800 bg-gray-100 border-gray-300" },
  twitter: { label: "X (Twitter)", icon: Twitter, color: "text-sky-600 bg-sky-50 border-sky-200" },
};

const CONNECT_BUTTONS: Array<{
  platform: "facebook" | "threads" | "twitter";
  label: string;
  hint: string;
  credKeys: string;
}> = [
  { platform: "facebook", label: "連接 Facebook 粉專", hint: "會自動帶入綁定的 Instagram 商業帳號", credKeys: "FACEBOOK_APP_ID / FACEBOOK_APP_SECRET" },
  { platform: "threads", label: "連接 Threads", hint: "需在 Meta 開發者後台啟用 Threads API", credKeys: "THREADS_APP_ID / THREADS_APP_SECRET" },
  { platform: "twitter", label: "連接 X (Twitter)", hint: "OAuth 2.0 PKCE 授權", credKeys: "TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET" },
];

export default function AdminSocialAccountsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useListSocialAccounts();
  const toggleMutation = useToggleSocialAccount();
  const deleteMutation = useDeleteSocialAccount();

  // OAuth callback 導回時顯示結果
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) {
      toast({ title: "帳號連接成功", description: `已連接 ${PLATFORM_META[connected]?.label ?? connected}（${params.get("count") ?? 1} 個帳號）` });
    } else if (error) {
      toast({ title: "帳號連接失敗", description: error, variant: "destructive" });
    }
    if (connected || error) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListSocialAccountsQueryKey() }).catch(() => {});

  const connect = async (platform: string) => {
    try {
      const res = await getSocialOAuthUrl(platform);
      window.location.href = res.url;
    } catch (err: any) {
      toast({
        title: "無法開始授權",
        description: err?.data?.error ?? "平台憑證未設定，請先在環境變數設定 App 憑證",
        variant: "destructive",
      });
    }
  };

  const credentials = data?.credentials;

  return (
    <AdminLayout title="社群帳號管理">
      <div className="space-y-6">
        {/* 連接按鈕 */}
        <div className="grid gap-4 md:grid-cols-3">
          {CONNECT_BUTTONS.map((b) => {
            const meta = PLATFORM_META[b.platform];
            const Icon = meta.icon;
            const hasCred = credentials ? credentials[b.platform] : true;
            return (
              <div key={b.platform} className="rounded-2xl border bg-white p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={20} />
                  <span className="font-semibold">{meta.label}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{b.hint}</p>
                {hasCred ? (
                  <Button
                    size="sm"
                    onClick={() => connect(b.platform)}
                    data-testid={`button-connect-${b.platform}`}
                  >
                    <Link2 size={16} className="mr-1" /> {b.label}
                  </Button>
                ) : (
                  <div
                    className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-700"
                    data-testid={`text-missing-cred-${b.platform}`}
                  >
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>尚未設定平台憑證（{b.credKeys}），設定後即可連接。</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 已連接帳號 */}
        <div className="rounded-2xl border bg-white">
          <div className="border-b px-5 py-4 font-semibold">已連接帳號</div>
          {isLoading ? (
            <div className="p-5 space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : !data?.accounts.length ? (
            <p className="p-8 text-center text-muted-foreground" data-testid="text-no-accounts">
              尚未連接任何社群帳號
            </p>
          ) : (
            <div className="divide-y">
              {data.accounts.map((a: SocialAccount) => {
                const meta = PLATFORM_META[a.platform] ?? PLATFORM_META.facebook;
                const Icon = meta.icon;
                return (
                  <div key={a.id} className="flex items-center gap-4 px-5 py-4" data-testid={`row-social-account-${a.id}`}>
                    {a.profileImageUrl ? (
                      <img src={a.profileImageUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                        <Icon size={18} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{a.accountName}</span>
                        <Badge variant="outline" className={meta.color}>
                          {meta.label}
                        </Badge>
                        {!a.isActive && <Badge variant="outline" className="bg-gray-100 text-gray-500">已停用</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {a.tokenExpiresAt
                          ? `Token 有效至 ${new Date(a.tokenExpiresAt).toLocaleDateString("zh-TW")}`
                          : "Token 無到期資訊"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={toggleMutation.isPending}
                      onClick={() =>
                        toggleMutation.mutate({ id: a.id }, { onSuccess: invalidate })
                      }
                      data-testid={`button-toggle-account-${a.id}`}
                    >
                      <Power size={14} className="mr-1" /> {a.isActive ? "停用" : "啟用"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`確定要刪除帳號「${a.accountName}」？`)) {
                          deleteMutation.mutate({ id: a.id }, { onSuccess: invalidate });
                        }
                      }}
                      data-testid={`button-delete-account-${a.id}`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
