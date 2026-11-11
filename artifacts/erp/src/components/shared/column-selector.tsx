import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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

  const selectAll = () => onChange(new Set(columns.map(c => c.key)));
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
            {columns.map(col => (
              <label
                key={col.key}
                className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-sm cursor-pointer ${col.alwaysVisible ? "opacity-60" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={visibleKeys.has(col.key)}
                  onChange={() => toggle(col.key)}
                  disabled={col.alwaysVisible}
                  className="rounded border-gray-300"
                />
                <span>{col.label}</span>
                {col.alwaysVisible && <span className="text-xs text-muted-foreground ml-auto">固定</span>}
              </label>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
