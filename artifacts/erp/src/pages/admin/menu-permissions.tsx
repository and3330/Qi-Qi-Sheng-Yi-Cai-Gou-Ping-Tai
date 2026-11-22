import { Fragment, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Save, RotateCcw, Search, Shield } from "lucide-react";
import { navGroups, topLevelNavs, type NavGroup } from "@/components/layout/sidebar";
import { ROLE_LABELS } from "@/lib/roles";
import { useAutoReloadKey } from "@/lib/auto-refresh";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

const ROLE_ORDER = ["owner", "admin", "finance_admin", "accountant", "manager", "sales", "warehouse", "hr_admin", "viewer"];

interface Row {
  groupLabel: string;
  parentLabel: string;
  childLabel: string;
  path: string;
  defaultRoles: readonly string[] | null;
}

function flattenNav(groups: NavGroup[]): Row[] {
  const rows: Row[] = [];
  for (const g of groups) {
    for (const it of g.items) {
      if (it.path) {
        rows.push({ groupLabel: g.groupLabel, parentLabel: it.label, childLabel: "", path: it.path, defaultRoles: it.roles ?? null });
      }
      for (const c of it.children || []) {
        rows.push({ groupLabel: g.groupLabel, parentLabel: it.label, childLabel: c.label, path: c.path, defaultRoles: c.roles ?? it.roles ?? null });
      }
    }
  }
  return rows;
}

