import { useState, useMemo } from "react";
import { useListAccounts, useCreateAccount } from "@workspace/erp-api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, FolderOpen, FileText, Plus, Pencil, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { AccountConfigurationTransfer } from "./account-configuration-transfer";

const typeMap: Record<string, string> = { Asset: "資產", Liability: "負債", Equity: "權益", Income: "收入", Expense: "費用" };
const typeColor: Record<string, string> = {
  Asset: "bg-blue-100 text-blue-700",
  Liability: "bg-red-100 text-red-700",
  Equity: "bg-purple-100 text-purple-700",
  Income: "bg-green-100 text-green-700",
  Expense: "bg-orange-100 text-orange-700",
};

const groupLabels: Record<string, string> = {
  "1": "1 - 資產", "2": "2 - 負債", "3": "3 - 權益",
  "4": "4 - 營業收入", "5": "5 - 營業成本",
  "6": "6 - 營業費用", "7": "7 - 營業外收支",
  "8": "8 - 所得稅", "9": "9 - 非常項目",
};

const accountTypes = ["Asset", "Liability", "Equity", "Income", "Expense"] as const;
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
const REPAIR_CONFIRMATION = "補齊育邦會計科目";

interface RepairPreview {
  tenantId: number;
  companyCode: string;
  total: number;
  existing: number;
  missing: Array<{ code: string; name: string; parentCode: string | null }>;
  conflicts: string[];
  fingerprint: string;
}

interface FormState {
  accountNumber: string;
  accountName: string;
  accountType: string;
  parentAccountId: string;
  isGroup: boolean;
  cashFlowCategory: string;
}

const emptyForm: FormState = { accountNumber: "", accountName: "", accountType: "Asset", parentAccountId: "", isGroup: false, cashFlowCategory: "" };

