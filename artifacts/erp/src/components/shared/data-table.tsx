import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff, SlidersHorizontal } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/shared/table-pagination";
import { useUiLayouts, type LayoutItem } from "@/components/shared/doc-window";
import { useAuth } from "@/contexts/auth-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { call, post } from "@/lib/call";
import { cn } from "@/lib/utils";

interface Column<T> {
  header: string | (() => React.ReactNode);
  accessor: keyof T | ((row: T) => React.ReactNode);
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[] | undefined;
  isLoading: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  /** 每頁筆數，預設 20；設為 0 可停用分頁 */
  defaultPageSize?: number;
  /** 載入失敗訊息；有值時顯示錯誤狀態 */
  error?: string | null;
  /** 顯示「重試」按鈕並在點擊時呼叫 */
  onRetry?: () => void;
  /**
   * 全公司的欄位設定（改欄名、隱藏、排序）存在哪個名字底下。
   * 沒給就自動用「這一頁的網址＋第一個欄位名稱」；同一頁有兩張表第一欄同名時，請給各自的 layoutId。
   * 給 false 表示這張表不開放調整。
   */
  layoutId?: string | false;
}

/** 欄位標題是「操作」或空白的，視為放按鈕的欄位 */
const ACTION_HEADERS = new Set(["", "操作", "動作", "功能"]);

function cellValue<T>(col: Column<T>, row: T): React.ReactNode {
  return typeof col.accessor === "function" ? col.accessor(row) : String(row[col.accessor] ?? "-");
}

/**
 * 把表格欄位分配到手機卡片的各個位置：
 * 勾選欄（標題是元件的欄位）→ 卡片左上；第一個文字欄 → 卡片標題；操作欄 → 卡片底部；其餘 → 兩欄的「名稱：內容」。
 */
export function splitColumnsForCard<T>(columns: Column<T>[]) {
  const selectors = columns.filter((c) => typeof c.header === "function");
  const texts = columns.filter((c) => typeof c.header === "string");
  const actions = texts.filter((c) => ACTION_HEADERS.has((c.header as string).trim()));
  const fields = texts.filter((c) => !actions.includes(c));
  return { selectors, title: fields[0], details: fields.slice(1), actions };
}

/**
 * 清單的欄位設定（老闆 2026-11-17：清單頁的表格也要能自己調）。
 * 管理者可以替全公司改欄名、隱藏欄、調順序，和單據視窗的版面存在同一個地方（ui_layouts），名字是「清單:…」。
 * 安全規則：勾選欄（標題是元件）和操作欄永遠不能藏也不能移；至少留一欄；隨時可以改回系統預設。
 * 只換畫面上的欄名，資料怎麼取（accessor）、點一列、匯出都不受影響。
 * 每個人自己的「顯示欄位」照舊：頁面先依個人設定決定給哪些欄，這裡再套公司的設定。
 */
const LIST_PREFIX = "清單:";
type Rules = Record<string, LayoutItem>;

