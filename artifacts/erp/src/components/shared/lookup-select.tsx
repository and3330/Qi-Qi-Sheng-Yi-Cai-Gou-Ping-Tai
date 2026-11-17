import { Children, isValidElement, useMemo, type ReactNode } from "react";
import { SearchableSelect, type SearchableSelectOption } from "@/components/shared/searchable-select";
import { cn } from "@/lib/utils";

/**
 * 可輸入關鍵字查詢的下拉選單，用法與原生 <select>／shadcn <Select> 相同：
 * 直接把 <option> 或 <SelectItem> 放在 children 裡，元件會讀出選項並改用可搜尋的清單呈現。
 * 所有「從主檔挑一筆」的欄位（客戶、供應商、品項、員工、科目、部門、專案、倉庫…）都用這個。
 */
interface Props {
  value?: string | number | null;
  /** 原生 select 寫法：e.target.value */
  onChange?: (e: any) => void;
  /** shadcn Select 寫法 */
  onValueChange?: (value: string) => void;
  children?: ReactNode;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  name?: string;
  required?: boolean;
  "data-testid"?: string;
}

const LAYOUT_CLASS = /^(?:[a-z]+:)*(?:w-|min-w-|max-w-|flex-|shrink|grow|basis-|col-span-|h-|text-(?:xs|sm|base)$)/;

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

interface Parsed { options: SearchableSelectOption[]; placeholder?: string; disabledValues: Set<string> }

function collect(node: ReactNode, acc: Parsed): void {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: unknown; placeholder?: string; children?: ReactNode; disabled?: boolean };
    if (typeof props.placeholder === "string" && props.value === undefined) {
      acc.placeholder ??= props.placeholder; // <SelectValue placeholder="…" />
      return;
    }
    if (props.value !== undefined && (child.type === "option" || textOf(props.children) !== "" || props.children == null)) {
      const value = String(props.value ?? "");
      const label = textOf(props.children) || value;
      if (value === "") acc.placeholder ??= label; // <option value="">請選擇</option> 當成提示文字，同時可用來清除
      if (props.disabled) acc.disabledValues.add(value);
      if (!acc.options.some(o => o.value === value)) acc.options.push({ value, label });
      return;
    }
    collect(props.children, acc); // <SelectContent>、<SelectGroup>、Fragment
  });
}

export function LookupSelect({ value, onChange, onValueChange, children, className, placeholder, disabled, title, "data-testid": testId }: Props) {
  const parsed = useMemo(() => {
    const acc: Parsed = { options: [], disabledValues: new Set() };
    collect(children, acc);
    return acc;
  }, [children]);

  const current = value == null ? "" : String(value);
  const options = parsed.options.filter(o => !parsed.disabledValues.has(o.value) || o.value === current);
  const layout = (className || "").split(/\s+/).filter(c => LAYOUT_CLASS.test(c)).join(" ");

  return (
    <SearchableSelect
      value={current}
      onValueChange={(next) => {
        onValueChange?.(next);
        onChange?.({ target: { value: next }, currentTarget: { value: next } });
      }}
      options={options}
      placeholder={placeholder || parsed.placeholder || "請選擇"}
      searchPlaceholder="輸入關鍵字搜尋…"
      triggerClassName={cn(layout || "w-full", "bg-background")}
      disabled={disabled}
      title={title}
      data-testid={testId}
    />
  );
}
