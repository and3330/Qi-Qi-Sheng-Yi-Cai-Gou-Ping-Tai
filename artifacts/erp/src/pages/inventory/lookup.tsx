import { useEffect, useMemo, useState } from "react";
import { ChevronDown, PackageSearch, Search, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { fmtMoney, fmtQty } from "@/lib/report-format";
import type { InventoryRow, InventoryStatusData, WarehouseBreakdown } from "@/pages/reports/types";
import { DrillAmount } from "@/components/shared/account-drill";
import { DocListDrillDialog, type DocListTarget } from "@/components/shared/doc-list-drill";

const PAGE_SIZE = 30;

type StockLevel = "out" | "low" | "ok";

function levelOf(row: InventoryRow): StockLevel {
  if (row.currentStock <= 0) return "out";
  return row.belowReorder ? "low" : "ok";
}

const LEVEL_STYLE: Record<StockLevel, { label: string; badge: string; qty: string }> = {
  out: { label: "缺貨", badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", qty: "text-red-600 dark:text-red-400" },
  low: { label: "低庫存", badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300", qty: "text-amber-600 dark:text-amber-400" },
  ok: { label: "充足", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", qty: "text-foreground" },
};

/**
 * 查庫存：一個搜尋框打品名或編號，結果直接看到現有數量；點一下展開各倉庫的數量。
 * 電腦上是跟「品項」一樣的表格（一列一個品項、欄位對齊，方便整頁瀏覽）；手機上是卡片。
 */
export default function InventoryLookupPage() {
  const [search, setSearch] = useState("");
  const [keyword, setKeyword] = useState("");
  // 首頁「低庫存品項」連過來會帶 ?low=1：一進來就只看需要補貨的
  const [lowOnly, setLowOnly] = useState(() => new URLSearchParams(window.location.search).get("low") === "1");
  const [warehouseId, setWarehouseId] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [meta, setMeta] = useState<Pick<InventoryStatusData, "summary" | "warehouses" | "pagination"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [docs, setDocs] = useState<DocListTarget | null>(null);
  // 點數量看這個品項的每一筆進出；給 w 就只看那個倉庫。上面有選倉庫時，整列的數量本來就只算那個倉庫
  const stockTarget = (row: InventoryRow, w?: WarehouseBreakdown): DocListTarget => {
    const wid = w ? w.warehouseId : warehouseId ? Number(warehouseId) : undefined;
    const wname = w ? w.warehouseName : wid ? meta?.warehouses.find((x) => x.id === wid)?.name : undefined;
    return { kind: "stock-entries", itemId: row.itemId, title: `${row.itemCode} ${row.itemName}`, ...(wid ? { warehouseId: wid } : {}), ...(wname ? { note: `倉庫：${wname}` } : {}) };
  };

  // 打字停一下才查，避免每個字都送出
  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPage(1); }, [keyword, lowOnly, warehouseId]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (keyword) params.set("search", keyword);
    if (lowOnly) params.set("lowStockOnly", "true");
    if (warehouseId) params.set("warehouseId", warehouseId);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    return params.toString();
  }, [keyword, lowOnly, warehouseId, page]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/erp-api/inventory-lookup?${query}`, { signal: controller.signal, credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("庫存資料載入失敗");
        return response.json() as Promise<InventoryStatusData>;
      })
      .then((data) => {
        const incoming = Array.isArray(data.rows) ? data.rows : [];
        // 第一頁是新的查詢，之後的頁接在後面（載入更多）
        setRows((previous) => (page === 1 ? incoming : [...previous, ...incoming]));
        setMeta({ summary: data.summary, warehouses: data.warehouses || [], pagination: data.pagination });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "庫存資料載入失敗");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, page, retry]);

  const hasMore = !!meta && meta.pagination.page < meta.pagination.totalPages;
  const chip = (active: boolean) =>
    `inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors touch-manipulation ${
      active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground active:bg-accent"
    }`;

  return (
    <div className="mx-auto max-w-2xl space-y-3 md:max-w-none" data-no-cards>
      <PageHeader title="查庫存" description="輸入品名或編號，馬上看到現有數量" />

      <div className="sticky top-0 z-10 -mx-4 space-y-2 bg-background/95 px-4 pb-2 pt-1 backdrop-blur md:static md:mx-0 md:bg-transparent md:px-0">
        <div className="relative">
          <Search size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="品名、編號"
            aria-label="搜尋品項"
            className="h-12 w-full rounded-xl border border-input bg-card pl-11 pr-11 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            data-testid="input-stock-lookup"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="清除搜尋"
              className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
          <button type="button" className={chip(!lowOnly)} onClick={() => setLowOnly(false)} aria-pressed={!lowOnly}>全部</button>
          <button type="button" className={chip(lowOnly)} onClick={() => setLowOnly(true)} aria-pressed={lowOnly} data-testid="chip-low-stock">
            需要補貨{meta ? `（${meta.summary.lowStockCount}）` : ""}
          </button>
          {(meta?.warehouses || []).length > 1 && (
            <>
              <span className="my-1 w-px shrink-0 bg-border" aria-hidden />
              <button type="button" className={chip(warehouseId === "")} onClick={() => setWarehouseId("")} aria-pressed={warehouseId === ""}>所有倉庫</button>
              {meta!.warehouses.map((w) => (
                <button key={w.id} type="button" className={chip(warehouseId === String(w.id))} onClick={() => setWarehouseId(String(w.id))} aria-pressed={warehouseId === String(w.id)}>
                  {w.name}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border bg-card px-4 py-8 text-center">
          <p className="mb-3 text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>重試</Button>
        </div>
      ) : loading && page === 1 ? (
        <div className="space-y-2.5" aria-busy>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card px-4 py-12 text-center text-muted-foreground">
          <PackageSearch size={36} className="mx-auto mb-3 opacity-60" aria-hidden />
          <p className="text-sm">{keyword ? `找不到符合「${keyword}」的品項` : lowOnly ? "目前沒有需要補貨的品項" : "還沒有品項"}</p>
        </div>
      ) : (
        <>
          <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
            {keyword || lowOnly || warehouseId ? `找到 ${rows.length}${hasMore ? "+" : ""} 項` : `共 ${meta?.summary.totalItems ?? rows.length} 項`}
          </p>
          {/* 電腦：表格 */}
          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="px-4 py-2.5 font-semibold">品項編號</th>
                  <th className="px-4 py-2.5 font-semibold">品名</th>
                  <th className="px-4 py-2.5 font-semibold">分類</th>
                  <th className="px-4 py-2.5 text-right font-semibold">現有數量</th>
                  <th className="px-4 py-2.5 font-semibold">單位</th>
                  <th className="px-4 py-2.5 font-semibold">各倉庫</th>
                  <th className="px-4 py-2.5 text-right font-semibold">補貨點</th>
                  <th className="px-4 py-2.5 text-right font-semibold">售價</th>
                  <th className="px-4 py-2.5 font-semibold">狀態</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const style = LEVEL_STYLE[levelOf(row)];
                  const open = openId === row.itemId;
                  return (
                    <tr key={row.itemId} className="cursor-pointer border-b align-top last:border-0 hover:bg-muted/30" onClick={() => setOpenId(open ? null : row.itemId)} title="點一下看各倉庫的數量" data-testid={`stock-table-row-${row.itemId}`}>
                      <td className="px-4 py-2.5 font-mono text-xs tabular-nums">{row.itemCode}</td>
                      <td className="px-4 py-2.5 font-medium">{row.itemName}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{row.itemGroup || "-"}</td>
                      <td className={`px-4 py-2.5 text-right text-base font-bold tabular-nums ${style.qty}`}><DrillAmount title="點一下看進出紀錄" onClick={() => setDocs(stockTarget(row))}>{fmtQty(row.currentStock)}</DrillAmount></td>
                      <td className="px-4 py-2.5 text-muted-foreground">{row.unit || "個"}</td>
                      <td className="px-4 py-2.5">
                        {row.warehouseBreakdown.length === 0 ? <span className="text-muted-foreground">-</span> : open ? (
                          <dl className="space-y-0.5">
                            {row.warehouseBreakdown.map((w) => (
                              <div key={w.warehouseId} className="flex justify-between gap-4"><dt className="text-muted-foreground">{w.warehouseName}</dt><dd className="font-medium tabular-nums"><DrillAmount title="點一下看進出紀錄" onClick={() => setDocs(stockTarget(row, w))}>{fmtQty(w.qty)}</DrillAmount></dd></div>
                            ))}
                          </dl>
                        ) : <span className="text-muted-foreground">{row.warehouseBreakdown.length} 個倉庫 <ChevronDown size={14} className="inline" aria-hidden /></span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtQty(row.reorderLevel)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(row.sellingPrice, true)}</td>
                      <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.badge}`}>{style.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* 手機：卡片 */}
          <ul className="space-y-2.5 md:hidden">
            {rows.map((row) => {
              const level = levelOf(row);
              const style = LEVEL_STYLE[level];
              const open = openId === row.itemId;
              return (
                <li key={row.itemId} className="overflow-hidden rounded-xl border bg-card shadow-sm">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : row.itemId)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted/60 touch-manipulation"
                    data-testid={`stock-row-${row.itemId}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-base font-semibold leading-snug">{row.itemName}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="tabular-nums">{row.itemCode}</span>
                        {row.itemGroup && <span>{row.itemGroup}</span>}
                        <span className={`rounded-full px-2 py-0.5 font-medium ${style.badge}`}>{style.label}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`block text-2xl font-bold leading-none tabular-nums ${style.qty}`}>{fmtQty(row.currentStock)}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{row.unit || "個"}</span>
                    </span>
                    <ChevronDown size={18} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {open && (
                    <div className="border-t bg-muted/30 px-4 py-3 text-sm">
                      {row.warehouseBreakdown.length > 0 ? (
                        <dl className="space-y-1.5">
                          {row.warehouseBreakdown.map((w) => (
                            <div key={w.warehouseId} className="flex items-center justify-between gap-3">
                              <dt className="min-w-0 truncate text-muted-foreground">{w.warehouseName}</dt>
                              <dd className="font-semibold tabular-nums"><DrillAmount title="點一下看進出紀錄" onClick={() => setDocs(stockTarget(row, w))}>{fmtQty(w.qty)}</DrillAmount> {row.unit || "個"}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="text-muted-foreground">沒有各倉庫的數量紀錄</p>
                      )}
                      <p className="mt-2 text-xs"><DrillAmount title="點一下看進出紀錄" onClick={() => setDocs(stockTarget(row))}>看這個品項的進出紀錄</DrillAmount></p>
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 text-xs">
                        <div><dt className="text-muted-foreground">補貨點</dt><dd className="font-medium tabular-nums">{fmtQty(row.reorderLevel)}</dd></div>
                        <div><dt className="text-muted-foreground">售價</dt><dd className="font-medium tabular-nums">{fmtMoney(row.sellingPrice, true)}</dd></div>
                      </dl>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <Button variant="outline" className="h-12 w-full" disabled={loading} onClick={() => setPage((p) => p + 1)} data-testid="button-stock-more">
              {loading ? "載入中…" : "載入更多"}
            </Button>
          )}
        </>
      )}
      <DocListDrillDialog target={docs} onClose={() => setDocs(null)} />
    </div>
  );
}
