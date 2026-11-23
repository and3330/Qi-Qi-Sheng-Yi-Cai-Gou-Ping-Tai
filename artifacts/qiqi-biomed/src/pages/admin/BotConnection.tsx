import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMcpApiKeys,
  getListMcpApiKeysQueryKey,
  useCreateMcpApiKey,
  useUpdateMcpApiKey,
  useDeleteMcpApiKey,
  useListMcpActions,
  getListMcpActionsQueryKey,
  useConfirmMcpAction,
  useRejectMcpAction,
  type McpAction,
} from "@workspace/api-client-react";
import { Bot, Check, Copy, KeyRound, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { AdminLayout } from "./AdminLayout";

function errMessage(e: unknown, fallback: string) {
  const anyE = e as any;
  return anyE?.data?.error || anyE?.message || fallback;
}

const ACTION_LABEL: Record<string, string> = {
  update_order_status: "變更訂單狀態",
  set_order_shipment: "填入出貨資訊（貨運公司、運送單號）",
  adjust_stock: "調整庫存",
  topup_institution_wallet: "機構錢包儲值／調整",
  set_article_status: "變更文章狀態",
  create_order: "代會員下單",
  update_sales_order_status: "變更銷貨單狀態",
  convert_quotation_to_order: "報價單轉訂單",
  admin_write: "後台操作",
};

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: "待確認", cls: "bg-amber-100 text-amber-700" },
  executing: { text: "執行中", cls: "bg-blue-100 text-blue-700" },
  ok: { text: "已執行", cls: "bg-green-100 text-green-700" },
  error: { text: "執行失敗", cls: "bg-red-100 text-red-700" },
  rejected: { text: "已拒絕", cls: "bg-muted text-muted-foreground" },
  expired: { text: "已逾時", cls: "bg-muted text-muted-foreground" },
};

const formatTime = (iso: string) => new Date(iso).toLocaleString("zh-TW", { hour12: false });

