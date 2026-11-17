import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Search, ChevronRight, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export interface PickerAccount { id: number; accountNumber: string; accountName: string; parentAccountId: number | null; isGroup?: boolean }

const label = (a: PickerAccount) => `[${a.accountNumber}] ${a.accountName}`;
const byNumber = (a: PickerAccount, b: PickerAccount) => a.accountNumber.localeCompare(b.accountNumber, "zh-Hant", { numeric: true });

/**
 * 照 Ecount「查詢科目」：科目樹 + 搜尋 + 勾選，可以一次勾很多個；勾上層科目等於整組都查。
 */
export function AccountMultiPicker({ accounts, value, onChange }: { accounts: PickerAccount[]; value: number[]; onChange: (ids: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number[]>([]);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const byId = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const children = useMemo(() => {
    const m = new Map<number | null, PickerAccount[]>();
    for (const a of accounts) {
      const parent = a.parentAccountId && byId.has(a.parentAccountId) ? a.parentAccountId : null;
      m.set(parent, [...(m.get(parent) ?? []), a]);
    }
    m.forEach(list => list.sort(byNumber));
    return m;
  }, [accounts, byId]);

  const term = q.trim().toLowerCase();
  // 搜尋時直接列出符合的科目（不分層），跟 Ecount 一樣打關鍵字就找得到
  const matches = useMemo(() => term ? accounts.filter(a => label(a).toLowerCase().includes(term)).sort(byNumber) : [], [accounts, term]);

  const toggle = (id: number) => setDraft(d => d.includes(id) ? d.filter(x => x !== id) : [...d, id]);
  const openPicker = () => { setDraft(value); setQ(""); setOpen(true); };

  const renderRow = (a: PickerAccount, depth: number, flat = false): ReactNode => {
    const kids = children.get(a.id) ?? [];
    const isCollapsed = collapsed.has(a.id);
    return (
      <Fragment key={a.id}>
        <label className={`flex cursor-pointer items-center gap-2 border-b px-2 py-1.5 text-sm hover:bg-muted/60 ${draft.includes(a.id) ? "bg-primary/10" : ""}`} style={{ paddingLeft: 8 + depth * 18 }}>
          <input type="checkbox" className="h-4 w-4" checked={draft.includes(a.id)} onChange={() => toggle(a.id)} />
          {kids.length > 0 && !flat ? (
            <button type="button" aria-label={isCollapsed ? "展開" : "收合"} onClick={e => { e.preventDefault(); setCollapsed(s => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; }); }} className="text-muted-foreground">
              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          ) : <span className="w-4" />}
          <span className={kids.length > 0 ? "font-medium" : ""}>{label(a)}</span>
          {kids.length > 0 && <span className="text-xs text-muted-foreground">（含底下 {kids.length} 項）</span>}
        </label>
        {!flat && !isCollapsed && kids.map(k => renderRow(k, depth + 1))}
      </Fragment>
    );
  };

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="w-full justify-start font-normal" onClick={openPicker}>
        <Search className="mr-2 h-4 w-4 text-muted-foreground" />
        {value.length === 0 ? <span className="text-muted-foreground">選擇科目（可複選）</span> : `已選 ${value.length} 個科目`}
      </Button>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map(id => byId.get(id)).filter((a): a is PickerAccount => !!a).map(a => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
              {label(a)}
              <button type="button" aria-label={`移除 ${a.accountName}`} onClick={() => onChange(value.filter(x => x !== a.id))}><X className="h-3 w-3" /></button>
            </span>
          ))}
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => onChange([])}>全部清除</button>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-2xl max-h-[90dvh] flex flex-col">
          <DialogHeader><DialogTitle>查詢科目</DialogTitle></DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="輸入科目編號或名稱，例如：1113、銀行存款" className="pl-9" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border" style={{ maxHeight: "55dvh" }}>
            {term
              ? (matches.length > 0 ? matches.map(a => renderRow(a, 0, true)) : <p className="p-6 text-center text-sm text-muted-foreground">找不到符合的科目</p>)
              : (children.get(null) ?? []).map(a => renderRow(a, 0))}
          </div>
          <DialogFooter className="gap-2">
            <span className="mr-auto self-center text-sm text-muted-foreground">已勾 {draft.length} 個</span>
            {draft.length > 0 && <Button variant="ghost" onClick={() => setDraft([])}>全部取消</Button>}
            <Button variant="outline" onClick={() => setOpen(false)}>關閉</Button>
            <Button onClick={() => { onChange(draft); setOpen(false); }}>套用</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
