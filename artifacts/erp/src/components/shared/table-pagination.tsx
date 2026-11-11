import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100];

export function TablePagination({ total, page, pageSize, onPageChange, onPageSizeChange }: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  if (total <= 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="hidden sm:inline">每頁</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-8 w-[76px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>{n} 筆</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>共 {total} 筆</span>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="hidden h-8 w-8 sm:inline-flex" disabled={page <= 1} onClick={() => onPageChange(1)} aria-label="第一頁">
          <ChevronsLeft size={14} />
        </Button>
        <Button variant="outline" size="icon" className="h-10 w-10 md:h-8 md:w-8" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="上一頁">
          <ChevronLeft size={14} />
        </Button>
        <span className="px-2 text-muted-foreground">第 {page} / {totalPages} 頁</span>
        <Button variant="outline" size="icon" className="h-10 w-10 md:h-8 md:w-8" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="下一頁">
          <ChevronRight size={14} />
        </Button>
        <Button variant="outline" size="icon" className="hidden h-8 w-8 sm:inline-flex" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)} aria-label="最後一頁">
          <ChevronsRight size={14} />
        </Button>
      </div>
    </div>
  );
}
