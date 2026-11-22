import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/shared/searchable-select";

/**
 * 進貨單、出貨單共用的品項明細輸入表（老闆 2026-11-19：照 Ecount 輸入畫面的樣子）：
 * 一行一筆，有行號、品項編碼／名稱、規格、數量、單價、小計、摘要，最下面一列合計。
 * 空白的行存檔時會略過，所以新單一開始就先放三行空白。
 */
export interface ItemLine {
  itemId: string; quantity: string; rate: string; specification: string; note: string;
  /** 從訂單帶入時，這個品項在訂單上還剩多少可以出／收；只用來提醒 */
  remaining?: number;
}
export interface CatalogItem { id: number; itemName: string; itemCode?: string | null; specification?: string | null }

export const blankLine = (): ItemLine => ({ itemId: "", quantity: "1", rate: "", specification: "", note: "" });
export const blankLines = (count = 3): ItemLine[] => Array.from({ length: count }, blankLine);
export const filledLines = (lines: ItemLine[]) => lines.filter(l => l.itemId);
export const lineAmount = (l: ItemLine) => (Number(l.quantity) || 0) * (Number(l.rate) || 0);
export const linesTotal = (lines: ItemLine[]) => filledLines(lines).reduce((sum, l) => sum + lineAmount(l), 0);
/** 存檔用：把畫面上的行轉成後端要的格式 */
export const linesPayload = (lines: ItemLine[]) => filledLines(lines).map(l => ({
  itemId: Number(l.itemId), quantity: Number(l.quantity), rate: Number(l.rate) || 0,
  specification: l.specification.trim() || undefined, note: l.note.trim() || undefined,
}));
/** 編輯既有單據：把存起來的明細轉回畫面上的行 */
export const linesFromSaved = (saved: Array<{ itemId: number; quantity: number; rate: number; specification?: string | null; note?: string | null }> | null | undefined): ItemLine[] => {
  const rows = (saved || []).map(it => ({ itemId: String(it.itemId), quantity: String(it.quantity), rate: String(it.rate), specification: it.specification || "", note: it.note || "" }));
  return rows.length > 0 ? rows : blankLines();
};

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
/** 含稅金額拆成未稅與 5% 營業稅 */
const splitTax = (amount: number) => { const net = Math.round((amount / 1.05) * 100) / 100; return { net, tax: Math.round((amount - net) * 100) / 100 }; };

