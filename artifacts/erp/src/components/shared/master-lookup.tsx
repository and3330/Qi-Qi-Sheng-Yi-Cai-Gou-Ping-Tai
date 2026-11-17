import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchableSelect } from "@/components/shared/searchable-select";

/**
 * 直接連到主檔的可搜尋下拉。給「原本是手打文字、其實應該從主檔挑」的欄位用：
 * 選項即時從主檔載入，輸入關鍵字就能篩選。
 * - valueKey="name"：欄位存的是名稱（供應商名稱、負責人姓名），舊資料不在主檔裡也會保留顯示
 * - valueKey="id"：欄位存的是主檔編號
 */
type Row = Record<string, any>;

const SOURCES = {
  suppliers: { endpoint: "suppliers", name: (r: Row) => r.name, hint: (r: Row) => r.supplierCode },
  customers: { endpoint: "customers", name: (r: Row) => r.name, hint: (r: Row) => r.customerCode },
  employees: { endpoint: "employees", name: (r: Row) => `${r.firstName || ""}${r.lastName || ""}`.trim() || r.name || r.employeeId, hint: (r: Row) => r.employeeId },
  items: { endpoint: "items", name: (r: Row) => r.itemName, hint: (r: Row) => r.itemCode },
  warehouses: { endpoint: "warehouses", name: (r: Row) => r.name, hint: () => "" },
  "purchase-receipts": { endpoint: "purchase-receipts", name: (r: Row) => r.receiptNumber, hint: (r: Row) => [r.supplierName, r.receiptDate].filter(Boolean).join(" · ") },
  "delivery-notes": { endpoint: "delivery-notes", name: (r: Row) => r.noteNumber, hint: (r: Row) => [r.customerName, r.deliveryDate].filter(Boolean).join(" · ") },
  "work-orders": { endpoint: "work-orders", name: (r: Row) => r.workOrderNumber, hint: (r: Row) => r.itemName },
  accounts: { endpoint: "accounts", name: (r: Row) => r.accountName, hint: (r: Row) => r.accountNumber },
} as const;

export type MasterSource = keyof typeof SOURCES;

/** 載入主檔清單（同一個主檔全站共用快取） */
export function useMasterRows(source: MasterSource | null, enabled = true) {
  const endpoint = source ? SOURCES[source].endpoint : "";
  return useQuery<Row[]>({
    queryKey: ["master-lookup", endpoint],
    enabled: enabled && !!source,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`/erp-api/${endpoint}`, { credentials: "include" });
      if (!res.ok) throw new Error("主檔載入失敗");
      const data = await res.json();
      return Array.isArray(data) ? data : (data?.data ?? data?.items ?? []);
    },
  });
}

interface Props {
  source: MasterSource;
  valueKey?: "name" | "id";
  value: string | number | null | undefined;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /** 只列出符合條件的主檔資料，例如只要明細科目 */
  filter?: (row: Row) => boolean;
  /** 允許清空 */
  clearable?: boolean;
  disabled?: boolean;
  "data-testid"?: string;
}

export function MasterLookup({ source, valueKey = "id", value, onValueChange, placeholder, filter, clearable = true, disabled, "data-testid": testId }: Props) {
  const config = SOURCES[source];
  const { data: rows = [], isLoading } = useMasterRows(source);
  const current = value == null ? "" : String(value);

  const options = useMemo(() => {
    const list = rows.filter(r => (filter ? filter(r) : true)).map(r => {
      const name = String(config.name(r) ?? "");
      const hint = config.hint(r);
      return { value: valueKey === "id" ? String(r.id) : name, label: hint ? `${name}（${hint}）` : name };
    }).filter(o => o.value !== "");
    const seen = new Set<string>();
    const unique = list.filter(o => (seen.has(o.value) ? false : (seen.add(o.value), true)));
    // 舊資料手打的名稱不在主檔裡時，仍然顯示出來，不會因為打開表單就被清掉
    if (current && valueKey === "name" && !seen.has(current)) unique.unshift({ value: current, label: `${current}（未建檔）` });
    if (clearable) unique.unshift({ value: "", label: "（不指定）" });
    return unique;
  }, [rows, filter, config, valueKey, current, clearable]);

  return (
    <SearchableSelect
      value={current}
      onValueChange={onValueChange}
      options={options}
      placeholder={isLoading ? "載入中…" : (placeholder || "請選擇")}
      searchPlaceholder="輸入關鍵字搜尋…"
      emptyText="找不到符合的資料"
      triggerClassName="bg-background"
      disabled={disabled}
      data-testid={testId}
    />
  );
}
