import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  Building2,
  FileText,
  FolderKanban,
  Loader2,
  Package,
  Receipt,
  Search,
  ShoppingCart,
  Truck,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

interface SearchHit {
  type: string;
  id: number;
  title: string;
  subtitle: string;
  link: string;
}

const GROUPS = [
  { key: "customers", label: "客戶", icon: Building2 },
  { key: "suppliers", label: "供應商", icon: Truck },
  { key: "items", label: "品項", icon: Package },
  { key: "salesOrders", label: "訂單", icon: ShoppingCart },
  { key: "quotations", label: "報價單", icon: FileText },
  { key: "purchaseOrders", label: "採購單", icon: ShoppingCart },
  { key: "invoices", label: "發票", icon: Receipt },
  { key: "projects", label: "專案", icon: FolderKanban },
] as const;

type SearchGroups = Record<string, SearchHit[]>;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function GlobalSearchDialog({ open, onClose }: Props) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroups>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
      setGroups({});
      setError("");
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setGroups({});
      setLoading(false);
      setError("");
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/erp-api/search?q=${encodeURIComponent(debouncedQuery)}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "搜尋失敗");
        }
        return response.json() as Promise<SearchGroups>;
      })
      .then((results) => {
        setGroups(results);
        setActiveIndex(0);
      })
      .catch((fetchError: Error) => {
        if (fetchError.name !== "AbortError") {
          setGroups({});
          setError(fetchError.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [debouncedQuery]);

  const allHits = useMemo(
    () => GROUPS.flatMap(({ key }) => groups[key] ?? []),
    [groups],
  );

  const goToResult = useCallback((hit: SearchHit) => {
    navigate(hit.link);
    onClose();
  }, [navigate, onClose]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, allHits.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && allHits[activeIndex]) {
      event.preventDefault();
      goToResult(allHits[activeIndex]);
    }
  };

  let resultIndex = 0;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="md:max-w-2xl p-0 overflow-hidden" data-testid="dialog-global-search">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜尋客戶、供應商、品項、訂單、報價單、採購單、發票或專案..."
            className="h-7 border-0 px-0 text-sm focus-visible:ring-0"
            data-testid="input-global-search"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] sm:inline-flex">ESC</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {query.trim().length < 2 && (
            <div className="p-8 text-center text-sm text-muted-foreground">請輸入至少 2 個字元開始搜尋</div>
          )}
          {error && <div className="p-8 text-center text-sm text-destructive">{error}</div>}
          {!loading && !error && debouncedQuery.length >= 2 && allHits.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              找不到符合「{debouncedQuery}」的結果
            </div>
          )}
          {GROUPS.map(({ key, label, icon: Icon }) => {
            const hits = groups[key] ?? [];
            if (hits.length === 0) return null;
            return (
              <div key={key} className="py-1">
                <div className="px-4 py-1 text-[11px] font-semibold tracking-wider text-muted-foreground">
                  {label} ({hits.length})
                </div>
                {hits.map((hit) => {
                  const index = resultIndex++;
                  const active = index === activeIndex;
                  return (
                    <button
                      key={`${hit.type}-${hit.id}`}
                      type="button"
                      onClick={() => goToResult(hit)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-left ${active ? "bg-accent" : ""}`}
                      data-testid={`hit-${hit.type}-${hit.id}`}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{hit.title}</div>
                        {hit.subtitle && <div className="truncate text-xs text-muted-foreground">{hit.subtitle}</div>}
                      </div>
                      {active && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span><kbd className="rounded bg-muted px-1">↑↓</kbd> 選擇</span>
            <span><kbd className="rounded bg-muted px-1">⏎</kbd> 開啟</span>
          </div>
          <span><kbd className="rounded bg-muted px-1">⌘K</kbd> / <kbd className="rounded bg-muted px-1">Ctrl+K</kbd></span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function useGlobalSearchHotkey(setOpen: (open: boolean) => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setOpen]);
}