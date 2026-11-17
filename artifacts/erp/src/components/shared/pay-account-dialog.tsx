import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CashAccountSelect, LedgerAccountSelect } from "@/components/shared/ledger-account-select";

export interface PayAccountChoice { cashAccountId: number; counterAccountId?: number; actualCashAmount?: number }

/**
 * 付款／收款／發薪前問一句「錢從哪個帳戶出去（進來）」。
 * counter 有給的時候，再問這筆錢要記到哪個科目（沒有對應發票的付款用）。
 */
export function PayAccountDialog({ open, onOpenChange, title, summary, cashLabel = "付款帳戶", confirmLabel = "確認付款", counter, actualCash, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  summary?: React.ReactNode;
  cashLabel?: string;
  confirmLabel?: string;
  counter?: { label: string; types: string[]; hint?: string };
  /** 有給的時候多問一句「實際進出的台幣」（外幣貨款換匯去付，金額和帳上不同），差額記兌換損益 */
  actualCash?: { label: string; booked: number };
  onConfirm: (choice: PayAccountChoice) => Promise<void>;
}) {
  const [cashAccountId, setCashAccountId] = useState("");
  const [counterAccountId, setCounterAccountId] = useState("");
  const [actualCashAmount, setActualCashAmount] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setCounterAccountId(""); setActualCashAmount(""); } }, [open]);
  const fxDiff = actualCash && Number(actualCashAmount) > 0 ? Math.round((Number(actualCashAmount) - actualCash.booked) * 100) / 100 : 0;

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm({ cashAccountId: Number(cashAccountId), ...(counterAccountId ? { counterAccountId: Number(counterAccountId) } : {}), ...(actualCash && Number(actualCashAmount) > 0 ? { actualCashAmount: Number(actualCashAmount) } : {}) });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {summary && <div className="text-sm text-muted-foreground">{summary}</div>}
          <div className="space-y-1.5">
            <Label htmlFor="pay-cash-account">{cashLabel}</Label>
            <CashAccountSelect id="pay-cash-account" value={cashAccountId} onChange={setCashAccountId} />
            <p className="text-xs text-muted-foreground">選實際進出的帳戶，銀行存款的帳面餘額才會跟存摺一致。</p>
          </div>
          {counter && (
            <div className="space-y-1.5">
              <Label htmlFor="pay-counter-account">{counter.label}</Label>
              <LedgerAccountSelect id="pay-counter-account" value={counterAccountId} onChange={setCounterAccountId} types={counter.types} />
              {counter.hint && <p className="text-xs text-muted-foreground">{counter.hint}</p>}
            </div>
          )}
          {actualCash && (
            <div className="space-y-1.5">
              <Label htmlFor="pay-actual-cash">{actualCash.label}</Label>
              <Input id="pay-actual-cash" type="number" inputMode="decimal" min="0" value={actualCashAmount} onChange={e => setActualCashAmount(e.target.value)} placeholder={`和帳上一樣就不用填（${actualCash.booked.toLocaleString()}）`} />
              <p className="text-xs text-muted-foreground">{fxDiff !== 0 ? `和帳上差 ${Math.abs(fxDiff).toLocaleString()} 元，會自動記成兌換損益。` : "外幣貨款用台幣換匯去付、金額和帳上不同時才填，差額會自動記成兌換損益。"}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={confirm} disabled={busy || !cashAccountId || (!!counter && !counterAccountId)}>{busy ? "處理中…" : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
