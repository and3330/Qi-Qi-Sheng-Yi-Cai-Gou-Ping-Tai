import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListNewsletterDomains,
  getListNewsletterDomainsQueryKey,
  useCreateNewsletterDomain,
  useVerifyNewsletterDomain,
  useDeleteNewsletterDomain,
  useListNewsletterApiKeys,
  getListNewsletterApiKeysQueryKey,
  useCreateNewsletterApiKey,
  useUpdateNewsletterApiKey,
  useDeleteNewsletterApiKey,
  useGetNewsletterUsage,
} from "@workspace/api-client-react";
import { Globe, KeyRound, Plus, RefreshCw, Trash2, Copy, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "./AdminLayout";

function errMessage(e: unknown, fallback: string) {
  const anyE = e as any;
  return anyE?.data?.error || anyE?.message || fallback;
}

export function ResendConfigBanner() {
  const { data: usage } = useGetNewsletterUsage();
  if (!usage || usage.configured) return null;
  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800"
      data-testid="banner-newsletter-not-configured"
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold">尚未設定 RESEND_API_KEY</p>
        <p>
          寄信、域名驗證等功能需要 Resend API 金鑰。請至環境變數（Secrets）新增
          <code className="mx-1 rounded bg-amber-100 px-1">RESEND_API_KEY</code>
          後重新啟動伺服器。設定前仍可管理訂閱者、活動與序列草稿。
        </p>
      </div>
    </div>
  );
}

const domainStatusLabel: Record<string, { text: string; cls: string }> = {
  verified: { text: "已驗證", cls: "bg-green-100 text-green-700" },
  pending: { text: "待驗證", cls: "bg-amber-100 text-amber-700" },
  not_started: { text: "未開始", cls: "bg-muted text-muted-foreground" },
  failed: { text: "驗證失敗", cls: "bg-red-100 text-red-700" },
  temporary_failure: { text: "暫時失敗", cls: "bg-red-100 text-red-700" },
};