/** 這一頁所有清單設定的開頭。網址裡的編號換成 :id，不然每一筆資料會各存一份 */
export function listLayoutPrefix(path: string): string {
  const clean = path.split(/[?#]/)[0].split("/").map((s) => (/^\d+$/.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) ? ":id" : s)).join("/");
  return `${LIST_PREFIX}${clean || "/"}:`;
}

const isFixedColumn = <T,>(col: Column<T>) => typeof col.header !== "string" || ACTION_HEADERS.has(col.header.trim());
const headerText = <T,>(col: Column<T>) => col.header as string;

/** 可以調整的欄位原本的名稱（不含勾選欄、操作欄），照程式裡的順序 */
function editableHeaders<T>(columns: Column<T>[]): string[] {
  return [...new Set(columns.filter((c) => !isFixedColumn(c)).map(headerText))];
}

/** 依設定排出畫面上要用的順序 */
function orderHeaders(headers: string[], rules: Rules | undefined): string[] {
  return headers.map((key, index) => ({ key, order: rules?.[key]?.order ?? index, index })).sort((a, b) => a.order - b.order || a.index - b.index).map((x) => x.key);
}

/** 套用公司設定：固定欄留在原位，其他欄改名、隱藏、排序後填回原本的空位 */
export function applyListLayout<T>(columns: Column<T>[], rules: Rules | undefined): Column<T>[] {
  if (!rules || Object.keys(rules).length === 0) return columns;
  const editable = columns.filter((c) => !isFixedColumn(c));
  // 全部都被藏起來的話表格會不能用，這時當作沒有藏
  const honourHidden = editable.some((c) => !rules[headerText(c)]?.hidden);
  const rank = new Map(orderHeaders(editableHeaders(columns), rules).map((key, i) => [key, i]));
  const queue = editable
    .filter((c) => !(honourHidden && rules[headerText(c)]?.hidden))
    .map((c, index) => ({ c, index }))
    .sort((a, b) => rank.get(headerText(a.c))! - rank.get(headerText(b.c))! || a.index - b.index)
    .map(({ c }) => {
      const label = rules[headerText(c)]?.label?.trim();
      // 改成「操作」這類字會被當成放按鈕的欄，所以不採用
      return label && !ACTION_HEADERS.has(label) ? { ...c, header: label } : c;
    });
  const out: Column<T>[] = [];
  for (const col of columns) {
    if (isFixedColumn(col)) out.push(col);
    else if (queue.length > 0) out.push(queue.shift()!);
  }
  return out;
}

export function DataTable<T extends { id?: number | string }>({
  columns: givenColumns, data, isLoading, onRowClick, defaultPageSize = 20, emptyMessage, error, onRetry, layoutId,
}: DataTableProps<T>) {
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(1);
  const isMobile = useIsMobile();

  const { hasRole } = useAuth();
  const [location] = useLocation();
  const { data: layouts } = useUiLayouts();
  const headers = editableHeaders(givenColumns);
  const autoKey = headers.length > 0 ? `${listLayoutPrefix(location)}${headers[0]}` : null;
  const wantedKey = layoutId === false ? null : layoutId ? `${LIST_PREFIX}${layoutId}` : autoKey;
  // 後端的名字最長 80 個字，超過就不開放調整（存了會對不上）
  const layoutKey = wantedKey && wantedKey.length <= 80 ? wantedKey : null;
  const savedRules = layoutKey ? layouts?.[layoutKey]?.columns : undefined;
  const [draft, setDraft] = useState<Rules | null>(null);
  const rules = draft ?? savedRules;
  // 每次重畫都重排：accessor 裡可能用到頁面最新的狀態，不能留舊的
  const columns = applyListLayout(givenColumns, rules);
  const layoutEditor = layoutKey && headers.length > 0 && hasRole("owner", "admin") ? (
    <ListLayoutEditor layoutKey={layoutKey} headers={headers} saved={savedRules} draft={draft} setDraft={setDraft} />
  ) : null;

  const total = data?.length ?? 0;
  const paginate = pageSize > 0 && total > 0;
  const totalPages = paginate ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const safePage = Math.min(page, totalPages);
  const pageOffset = paginate ? (safePage - 1) * pageSize : 0;
  const pageData = paginate && data ? data.slice(pageOffset, safePage * pageSize) : data;

  const pagination = paginate && (
    <TablePagination
      total={total}
      page={page}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
    />
  );

  const errorBlock = error ? (
    <>
      <div className="text-destructive text-sm mb-2">{error}</div>
      {onRetry && (
        <button onClick={onRetry} className="text-sm px-3 py-1.5 max-md:min-h-11 max-md:px-5 rounded-md border hover:bg-accent" data-testid="button-table-retry">
          重試
        </button>
      )}
    </>
  ) : null;

  // 手機：每筆資料一張卡片，不用左右捲動表格
  if (isMobile) {
    const { selectors, title, details, actions } = splitColumnsForCard(columns);
    return (
      <div data-testid="data-card-list">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="mb-2.5 rounded-xl border bg-card p-4">
              <Skeleton className="mb-3 h-5 w-2/5" />
              <Skeleton className="mb-2 h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))
        ) : error ? (
          <div className="rounded-xl border bg-card px-4 py-8 text-center">{errorBlock}</div>
        ) : pageData && pageData.length > 0 ? (
          pageData.map((row, i) => (
            <div
              key={row.id ?? pageOffset + i}
              onClick={() => onRowClick?.(row)}
              className={`mb-2.5 rounded-xl border bg-card p-4 text-card-foreground shadow-sm ${onRowClick ? "cursor-pointer transition-colors active:bg-muted/60" : ""}`}
            >
              <div className="flex items-start gap-3">
                {selectors.map((col, j) => (
                  <div key={j} className="pt-0.5" onClick={(e) => e.stopPropagation()}>{cellValue(col, row)}</div>
                ))}
                <div className="min-w-0 flex-1 break-words text-base font-semibold leading-snug">
                  {title ? cellValue(title, row) : null}
                </div>
                {onRowClick && <ChevronRight size={18} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />}
              </div>
              {details.length > 0 && (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                  {details.map((col, j) => (
                    <div key={j} className="min-w-0">
                      <dt className="mb-0.5 text-xs text-muted-foreground">{col.header as string}</dt>
                      <dd className="break-words font-medium">{cellValue(col, row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {actions.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t pt-3" onClick={(e) => e.stopPropagation()}>
                  {actions.map((col, j) => <div key={j}>{cellValue(col, row)}</div>)}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            {emptyMessage || "尚無資料"}
          </div>
        )}
        {pagination && <div className="mt-1 rounded-xl border bg-card [&>div]:border-t-0">{pagination}</div>}
        {layoutEditor && <div className="mt-1 flex justify-end">{layoutEditor}</div>}
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-card text-card-foreground">
      <div className="overflow-x-auto">
      <Table className="min-w-[800px] w-full">
        <TableHeader>
          <TableRow className="bg-muted/40">
            {columns.map((col, i) => (
              <TableHead key={i} className={col.className}>{typeof col.header === "function" ? col.header() : col.header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {columns.map((_, j) => (
                  <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                ))}
              </TableRow>
            ))
          ) : error ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center py-8">{errorBlock}</TableCell>
            </TableRow>
          ) : pageData && pageData.length > 0 ? (
            pageData.map((row, i) => (
              <TableRow
                key={row.id ?? pageOffset + i}
                onClick={() => onRowClick?.(row)}
                className={onRowClick ? "cursor-pointer hover:bg-muted/50" : ""}
              >
                {columns.map((col, j) => (
                  <TableCell key={j} className={col.className}>{cellValue(col, row)}</TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center py-8 text-muted-foreground">
                {emptyMessage || "尚無資料"}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>
      {pagination}
      {layoutEditor && <div className="flex justify-end border-t px-2 py-1 print:hidden">{layoutEditor}</div>}
    </div>
  );
}

/** 管理者用的「調整欄位」：按鈕＋視窗。改的時候後面的表格立刻跟著變，按儲存全公司才會套用 */
function ListLayoutEditor({ layoutKey, headers, saved, draft, setDraft }: {
  layoutKey: string; headers: string[]; saved: Rules | undefined; draft: Rules | null; setDraft: (rules: Rules | null) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const rules = draft ?? {};
  const keys = orderHeaders(headers, rules);
  const visibleCount = keys.filter((k) => !rules[k]?.hidden).length;
  const setItem = (key: string, patch: LayoutItem) => setDraft({ ...rules, [key]: { ...rules[key], ...patch } });
  const move = (key: string, step: -1 | 1) => {
    const from = keys.indexOf(key), to = from + step;
    if (to < 0 || to >= keys.length) return;
    const list = [...keys];
    [list[from], list[to]] = [list[to], list[from]];
    // 這次畫面上沒出現的欄（例如個人設定沒勾的）原本的設定照留
    setDraft({ ...rules, ...Object.fromEntries(list.map((k, i) => [k, { ...rules[k], order: i }])) });
  };
  const finish = async (work: () => Promise<unknown>, done: { title: string; description?: string }) => {
    setSaving(true);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: ["/ui-layouts"] });
      toast(done);
      setDraft(null);
    } catch (e) {
      toast({ title: "沒有成功", description: e instanceof Error ? e.message : "請稍後再試", variant: "destructive" });
    } finally { setSaving(false); }
  };
  const save = () => finish(() => post("ui-layouts", { key: layoutKey, config: { columns: rules } }, "PUT"), { title: "欄位已儲存", description: "全公司看這張表都會是新的樣子" });
  const reset = () => {
    if (!window.confirm("把這張表的欄位改回系統預設？你改過的欄名、隱藏和順序都會取消。")) return;
    void finish(() => call(`ui-layouts?key=${encodeURIComponent(layoutKey)}`, { method: "DELETE" }), { title: "已改回系統預設" });
  };

  return (
    <>
      <button type="button" onClick={() => setDraft(saved ?? {})} title="替全公司調整這張表的欄位：改欄名、隱藏、調順序" data-testid="button-edit-list-layout"
        className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground max-md:min-h-11">
        <SlidersHorizontal className="h-3.5 w-3.5" />調整欄位（全公司）
      </button>
      <Dialog open={draft !== null} onOpenChange={(o) => { if (!o && !saving) setDraft(null); }}>
        {/* 視窗裡的點擊不要傳到外層（表格可能放在可以點的卡片或另一個視窗裡） */}
        <DialogContent className="flex max-h-[92dvh] flex-col gap-3 md:max-w-lg" data-testid="list-layout-editor" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="text-left">調整這張表的欄位</DialogTitle>
            <DialogDescription className="text-left">
              改欄名、用箭頭調順序、按眼睛隱藏。這裡改的是全公司看到的樣子，按「儲存」才會套用。勾選欄和操作欄是固定的，不會出現在這裡。
            </DialogDescription>
          </DialogHeader>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {keys.map((key, i) => {
              const rule = rules[key];
              const lastVisible = !rule?.hidden && visibleCount <= 1;
              return (
                <li key={key} className="flex items-center gap-1">
                  <Input className={cn("h-9 flex-1", rule?.hidden && "text-muted-foreground line-through")} value={rule?.label ?? key} placeholder={key} maxLength={40}
                    onChange={(e) => setItem(key, { label: e.target.value })} aria-label={`「${key}」要顯示成什麼`} data-testid={`list-layout-${key}`} />
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={i === 0} onClick={() => move(key, -1)} aria-label={`「${key}」往前移`}><ArrowUp className="h-4 w-4" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={i === keys.length - 1} onClick={() => move(key, 1)} aria-label={`「${key}」往後移`}><ArrowDown className="h-4 w-4" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={lastVisible} onClick={() => setItem(key, { hidden: !rule?.hidden })}
                    aria-label={rule?.hidden ? `顯示「${key}」` : `隱藏「${key}」`} title={lastVisible ? "至少要留一欄" : rule?.hidden ? "目前隱藏，按一下顯示" : "目前顯示，按一下隱藏"}>
                    {rule?.hidden ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" className="mr-auto text-destructive" disabled={saving} onClick={reset} data-testid="button-reset-list-layout">改回系統預設</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setDraft(null)}>取消</Button>
            <Button type="button" disabled={saving} onClick={save} data-testid="button-save-list-layout">{saving ? "儲存中…" : "儲存"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
