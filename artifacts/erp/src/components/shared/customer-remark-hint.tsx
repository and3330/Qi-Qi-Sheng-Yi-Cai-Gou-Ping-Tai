import { useState } from "react";
import { StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseRemarkEntries } from "@/lib/customer-remarks";

/**
 * 開單時選了客戶，就把這個客戶的備註顯示出來當提醒（例如「11/15、12/15 合併出貨」）。
 * 按「帶入單據備註」把最新一則加到這張單的備註；每一則也可以個別帶入。
 * 客戶沒有備註時不顯示。
 */
export function CustomerRemarkHint({ remarks, onInsert, className }: {
  remarks: string | null | undefined;
  onInsert?: (entry: string) => void;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const entries = parseRemarkEntries(remarks);
  if (entries.length === 0) return null;
  const shown = expanded ? entries : entries.slice(0, 2);

  return (
    <div
      className={`rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 ${className ?? ""}`}
      data-testid="customer-remark-hint"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium"><StickyNote className="h-4 w-4" />客戶備註</span>
        {onInsert && (
          <Button type="button" size="sm" variant="outline" className="h-7 bg-background" onClick={() => onInsert(entries[0])} data-testid="button-insert-customer-remark">
            帶入單據備註
          </Button>
        )}
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {shown.map((entry, i) => (
          <li key={i} className="flex items-start gap-2 border-t border-amber-200 pt-1.5 first:border-t-0 first:pt-0 dark:border-amber-800">
            <p className="flex-1 whitespace-pre-wrap break-words">{entry}</p>
            {onInsert && i > 0 && (
              <button type="button" className="shrink-0 text-xs text-amber-800 underline underline-offset-2 dark:text-amber-200" onClick={() => onInsert(entry)}>
                帶入這則
              </button>
            )}
          </li>
        ))}
      </ul>
      {entries.length > 2 && (
        <button type="button" className="mt-1 text-xs text-amber-800 underline underline-offset-2 dark:text-amber-200" onClick={() => setExpanded(v => !v)}>
          {expanded ? "收起" : `看全部 ${entries.length} 則`}
        </button>
      )}
    </div>
  );
}
