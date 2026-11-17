import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiKeyApi, type ApiKeyRecord } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Key, Plus, Trash2, RefreshCw, Copy, Eye, EyeOff, Check, X } from "lucide-react";

import { LookupSelect } from "@/components/shared/lookup-select";
export default function ApiKeys() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<ApiKeyRecord | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ keyName: "", projectId: "", permissions: "read", expiresAt: "" });

  const { data: keys = [], isLoading } = useQuery({ queryKey: ["/erp-api/api-keys"], queryFn: apiKeyApi.list });
  const { data: projects = [] } = useQuery({
    queryKey: ["/erp-api/projects"],
    queryFn: () => fetch(`/erp-api/projects`).then((r) => r.json()),
  });

  const createMut = useMutation({
    mutationFn: apiKeyApi.create,
    onSuccess: (data) => {
      setNewKey(data);
      setShowCreate(false);
      setForm({ keyName: "", projectId: "", permissions: "read", expiresAt: "" });
      qc.invalidateQueries({ queryKey: ["/erp-api/api-keys"] });
      toast({ title: "API 金鑰已建立", description: "請立即複製並保存 Secret，此後將無法再次查看。" });
    },
    onError: (e: Error) => toast({ title: "建立失敗", description: e.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => apiKeyApi.update(id, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/erp-api/api-keys"] }),
  });

  const deleteMut = useMutation({
    mutationFn: apiKeyApi.delete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/erp-api/api-keys"] });
      toast({ title: "已刪除" });
    },
  });

  const regenMut = useMutation({
    mutationFn: apiKeyApi.regenerate,
    onSuccess: (data) => {
      setNewKey(data);
      qc.invalidateQueries({ queryKey: ["/erp-api/api-keys"] });
      toast({ title: "金鑰已重新產生" });
    },
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `已複製 ${label}` });
  };

  const handleCreate = () => {
    createMut.mutate({
      keyName: form.keyName,
      projectId: form.projectId ? Number(form.projectId) : null,
      permissions: form.permissions,
      expiresAt: form.expiresAt || null,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">API 金鑰管理</h1>
          <p className="text-muted-foreground">管理外部系統串接用的 API 金鑰</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={16} className="mr-2" />
          建立新金鑰
        </Button>
      </div>

      {newKey && (
        <div className="bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-semibold">
            <Key size={18} />
            新金鑰已建立 — 請立即複製並妥善保存
          </div>
          <div className="grid gap-3">
            <div>
              <label className="text-xs text-muted-foreground">名稱</label>
              <div className="font-medium">{newKey.keyName}</div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">API Key</label>
              <div className="flex items-center gap-2">
                <code className="bg-background px-3 py-1.5 rounded text-sm flex-1 overflow-x-auto">{newKey.apiKey}</code>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(newKey.apiKey, "API Key")}>
                  <Copy size={14} />
                </Button>
              </div>
            </div>
            {newKey.apiSecret && (
              <div>
                <label className="text-xs text-muted-foreground">API Secret（僅顯示一次）</label>
                <div className="flex items-center gap-2">
                  <code className="bg-background px-3 py-1.5 rounded text-sm flex-1 overflow-x-auto text-red-600 dark:text-red-400">
                    {showSecrets["new"] ? newKey.apiSecret : "•".repeat(40)}
                  </code>
                  <Button variant="ghost" size="sm" onClick={() => setShowSecrets((p) => ({ ...p, new: !p.new }))}>
                    {showSecrets["new"] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard(newKey.apiSecret!, "API Secret")}>
                    <Copy size={14} />
                  </Button>
                </div>
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setNewKey(null)}>
            我已保存，關閉提示
          </Button>
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="md:max-w-2xl max-h-[90dvh] overflow-y-auto" data-testid="dialog-api-key-form">
          <DialogHeader>
            <DialogTitle>建立新 API 金鑰</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm text-muted-foreground">金鑰名稱 *</label>
              <Input
                placeholder="例：網站 A 串接用"
                value={form.keyName}
                onChange={(e) => setForm({ ...form, keyName: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">所屬專案</label>
              <LookupSelect
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
              >
                <option value="">全域（不限專案）</option>
                {(projects as any[]).map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </LookupSelect>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">權限</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.permissions}
                onChange={(e) => setForm({ ...form, permissions: e.target.value })}
              >
                <option value="read">唯讀 (Read)</option>
                <option value="readwrite">讀寫 (Read/Write)</option>
                <option value="admin">管理員 (Admin)</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">有效期限（選填）</label>
              <Input
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
            </div>
          </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={!form.keyName || createMut.isPending}>建立</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-4 py-3 font-medium">名稱</th>
                <th className="text-left px-4 py-3 font-medium">API Key</th>
                <th className="text-left px-4 py-3 font-medium">專案</th>
                <th className="text-left px-4 py-3 font-medium">權限</th>
                <th className="text-left px-4 py-3 font-medium">狀態</th>
                <th className="text-left px-4 py-3 font-medium">最後使用</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">載入中...</td></tr>
              ) : keys.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">尚未建立任何 API 金鑰</td></tr>
              ) : (
                keys.map((k) => (
                  <tr key={k.id} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{k.keyName}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <code className="text-xs bg-muted px-2 py-0.5 rounded">{k.maskedKey}</code>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copyToClipboard(k.apiKey, "API Key")}>
                          <Copy size={12} />
                        </Button>
                      </div>
                    </td>
                    <td className="px-4 py-3">{k.projectName}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        k.permissions === "admin" ? "bg-red-100 text-red-700" :
                        k.permissions === "readwrite" ? "bg-blue-100 text-blue-700" :
                        "bg-gray-100 text-gray-700"
                      }`}>
                        {k.permissions === "admin" ? "管理員" : k.permissions === "readwrite" ? "讀寫" : "唯讀"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleMut.mutate({ id: k.id, isActive: !k.isActive })}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                          k.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {k.isActive ? <><Check size={10} />啟用</> : <><X size={10} />停用</>}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("zh-TW") : "尚未使用"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost" size="sm" className="h-7 w-7 p-0"
                          onClick={() => { if (confirm("確定要重新產生金鑰？舊金鑰將立即失效。")) regenMut.mutate(k.id); }}
                        >
                          <RefreshCw size={14} />
                        </Button>
                        <Button
                          variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                          onClick={() => { if (confirm("確定要刪除此金鑰？")) deleteMut.mutate(k.id); }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-xl p-6 space-y-3">
        <h3 className="font-semibold text-blue-700 dark:text-blue-400">串接方式說明</h3>
        <div className="text-sm space-y-2 text-blue-900 dark:text-blue-200">
          <p><strong>驗證方式一：Bearer Token</strong></p>
          <code className="block bg-blue-100 dark:bg-blue-900 px-3 py-2 rounded text-xs">
            Authorization: Bearer &lt;API_KEY&gt;:&lt;API_SECRET&gt;
          </code>
          <p><strong>驗證方式二：自訂標頭</strong></p>
          <code className="block bg-blue-100 dark:bg-blue-900 px-3 py-2 rounded text-xs">
            X-API-Key: &lt;API_KEY&gt;<br />
            X-API-Secret: &lt;API_SECRET&gt;
          </code>
          <p className="text-xs mt-2">所有 API 端點皆位於 <code>/erp-api/</code> 路徑下。驗證通過後即可使用所有模組的 API。</p>
        </div>
      </div>
    </div>
  );
}
