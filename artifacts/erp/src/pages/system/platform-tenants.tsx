import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Building2, ChevronDown, ChevronRight } from "lucide-react";
import { topLevelNavs, navGroups, type NavItem } from "@/components/layout/sidebar";
import { companyCodeValidationMessage, isValidCompanyCode, normalizeCompanyCode } from "@/lib/company-code";

/** 平台管理後台：檢視註冊公司、開放模組（僅平台方 tenant 1 super_admin 可用） */

const DISABLED = "__disabled__";

/** 基礎功能頁：不可停用，不列入模組開關（需與 api-server module-guard 的 FOUNDATION_PATHS 一致） */
const FOUNDATION_PATHS = [
  "/billing",
  "/hr/me",
  "/platform/tenants",
  "/admin/permissions",
  "/admin/menu-permissions",
  "/admin/api-docs",
  "/system/notifications",
  "/system/file-management",
];
interface TenantRow {
  id: number; name: string; status: string; isExempt: boolean;
  companyCode: string | null;
  trialEndsAt: string | null; aiCredits: number; contactEmail: string | null;
  createdAt: string; hasSubscription: boolean; userCount: number;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/erp-api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: "請求失敗" }));
    throw new Error(e.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** 從 sidebar 導覽定義攤平出「模組群 → 頁面」結構，供勾選 */
function buildCatalog() {
  const groups: { label: string; pages: { label: string; path: string }[] }[] = [];
  const flattenItems = (items: NavItem[]): { label: string; path: string }[] => {
    const out: { label: string; path: string }[] = [];
    for (const it of items) {
      if (it.path && !FOUNDATION_PATHS.includes(it.path)) out.push({ label: it.label, path: it.path });
      for (const c of it.children || []) {
        if (!FOUNDATION_PATHS.includes(c.path)) out.push({ label: `${it.label}｜${c.label}`, path: c.path });
      }
    }
    return out;
  };
  groups.push({ label: "AI 助理", pages: flattenItems(topLevelNavs) });
  for (const g of navGroups) groups.push({ label: g.groupLabel, pages: flattenItems(g.items) });
  return groups;
}

/** 單一租戶的帳務調整區：AI 點數、試用期限、免收費 */
function TenantBilling({ tenant, onUpdated }: { tenant: TenantRow; onUpdated: (patch: Partial<TenantRow>) => void }) {
  const [companyCode, setCompanyCode] = useState(tenant.companyCode ?? "");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [trial, setTrial] = useState(tenant.trialEndsAt ? tenant.trialEndsAt.slice(0, 10) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setNote(null);
    try { await fn(); }
    catch (e: any) { setNote({ ok: false, text: e.message }); }
    finally { setBusy(null); }
  };

  const adjustCredits = () => run("credits", async () => {
    const d = parseInt(delta, 10);
    const r = await api<{ aiCredits: number }>(`/platform/tenants/${tenant.id}/credits`, {
      method: "POST",
      body: JSON.stringify({ delta: d, reason }),
    });
    onUpdated({ aiCredits: r.aiCredits });
    setDelta(""); setReason("");
    setNote({ ok: true, text: `點數已調整，新餘額 ${r.aiCredits} 點。` });
  });

  const saveCompanyCode = () => run("companyCode", async () => {
    const value = normalizeCompanyCode(companyCode);
    const validationError = companyCodeValidationMessage(value);
    if (validationError) throw new Error(validationError);
    await api(`/platform/tenants/${tenant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ companyCode: value }),
    });
    setCompanyCode(value);
    onUpdated({ companyCode: value });
    setNote({ ok: true, text: `公司編碼已更新為 ${value}。` });
  });

  const saveTrial = () => run("trial", async () => {
    const value = trial ? new Date(`${trial}T23:59:59`).toISOString() : null;
    await api(`/platform/tenants/${tenant.id}`, { method: "PATCH", body: JSON.stringify({ trialEndsAt: value }) });
    onUpdated({ trialEndsAt: value });
    setNote({ ok: true, text: value ? `試用期限已更新為 ${trial}。` : "已清除試用期限。" });
  });

  const toggleExempt = (on: boolean) => run("exempt", async () => {
    await api(`/platform/tenants/${tenant.id}`, { method: "PATCH", body: JSON.stringify({ isExempt: on }) });
    onUpdated({ isExempt: on });
    setNote({ ok: true, text: on ? "已標記為免收費。" : "已取消免收費。" });
  });

  const companyCodeError = companyCode ? companyCodeValidationMessage(companyCode) : null;

  return (
    <div className="border rounded-md p-3 space-y-3">
      <div className="font-medium">公司與帳務調整</div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor={`company-code-${tenant.id}`} className="block text-sm text-muted-foreground">
            公司編碼（統編）
            <span className="ml-2 text-xs">{tenant.companyCode ?? "尚未設定"}</span>
          </label>
          <Input
            id={`company-code-${tenant.id}`}
            className="w-40"
            value={companyCode}
            onChange={(e) => setCompanyCode(e.target.value)}
            inputMode="numeric"
            maxLength={8}
            placeholder="8 位半形數字"
            aria-describedby={`company-code-hint-${tenant.id}`}
            aria-invalid={companyCodeError ? true : undefined}
            data-testid={`input-company-code-${tenant.id}`}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={saveCompanyCode}
          disabled={busy !== null || !isValidCompanyCode(companyCode) || normalizeCompanyCode(companyCode) === tenant.companyCode}
          data-testid={`button-save-company-code-${tenant.id}`}
        >
          {busy === "companyCode" && <Loader2 className="animate-spin mr-1" size={14} />}
          更新公司編碼
        </Button>
        <span
          id={`company-code-hint-${tenant.id}`}
          className={`w-full text-xs ${companyCodeError ? "text-destructive" : "text-muted-foreground"}`}
          role={companyCodeError ? "alert" : undefined}
        >
          {companyCodeError ?? "公司編碼須由平台管理員明確指派；未設定時不會自動推測統編。"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground w-28">AI 點數（{tenant.aiCredits} 點）</span>
        <Input className="w-28" type="number" placeholder="+50 / -10" value={delta}
          onChange={(e) => setDelta(e.target.value)} data-testid={`input-credits-delta-${tenant.id}`} />
        <Input className="w-64" placeholder="原因（必填，例如：客服補償）" value={reason}
          onChange={(e) => setReason(e.target.value)} data-testid={`input-credits-reason-${tenant.id}`} />
        <Button size="sm" onClick={adjustCredits}
          disabled={busy !== null || !reason.trim() || !parseInt(delta, 10)}
          data-testid={`button-adjust-credits-${tenant.id}`}>
          {busy === "credits" && <Loader2 className="animate-spin mr-1" size={14} />}調整點數
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground w-28">試用期限</span>
        <Input className="w-40" type="date" value={trial} onChange={(e) => setTrial(e.target.value)}
          data-testid={`input-trial-${tenant.id}`} />
        <Button size="sm" variant="outline" onClick={saveTrial} disabled={busy !== null}
          data-testid={`button-save-trial-${tenant.id}`}>
          {busy === "trial" && <Loader2 className="animate-spin mr-1" size={14} />}更新試用期限
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={tenant.isExempt} disabled={busy !== null}
          onCheckedChange={(v) => toggleExempt(v === true)} data-testid={`checkbox-exempt-${tenant.id}`} />
        免收費（內部/創始租戶，不受訂閱狀態影響）
      </label>
      {note && <div className={`text-sm ${note.ok ? "text-green-700" : "text-red-600"}`}>{note.text}</div>}
    </div>
  );
}

interface CreditTx {
  id: number; delta: number; balanceAfter: number; reason: string;
  stripeRef: string | null; createdAt: string;
}
const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  trialing: { text: "試用中", cls: "bg-amber-100 text-amber-800" },
  active: { text: "訂閱中", cls: "bg-green-100 text-green-800" },
  past_due: { text: "逾期未付", cls: "bg-red-100 text-red-800" },
  canceled: { text: "已取消", cls: "bg-gray-200 text-gray-700" },
};

export default function PlatformTenantsPage() {
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [modules, setModules] = useState<Record<string, string[]>>({});
  const [loadingModules, setLoadingModules] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const catalog = useMemo(buildCatalog, []);

  useEffect(() => {
    api<TenantRow[]>("/platform/tenants").then(setTenants).catch((e) => setErr(e.message));
  }, []);

  const openTenant = async (id: number) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id); setMsg(null); setLoadingModules(true);
    try {
      setModules(await api<Record<string, string[]>>(`/platform/tenants/${id}/modules`));
    } catch (e: any) { setErr(e.message); }
    finally { setLoadingModules(false); }
  };

  const isEnabled = (path: string) => !(modules[path] || []).includes(DISABLED);
  const toggle = (path: string, on: boolean) => {
    setModules((m) => {
      const next = { ...m };
      const prev = (next[path] || []).filter((r) => r !== DISABLED);
      next[path] = on ? prev : [...prev, DISABLED];
      return next;
    });
  };
  const toggleGroup = (pages: { path: string }[], on: boolean) => {
    setModules((m) => {
      const next = { ...m };
      for (const p of pages) {
        const prev = (next[p.path] || []).filter((r) => r !== DISABLED);
        next[p.path] = on ? prev : [...prev, DISABLED];
      }
      return next;
    });
  };

  const save = async () => {
    if (openId == null) return;
    setSaving(true); setMsg(null);
    try {
      await api(`/platform/tenants/${openId}/modules`, {
        method: "PUT",
        body: JSON.stringify({ overrides: modules }),
      });
      setMsg("已儲存，該公司的使用者重新整理後即會生效。");
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!tenants) return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="animate-spin" size={16} />載入中…</div>;

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 size={22} />平台管理：註冊公司</h1>
      <p className="text-sm text-muted-foreground">檢視所有註冊公司與訂閱狀態，並可設定各公司開放使用的模組（取消勾選即對該公司隱藏）。</p>
      {tenants.map((t) => {
        const st = STATUS_LABEL[t.status] || { text: t.status, cls: "bg-gray-100 text-gray-700" };
        const open = openId === t.id;
        return (
          <Card key={t.id} data-testid={`card-tenant-${t.id}`}>
            <CardHeader className="cursor-pointer" onClick={() => openTenant(t.id)}>
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  {t.name}
                  <Badge className={st.cls}>{st.text}</Badge>
                  {t.isExempt && <Badge variant="outline">免收費</Badge>}
                </span>
                <span className="text-sm font-normal text-muted-foreground">
                  使用者 {t.userCount} 人｜AI 點數 {t.aiCredits}｜{t.contactEmail || "—"}｜
                  註冊 {new Date(t.createdAt).toLocaleDateString("zh-TW")}
                  {t.status === "trialing" && t.trialEndsAt && `｜試用至 ${new Date(t.trialEndsAt).toLocaleDateString("zh-TW")}`}
                </span>
              </CardTitle>
            </CardHeader>
            {open && (
              <CardContent className="space-y-4">
                <TenantBilling
                  tenant={t}
                  onUpdated={(patch) => {
                    setTenants((list) => (list || []).map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
                    if ("aiCredits" in patch) setHistoryKey((k) => k + 1);
                  }}
                />
                <CreditHistory tenantId={t.id} refreshKey={historyKey} />
                {loadingModules ? (
                  <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="animate-spin" size={16} />載入模組設定…</div>
                ) : (
                  <>
                    {catalog.map((g) => {
                      const allOn = g.pages.every((p) => isEnabled(p.path));
                      return (
                        <div key={g.label} className="border rounded-md p-3">
                          <label className="flex items-center gap-2 font-medium mb-2">
                            <Checkbox checked={allOn} onCheckedChange={(v) => toggleGroup(g.pages, v === true)} data-testid={`checkbox-group-${g.label}`} />
                            {g.label}
                          </label>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-1 pl-6">
                            {g.pages.map((p) => (
                              <label key={p.path} className="flex items-center gap-2 text-sm">
                                <Checkbox checked={isEnabled(p.path)} onCheckedChange={(v) => toggle(p.path, v === true)} data-testid={`checkbox-page-${p.path}`} />
                                {p.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-3">
                      <Button onClick={save} disabled={saving} data-testid="button-save-modules">
                        {saving && <Loader2 className="animate-spin mr-1" size={14} />}儲存模組設定
                      </Button>
                      {msg && <span className="text-sm text-green-700">{msg}</span>}
                    </div>
                  </>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/** 單一租戶的 AI 點數異動歷史（購買 + 人工調整），最新在前、可載入更多 */
function CreditHistory({ tenantId, refreshKey }: { tenantId: number; refreshKey: number }) {
  const PAGE = 10;
  const [txs, setTxs] = useState<CreditTx[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (offset: number, append: boolean) => {
    setLoading(true); setError(null);
    try {
      const r = await api<{ transactions: CreditTx[]; hasMore: boolean }>(
        `/platform/tenants/${tenantId}/credit-transactions?limit=${PAGE}&offset=${offset}`);
      setTxs((prev) => (append && prev ? [...prev, ...r.transactions] : r.transactions));
      setHasMore(r.hasMore);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(0, false); }, [tenantId, refreshKey]);

  return (
    <div className="border rounded-md p-3 space-y-2" data-testid={`credit-history-${tenantId}`}>
      <div className="font-medium">點數異動歷史</div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {txs === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" size={14} />載入中…</div>
      ) : txs.length === 0 ? (
        <div className="text-sm text-muted-foreground">尚無點數異動紀錄。</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b">
              <th className="py-1 pr-2 font-normal">時間</th>
              <th className="py-1 pr-2 font-normal text-right">增減</th>
              <th className="py-1 pr-2 font-normal text-right">餘額</th>
              <th className="py-1 font-normal">原因</th>
            </tr>
          </thead>
          <tbody>
            {txs.map((tx) => (
              <tr key={tx.id} className="border-b last:border-0" data-testid={`credit-tx-${tx.id}`}>
                <td className="py-1 pr-2 whitespace-nowrap">{new Date(tx.createdAt).toLocaleString("zh-TW")}</td>
                <td className={`py-1 pr-2 text-right font-medium ${tx.delta >= 0 ? "text-green-700" : "text-red-600"}`}>
                  {tx.delta >= 0 ? `+${tx.delta}` : tx.delta}
                </td>
                <td className="py-1 pr-2 text-right">{tx.balanceAfter}</td>
                <td className="py-1">{tx.reason}{tx.stripeRef && <span className="text-muted-foreground">（Stripe 購買）</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasMore && (
        <Button size="sm" variant="outline" disabled={loading}
          onClick={() => load(txs?.length || 0, true)} data-testid={`button-more-credit-tx-${tenantId}`}>
          {loading && <Loader2 className="animate-spin mr-1" size={14} />}載入更多
        </Button>
      )}
    </div>
  );
}
