import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** 可搜尋、可多選的下拉選單；選到的項目以小標籤顯示在選單下方，可個別移除 */
export function MultiSearchSelect({ options, value, onChange, placeholder = "請選擇", searchPlaceholder = "搜尋…", emptyText = "找不到符合的項目" }: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (option: string) => onChange(value.includes(option) ? value.filter(v => v !== option) : [...value, option]);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
            <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
              {value.length === 0 ? placeholder : `已選 ${value.length} 個`}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0" style={{ width: "var(--radix-popover-trigger-width)" }} align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList className="max-h-72">
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map(option => {
                  const on = value.includes(option);
                  return (
                    <CommandItem key={option} value={option} onSelect={() => toggle(option)} aria-selected={on}>
                      <Check className={cn("mr-2 h-4 w-4 shrink-0", on ? "opacity-100" : "opacity-0")} />
                      <span className="truncate">{option}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map(v => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-3 pr-1 text-sm">
              {v}
              <button type="button" onClick={() => toggle(v)} className="rounded-full p-1 hover:bg-primary/20" aria-label={`移除 ${v}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