export default function MenuPermissionsPage() {
  const reloadKey = useAutoReloadKey();
  const rows = useMemo(() => flattenNav([{ groupLabel: "頂層項目", items: topLevelNavs } as NavGroup, ...navGroups]), []);
  const { toast } = useToast();
  const [overrides, setOverrides] = useState<Record<string, string[]>>({});
  const [serverState, setServerState] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const load = () => {
    setLoading(true);
    fetch(`/erp-api/menu-permissions`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => {
        setServerState(d || {});
        setOverrides(d || {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [reloadKey]);

  const stableStringify = (o: Record<string, string[]>) => {
    const keys = Object.keys(o).sort();
    return JSON.stringify(keys.map((k) => [k, [...o[k]].sort()]));
  };
  const dirty = stableStringify(overrides) !== stableStringify(serverState);

  const filteredRows = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      r.path.toLowerCase().includes(q) ||
      r.parentLabel.toLowerCase().includes(q) ||
      r.childLabel.toLowerCase().includes(q) ||
      r.groupLabel.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const isChecked = (path: string, role: string) => {
    if (path in overrides) return overrides[path].includes(role);
    const r = rows.find((x) => x.path === path);
    if (!r) return false;
    if (!r.defaultRoles) return true;
    return r.defaultRoles.includes(role);
  };

  const toggle = (path: string, role: string) => {
    setOverrides((prev) => {
      const current = path in prev
        ? prev[path]
        : (rows.find((x) => x.path === path)?.defaultRoles
            ? [...(rows.find((x) => x.path === path)!.defaultRoles!)]
            : ROLE_ORDER.slice());
      const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
      return { ...prev, [path]: next };
    });
  };

  const setRowAll = (path: string, allow: boolean) => {
    setOverrides((prev) => ({ ...prev, [path]: allow ? ROLE_ORDER.slice() : [] }));
  };

  const resetRow = (path: string) => {
    setOverrides((prev) => {
      const { [path]: _omit, ...rest } = prev;
      return rest;
    });
  };

  const setColumnAll = (role: string, allow: boolean) => {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const r of filteredRows) {
        const current = r.path in next
          ? next[r.path]
          : (r.defaultRoles ? [...r.defaultRoles] : ROLE_ORDER.slice());
        if (allow && !current.includes(role)) next[r.path] = [...current, role];
        else if (!allow && current.includes(role)) next[r.path] = current.filter((x) => x !== role);
        else next[r.path] = current;
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/erp-api/menu-permissions`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "儲存失敗");
      }
      toast({ title: "已儲存選單權限", description: "重新整理頁面即可看到效果" });
      setServerState(overrides);
    } catch (e: any) {
      toast({ title: "儲存失敗", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const resetAll = () => {
    if (!confirm("確定要將所有選單還原為預設權限嗎？此操作會移除所有自訂覆寫設定。")) return;
    setOverrides({});
  };

  // 群組顯示
  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, Row[]>>();
    for (const r of filteredRows) {
      if (!map.has(r.groupLabel)) map.set(r.groupLabel, new Map());
      const inner = map.get(r.groupLabel)!;
      const k = r.parentLabel;
      if (!inner.has(k)) inner.set(k, []);
      inner.get(k)!.push(r);
    }
    return map;
  }, [filteredRows]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="選單權限"
        description="勾選每個身份可以看到哪些選單。super_admin 永遠可看全部。"
      />

      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="搜尋選單名稱或路徑..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Badge variant={dirty ? "default" : "secondary"}>
            {dirty ? "有未儲存變更" : "已同步"}
          </Badge>
          <Button variant="outline" onClick={load} disabled={loading || saving}>
            <RotateCcw size={14} className="mr-1" />重新載入
          </Button>
          <Button variant="outline" onClick={resetAll} disabled={saving}>還原全部為預設</Button>
          <Button onClick={save} disabled={!dirty || saving}>
            <Save size={14} className="mr-1" />{saving ? "儲存中..." : "儲存"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield size={16} className="text-primary" />選單 × 角色 矩陣
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium min-w-[280px]">選單項目</th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} className="px-2 py-2 font-medium text-center min-w-[80px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <span>{ROLE_LABELS[r] || r}</span>
                      <div className="flex gap-1 text-[10px] text-muted-foreground">
                        <button className="hover:text-primary underline" onClick={() => setColumnAll(r, true)}>全勾</button>
                        <button className="hover:text-destructive underline" onClick={() => setColumnAll(r, false)}>全消</button>
                      </div>
                    </div>
                  </th>
                ))}
                <th className="px-2 py-2 font-medium text-center min-w-[120px]">列操作</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(grouped.entries()).map(([groupLabel, parentMap]) => (
                <Fragment key={groupLabel}>
                  <tr className="bg-muted/20">
                    <td colSpan={ROLE_ORDER.length + 2} className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                      {groupLabel}
                    </td>
                  </tr>
                  {Array.from(parentMap.entries()).map(([parentLabel, items]) => (
                    items.map((row, idx) => {
                      const overridden = row.path in overrides;
                      return (
                        <tr key={row.path} className="border-t hover:bg-accent/40">
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              {idx === 0 && <span className="text-xs font-medium text-foreground">{parentLabel}</span>}
                              {row.childLabel && (
                                <span className="text-muted-foreground text-xs">
                                  {idx === 0 ? "" : "—"} {row.childLabel}
                                </span>
                              )}
                              {overridden && <Badge variant="outline" className="text-[10px] py-0 px-1">自訂</Badge>}
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono">{row.path}</div>
                          </td>
                          {ROLE_ORDER.map((r) => (
                            <td key={r} className="px-2 py-1.5 text-center">
                              <Checkbox checked={isChecked(row.path, r)} onCheckedChange={() => toggle(row.path, r)} />
                            </td>
                          ))}
                          <td className="px-2 py-1.5 text-center">
                            <div className="flex justify-center gap-1 text-[10px]">
                              <button className="text-primary hover:underline" onClick={() => setRowAll(row.path, true)}>全勾</button>
                              <span className="text-muted-foreground">|</span>
                              <button className="text-destructive hover:underline" onClick={() => setRowAll(row.path, false)}>全消</button>
                              {overridden && (
                                <>
                                  <span className="text-muted-foreground">|</span>
                                  <button className="text-muted-foreground hover:underline" onClick={() => resetRow(row.path)}>還原預設</button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ))}
                </Fragment>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={ROLE_ORDER.length + 2} className="text-center py-8 text-muted-foreground">沒有符合的選單</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
