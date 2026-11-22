import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDown, Search, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DocWindow } from "@/components/shared/doc-window";

/**
 * 選對象（付給誰、跟誰收）：點欄位開一個視窗，上面有分頁可以切換
 * 員工／供應商／老師／客戶，下面是可以搜尋的名單，點一下就選好。
 * 老闆 2026-11-17：不要直接用下拉選單；一張單只選一個對象。
 */
export type PayeeKind = "employee" | "supplier" | "teacher" | "customer";
export interface PayeeChoice { name: string; kind: PayeeKind | "self" | "other"; id?: number }

const TABS: Array<{ key: PayeeKind; label: string; path: string }> = [
  { key: "employee", label: "員工", path: "employees" },
  { key: "supplier", label: "供應商", path: "suppliers" },
  { key: "teacher", label: "老師", path: "teachers" },
  { key: "customer", label: "客戶", path: "customers" },
];
const KIND_LABEL: Record<string, string> = { employee: "員工", supplier: "供應商", teacher: "老師", customer: "客戶", self: "我自己", other: "其他" };

interface Entry { id: number; name: string; code: string | null; note: string | null }
function toEntries(kind: PayeeKind, rows: any[]): Entry[] {
  return rows.map(r => {
    if (kind === "employee") return { id: r.id, name: `${r.firstName ?? ""}${r.lastName ?? ""}`.trim() || r.name || "", code: r.employeeId ?? null, note: r.departmentName ?? r.designation ?? null };
    if (kind === "supplier") return { id: r.id, name: r.name ?? "", code: r.supplierCode ?? null, note: r.contactPerson ?? null };
    if (kind === "teacher") return { id: r.id, name: r.name ?? "", code: r.teacherCode ?? r.code ?? null, note: r.phone ?? null };
    return { id: r.id, name: r.name ?? "", code: r.customerCode ?? null, note: r.contactPerson ?? null };
  }).filter(e => e.name);
}

async function load(path: string): Promise<any[]> {
  const res = await fetch(`/erp-api/${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(res.status === 403 ? "你的帳號看不到這份名單" : "名單讀取失敗");
  const json = await res.json();
  return Array.isArray(json) ? json : Array.isArray(json?.rows) ? json.rows : Array.isArray(json?.data) ? json.data : [];
}

export function PayeePicker({ value, onChange, selfName, disabled, placeholder = "請選擇對象", fallbackSuppliers, testId = "payee-picker" }: {
  value: PayeeChoice | null;
  onChange: (choice: PayeeChoice | null) => void;
  /** 有給就多一個「我自己（先墊）」的選項 */
  selfName?: string;
  disabled?: boolean;
  placeholder?: string;
  /** 帳號看不到供應商名單時（員工自助帳號），用這份代替 */
  fallbackSuppliers?: Array<{ id: number; name: string }>;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PayeeKind>("supplier");
  const [keyword, setKeyword] = useState("");
  const current = TABS.find(t => t.key === tab)!;
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["/payee-picker", current.path],
    queryFn: () => load(current.path),
    enabled: open, staleTime: 5 * 60 * 1000, retry: false,
  });
  const entries = useMemo(() => {
    const rows = isError && tab === "supplier" && fallbackSuppliers ? fallbackSuppliers : data ?? [];
    const list = toEntries(tab, rows as any[]);
    const k = keyword.trim().toLowerCase();
    return (k ? list.filter(e => e.name.toLowerCase().includes(k) || (e.code ?? "").toLowerCase().includes(k)) : list).slice(0, 200);
  }, [data, isError, tab, keyword, fallbackSuppliers]);
  const unavailable = isError && !(tab === "supplier" && fallbackSuppliers);
  const typed = keyword.trim();
  const pick = (choice: PayeeChoice) => { onChange(choice); setOpen(false); setKeyword(""); };

  return (
    <>
      <div className="flex gap-1">
        <Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)} data-testid={testId}
          className={cn("h-11 flex-1 justify-between px-3 text-left font-normal md:h-9", !value && "text-muted-foreground")}>
          <span className="truncate">{value ? <>{value.name}<span className="ml-2 text-xs text-muted-foreground">{value.kind === "self" ? "我自己（先墊）" : KIND_LABEL[value.kind]}</span></> : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
        {value && !disabled && <Button type="button" variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9" onClick={() => onChange(null)} aria-label="清除對象"><X className="h-4 w-4" /></Button>}
      </div>

      <DocWindow open={open} onClose={() => setOpen(false)} name="選擇對象" description="一張單只能選一個對象。先選分頁，再從名單點選。"
        footer={<Button variant="outline" onClick={() => setOpen(false)}>取消</Button>}>
        <div className="space-y-3">
          {selfName && (
            <Button type="button" variant="outline" className="w-full justify-start" onClick={() => pick({ name: selfName, kind: "self" })} data-testid="payee-self">
              <User className="mr-2 h-4 w-4" />付給我自己（{selfName}，我先墊的錢）
            </Button>
          )}
          <div role="tablist" className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
            {TABS.map(t => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => { setTab(t.key); setKeyword(""); }} data-testid={`payee-tab-${t.key}`}
                className={cn("min-h-[40px] rounded-md px-2 text-sm font-medium transition-colors", tab === t.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={`搜尋${current.label}名稱或編號`} aria-label={`搜尋${current.label}`} data-testid="payee-search" />
          </div>
          <div className="max-h-[42dvh] overflow-y-auto rounded-md border">
            {isLoading ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">讀取中…</p>
              : unavailable ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">{error instanceof Error ? error.message : "名單讀取失敗"}。可以在上面打名字，再按下面的「用這個名字」。</p>
              : entries.length === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">{typed ? `找不到「${typed}」` : `還沒有${current.label}資料`}</p>
              : (
                <ul className="divide-y">
                  {entries.map(e => (
                    <li key={e.id}>
                      <button type="button" onClick={() => pick({ name: e.name, kind: tab, id: e.id })} data-testid={`payee-option-${tab}-${e.id}`}
                        className={cn("flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/60", value?.kind === tab && value?.id === e.id && "bg-primary/5 font-medium")}>
                        <span className="min-w-0 truncate">{e.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{[e.code, e.note].filter(Boolean).join("・")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </div>
          {typed && !entries.some(e => e.name === typed) && (
            <Button type="button" variant="outline" className="w-full justify-start" onClick={() => pick({ name: typed, kind: "other" })} data-testid="payee-use-typed">
              名單裡沒有，用這個名字：「{typed}」
            </Button>
          )}
        </div>
      </DocWindow>
    </>
  );
}
