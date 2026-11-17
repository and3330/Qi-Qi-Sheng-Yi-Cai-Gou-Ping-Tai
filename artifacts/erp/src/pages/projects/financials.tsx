import { useMemo, useState } from "react";
import { getGetProjectFinancialsQueryKey, useListProjects, useGetProjectFinancials } from "@workspace/erp-api-client-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, DollarSign, Percent, Search, ChevronDown, ChevronRight, FolderOpen, ArrowLeft } from "lucide-react";

/**
 * 專案損益：左邊（手機在上面）用搜尋挑專案，右邊看這個專案的收入、支出、損益、毛利率，
 * 以及底下每一張相關單據與分錄；單據可以點開看明細。
 */
const statusLabel: Record<string, string> = { Open: "進行中", Working: "進行中", "In Progress": "進行中", Completed: "已完成", Cancelled: "已取消", "On Hold": "暫停", Planning: "規劃中" };
const voucherStatusLabel: Record<string, string> = { Draft: "草稿", Submitted: "已過帳", Posted: "已過帳", Cancelled: "已作廢", Approved: "已核准" };
const voucherTypeLabel: Record<string, string> = { Receipt: "收款單", Payment: "付款單", Journal: "轉帳傳票", Transfer: "轉帳傳票", Sales: "銷貨", Purchase: "進貨" };
const money = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString()}`;
const PAGE = 100;

export default function ProjectFinancialsPage() {
  const { data: projects, isLoading: loadingProjects } = useListProjects();
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    // 支援從部門／專案列表帶 ?id= 直接開啟
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"active" | "inactive" | "all">("active");
  const [tab, setTab] = useState<"vouchers" | "entries">("vouchers");
  const [docSearch, setDocSearch] = useState("");
  const [openVoucher, setOpenVoucher] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const { data: financials, isLoading: loadingFinancials } = useGetProjectFinancials(
    selectedId ?? 0,
    { query: { queryKey: getGetProjectFinancialsQueryKey(selectedId ?? 0), enabled: !!selectedId } }
  );

  const list = (projects || []) as any[];
  const nameOf = (id: number | null | undefined) => list.find(p => p.id === id)?.name as string | undefined;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list
      .filter(p => scope === "all" || (scope === "active" ? p.isActive !== false : p.isActive === false))
      .filter(p => !q || `${p.name} ${p.departmentName || ""} ${nameOf(p.parentId) || ""}`.toLowerCase().includes(q))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hant"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, search, scope]);
  const selected = list.find(p => p.id === selectedId);
  const pick = (id: number) => { setSelectedId(id); setDocSearch(""); setOpenVoucher(null); setLimit(PAGE); setTab("vouchers"); window.history.replaceState(null, "", `${window.location.pathname}?id=${id}`); };

  const f = financials as any;
  const vouchers: any[] = f?.vouchers || [];
  const entries: any[] = f?.entries || [];
  const dq = docSearch.trim().toLowerCase();
  const shownVouchers = vouchers.filter(v => !dq || `${v.voucherNumber} ${v.voucherType} ${v.description || ""} ${v.voucherDate}`.toLowerCase().includes(dq)).sort((a, b) => String(b.voucherDate).localeCompare(String(a.voucherDate)));
  const shownEntries = entries.filter(e => !dq || `${e.entryNumber} ${e.description || ""} ${e.entryDate}`.toLowerCase().includes(dq)).sort((a, b) => String(b.entryDate).localeCompare(String(a.entryDate)));
  const margin = f && f.totalIncome > 0 ? (f.netProfit / f.totalIncome) * 100 : null;
  const chip = (active: boolean) => `shrink-0 rounded-full border px-3 py-1 text-sm transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`;

  const picker = (
    <Card className="lg:sticky lg:top-4">
      <CardHeader className="space-y-3 py-3">
        <CardTitle className="text-base">選擇專案</CardTitle>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="搜尋專案名稱、部門" value={search} onChange={e => setSearch(e.target.value)} aria-label="搜尋專案" />
        </div>
        <div className="flex gap-2">
          <button type="button" className={chip(scope === "active")} onClick={() => setScope("active")}>使用中</button>
          <button type="button" className={chip(scope === "inactive")} onClick={() => setScope("inactive")}>已停用</button>
          <button type="button" className={chip(scope === "all")} onClick={() => setScope("all")}>全部</button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loadingProjects ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">載入中…</div>
        ) : shown.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">{list.length === 0 ? "還沒有專案" : "沒有符合的專案"}</div>
        ) : (
          <ul className="max-h-[60dvh] overflow-y-auto border-t" data-testid="project-picker">
            {shown.map(p => (
              <li key={p.id}>
                <button type="button" onClick={() => pick(p.id)} aria-current={selectedId === p.id}
                  className={`flex w-full items-center justify-between gap-2 border-b px-4 py-2.5 text-left text-sm transition-colors last:border-0 ${selectedId === p.id ? "bg-primary/10 font-medium" : "hover:bg-muted/50"}`}>
                  <span className="min-w-0">
                    <span className="block truncate">{p.parentId ? "└ " : ""}{p.name}{p.isActive === false ? "（已停用）" : ""}</span>
                    {(p.departmentName || p.parentId) && <span className="block truncate text-xs text-muted-foreground">{[nameOf(p.parentId), p.departmentName].filter(Boolean).join("・")}</span>}
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">共 {shown.length} 個專案</div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="專案損益查詢" description="挑一個專案，看它的收入、支出、損益，以及底下每一張單據" />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* 手機：選好專案後收起清單，留一顆「換專案」 */}
        <div className={selectedId ? "hidden lg:block" : ""}>{picker}</div>

        <div className="min-w-0 space-y-4">
          {!selectedId ? (
            <Card className="hidden lg:block"><CardContent className="flex flex-col items-center gap-2 py-16 text-muted-foreground"><FolderOpen size={32} aria-hidden /><p>從左邊選一個專案</p></CardContent></Card>
          ) : (
            <>
              <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setSelectedId(null)}><ArrowLeft size={14} className="mr-1" />換專案</Button>
              <Card>
                <CardContent className="space-y-2 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{selected?.name || f?.projectName || "專案"}</h2>
                    {selected && <Badge variant="outline">{statusLabel[selected.status] || selected.status}</Badge>}
                    {selected?.isActive === false && <Badge variant="secondary">已停用</Badge>}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
                    <div><dt className="text-xs text-muted-foreground">部門</dt><dd>{selected?.departmentName || "-"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">主專案</dt><dd>{nameOf(selected?.parentId) || "-"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">開始</dt><dd>{selected?.startDate || "-"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">結束</dt><dd>{selected?.endDate || "-"}</dd></div>
                  </dl>
                </CardContent>
              </Card>

              {loadingFinancials ? (
                <div className="grid animate-pulse grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-muted" />)}</div>
              ) : f && (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {[
                      { label: "總收入", value: money(f.totalIncome), icon: <TrendingUp className="h-5 w-5 text-green-600" />, tone: "text-green-600", bg: "bg-green-100" },
                      { label: "總支出", value: money(f.totalExpense), icon: <TrendingDown className="h-5 w-5 text-red-600" />, tone: "text-red-600", bg: "bg-red-100" },
                      { label: "淨損益", value: money(f.netProfit), icon: <DollarSign className="h-5 w-5 text-blue-600" />, tone: f.netProfit >= 0 ? "text-green-600" : "text-red-600", bg: "bg-blue-100" },
                      { label: "毛利率", value: margin == null ? "-" : `${margin.toFixed(1)}%`, icon: <Percent className="h-5 w-5 text-amber-600" />, tone: margin != null && margin < 0 ? "text-red-600" : "text-foreground", bg: "bg-amber-100" },
                    ].map(k => (
                      <Card key={k.label}>
                        <CardContent className="flex items-center gap-3 py-4">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${k.bg}`}>{k.icon}</div>
                          <div className="min-w-0"><div className="text-sm text-muted-foreground">{k.label}</div><div className={`truncate text-xl font-bold tabular-nums ${k.tone}`}>{k.value}</div></div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {Number(f.laborHours) > 0 && (
                    <p className="text-sm text-muted-foreground">
                      工時表已核准 {f.laborHours} 小時，換算人工成本 {money(f.laborCost)}。薪資已在發薪時計入支出，這個數字是看專案用了多少人力，沒有重複計入上面的總支出。
                    </p>
                  )}

                  {Array.isArray(f.children) && f.children.length > 0 && (
                    <Card>
                      <CardHeader className="py-3"><CardTitle className="text-base">主專案與子專案</CardTitle></CardHeader>
                      <CardContent className="p-0 overflow-x-auto">
                        <p className="px-4 pb-2 text-sm text-muted-foreground">上面的數字是主專案自己加上所有子專案的合計。點子專案可以單獨看。</p>
                        <table className="w-full text-sm" data-testid="table-child-projects">
                          <thead className="bg-muted/50"><tr><th className="px-4 py-2 text-left font-medium">專案</th><th className="px-4 py-2 text-right font-medium">收入</th><th className="px-4 py-2 text-right font-medium">支出</th><th className="px-4 py-2 text-right font-medium">損益</th></tr></thead>
                          <tbody>
                            {f.children.map((c: any, index: number) => (
                              <tr key={c.projectId} className={`border-t ${index > 0 ? "cursor-pointer hover:bg-muted/40" : ""}`} onClick={() => index > 0 && pick(c.projectId)}>
                                <td className="px-4 py-2">{index === 0 ? `${c.projectName}（主專案本身）` : `└ ${c.projectName}`}</td>
                                <td className="px-4 py-2 text-right tabular-nums">{money(c.totalIncome)}</td>
                                <td className="px-4 py-2 text-right tabular-nums">{money(c.totalExpense)}</td>
                                <td className={`px-4 py-2 text-right tabular-nums ${c.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>{money(c.netProfit)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  )}

                  <Card>
                    <CardHeader className="space-y-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" className={chip(tab === "vouchers")} onClick={() => { setTab("vouchers"); setLimit(PAGE); }}>相關單據（{vouchers.length}）</button>
                        <button type="button" className={chip(tab === "entries")} onClick={() => { setTab("entries"); setLimit(PAGE); }}>日記帳分錄（{entries.length}）</button>
                        <div className="relative ml-auto w-full md:w-64">
                          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
                          <Input className="pl-9" placeholder="搜尋單號、說明、日期" value={docSearch} onChange={e => { setDocSearch(e.target.value); setLimit(PAGE); }} aria-label="搜尋單據" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0 overflow-x-auto">
                      {tab === "vouchers" ? (
                        shownVouchers.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">{vouchers.length === 0 ? "這個專案還沒有單據" : "沒有符合的單據"}</div> : (
                          <table className="w-full text-sm" data-testid="table-project-vouchers">
                            <thead><tr className="border-b bg-muted/40 text-left">
                              <th className="w-8 px-2 py-2" /><th className="px-4 py-2 font-medium">單號</th><th className="px-4 py-2 font-medium">類型</th><th className="px-4 py-2 font-medium">日期</th>
                              <th className="hidden px-4 py-2 font-medium sm:table-cell">說明</th><th className="px-4 py-2 text-right font-medium">金額</th><th className="px-4 py-2 text-center font-medium">狀態</th>
                            </tr></thead>
                            <tbody>
                              {shownVouchers.slice(0, limit).map(v => {
                                const open = openVoucher === v.id;
                                const items: any[] = Array.isArray(v.items) ? v.items : [];
                                return [
                                  <tr key={v.id} className="cursor-pointer border-b hover:bg-muted/40" onClick={() => setOpenVoucher(open ? null : v.id)} title="點一下看明細">
                                    <td className="px-2 py-2 text-muted-foreground">{open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}</td>
                                    <td className="px-4 py-2 font-mono text-xs">{v.voucherNumber}</td>
                                    <td className="px-4 py-2">{voucherTypeLabel[v.voucherType] || v.voucherType}</td>
                                    <td className="px-4 py-2 tabular-nums">{v.voucherDate}</td>
                                    <td className="hidden px-4 py-2 sm:table-cell">{v.description || "-"}</td>
                                    <td className="px-4 py-2 text-right tabular-nums">{money(v.totalAmount)}</td>
                                    <td className="px-4 py-2 text-center"><Badge variant="outline">{voucherStatusLabel[v.status] || v.status}</Badge></td>
                                  </tr>,
                                  open && (
                                    <tr key={`${v.id}-items`} className="border-b bg-muted/20">
                                      <td />
                                      <td colSpan={6} className="px-4 py-3">
                                        {items.length === 0 ? <span className="text-sm text-muted-foreground">這張單沒有明細</span> : (
                                          <ul className="space-y-1 text-sm">
                                            {items.map((it, i) => (
                                              <li key={i} className="flex justify-between gap-4">
                                                <span className="min-w-0 truncate">{it.accountName || it.itemName || it.summary || it.description || `第 ${i + 1} 筆`}{it.description && it.accountName ? `・${it.description}` : ""}</span>
                                                <span className="shrink-0 tabular-nums">{money(it.amount ?? it.debit ?? it.credit ?? 0)}</span>
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </td>
                                    </tr>
                                  ),
                                ];
                              })}
                            </tbody>
                          </table>
                        )
                      ) : (
                        shownEntries.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">{entries.length === 0 ? "這個專案還沒有分錄" : "沒有符合的分錄"}</div> : (
                          <table className="w-full text-sm" data-testid="table-project-entries">
                            <thead><tr className="border-b bg-muted/40 text-left">
                              <th className="px-4 py-2 font-medium">分錄編號</th><th className="px-4 py-2 font-medium">日期</th><th className="hidden px-4 py-2 font-medium sm:table-cell">說明</th>
                              <th className="px-4 py-2 text-right font-medium">借方</th><th className="px-4 py-2 text-right font-medium">貸方</th>
                            </tr></thead>
                            <tbody>
                              {shownEntries.slice(0, limit).map(e => (
                                <tr key={e.id} className="border-b hover:bg-muted/40">
                                  <td className="px-4 py-2 font-mono text-xs">{e.entryNumber}</td>
                                  <td className="px-4 py-2 tabular-nums">{e.entryDate}</td>
                                  <td className="hidden px-4 py-2 sm:table-cell">{e.description || "-"}</td>
                                  <td className="px-4 py-2 text-right tabular-nums">{money(e.totalDebit)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums">{money(e.totalCredit)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )
                      )}
                      {(tab === "vouchers" ? shownVouchers.length : shownEntries.length) > limit && (
                        <div className="border-t p-3 text-center">
                          <Button variant="outline" size="sm" onClick={() => setLimit(l => l + PAGE)}>再看 {PAGE} 筆（還有 {(tab === "vouchers" ? shownVouchers.length : shownEntries.length) - limit} 筆）</Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
