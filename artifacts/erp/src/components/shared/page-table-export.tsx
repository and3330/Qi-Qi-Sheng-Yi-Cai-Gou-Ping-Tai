import { ExportMenu } from "@/components/shared/export-menu";
import type { ExportOptions } from "@/lib/export-utils";
import { useToast } from "@/hooks/use-toast";

const ACTION_LABELS = new Set(["操作", "動作", "功能", "管理"]);

const cellText = (cell: Element) => (cell.textContent || "").replace(/\s+/g, " ").trim();

/** 找出目前頁面上資料最多的那張表格（不含對話框裡的） */
function findMainTable(): HTMLTableElement | null {
  let best: HTMLTableElement | null = null;
  let bestRows = 0;
  document.querySelectorAll<HTMLTableElement>("main table").forEach((table) => {
    if (table.closest("[role='dialog']") || !table.tHead) return;
    const rows = Array.from(table.tBodies).reduce((n, body) => n + body.rows.length, 0);
    if (rows > bestRows) {
      best = table;
      bestRows = rows;
    }
  });
  return best;
}

/**
 * 把畫面上的表格轉成匯出資料。只含目前畫面顯示的列；
 * 操作欄、勾選欄與跨欄的提示列（例如「尚無資料」）不匯出。
 */
function readTable(table: HTMLTableElement, title: string): ExportOptions {
  const headRows = table.tHead!.rows;
  const headCells = Array.from(headRows[headRows.length - 1].cells);
  const keep: number[] = [];
  const headers: string[] = [];
  headCells.forEach((cell, index) => {
    const label = cellText(cell);
    if (label === "" || ACTION_LABELS.has(label)) return;
    keep.push(index);
    headers.push(label);
  });
  const columnKeys = keep.map((index) => `c${index}`);
  const rows = Array.from(table.tBodies)
    .flatMap((body) => Array.from(body.rows))
    .filter((row) => row.cells.length === headCells.length)
    .map((row) => Object.fromEntries(keep.map((index) => [`c${index}`, cellText(row.cells[index])])));
  const today = new Date().toLocaleDateString("zh-TW");
  return {
    title,
    subtitle: `匯出日期：${today}（共 ${rows.length} 筆，僅含畫面上顯示的資料）`,
    fileName: `${title}_${new Date().toISOString().slice(0, 10)}`,
    headers,
    rows,
    columnKeys,
  };
}

/** 頁首的「匯出」：把目前頁面的表格匯出成 CSV／Excel／PDF，各頁不用另外寫 */
export function PageTableExport({ title }: { title: string }) {
  const { toast } = useToast();

  const getExportOptions = () => {
    const table = findMainTable();
    if (!table) {
      toast({ title: "這個頁面沒有可匯出的表格", variant: "destructive" });
      throw new Error("no table");
    }
    return readTable(table, title);
  };

  return (
    <div className="hidden sm:block shrink-0" data-print-hide>
      <ExportMenu getExportOptions={getExportOptions} />
    </div>
  );
}