function ActionCard({
  action,
  highlighted,
  busy,
  onConfirm,
  onReject,
}: {
  action: McpAction;
  highlighted: boolean;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const status = STATUS_LABEL[action.status] ?? { text: action.status, cls: "bg-muted" };
  return (
    <div
      className={`rounded-xl border bg-card p-4 ${highlighted ? "ring-2 ring-primary" : ""}`}
      data-testid={`bot-action-${action.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{ACTION_LABEL[action.action] ?? action.action}</span>
        <Badge className={status.cls}>{status.text}</Badge>
        <span className="text-xs text-muted-foreground">
          #{action.id}・{action.keyName}・{formatTime(action.createdAt)}
        </span>
      </div>
      {action.action === "admin_write" && typeof (action.payload as { summary?: unknown })?.summary === "string" && (
        <p className="mt-3 text-sm font-medium" data-testid={`bot-action-summary-${action.id}`}>
          {(action.payload as { summary: string }).summary}
        </p>
      )}
      {action.action === "admin_write" && (
        <p className="mt-1 text-xs text-amber-700">
          上面的說明是 Bot 自己寫的，實際會執行的內容以下方為準，請核對後再確認。
        </p>
      )}
      <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-3 text-xs">
        {JSON.stringify(action.payload, null, 2)}
      </pre>
      {action.result && action.status !== "pending" && (
        <p className="mt-2 break-all text-xs text-muted-foreground">結果：{action.result}</p>
      )}
      {action.status === "pending" && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={onReject}>
            <X size={14} className="mr-1" />
            拒絕
          </Button>
          <Button size="sm" disabled={busy} onClick={onConfirm}>
            <Check size={14} className="mr-1" />
            確認執行
          </Button>
        </div>
      )}
    </div>
  );
}

export default function BotConnection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";

  // 從 Bot 給的確認連結進來時，網址會帶 ?action=編號
  const highlightedId = Number(new URLSearchParams(window.location.search).get("action")) || null;

  const { data: actions, isLoading: actionsLoading } = useListMcpActions(undefined, {
    query: { queryKey: getListMcpActionsQueryKey(), refetchInterval: 15000 },
  });
  const { data: keys } = useListMcpApiKeys({
    query: { queryKey: getListMcpApiKeysQueryKey(), enabled: isAdmin },
  });

  const confirmAction = useConfirmMcpAction();
  const rejectAction = useRejectMcpAction();
  const createKey = useCreateMcpApiKey();
  const updateKey = useUpdateMcpApiKey();
  const deleteKey = useDeleteMcpApiKey();

  const [keyOpen, setKeyOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const refreshActions = () =>
    queryClient.invalidateQueries({ queryKey: getListMcpActionsQueryKey() });
  const refreshKeys = () =>
    queryClient.invalidateQueries({ queryKey: getListMcpApiKeysQueryKey() });

  const handleConfirm = async (action: McpAction) => {
    const label = ACTION_LABEL[action.action] ?? action.action;
    if (!window.confirm(`確定執行「${label}」？執行後無法從這裡復原。`)) return;
    try {
      await confirmAction.mutateAsync({ id: action.id });
      toast({ title: "已確認並執行" });
    } catch (e) {
      toast({ title: "執行失敗", description: errMessage(e, ""), variant: "destructive" });
    }
    refreshActions();
  };

  const handleReject = async (action: McpAction) => {
    try {
      await rejectAction.mutateAsync({ id: action.id });
      toast({ title: "已拒絕" });
    } catch (e) {
      toast({ title: "操作失敗", description: errMessage(e, ""), variant: "destructive" });
    }
    refreshActions();
  };

  const handleCreateKey = async () => {
    const name = newKeyName.trim();
    if (!name) {
      toast({ title: "請填寫金鑰名稱", variant: "destructive" });
      return;
    }
    try {
      const created = await createKey.mutateAsync({ data: { name } });
      setRevealedKey(created.key);
      setKeyOpen(false);
      setNewKeyName("");
      refreshKeys();
    } catch (e) {
      toast({ title: "新增失敗", description: errMessage(e, ""), variant: "destructive" });
    }
  };

  const endpoint = `${window.location.origin}/api/mcp`;
  const pending = (actions ?? []).filter((a) => a.status === "pending");
  const history = (actions ?? []).filter((a) => a.status !== "pending");
  const busy = confirmAction.isPending || rejectAction.isPending;

  return (
    <AdminLayout title="Bot 連線">
      <div className="space-y-8">
        <section className="rounded-xl border bg-card p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <Bot size={18} />
            連線方式
          </div>
          <p className="mt-2 text-muted-foreground">
            外部 Bot 以 MCP 連到下面的網址，並在標頭帶上金鑰（Authorization: Bearer 金鑰）。Bot
            能用的功能與後台「AI 助理」相同：查詢類直接回答；會改動資料的操作只會送到這一頁，
            由後台人員按下確認後才執行。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-muted px-2 py-1">{endpoint}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(endpoint);
                toast({ title: "已複製網址" });
              }}
            >
              <Copy size={14} className="mr-1" />
              複製
            </Button>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-bold">待確認操作（{pending.length}）</h2>
          {actionsLoading && <p className="text-sm text-muted-foreground">載入中...</p>}
          {!actionsLoading && pending.length === 0 && (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              目前沒有等待確認的操作
            </p>
          )}
          <div className="space-y-3">
            {pending.map((a) => (
              <ActionCard
                key={a.id}
                action={a}
                highlighted={a.id === highlightedId}
                busy={busy}
                onConfirm={() => handleConfirm(a)}
                onReject={() => handleReject(a)}
              />
            ))}
          </div>
        </section>

        {history.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-bold">最近紀錄</h2>
            <div className="space-y-3">
              {history.map((a) => (
                <ActionCard
                  key={a.id}
                  action={a}
                  highlighted={a.id === highlightedId}
                  busy={busy}
                  onConfirm={() => handleConfirm(a)}
                  onReject={() => handleReject(a)}
                />
              ))}
            </div>
          </section>
        )}

        {isAdmin && (
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <KeyRound size={18} />
                連線金鑰
              </h2>
              <Button size="sm" onClick={() => setKeyOpen(true)}>
                <Plus size={14} className="mr-1" />
                新增金鑰
              </Button>
            </div>
            {(keys ?? []).length === 0 && (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                尚未建立金鑰
              </p>
            )}
            <div className="space-y-2">
              {(keys ?? []).map((k) => (
                <div
                  key={k.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{k.name}</p>
                    <p className="text-xs text-muted-foreground">
                      末四碼 {k.keyLastFour}・代表 {k.memberName}・
                      {k.lastUsedAt ? `最後使用 ${formatTime(k.lastUsedAt)}` : "尚未使用"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{k.isActive ? "啟用" : "停用"}</span>
                    <Switch
                      checked={k.isActive}
                      onCheckedChange={async (checked) => {
                        try {
                          await updateKey.mutateAsync({ id: k.id, data: { isActive: checked } });
                        } catch (e) {
                          toast({ title: "更新失敗", description: errMessage(e, ""), variant: "destructive" });
                        }
                        refreshKeys();
                      }}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    aria-label="刪除金鑰"
                    onClick={async () => {
                      if (!window.confirm(`確定刪除金鑰「${k.name}」？使用這把金鑰的 Bot 會立刻無法連線。`)) return;
                      try {
                        await deleteKey.mutateAsync({ id: k.id });
                      } catch (e) {
                        toast({ title: "刪除失敗", description: errMessage(e, ""), variant: "destructive" });
                      }
                      refreshKeys();
                    }}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <Dialog open={keyOpen} onOpenChange={setKeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增連線金鑰</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>名稱</Label>
            <Input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="例如：客服 Bot"
            />
            <p className="text-xs text-muted-foreground">
              這把金鑰會代表你的帳號；Bot 送出的操作都會記在你名下。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeyOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateKey} disabled={createKey.isPending}>
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
          <p className="text-sm text-muted-foreground">
            請現在複製並妥善保存。關閉後無法再次查看，遺失只能刪除重建。
          </p>
          <code className="block break-all rounded bg-muted p-3 text-sm">{revealedKey}</code>
          <DialogFooter>
            <Button
              onClick={() => {
                if (revealedKey) void navigator.clipboard.writeText(revealedKey);
                toast({ title: "已複製金鑰" });
              }}
            >
              <Copy size={14} className="mr-1" />
              複製金鑰
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