export default function AccountsPage() {
  const { data: accounts, isLoading } = useListAccounts();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const createMutation = useCreateAccount();

  const batch = useBatchSelection(accounts);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState("");
  const [repairOpen, setRepairOpen] = useState(false);
  const [repairPreview, setRepairPreview] = useState<RepairPreview | null>(null);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairApplying, setRepairApplying] = useState(false);
  const [repairConfirmation, setRepairConfirmation] = useState("");
  const [repairError, setRepairError] = useState("");
  const [repairResult, setRepairResult] = useState<{ inserted: number; existing: number } | null>(null);

  const canRepairYubonAccounts =
    user?.tenantId === 1 &&
    user.companyCode === "83483621" &&
    (user.role === "owner" || user.role === "super_admin");

  const readApiError = async (response: Response, fallback: string) => {
    const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    return body?.error || body?.message || fallback;
  };

  const loadRepairPreview = async () => {
    setRepairLoading(true);
    setRepairError("");
    setRepairResult(null);
    setRepairPreview(null);
    setRepairConfirmation("");
    try {
      const response = await fetch("/erp-api/accounts/baseline-repair/preview", {
        credentials: "include",
      });
      if (!response.ok) throw new Error(await readApiError(response, "無法取得科目補齊預覽"));
      const preview = await response.json() as RepairPreview;
      if (preview.tenantId !== 1 || preview.companyCode !== "83483621") {
        throw new Error("公司資料不符，已停止操作");
      }
      setRepairPreview(preview);
    } catch (cause) {
      setRepairError(cause instanceof Error ? cause.message : "無法取得科目補齊預覽");
    } finally {
      setRepairLoading(false);
    }
  };

  const openRepairPreview = () => {
    setRepairOpen(true);
    void loadRepairPreview();
  };

  const applyRepair = async () => {
    if (!repairPreview) return;
    setRepairApplying(true);
    setRepairError("");
    try {
      const response = await fetch("/erp-api/accounts/baseline-repair/apply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint: repairPreview.fingerprint,
          confirmation: repairConfirmation,
        }),
      });
      if (!response.ok) {
        const message = await readApiError(response, "科目補齊失敗");
        if (response.status === 409 || response.status === 412) {
          setRepairPreview(null);
          setRepairConfirmation("");
          throw new Error(`${message}，請重新取得預覽後再確認`);
        }
        throw new Error(message);
      }
      const result = await response.json() as { inserted: number; existing: number };
      setRepairResult(result);
      setRepairPreview(null);
      setRepairConfirmation("");
      await queryClient.invalidateQueries();
    } catch (cause) {
      setRepairError(cause instanceof Error ? cause.message : "科目補齊失敗");
    } finally {
      setRepairApplying(false);
    }
  };

  const groupAccounts = useMemo(() => {
    if (!accounts) return [];
    return accounts.filter(a => a.isGroup).sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
  }, [accounts]);

  const filtered = useMemo(() => {
    if (!accounts) return [];
    let list = [...accounts];
    if (activeTab !== "all") {
      list = list.filter(a => a.accountType === activeTab);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        a.accountNumber.toLowerCase().includes(q) ||
        a.accountName.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
    return list;
  }, [accounts, search, activeTab]);

  const groups = useMemo(() => {
    if (!filtered) return {};
    const g: Record<string, typeof filtered> = {};
    filtered.forEach(a => {
      const key = a.accountNumber[0];
      if (!g[key]) g[key] = [];
      g[key].push(a);
    });
    return g;
  }, [filtered]);

  const typeCounts = useMemo(() => {
    if (!accounts) return {};
    const c: Record<string, number> = {};
    accounts.forEach(a => {
      c[a.accountType] = (c[a.accountType] || 0) + 1;
    });
    return c;
  }, [accounts]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setShowDialog(true);
  };

  const openEdit = (a: NonNullable<typeof accounts>[0]) => {
    setEditingId(a.id);
    setForm({
      accountNumber: a.accountNumber,
      accountName: a.accountName,
      accountType: a.accountType,
      parentAccountId: a.parentAccountId ? String(a.parentAccountId) : "",
      isGroup: a.isGroup ?? false,
      cashFlowCategory: (a as typeof a & { cashFlowCategory?: string | null }).cashFlowCategory || "",
    });
    setError("");
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!form.accountNumber.trim() || !form.accountName.trim()) {
      setError("科目編號及名稱為必填");
      return;
    }
    setError("");
    try {
      if (editingId) {
        const response = await fetch(`/erp-api/accounts/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountName: form.accountName,
            accountType: form.accountType,
            ...(form.parentAccountId ? { parentAccountId: Number(form.parentAccountId) } : {}),
            isGroup: form.isGroup,
            cashFlowCategory: form.cashFlowCategory || null,
          }),
        });
        if (!response.ok) throw new Error((await response.json()).error || "儲存失敗");
      } else {
        await createMutation.mutateAsync({
          data: {
            accountNumber: form.accountNumber,
            accountName: form.accountName,
            accountType: form.accountType,
            parentAccountId: form.parentAccountId ? Number(form.parentAccountId) : undefined,
            isGroup: form.isGroup,
            ...(form.cashFlowCategory ? { cashFlowCategory: form.cashFlowCategory } : {}),
          } as any,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/erp-api/accounts"] });
      setShowDialog(false);
    } catch (e: any) {
      setError(e?.message || "儲存失敗");
    }
  };

  const saving = createMutation.isPending;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="會計科目" description="臺灣標準會計科目表" />
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-gray-200 rounded w-64" />
          <div className="h-96 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="會計科目" description="臺灣標準會計科目表（依商業會計法）" />

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="會計科目"
          entityEndpoint="accounts"
          ids={batch.ids}
          batchFields={[]}
          onClear={batch.clearSelection}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ["/erp-api/accounts"] })}
        />
      )}

      <div className="flex flex-col sm:flex-row gap-3 justify-between">
        <div className="grid grid-cols-1 md:grid-cols-2 md:grid-cols-5 gap-3 flex-1">
          {accountTypes.map(type => (
            <Card key={type} className={`cursor-pointer transition-all ${activeTab === type ? "ring-2 ring-blue-500" : ""}`}
              onClick={() => setActiveTab(activeTab === type ? "all" : type)}>
              <CardContent className="py-3 px-4">
                <div className="text-sm text-gray-500">{typeMap[type]}</div>
                <div className="text-2xl font-bold">{typeCounts[type] || 0}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="搜尋科目編號或名稱..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          {canRepairYubonAccounts && (
            <Button variant="outline" onClick={openRepairPreview} className="shrink-0">
              <RefreshCw className="h-4 w-4 mr-1" />補齊育邦科目
            </Button>
          )}
          <Button onClick={openCreate} className="shrink-0">
            <Plus className="h-4 w-4 mr-1" />新增科目
          </Button>
        </div>
      </div>

      <div className="text-sm text-gray-500">
        共 {filtered.length} 筆科目 {activeTab !== "all" && `（${typeMap[activeTab]}）`}
      </div>
      <AccountConfigurationTransfer key={`${user?.tenantId}:${user?.id}:${user?.companyCode}`} />

      {Object.keys(groups).sort().map(key => (
        <Card key={key}>
          <CardHeader className="py-3">
            <CardTitle className="text-base">{groupLabels[key] || `${key} 類`}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50/50">
                    <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                    <th className="text-left px-4 py-2 w-24 font-medium">科目編號</th>
                    <th className="text-left px-4 py-2 font-medium">科目名稱</th>
                    <th className="text-left px-4 py-2 w-20 font-medium hidden sm:table-cell">類型</th>
                    <th className="text-left px-4 py-2 w-16 font-medium hidden md:table-cell">分類</th>
                    <th className="text-right px-4 py-2 w-32 font-medium">目前餘額</th>
                    <th className="text-center px-4 py-2 w-16 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {groups[key].map(a => (
                    <tr key={a.id} className={`border-b last:border-0 hover:bg-gray-50 ${a.isGroup ? "bg-blue-50/50 font-semibold" : ""}`}>
                      <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(a.id)} onChange={() => batch.toggle(a.id)} /></td>
                      <td className="px-4 py-2 font-mono text-xs">{a.accountNumber}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {a.isGroup ? <FolderOpen className="h-4 w-4 text-blue-500 shrink-0" /> : <FileText className="h-3.5 w-3.5 text-gray-400 shrink-0" />}
                          <span className={a.isGroup ? "" : `${a.accountNumber.length <= 2 ? "" : "pl-2"}`}>{a.accountName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 hidden sm:table-cell">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${typeColor[a.accountType] || "bg-gray-100"}`}>
                          {typeMap[a.accountType] || a.accountType}
                        </span>
                      </td>
                      <td className="px-4 py-2 hidden md:table-cell">
                        {a.isGroup ? <Badge variant="default" className="text-xs">群組</Badge> : <span className="text-gray-400 text-xs">明細</span>}
                      </td>
                      <td className="px-4 py-2 text-right font-mono" title={`期初 ${Number(a.balance).toLocaleString()}`}>{a.isGroup ? <span className="text-gray-300">—</span> : `$${Number((a as any).currentBalance ?? a.balance).toLocaleString()}`}</td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => openEdit(a)}
                          className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors"
                          title="編輯"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "編輯科目" : "新增科目"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">科目編號 *</label>
              <Input
                value={form.accountNumber}
                onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))}
                placeholder="例如：1101"
                disabled={!!editingId}
                className={editingId ? "bg-gray-100 text-gray-500" : ""}
              />
              {editingId && <p className="text-xs text-gray-400 mt-1">科目編號建立後無法修改</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">科目名稱 *</label>
              <Input
                value={form.accountName}
                onChange={e => setForm(f => ({ ...f, accountName: e.target.value }))}
                placeholder="例如：現金"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">科目類型</label>
              <select
                value={form.accountType}
                onChange={e => setForm(f => ({ ...f, accountType: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {accountTypes.map(t => <option key={t} value={t}>{typeMap[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">上層群組科目</label>
              <select
                value={form.parentAccountId}
                onChange={e => setForm(f => ({ ...f, parentAccountId: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">無（頂層科目）</option>
                {groupAccounts
                  .filter(g => g.accountType === form.accountType && g.id !== editingId)
                  .map(g => (
                    <option key={g.id} value={g.id}>{g.accountNumber} - {g.accountName}</option>
                  ))
                }
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">現金流量分類</label>
              <select
                value={form.cashFlowCategory}
                onChange={e => setForm(f => ({ ...f, cashFlowCategory: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">自動判斷</option>
                <option value="operating">營業</option>
                <option value="investing">投資</option>
                <option value="financing">籌資</option>
                <option value="cash">現金</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isGroup"
                checked={form.isGroup}
                onChange={e => setForm(f => ({ ...f, isGroup: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="isGroup" className="text-sm text-gray-700">設為群組科目（不可直接過帳的彙總科目）</label>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "儲存中..." : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canRepairYubonAccounts && (
        <Dialog open={repairOpen} onOpenChange={setRepairOpen}>
          <DialogContent className="md:max-w-2xl">
            <DialogHeader>
              <DialogTitle>補齊育邦會計科目</DialogTitle>
              <DialogDescription>
                僅新增缺少的科目，不會覆寫目前的科目或帳務資料。
              </DialogDescription>
            </DialogHeader>

            {repairLoading && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在檢查目前科目…
              </div>
            )}

            {!repairLoading && repairResult && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800" role="status">
                補齊完成：新增 {repairResult.inserted} 筆，原有 {repairResult.existing} 筆。
              </div>
            )}

            {!repairLoading && repairPreview && (
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="font-medium">請確認操作公司</div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">公司</dt>
                    <dd className="font-medium">育邦</dd>
                    <dt className="text-muted-foreground">公司編碼</dt>
                    <dd className="font-mono">{repairPreview.companyCode}</dd>
                    <dt className="text-muted-foreground">預計總數</dt>
                    <dd>{repairPreview.total} 筆</dd>
                    <dt className="text-muted-foreground">目前已有</dt>
                    <dd>{repairPreview.existing} 筆</dd>
                    <dt className="text-muted-foreground">缺少</dt>
                    <dd className="font-semibold">{repairPreview.missing.length} 筆</dd>
                  </dl>
                </div>

                {repairPreview.conflicts.length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
                    <div className="flex items-center gap-2 font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      發現科目結構衝突，無法補齊
                    </div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {repairPreview.conflicts.map((conflict, index) => <li key={index}>{conflict}</li>)}
                    </ul>
                  </div>
                )}

                {repairPreview.missing.length > 0 ? (
                  <div>
                    <div className="mb-2 text-sm font-medium">將新增的科目</div>
                    <div className="max-h-56 overflow-y-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">編號</th>
                            <th className="px-3 py-2 text-left font-medium">名稱</th>
                            <th className="px-3 py-2 text-left font-medium">上層編號</th>
                          </tr>
                        </thead>
                        <tbody>
                          {repairPreview.missing.map(item => (
                            <tr key={item.code} className="border-t">
                              <td className="px-3 py-2 font-mono">{item.code}</td>
                              <td className="px-3 py-2">{item.name}</td>
                              <td className="px-3 py-2 font-mono text-muted-foreground">{item.parentCode || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border bg-muted/30 p-4 text-sm">目前沒有缺少的科目。</div>
                )}

                <div>
                  <label htmlFor="repair-confirmation" className="mb-1 block text-sm font-medium">
                    請輸入「{REPAIR_CONFIRMATION}」確認
                  </label>
                  <Input
                    id="repair-confirmation"
                    value={repairConfirmation}
                    onChange={event => setRepairConfirmation(event.target.value)}
                    autoComplete="off"
                    disabled={repairApplying}
                  />
                </div>
              </div>
            )}

            {repairError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                {repairError}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setRepairOpen(false)} disabled={repairApplying}>
                {repairResult ? "關閉" : "取消"}
              </Button>
              {!repairLoading && !repairPreview && !repairResult && (
                <Button variant="outline" onClick={() => void loadRepairPreview()} disabled={repairApplying}>
                  重新取得預覽
                </Button>
              )}
              {repairPreview && (
                <Button
                  onClick={() => void applyRepair()}
                  disabled={
                    repairApplying ||
                    repairLoading ||
                    repairPreview.conflicts.length > 0 ||
                    repairPreview.missing.length === 0 ||
                    repairConfirmation !== REPAIR_CONFIRMATION
                  }
                >
                  {repairApplying && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  {repairApplying ? "補齊中…" : "確認補齊"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
