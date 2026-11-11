import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

/** cmdk 不接受空字串當項目值，「不指定／請選擇」這類空值選項用這個代號 */
const EMPTY_VALUE = "__empty__";

/** 手機上選項少於這個數量時，打開選單不自動跳出鍵盤（直接點選比較快） */
const MOBILE_AUTOFOCUS_MIN_OPTIONS = 9;

interface Props {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  title?: string;
  "data-testid"?: string;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "請選擇",
  searchPlaceholder = "搜尋...",
  emptyText = "找不到項目",
  className,
  triggerClassName,
  disabled,
  title,
  "data-testid": testId,
}: Props) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const selected = options.find((o) => o.value === value);

  const trigger = (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className={cn("w-full justify-between font-normal", triggerClassName)}
      disabled={disabled}
      title={title}
      data-testid={testId}
      onClick={isMobile ? () => setOpen(true) : undefined}
    >
      <span className={cn("truncate", !selected && "text-muted-foreground")}>
        {selected ? selected.label : placeholder}
      </span>
      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
    </Button>
  );

  const list = (
    <Command
      className={isMobile ? "flex-1 min-h-0 rounded-none bg-transparent" : undefined}
      filter={(itemValue, search) => {
        // itemValue 是 option.value，但我們希望以 label 篩選
        const key = itemValue === EMPTY_VALUE ? "" : itemValue;
        const opt = options.find((o) => o.value === key || o.value.trim() === key);
        const text = (opt?.label || itemValue).toLowerCase();
        // 可用空白分隔多個關鍵字，全部符合才列出
        const words = search.toLowerCase().split(/\s+/).filter(Boolean);
        return words.every((w) => text.includes(w)) ? 1 : 0;
      }}
    >
      <CommandInput placeholder={searchPlaceholder} />
      <CommandList
        className={cn(
          "overflow-y-auto overscroll-contain",
          isMobile ? "max-h-none flex-1 pb-[max(1rem,env(safe-area-inset-bottom))]" : "max-h-72",
        )}
      >
        <CommandEmpty>{emptyText}</CommandEmpty>
        <CommandGroup>
          {options.map((opt) => (
            <CommandItem
              key={opt.value}
              value={opt.value === "" ? EMPTY_VALUE : opt.value}
              onSelect={() => {
                onValueChange(opt.value);
                setOpen(false);
              }}
              className={isMobile ? "min-h-12 px-3 text-base" : undefined}
              data-testid={testId ? `${testId}-option-${opt.value}` : undefined}
            >
              <Check className={cn("mr-2 h-4 w-4 shrink-0", value === opt.value ? "opacity-100 text-primary" : "opacity-0")} />
              <span className={isMobile ? "break-words" : undefined}>{opt.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );

  // 手機：從底部滑出的整片選單，清單高度固定，鍵盤彈出時不會跳動
  if (isMobile) {
    return (
      <>
        {trigger}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            aria-describedby={undefined}
            className={cn("flex h-[85dvh] max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 pt-6 pb-0", className)}
            onOpenAutoFocus={(e) => {
              if (options.length < MOBILE_AUTOFOCUS_MIN_OPTIONS) e.preventDefault();
            }}
          >
            <DialogTitle className="px-4 pb-3 pr-12 text-base">{title || placeholder}</DialogTitle>
            {list}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className={cn("w-[--radix-popover-trigger-width] p-0", className)} align="start">
        {list}
      </PopoverContent>
    </Popover>
  );
}
