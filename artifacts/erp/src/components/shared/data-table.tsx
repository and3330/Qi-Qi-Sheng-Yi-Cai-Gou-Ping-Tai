import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/shared/table-pagination";
import { useIsMobile } from "@/hooks/use-mobile";

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

export function DataTable<T extends { id?: number | string }>({
  columns, data, isLoading, onRowClick, defaultPageSize = 20, emptyMessage, error, onRetry,
}: DataTableProps<T>) {
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(1);
  const isMobile = useIsMobile();

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
    </div>
  );
}
