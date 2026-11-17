import { useState } from "react";
import { CircleHelp, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageHintProps {
  hintKey: string;
  children: React.ReactNode;
}

const storageKey = (hintKey: string) => `erp-page-hint-dismissed:${hintKey}`;

export function PageHint({ hintKey, children }: PageHintProps) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storageKey(hintKey)) !== "1";
    } catch {
      return true;
    }
  });

  const dismiss = () => {
    setOpen(false);
    try {
      localStorage.setItem(storageKey(hintKey), "1");
    } catch {
      // The hint still works when storage is unavailable.
    }
  };

  return (
    <span className="relative inline-flex print:hidden">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        aria-label={open ? "收合此頁說明" : "開啟此頁說明"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <CircleHelp className="h-4 w-4" />
      </Button>
      {open && (
        <span
          role="note"
          className="absolute left-0 top-9 z-40 block w-[min(22rem,calc(100vw-2rem))] max-md:fixed max-md:left-4 max-md:right-4 max-md:top-[calc(4.25rem+env(safe-area-inset-top))] max-md:w-auto rounded-lg border bg-popover p-3 pr-9 text-sm font-normal leading-relaxed text-popover-foreground shadow-md"
        >
          {children}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1.5 top-1.5 h-7 w-7 text-muted-foreground"
            aria-label="關閉並記住"
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </span>
      )}
    </span>
  );
}