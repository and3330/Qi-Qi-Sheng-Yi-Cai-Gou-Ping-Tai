import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowDown, ArrowUp, ExternalLink, Eye, EyeOff, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { call, post } from "@/lib/call";
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
 *
 * 視覺化編輯（老闆 2026-11-17）：管理者在任何一個視窗的標題列按「編輯版面」，就可以直接改
 * 這個視窗的標題、每個欄位叫什麼、要不要顯示、排第幾個，表格的欄也一樣；改的時候下面的畫面跟著變。
 * 設定是照視窗名稱存的（整家公司共用），存在 ui_layouts。
 */
export interface LayoutItem { label?: string; hidden?: boolean; order?: number }
export interface LayoutConfig { title?: string; fields?: Record<string, LayoutItem>; columns?: Record<string, LayoutItem>; labels?: Record<string, string> }
type Group = "fields" | "columns";

interface LayoutContext {
  config: LayoutConfig;
  editing: boolean;
  /** DocFields、DocLines 把自己原本有哪些欄位報上來，編輯面板才列得出來 */
  register: (group: Group, labels: string[]) => void;
}
const Ctx = createContext<LayoutContext | null>(null);

/** 全公司的版面設定：{ 視窗名稱: 設定 }。讀不到就當作沒有設定，畫面照原樣 */
export function useUiLayouts() {
  return useQuery({ queryKey: ["/ui-layouts"], queryFn: () => call<Record<string, LayoutConfig>>("ui-layouts"), staleTime: 5 * 60 * 1000, retry: false });
}

/** 依設定改名、隱藏、排序。原本的名稱是鑰匙，所以程式裡的欄位名稱不要隨便改 */
function arrange<T>(items: T[], labelOf: (item: T) => string, rules: Record<string, LayoutItem> | undefined): Array<{ item: T; label: string; original: string }> {
  const list = items.map((item, index) => {
    const original = labelOf(item);
    const rule = rules?.[original];
    return { item, original, label: rule?.label || original, hidden: !!rule?.hidden, order: rule?.order ?? index, index };
  });
  return list.filter(x => !x.hidden).sort((a, b) => a.order - b.order || a.index - b.index);
}

/**
 * 新增和編輯是同一張表單：視窗名稱開頭是「新增／編輯／修改」的，設定一律存在「表單:XX」底下，兩邊共用。
 * 看單的視窗（名稱就是「XX」）內容不一樣（表頭欄位＋明細表格），所以不併進來，維持自己的名字。
 */
const FORM_PREFIXES = ["新增", "編輯", "修改"];
interface SharedForm { key: string; prefix: string; base: string }
function sharedFormKey(name: string): SharedForm | null {
  const prefix = FORM_PREFIXES.find(p => name.startsWith(p));
  const base = prefix ? name.slice(prefix.length).trim() : "";
  // 後端的名字最長 80 個字，太長就不共用，照原本的名稱存
  if (!prefix || !base || base.length > 70) return null;
  return { key: `表單:${base}`, prefix, base };
}
/** 舊設定的標題是整個寫死的（例如「新增出貨」）；共用後開頭的「新增／編輯」由系統自動加，所以先拿掉 */
function stripFormPrefix(title: string | undefined): string | undefined {
  const prefix = title ? FORM_PREFIXES.find(p => title.startsWith(p)) : undefined;
  return prefix && title ? title.slice(prefix.length).trim() || undefined : title;
}

