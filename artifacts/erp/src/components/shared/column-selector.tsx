import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { listLayoutPrefix } from "@/components/shared/data-table";
import { useUiLayouts, type LayoutItem } from "@/components/shared/doc-window";

export interface ColumnDef {
  key: string;
  label: string;
  defaultVisible?: boolean;
  alwaysVisible?: boolean;
}

interface ColumnSelectorProps {
  storageKey: string;
  columns: ColumnDef[];
  visibleKeys: Set<string>;
  onChange: (keys: Set<string>) => void;
}

export function useColumnVisibility(storageKey: string, columns: ColumnDef[]) {
  const validKeys = new Set(columns.map(c => c.key));

  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = (JSON.parse(saved) as string[]).filter(k => validKeys.has(k));
        const alwaysKeys = columns.filter(c => c.alwaysVisible).map(c => c.key);
        return new Set([...alwaysKeys, ...parsed]);
      }
    } catch {}
    return new Set(columns.filter(c => c.defaultVisible !== false).map(c => c.key));
  });

  const setAndSave = (keys: Set<string>) => {
    setVisibleKeys(keys);
    const alwaysKeys = new Set(columns.filter(c => c.alwaysVisible).map(c => c.key));
    const toSave = [...keys].filter(k => !alwaysKeys.has(k));
    try { localStorage.setItem(storageKey, JSON.stringify(toSave)); } catch {}
  };

  return { visibleKeys, setVisibleKeys: setAndSave };
}

export function ColumnSelector({ storageKey, columns, visibleKeys, onChange }: ColumnSelectorProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePos = useCallback(() => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 256) });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos]);

  const toggle = (key: string) => {
    const col = columns.find(c => c.key === key);
    if (col?.alwaysVisible) return;
    const next = new Set(visibleKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  // 公司替這一頁清單做的設定（管理者在表格下方「調整欄位」改的）：這裡跟著顯示新的欄名；
  // 公司已經隱藏的欄，個人勾了也不會出現，所以標出來、不給勾。對應方式是欄位名稱相同。
  const [location] = useLocation();
  const { data: layouts } = useUiLayouts();
  const prefix = listLayoutPrefix(location);
  const company: Record<string, LayoutItem> = Object.assign({}, ...Object.entries(layouts ?? {}).filter(([k]) => k.startsWith(prefix)).map(([, config]) => config.columns ?? {}));

  const selectAll =() => onChange(new Set(columns.map(c => c.key)));
  const resetDefaults = () => onChange(new Set(columns.filter(c => c.defaultVisible !== false).map(c => c.key)));

  return (
    <>
      <Button
        ref={btnRef}
        variant="outline"
        size="sm"
        className="h-10 gap-1.5"
        onClick={() => setOpen(!open)}
      >
        <Settings2 size={14} />
        <span className="hidden sm:inline">顯示欄位</span>
        <span className="text-xs text-muted-foreground">({visibleKeys.size})</span>
      </Button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] bg-background border rounded-lg shadow-lg w-64 max-h-96 flex flex-col"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="p-2 border-b flex gap-1 shrink-0">
            <Button variant="ghost" size="sm" className="h-7 text-xs flex-1" onClick={selectAll}>全選</Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs flex-1" onClick={resetDefaults}>預設</Button>
          </div>
          <div className="p-1.5 overflow-y-auto flex-1">
            {columns.map(col => {
              const rule = company[col.label];
              const companyHidden = !!rule?.hidden;
              return (
                <label
                  key={col.key}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-sm cursor-pointer ${col.alwaysVisible || companyHidden ? "opacity-60" : ""}`}
                  title={companyHidden ? "公司已經把這一欄隱藏，要顯示請管理者在表格下方的「調整欄位」打開" : undefined}
                >
                  <input
                    type="checkbox"
                    checked={visibleKeys.has(col.key) && !companyHidden}
                    onChange={() => toggle(col.key)}
                    disabled={col.alwaysVisible || companyHidden}
                    className="rounded border-gray-300"
                  />
                  <span>{rule?.label || col.label}</span>
                  {companyHidden
                    ? <span className="text-xs text-muted-foreground ml-auto">公司已隱藏</span>
                    : col.alwaysVisible && <span className="text-xs text-muted-foreground ml-auto">固定</span>}
                </label>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
