import { Plus, Trash2 } from "lucide-react";
import { MasterLookup, useMasterRows } from "@/components/shared/master-lookup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ItemLine { itemId: string; quantity: string; rate: string; note: string }
export const emptyLine: ItemLine = { itemId: "", quantity: "1", rate: "", note: "" };

/** 品項明細的輸入列：請購單只要品項、數量、備註；定期發票多一欄單價 */
export function ItemLines({ lines, onChange, withRate = false, priceField = "sellingPrice" }: {
  lines: ItemLine[]; onChange: (lines: ItemLine[]) => void; withRate?: boolean; priceField?: "sellingPrice" | "buyingPrice";
}) {
  const { data: items = [] } = useMasterRows("items");
  const set = (index: number, patch: Partial<ItemLine>) => onChange(lines.map((l, i) => i === index ? { ...l, ...patch } : l));
  const pick = (index: number, itemId: string) => {
    const item = items.find(i => String(i.id) === itemId);
    set(index, { itemId, ...(withRate && item ? { rate: String(Number(item[priceField]) || 0) } : {}) });
  };
  return (
    <div className="space-y-2">
      {lines.map((line, index) => (
        <div key={index} className="rounded-lg border p-2 space-y-2">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <MasterLookup source="items" value={line.itemId} onValueChange={v => pick(index, v)} clearable={false} placeholder="選擇品項" />
            </div>
            <Button type="button" size="icon" variant="ghost" className="h-10 w-10 shrink-0 text-red-500" aria-label={`刪除第 ${index + 1} 列`} disabled={lines.length <= 1} onClick={() => onChange(lines.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
          </div>
          <div className={`grid gap-2 ${withRate ? "grid-cols-2" : "grid-cols-[6rem_1fr]"}`}>
            <Input aria-label={`第 ${index + 1} 列數量`} type="number" inputMode="decimal" min="0" placeholder="數量" value={line.quantity} onChange={e => set(index, { quantity: e.target.value })} />
            {withRate
              ? <Input aria-label={`第 ${index + 1} 列單價`} type="number" inputMode="decimal" min="0" placeholder="單價" value={line.rate} onChange={e => set(index, { rate: e.target.value })} />
              : <Input aria-label={`第 ${index + 1} 列備註`} placeholder="規格、用途（選填）" value={line.note} onChange={e => set(index, { note: e.target.value })} />}
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...lines, { ...emptyLine }])}><Plus className="h-3.5 w-3.5 mr-1" />加一列</Button>
    </div>
  );
}