export default function NewsletterDomains() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: domains, isLoading } = useListNewsletterDomains();
  const { data: apiKeys, isLoading: keysLoading } = useListNewsletterApiKeys();

  const [addOpen, setAddOpen] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [expandedDomain, setExpandedDomain] = useState<number | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const invalidateDomains = () =>
    queryClient.invalidateQueries({ queryKey: getListNewsletterDomainsQueryKey() });
  const invalidateKeys = () =>
    queryClient.invalidateQueries({ queryKey: getListNewsletterApiKeysQueryKey() });

  const createDomain = useCreateNewsletterDomain();
  const verifyDomain = useVerifyNewsletterDomain();
  const deleteDomain = useDeleteNewsletterDomain();
  const createKey = useCreateNewsletterApiKey();
  const updateKey = useUpdateNewsletterApiKey();
  const deleteKey = useDeleteNewsletterApiKey();

  const handleAddDomain = async () => {
    const domain = newDomain.trim().toLowerCase();
    if (!domain.includes(".")) {
      toast({ title: "請輸入有效的域名", variant: "destructive" });
      return;
    }
    try {
      await createDomain.mutateAsync({ data: { domain } });
      toast({ title: "域名已新增", description: "請依 DNS 記錄設定後再驗證" });
      setAddOpen(false);
      setNewDomain("");
      invalidateDomains();
    } catch (e) {
      toast({ title: "新增失敗", description: errMessage(e, ""), variant: "destructive" });
    }
  };

  return (
    <AdminLayout title="電子報・寄件域名">
      <ResendConfigBanner />

      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Globe size={18} /> 寄件域名
        </h2>
        <Button size="sm" onClick={() => setAddOpen(true)} data-testid="button-add-domain">
          <Plus size={16} /> 新增域名
        </Button>
      </div>

      <div className="rounded-xl border bg-white">
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : !domains?.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground" data-testid="text-no-domains">
            尚未新增寄件域名。新增並完成 DNS 驗證後，即可用自己的域名寄信。
          </p>
        ) : (
          <div className="divide-y">
            {domains.map((d) => {
              const st = domainStatusLabel[d.status] ?? {
                text: d.status,
                cls: "bg-muted text-muted-foreground",
              };
              return (
                <div key={d.id} className="p-4" data-testid={`row-domain-${d.id}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">{d.domain}</span>
                    <Badge className={st.cls} variant="secondary">
                      {st.text}
                    </Badge>
                    <div className="ml-auto flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setExpandedDomain(expandedDomain === d.id ? null : d.id)
                        }
                        data-testid={`button-domain-dns-${d.id}`}
                      >
                        DNS 記錄
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={verifyDomain.isPending}
                        onClick={async () => {
                          try {
                            const updated = await verifyDomain.mutateAsync({ id: d.id });
                            invalidateDomains();
                            toast({
                              title:
                                updated.status === "verified"
                                  ? "域名驗證成功"
                                  : `驗證已送出（狀態：${domainStatusLabel[updated.status]?.text ?? updated.status}）`,
                            });
                          } catch (e) {
                            toast({ title: "驗證失敗", description: errMessage(e, ""), variant: "destructive" });
                          }
                        }}
                        data-testid={`button-domain-verify-${d.id}`}
                      >
                        <RefreshCw size={14} /> 驗證
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600"
                        onClick={async () => {
                          if (!confirm(`確定刪除域名 ${d.domain}？`)) return;
                          try {
                            await deleteDomain.mutateAsync({ id: d.id });
                            invalidateDomains();
                            toast({ title: "已刪除域名" });
                          } catch (e) {
                            toast({ title: "刪除失敗", description: errMessage(e, ""), variant: "destructive" });
                          }
                        }}
                        data-testid={`button-domain-delete-${d.id}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                  {expandedDomain === d.id && (
                    <div className="mt-3 overflow-x-auto rounded-lg border bg-muted/30 p-3">
                      {Array.isArray(d.dnsRecords) && d.dnsRecords.length ? (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground">
                              <th className="p-1">類型</th>
                              <th className="p-1">名稱</th>
                              <th className="p-1">值</th>
                              <th className="p-1">狀態</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.dnsRecords.map((r, i) => (
                              <tr key={i} className="border-t">
                                <td className="p-1 font-mono">{r.type}</td>
                                <td className="p-1 font-mono">{r.name}</td>
                                <td className="max-w-[300px] truncate p-1 font-mono" title={r.value}>
                                  {r.value}
                                </td>
                                <td className="p-1">{r.status ?? "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="text-xs text-muted-foreground">尚無 DNS 記錄資料，請先執行驗證。</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mb-3 mt-8 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <KeyRound size={18} /> 公開 API 金鑰
        </h2>
        <Button size="sm" variant="outline" onClick={() => setKeyOpen(true)} data-testid="button-add-api-key">
          <Plus size={16} /> 新增金鑰
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        外部系統可用金鑰呼叫 /api/newsletter/v1 的訂閱、退訂與發送端點（Authorization: Bearer 金鑰）。
      </p>
      <div className="rounded-xl border bg-white">
        {keysLoading ? (
          <div className="p-4">
            <Skeleton className="h-8 w-full" />
          </div>
        ) : !apiKeys?.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">尚未建立 API 金鑰。</p>
        ) : (
          <div className="divide-y">
            {apiKeys.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center gap-3 p-4" data-testid={`row-api-key-${k.id}`}>
                <div className="min-w-0">
                  <p className="font-medium">{k.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    nl_••••••••{k.keyLastFour}
                  </p>
                </div>
                <Badge variant="secondary">
                  {k.permissions === "full" ? "完整權限" : "僅訂閱"}
                </Badge>
                <div className="ml-auto flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    啟用
                    <Switch
                      checked={k.isActive}
                      onCheckedChange={async (v) => {
                        try {
                          await updateKey.mutateAsync({ id: k.id, data: { isActive: v } });
                          invalidateKeys();
                        } catch (e) {
                          toast({ title: "更新失敗", description: errMessage(e, ""), variant: "destructive" });
                        }
                      }}
                      data-testid={`switch-key-active-${k.id}`}
                    />
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600"
                    onClick={async () => {
                      if (!confirm(`確定刪除金鑰「${k.name}」？外部系統將無法再使用。`)) return;
                      try {
                        await deleteKey.mutateAsync({ id: k.id });
                        invalidateKeys();
                        toast({ title: "已刪除金鑰" });
                      } catch (e) {
                        toast({ title: "刪除失敗", description: errMessage(e, ""), variant: "destructive" });
                      }
                    }}
                    data-testid={`button-key-delete-${k.id}`}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增寄件域名</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-domain">域名</Label>
            <Input
              id="new-domain"
              placeholder="mail.example.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              data-testid="input-new-domain"
            />
            <p className="text-xs text-muted-foreground">
              新增後會取得 Resend 提供的 DNS 記錄，請至您的 DNS 服務商設定後再按「驗證」。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAddDomain} disabled={createDomain.isPending} data-testid="button-confirm-add-domain">
              新增
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={keyOpen} onOpenChange={setKeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增 API 金鑰</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-key-name">金鑰名稱</Label>
            <Input
              id="new-key-name"
              placeholder="例如：官網表單"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              data-testid="input-new-key-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeyOpen(false)}>
              取消
            </Button>
            <Button
              disabled={createKey.isPending}
              onClick={async () => {
                if (!newKeyName.trim()) {
                  toast({ title: "請輸入金鑰名稱", variant: "destructive" });
                  return;
                }
                try {
                  const created = await createKey.mutateAsync({ data: { name: newKeyName.trim() } });
                  invalidateKeys();
                  setKeyOpen(false);
                  setNewKeyName("");
                  setRevealedKey(created.key);
                } catch (e) {
                  toast({ title: "建立失敗", description: errMessage(e, ""), variant: "destructive" });
                }
              }}
              data-testid="button-confirm-add-key"
            >
              建立
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revealedKey} onOpenChange={(open) => !open && setRevealedKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>金鑰已建立</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              請立即複製並妥善保存，此金鑰只會顯示這一次，離開後將無法再次取得完整內容。
            </p>
            <div className="flex items-center gap-2 rounded-lg border bg-muted p-3">
              <code className="flex-1 break-all font-mono text-sm" data-testid="text-revealed-key">
                {revealedKey}
              </code>
              <button
                className="text-primary"
                onClick={() => {
                  if (revealedKey) navigator.clipboard.writeText(revealedKey);
                  toast({ title: "已複製金鑰" });
                }}
                data-testid="button-copy-revealed-key"
              >
                <Copy size={16} />
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealedKey(null)} data-testid="button-close-revealed-key">
              我已保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
