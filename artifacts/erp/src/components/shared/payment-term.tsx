import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { call, money, post, selectClass } from "@/lib/call";

export interface PaymentTerm { id: number; name: string; summary: string; isActive: boolean; installments: Array<{ label: string; percent: number; days: number }>; note: string | null; customerCount: number; supplierCount: number }

export function usePaymentTerms() {
  return useQuery({ queryKey: ["/payment-terms"], queryFn: () => call<PaymentTerm[]>("payment-terms"), staleTime: 60_000 });
}

/**
 * 付款條件下拉選單。
 * - 用在客戶／供應商資料：emptyLabel 是「不設定」
 * - 用在開發票：allowDefault 會多一個「依客戶／供應商預設」，值是空字串；「不分期」的值是 "none"
 */
export function PaymentTermField({ value, onChange, label = "付款條件", allowDefault = false, id = "payment-term" }: {
  value: string; onChange: (value: string) => void; label?: string; allowDefault?: boolean; id?: string;
}) {
  const { data: terms = [] } = usePaymentTerms();
  const selected = terms.find(t => String(t.id) === value);
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={selectClass} value={value} onChange={e => onChange(e.target.value)}>
        {allowDefault ? <><option value="">依客戶／供應商預設</option><option value="none">不分期（只用到期日）</option></> : <option value="">不設定</option>}
        {terms.filter(t => t.isActive || String(t.id) === value).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {selected && <p className="mt-1 text-xs text-muted-foreground">{selected.summary}</p>}
    </div>
  );
}

/** 開發票時把下拉選單的值轉成要送給後端的欄位 */
export function paymentTermPayload(value: string): { paymentTermId?: number | null } {
  if (value === "none") return { paymentTermId: null };
  if (value) return { paymentTermId: Number(value) };
  return {};
}

interface ScheduleStatus {
  invoiceId: number; paymentTermId: number | null; dueDate: string | null;
  rows: Array<{ label: string; percent: number; dueDate: string; amount: number; paid: number; remaining: number; overdue: boolean }>;
  nextDueDate: string | null; nextDueAmount: number; overdueAmount: number;
}

/** 一張發票的分期狀況，可以在這裡換付款條件 */
export function InvoiceSchedulePanel({ invoiceId, canEdit = true, onChanged }: { invoiceId: number; canEdit?: boolean; onChanged?: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: terms = [] } = usePaymentTerms();
  const key = ["/payment-terms/invoice", invoiceId];
  const { data } = useQuery({ queryKey: key, queryFn: () => call<ScheduleStatus>(`payment-terms/invoice/${invoiceId}`) });
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = picked ?? (data?.paymentTermId ? String(data.paymentTermId) : "");

  const apply = async () => {
    setSaving(true);
    try {
      const next = await post<ScheduleStatus>(`payment-terms/invoice/${invoiceId}`, { paymentTermId: current ? Number(current) : null }, "PUT");
      queryClient.setQueryData(key, next);
      // 到期日變了，清單與報表都要重抓
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey !== key });
      setPicked(null);
      toast({ title: current ? "已套用付款條件" : "已取消分期" });
      onChanged?.();
    } catch (error) {
      toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (!data) return null;
  const changed = current !== (data.paymentTermId ? String(data.paymentTermId) : "");
  return (
    <div className="rounded-lg border p-3 space-y-2" data-testid="invoice-schedule">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-40">
          <Label htmlFor={`term-${invoiceId}`}>付款條件</Label>
          <select id={`term-${invoiceId}`} className={selectClass} value={current} disabled={!canEdit} onChange={e => setPicked(e.target.value)}>
            <option value="">不分期</option>
            {terms.filter(t => t.isActive || String(t.id) === current).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {canEdit && changed && <Button size="sm" className="h-10" onClick={apply} disabled={saving}>{saving ? "處理中…" : "套用"}</Button>}
      </div>
      {data.rows.length > 0 && (
        <ul className="divide-y text-sm">
          {data.rows.map((row, index) => (
            <li key={index} className="flex items-center justify-between gap-3 py-1.5">
              <span>{row.label}<span className="ml-2 text-xs text-muted-foreground">{row.percent}%・{row.dueDate} 到期</span></span>
              <span className="text-right">
                <span className="font-mono">{money(row.amount)}</span>
                <span className={`block text-xs ${row.overdue ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}`}>
                  {row.remaining <= 0.005 ? "已結清" : row.overdue ? `逾期未收付 ${money(row.remaining)}` : `尚餘 ${money(row.remaining)}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.rows.length > 0 && <p className="text-xs text-muted-foreground">收付款會從第一期開始往後沖。套用付款條件後，到期日會改成最後一期的日期。</p>}
    </div>
  );
}
