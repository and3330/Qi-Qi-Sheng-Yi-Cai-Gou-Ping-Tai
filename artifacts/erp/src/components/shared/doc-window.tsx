import type { ReactNode } from "react";
import { Link } from "wouter";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * 單據視窗的共用外框（老闆 2026-11-16：整個 ERP 點開任何一張單，畫面都長一樣）。
 *
 * 由上到下固定五區，每張單都照這個順序排：
 *   1. 標題列：單據名稱、單號、狀態           → DocWindow 的 name / number / status
 *   2. 表頭欄位：日期、對象、專案、部門…       → DocFields
 *   3. 明細表格：一行一筆，最下面合計           → DocLines
 *   4. 其他區塊：備註、附件、關聯單據、審批進度 → DocSection / DocNote / DocRelated
 *   5. 底部按鈕列：位置固定在視窗最下面         → DocWindow 的 footer
 *
 * 電腦上是彈跳視窗，手機上貼齊螢幕下緣、可上下捲。
 */
export function DocWindow({ open, onClose, name, number, status, description, children, footer, wide = false, extraWide = false }: {
  open: boolean; onClose: () => void;
  /** 單據名稱，例如「進貨單」 */ name: string;
  /** 單號 */ number?: string | null;
  /** 狀態徽章（用 DocStatus，或各單自己的徽章） */ status?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** 底部按鈕列：左邊放刪除、作廢這類要小心的，右邊放主要動作和關閉 */ footer?: ReactNode;
  /** 明細欄位多的單（進貨、出貨）用寬一點的視窗 */ wide?: boolean;
  /** 一次輸入很多欄的工具（批次輸入）用最寬的視窗 */ extraWide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className={cn("flex max-h-[92dvh] flex-col gap-0 p-0", extraWide ? "md:max-w-[min(1320px,96vw)]" : wide ? "md:max-w-4xl" : "md:max-w-2xl")}>
        <DialogHeader className="border-b px-4 py-3 md:px-6">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8 text-left">
            <span>{name}</span>
            {number && <span className="font-mono text-base font-medium">{number}</span>}
            {status}
          </DialogTitle>
          {/* 沒有說明文字時也留一個給螢幕閱讀器用的描述，避免無障礙警告 */}
          <DialogDescription className={description ? "text-left" : "sr-only"}>{description || `${name}${number ? ` ${number}` : ""} 的內容`}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm md:px-6">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-background px-4 py-3 md:px-6">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}

type Tone = "default" | "secondary" | "destructive" | "outline";
/** 狀態徽章：顏色規則全系統一樣——進行中灰色、完成藍色、取消或作廢紅色、草稿外框 */
export function DocStatus({ label, tone }: { label: string; tone?: Tone }) {
  return <Badge variant={tone ?? "secondary"}>{label}</Badge>;
}
/** 常見狀態對應的顏色；各單可以直接用 */
export function statusTone(status: string): Tone {
  if (["Draft", "draft"].includes(status)) return "outline";
  if (["Cancelled", "Voided", "Rejected", "Reversed", "WrittenOff"].includes(status)) return "destructive";
  if (["Completed", "Paid", "Posted", "Approved", "Settled", "paid", "In Use", "Confirmed", "Submitted", "To Deliver"].includes(status)) return "default";
  return "secondary";
}

/** 表頭欄位：標籤在左、內容在右，電腦兩欄、手機一欄。值是空的那一格不顯示 */
export function DocFields({ items }: { items: Array<[label: string, value: ReactNode] | null | false | undefined> }) {
  const shown = items.filter((it): it is [string, ReactNode] => !!it && it[1] !== null && it[1] !== undefined && it[1] !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
      {shown.map(([label, value]) => (
        <div key={label} className="flex gap-3 border-b py-2">
          <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
          <dd className="min-w-0 flex-1 break-words font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface DocColumn<Row> { header: string; cell: (row: Row, index: number) => ReactNode; align?: "left" | "right"; className?: string }
/** 明細表格：一行一筆；有給 total 就在最下面多一列合計 */
export function DocLines<Row>({ columns, rows, total, empty = "沒有明細", scroll = false }: { columns: DocColumn<Row>[]; rows: Row[]; total?: { label?: string; value: ReactNode }; empty?: string; /** 行數很多的單（盤點單）：表格自己捲、表頭固定，上面的搜尋列不會被捲走 */ scroll?: boolean }) {
  return (
    <div className={cn("overflow-x-auto rounded-md border", scroll && "max-h-[46dvh] overflow-y-auto")}>
      <table className="w-full text-sm">
        <thead className={cn("bg-muted text-xs text-muted-foreground", scroll && "sticky top-0 z-10")}>
          <tr>{columns.map(c => <th key={c.header} className={cn("px-3 py-1.5 font-medium", c.align === "right" ? "text-right" : "text-left", c.className)}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="px-3 py-4 text-center text-muted-foreground">{empty}</td></tr>}
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {columns.map(c => <td key={c.header} className={cn("px-3 py-1.5", c.align === "right" ? "text-right tabular-nums" : "text-left", c.className)}>{c.cell(row, i)}</td>)}
            </tr>
          ))}
          {total && rows.length > 0 && (
            <tr className="border-t-2 font-semibold">
              <td className="px-3 py-1.5" colSpan={Math.max(1, columns.length - 1)}>{total.label ?? "合計"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{total.value}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** 一個有標題的區塊（附件、審批進度、可以編輯的欄位…） */
export function DocSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** 備註：有內容才顯示，保留換行 */
export function DocNote({ label = "備註", children }: { label?: string; children?: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 px-3 py-2">
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

export interface DocLink { label: string; number: string; href?: string | null }
/** 關聯單據：這張單從哪張來、產生了哪些單和分錄；有網址的可以點過去 */
export function DocRelated({ items, onNavigate }: { items: Array<DocLink | null | false | undefined>; onNavigate?: () => void }) {
  const shown = items.filter((it): it is DocLink => !!it && !!it.number);
  if (shown.length === 0) return null;
  return (
    <DocSection title="關聯單據">
      <ul className="divide-y rounded-md border">
        {shown.map((it, i) => (
          <li key={`${it.label}-${it.number}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="text-muted-foreground">{it.label}</span>
            {it.href
              ? <Link href={it.href} onClick={onNavigate} className="inline-flex min-h-[32px] items-center gap-1 font-medium text-primary hover:underline">{it.number}<ExternalLink className="h-3.5 w-3.5" /></Link>
              : <span className="font-medium">{it.number}</span>}
          </li>
        ))}
      </ul>
    </DocSection>
  );
}
