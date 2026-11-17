import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

interface AccountOption { id: number; accountNumber: string; accountName: string }

const LAST_KEY = "erp:last-cash-account";
const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/erp-api/${path}`, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** 上次用的收付款帳戶（只記在這台裝置上，方便下次不用重選） */
function lastCashAccount(): string {
  try { return localStorage.getItem(LAST_KEY) || ""; } catch { return ""; }
}

/**
 * 收付款帳戶：錢進出哪裡（庫存現金、零用金、各銀行存款）。
 * 沒有值時自動帶入上次選的帳戶；只有一個帳戶時直接選它。
 */
export function CashAccountSelect({ value, onChange, placeholder = "請選擇帳戶", id }: {
  value: string; onChange: (value: string) => void; placeholder?: string; id?: string;
}) {
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["/accounts/cash-accounts"],
    queryFn: () => getJson<AccountOption[]>("accounts/cash-accounts"),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (value || accounts.length === 0) return;
    const last = lastCashAccount();
    if (accounts.some(a => String(a.id) === last)) onChange(last);
    else if (accounts.length === 1) onChange(String(accounts[0].id));
  }, [accounts, value, onChange]);

  return (
    <select
      id={id}
      className={selectClass}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        try { if (e.target.value) localStorage.setItem(LAST_KEY, e.target.value); } catch { /* 無法記住也不影響操作 */ }
      }}
    >
      <option value="">{isLoading ? "載入中…" : accounts.length === 0 ? "科目表沒有現金或銀行存款科目" : placeholder}</option>
      {accounts.map(a => <option key={a.id} value={a.id}>{a.accountNumber} {a.accountName}</option>)}
    </select>
  );
}

/** 某一類的明細科目（例如費用科目），給「這筆錢記到哪個科目」用 */
export function LedgerAccountSelect({ value, onChange, types, placeholder = "請選擇科目", id }: {
  value: string; onChange: (value: string) => void; types: string[]; placeholder?: string; id?: string;
}) {
  const { data: accounts = [] } = useQuery({
    queryKey: ["/accounts"],
    queryFn: () => getJson<Array<AccountOption & { accountType: string; isGroup: boolean }>>("accounts"),
    staleTime: 60_000,
  });
  const options = accounts.filter(a => !a.isGroup && types.includes(a.accountType));
  return (
    <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map(a => <option key={a.id} value={a.id}>{a.accountNumber} {a.accountName}</option>)}
    </select>
  );
}