export function DocWindow({ open, onClose, name, number, status, description, children, footer, wide = false, extraWide = false, layoutKey }: {
  open: boolean; onClose: () => void;
  /** 單據名稱，例如「進貨單」 */ name: string;
  /** 單號 */ number?: string | null;
  /** 狀態徽章（用 DocStatus，或各單自己的徽章） */ status?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** 底部按鈕列：左邊放刪除、作廢這類要小心的，右邊放主要動作和關閉 */ footer?: ReactNode;
  /** 明細欄位多的單（進貨、出貨）用寬一點的視窗 */ wide?: boolean;
  /** 一次輸入很多欄的工具（批次輸入）用最寬的視窗 */ extraWide?: boolean;
  /**
   * 版面設定存在哪個名字底下。沒給就用 name（開頭是「新增／編輯／修改」的會自動共用同一份，見 sharedFormKey）。
   * 視窗名稱裡如果帶了資料（客戶名稱、品項名稱…），一定要給固定的 layoutKey，
   * 不然改好的版面只會對那一筆資料有效；兩種不同的視窗也不能共用同一個名字。
   */
  layoutKey?: string;
}) {
  const { hasRole } = useAuth();
  const { data: layouts } = useUiLayouts();
  // 「新增XX」「編輯XX」是同一張表單，設定存在同一個名字底下，改一次兩邊都生效；看單的視窗（XX）維持自己一份
  const shared = layoutKey ? null : sharedFormKey(name);
  const key = layoutKey ?? shared?.key ?? name;
  // 以前照視窗原本名稱存的設定繼續有效：先找新名字，沒有才用舊的
  const legacy = shared ? layouts?.[name] : undefined;
  const current = layouts?.[key];
  const saved = useMemo(() => current ?? (legacy ? { ...legacy, title: stripFormPrefix(legacy.title) } : undefined), [current, legacy]);
  const [draft, setDraft] = useState<LayoutConfig | null>(null);
  const editing = draft !== null;
  const config = draft ?? saved ?? {};
  const bodyRef = useRef<HTMLDivElement>(null);
  const [registered, setRegistered] = useState<Record<Group, string[]>>({ fields: [], columns: [] });
  const register = useCallback((group: Group, labels: string[]) => {
    setRegistered(prev => {
      const merged = [...new Set([...prev[group], ...labels])];
      return merged.length === prev[group].length ? prev : { ...prev, [group]: merged };
    });
  }, []);
  const context = useMemo(() => ({ config, editing, register }), [config, editing, register]);
  // 關掉視窗就離開編輯，沒存的不留
  useEffect(() => { if (!open) { setDraft(null); setRegistered({ fields: [], columns: [] }); } }, [open]);
  useFormLabels(bodyRef, config.labels, open);

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className={cn("flex max-h-[92dvh] flex-col gap-0 p-0", extraWide ? "md:max-w-[min(1320px,96vw)]" : wide ? "md:max-w-4xl" : "md:max-w-2xl")}>
        <DialogHeader className="border-b px-4 py-3 md:px-6">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8 text-left">
            <span>{shared ? `${shared.prefix}${config.title || shared.base}` : config.title || name}</span>
            {number && <span className="font-mono text-base font-medium">{number}</span>}
            {status}
            {hasRole("owner", "admin") && !editing && (
              <button type="button" onClick={() => setDraft(saved ?? {})} title="編輯這個視窗的版面" aria-label="編輯版面" data-testid="button-edit-layout"
                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground print:hidden">
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            )}
          </DialogTitle>
          {/* 沒有說明文字時也留一個給螢幕閱讀器用的描述，避免無障礙警告 */}
          <DialogDescription className={description ? "text-left" : "sr-only"}>{description || `${name}${number ? ` ${number}` : ""} 的內容`}</DialogDescription>
        </DialogHeader>
        <Ctx.Provider value={context}>
          <div ref={bodyRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm md:px-6">
            {editing && <LayoutEditor name={key} shared={shared} oldKeys={shared ? FORM_PREFIXES.map(p => `${p}${shared.base}`).concat(name).filter((k, i, all) => all.indexOf(k) === i && !!layouts?.[k]) : []}
              draft={draft!} setDraft={setDraft} registered={registered} bodyRef={bodyRef} onDone={() => setDraft(null)} />}
            {children}
          </div>
        </Ctx.Provider>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-background px-4 py-3 md:px-6">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 表單上的欄位名稱（<label>）和手寫表格的欄名（<th>）：每個視窗寫法不同，所以直接改畫面上的字。
 * 只改名稱，不隱藏、不移位（必填欄位藏起來會存不了檔）。原本的名稱記在 data-doc-orig。
 */
const LABEL_SELECTOR = "label, th";
function labelNode(el: Element): Text | null {
  for (const node of Array.from(el.childNodes)) if (node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim()) return node as Text;
  return null;
}
function formLabelsIn(root: HTMLElement): Array<{ el: HTMLElement; node: Text; original: string }> {
  const out: Array<{ el: HTMLElement; node: Text; original: string }> = [];
  root.querySelectorAll<HTMLElement>(LABEL_SELECTOR).forEach(el => {
    if (el.closest("[data-layout-editor], [data-doc-managed]")) return;
    const node = labelNode(el);
    if (!node) return;
    const now = node.nodeValue!.trim();
    // React 重畫時會把字改回原樣（或換成另一個詞），這時以現在的字當原本的名稱
    if (!el.dataset.docOrig || (now !== el.dataset.docOrig && now !== el.dataset.docShown)) el.dataset.docOrig = now;
    out.push({ el, node, original: el.dataset.docOrig });
  });
  return out;
}
function useFormLabels(bodyRef: React.RefObject<HTMLDivElement | null>, labels: Record<string, string> | undefined, open: boolean) {
  useEffect(() => {
    const root = bodyRef.current;
    if (!open || !root) return;
    const apply = () => {
      for (const { el, node, original } of formLabelsIn(root)) {
        const want = labels?.[original] || original;
        if (node.nodeValue!.trim() !== want) node.nodeValue = node.nodeValue!.replace(node.nodeValue!.trim(), want);
        el.dataset.docShown = want;
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  });
}

/** 編輯面板：改標題、表頭欄位、表格欄、表單欄位名稱。改的時候下面的畫面立刻跟著變，按儲存才會存起來 */
function LayoutEditor({ name, shared, oldKeys, draft, setDraft, registered, bodyRef, onDone }: {
  name: string; draft: LayoutConfig; setDraft: (c: LayoutConfig | null) => void; registered: Record<Group, string[]>;
  bodyRef: React.RefObject<HTMLDivElement | null>; onDone: () => void;
  /** 新增、編輯共用的表單才有 */ shared: SharedForm | null;
  /** 以前照舊名稱存的設定；改回系統預設時要一起清掉，不然舊的會再冒出來 */ oldKeys: string[];
}) {
  const shownName = shared ? `${shared.base}（新增和編輯共用）` : name;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [formLabels, setFormLabels] = useState<string[]>([]);
  useEffect(() => {
    const scan = () => { if (bodyRef.current) setFormLabels([...new Set(formLabelsIn(bodyRef.current).map(l => l.original))]); };
    scan();
    const timer = window.setInterval(scan, 1500);
    return () => window.clearInterval(timer);
  }, [bodyRef]);

  const setItem = (group: Group, key: string, patch: LayoutItem) => setDraft({ ...draft, [group]: { ...draft[group], [key]: { ...draft[group]?.[key], ...patch } } });
  const ordered = (group: Group) => {
    const rules = draft[group];
    return registered[group].map((key, index) => ({ key, order: rules?.[key]?.order ?? index, index })).sort((a, b) => a.order - b.order || a.index - b.index).map(x => x.key);
  };
  const move = (group: Group, key: string, step: -1 | 1) => {
    const list = ordered(group);
    const from = list.indexOf(key), to = from + step;
    if (to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to], list[from]];
    setDraft({ ...draft, [group]: Object.fromEntries(list.map((k, i) => [k, { ...draft[group]?.[k], order: i }])) });
  };

  const save = async () => {
    setSaving(true);
    try {
      await post("ui-layouts", { key: name, config: draft }, "PUT");
      await queryClient.invalidateQueries({ queryKey: ["/ui-layouts"] });
      toast({ title: "版面已儲存", description: shared ? "全公司新增和編輯這張單，都會是新的樣子" : "全公司打開這個視窗都會是新的樣子" });
      onDone();
    } catch (e) {
      toast({ title: "沒有存成功", description: e instanceof Error ? e.message : "請稍後再試", variant: "destructive" });
    } finally { setSaving(false); }
  };
  const reset = async () => {
    if (!window.confirm(`把「${shownName}」的版面改回系統預設？你改過的名稱、隱藏和順序都會取消。`)) return;
    setSaving(true);
    try {
      for (const key of [name, ...oldKeys.filter(k => k !== name)]) await call(`ui-layouts?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["/ui-layouts"] });
      toast({ title: "已改回系統預設" });
      onDone();
    } catch (e) {
      toast({ title: "沒有成功", description: e instanceof Error ? e.message : "請稍後再試", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const groupBlock = (group: Group, title: string, hint: string) => {
    const keys = ordered(group);
    if (keys.length === 0) return null;
    return (
      <div className="space-y-1.5">
        <p className="text-xs font-medium">{title}<span className="ml-2 font-normal text-muted-foreground">{hint}</span></p>
        <ul className="space-y-1">
          {keys.map((key, i) => {
            const rule = draft[group]?.[key];
            return (
              <li key={key} className="flex items-center gap-1">
                <Input className={cn("h-9 flex-1", rule?.hidden && "text-muted-foreground line-through")} value={rule?.label ?? key} placeholder={key}
                  onChange={e => setItem(group, key, { label: e.target.value })} aria-label={`「${key}」要顯示成什麼`} data-testid={`layout-${group}-${key}`} />
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={i === 0} onClick={() => move(group, key, -1)} aria-label={`「${key}」往前移`}><ArrowUp className="h-4 w-4" /></Button>
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={i === keys.length - 1} onClick={() => move(group, key, 1)} aria-label={`「${key}」往後移`}><ArrowDown className="h-4 w-4" /></Button>
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => setItem(group, key, { hidden: !rule?.hidden })} aria-label={rule?.hidden ? `顯示「${key}」` : `隱藏「${key}」`} title={rule?.hidden ? "目前隱藏，按一下顯示" : "目前顯示，按一下隱藏"}>
                  {rule?.hidden ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4" />}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div data-layout-editor className="space-y-3 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-3" data-testid="layout-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">編輯版面：{shownName}</p>
        <p className="text-xs text-muted-foreground">改了下面的畫面會立刻跟著變；按「儲存版面」全公司才會套用。</p>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium">視窗標題{shared && <span className="ml-2 font-normal text-muted-foreground">前面的「新增」「編輯」系統會自動加，這裡只要填單據名稱</span>}</p>
        <Input className="h-9" value={draft.title ?? ""} placeholder={shared ? shared.base : name} onChange={e => setDraft({ ...draft, title: e.target.value })} aria-label="視窗標題" data-testid="layout-title" />
      </div>
      {groupBlock("fields", "表頭欄位", "改名稱、調順序、按眼睛隱藏")}
      {groupBlock("columns", "明細表格的欄", "改名稱、調順序、按眼睛隱藏")}
      {formLabels.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">表單欄位名稱<span className="ml-2 font-normal text-muted-foreground">只能改名稱（要填的欄位不能藏）</span></p>
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {formLabels.map(key => (
              <Input key={key} className="h-9" value={draft.labels?.[key] ?? key} placeholder={key} aria-label={`「${key}」要顯示成什麼`} data-testid={`layout-label-${key}`}
                onChange={e => setDraft({ ...draft, labels: { ...draft.labels, [key]: e.target.value } })} />
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className="mr-auto text-destructive" disabled={saving} onClick={reset}>改回系統預設</Button>
        <Button type="button" variant="outline" disabled={saving} onClick={() => setDraft(null)}>取消</Button>
        <Button type="button" disabled={saving} onClick={save} data-testid="button-save-layout">{saving ? "儲存中…" : "儲存版面"}</Button>
      </div>
    </div>
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
  const layout = useContext(Ctx);
  const all = items.filter((it): it is [string, ReactNode] => !!it);
  const names = all.map(it => it[0]).join("\u0001");
  useEffect(() => { if (names) layout?.register("fields", names.split("\u0001")); }, [names, layout?.register]);
  const shown = arrange(all, it => it[0], layout?.config.fields).filter(({ item }) => item[1] !== null && item[1] !== undefined && item[1] !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 md:grid-cols-2" data-doc-managed>
      {shown.map(({ item, label, original }) => (
        <div key={original} className="flex gap-3 border-b py-2">
          <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
          <dd className="min-w-0 flex-1 break-words font-medium">{item[1]}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 新增／編輯表單的表頭（老闆 2026-11-18：照 Ecount 輸入畫面的樣子）：一個欄位一列，
 * 左邊是欄位名稱、右邊是填的地方；手機上名稱在上、輸入框在下。下面再接一張一行一筆的輸入表格。
 * 欄位名稱是真的 <label>，所以「編輯版面」一樣改得到名稱。
 */
export function DocFormRows({ children, className, ...rest }: { children: ReactNode; className?: string; "data-testid"?: string }) {
  return <div className={cn("divide-y overflow-hidden rounded-md border", className)} {...rest}>{children}</div>;
}
export function DocFormRow({ label, htmlFor, required, hint, top, children }: {
  label: string; htmlFor?: string; required?: boolean;
  /** 輸入框下面的小字說明 */ hint?: ReactNode;
  /** 內容比較高（多行備註、附件清單）時，欄位名稱靠上對齊 */ top?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[8rem_minmax(0,1fr)]">
      <label htmlFor={htmlFor} className={cn("flex px-3 pt-2 text-sm font-medium text-muted-foreground md:border-r md:bg-muted/40 md:py-2.5", top ? "md:items-start" : "md:items-center")}>
        {label}{required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      <div className="min-w-0 space-y-1 px-3 pb-2.5 pt-1 md:py-2">
        {children}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export interface DocColumn<Row> { header: string; cell: (row: Row, index: number) => ReactNode; align?: "left" | "right"; className?: string }
/** 明細表格：一行一筆；有給 total 就在最下面多一列合計 */
export function DocLines<Row>({ columns, rows, total, empty = "沒有明細", scroll = false }: { columns: DocColumn<Row>[]; rows: Row[]; total?: { label?: string; value: ReactNode }; empty?: string; /** 行數很多的單（盤點單）：表格自己捲、表頭固定，上面的搜尋列不會被捲走 */ scroll?: boolean }) {
  const layout = useContext(Ctx);
  const names = columns.map(c => c.header).join("\u0001");
  useEffect(() => { if (names) layout?.register("columns", names.split("\u0001")); }, [names, layout?.register]);
  const shown = arrange(columns, c => c.header, layout?.config.columns);
  return (
    <div className={cn("overflow-x-auto rounded-md border", scroll && "max-h-[46dvh] overflow-y-auto")} data-doc-managed>
      <table className="w-full text-sm">
        <thead className={cn("bg-muted text-xs text-muted-foreground", scroll && "sticky top-0 z-10")}>
          <tr>{shown.map(({ item: c, label, original }) => <th key={original} className={cn("px-3 py-1.5 font-medium", c.align === "right" ? "text-right" : "text-left", c.className)}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={Math.max(1, shown.length)} className="px-3 py-4 text-center text-muted-foreground">{empty}</td></tr>}
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {shown.map(({ item: c, original }) => <td key={original} className={cn("px-3 py-1.5", c.align === "right" ? "text-right tabular-nums" : "text-left", c.className)}>{c.cell(row, i)}</td>)}
            </tr>
          ))}
          {total && rows.length > 0 && (
            <tr className="border-t-2 font-semibold">
              <td className="px-3 py-1.5" colSpan={Math.max(1, shown.length - 1)}>{total.label ?? "合計"}</td>
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