export function DocItemLines({ lines, onChange, items, priceOf, taxInclusive = false, remainingLabel = "訂單還剩" }: {
  lines: ItemLine[];
  onChange: (lines: ItemLine[]) => void;
  items: CatalogItem[];
  /** 選了品項之後要帶入的預設單價（出貨帶售價、進貨帶進價） */
  priceOf: (itemId: number) => string | number | null | undefined;
  /** 進貨單：單價是含稅價，多顯示稅前價格與營業稅兩欄 */
  taxInclusive?: boolean;
  remainingLabel?: string;
}) {
  const options = items.map(it => ({ value: String(it.id), label: it.itemCode ? `[${it.itemCode}] ${it.itemName}` : it.itemName }));
  const set = (index: number, patch: Partial<ItemLine>) => onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const pick = (index: number, value: string) => {
    const found = items.find(it => String(it.id) === value);
    const price = found ? priceOf(found.id) : null;
    set(index, { itemId: value, specification: found?.specification || "", rate: price != null && price !== "" ? String(price) : lines[index].rate, remaining: undefined });
  };
  const remove = (index: number) => { const next = lines.filter((_, i) => i !== index); onChange(next.length > 0 ? next : [blankLine()]); };
  const total = linesTotal(lines);
  const totalTax = splitTax(total);
  const leading = 5; // 合計列前面要跨過的欄數：#、品項、規格、數量、單價

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <table className={`w-full text-sm ${taxInclusive ? "min-w-[1060px]" : "min-w-[880px]"}`}>
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2 text-center font-medium">#</th>
              <th className="w-[280px] px-2 py-2 text-left font-medium">品項編碼／名稱</th>
              <th className="px-2 py-2 text-left font-medium">規格</th>
              <th className="px-2 py-2 text-right font-medium">數量</th>
              <th className="whitespace-nowrap px-2 py-2 text-right font-medium">{taxInclusive ? "單價（含稅）" : "單價"}</th>
              {taxInclusive && <th className="whitespace-nowrap px-2 py-2 text-right font-medium">稅前價格</th>}
              {taxInclusive && <th className="whitespace-nowrap px-2 py-2 text-right font-medium">營業稅</th>}
              <th className="w-24 px-2 py-2 text-right font-medium">小計</th>
              <th className="px-2 py-2 text-left font-medium">摘要</th>
              <th className="w-10" aria-label="刪除" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const amount = line.itemId ? lineAmount(line) : 0;
              const { net, tax } = splitTax(amount);
              const over = line.remaining !== undefined && Number(line.quantity) > line.remaining;
              return (
                <tr key={i} className="border-t align-top">
                  <td className="px-2 py-3 text-center text-xs text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1.5">
                    <SearchableSelect value={line.itemId} onValueChange={v => pick(i, v)} options={options}
                      placeholder="選擇品項" searchPlaceholder="輸入品項編碼或名稱搜尋..." emptyText="找不到符合的品項" />
                  </td>
                  <td className="px-2 py-1.5"><Input aria-label={`第 ${i + 1} 列規格`} className="h-9 w-32" value={line.specification} onChange={e => set(i, { specification: e.target.value })} /></td>
                  <td className="px-2 py-1.5">
                    <Input type="number" inputMode="decimal" min="0" aria-label={`第 ${i + 1} 列數量`} className={`h-9 w-24 text-right ${over ? "border-red-400" : ""}`} value={line.quantity} onChange={e => set(i, { quantity: e.target.value })} />
                    {line.remaining !== undefined && <p className={`mt-0.5 text-right text-[11px] ${over ? "text-red-600" : "text-muted-foreground"}`}>{remainingLabel} {line.remaining}</p>}
                  </td>
                  <td className="px-2 py-1.5"><Input type="number" inputMode="decimal" min="0" aria-label={`第 ${i + 1} 列單價`} className="h-9 w-28 text-right" value={line.rate} onChange={e => set(i, { rate: e.target.value })} /></td>
                  {taxInclusive && <td className="px-2 py-3 text-right tabular-nums">{line.itemId ? money(net) : ""}</td>}
                  {taxInclusive && <td className="px-2 py-3 text-right tabular-nums">{line.itemId ? money(tax) : ""}</td>}
                  <td className="px-2 py-3 text-right font-medium tabular-nums">{line.itemId ? money(amount) : ""}</td>
                  <td className="px-2 py-1.5"><Input aria-label={`第 ${i + 1} 列摘要`} className="h-9 w-44" value={line.note} onChange={e => set(i, { note: e.target.value })} /></td>
                  <td className="px-1 py-1.5"><Button type="button" variant="ghost" size="sm" onClick={() => remove(i)} aria-label={`刪除第 ${i + 1} 列`}><Trash2 className="h-4 w-4 text-red-500" /></Button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t bg-muted/30 font-medium">
            <tr>
              <td colSpan={leading} className="px-2 py-2 text-right">合計</td>
              {taxInclusive && <td className="px-2 py-2 text-right tabular-nums">{money(totalTax.net)}</td>}
              {taxInclusive && <td className="px-2 py-2 text-right tabular-nums">{money(totalTax.tax)}</td>}
              <td className="px-2 py-2 text-right tabular-nums">{money(total)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...lines, blankLine()])}><Plus className="mr-1 h-3.5 w-3.5" />新增一行</Button>
        <span className="text-xs text-muted-foreground">沒選品項的空白行存檔時會自動略過。</span>
      </div>
    </div>
  );
}
