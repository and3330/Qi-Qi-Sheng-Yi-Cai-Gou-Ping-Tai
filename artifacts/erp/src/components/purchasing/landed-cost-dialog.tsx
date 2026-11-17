import { useState } from "react";
import { Truck } from "lucide-react";
import { MasterLookup } from "@/components/shared/master-lookup";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { money, post, selectClass, todayText } from "@/lib/call";

const empty = { description: "集運費", amount: "", taxAmount: "", payMode: "paid", cashAccountId: "", supplierId: "", date: "" };
const isCashAccount = (row: Record<string, unknown>) => !row.isGroup && row.accountType === "Asset" && /現金|銀行存款|零用金|電子支付/.test(String(row.accountName || ""));

/** 進貨附加費用：集運費、運費、關稅這類貨到之後才知道的費用，攤進這批貨的成本 */
export function LandedCostButton({ receiptId, receiptNumber, onDone }: { receiptId: number; receiptNumber: string; onDone?: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const amount = Number(form.amount);
  const valid = amount > 0 && (form.payMode === "paid" ? !!form.cashAccountId : !!form.supplierId);

  const submit = async () => {
    setSaving(true);
    try {
      const result = await post<{ toInventory: number; toCogs: number; invoiceNumber: string | null }>(`purchase-receipts/${receiptId}/landed-cost`, {
        description: form.description, amount, taxAmount: Number(form.taxAmount) || 0, date: form.date || undefined,
        ...(form.payMode === "paid" ? { cashAccountId: Number(form.cashAccountId) } : { supplierId: Number(form.supplierId) }),
      });
      toast({
        title: "已攤進商品成本",
        description: `${money(result.toInventory)} 加到庫存成本${result.toCogs > 0 ? `，${money(result.toCogs)} 是已經賣掉的部分，記成銷貨成本` : ""}${result.invoiceNumber ? `；應付發票 ${result.invoiceNumber}` : ""}`,
      });
      setOpen(false);
      onDone?.();
    } catch (error) {
      toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <>
      <Button variant="outline" onClick={() => { setForm({ ...empty, date: todayText() }); setOpen(true); }} data-testid="button-landed-cost"><Truck className="h-4 w-4 mr-1" />加入運費／集運費</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-md max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>加入運費／集運費</DialogTitle>
            <DialogDescription>進貨單 {receiptNumber}。這筆費用會依各品項的金額比例，攤進這批貨的成本。請填換算成台幣的金額。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="lc-desc">費用名稱</Label><Input id="lc-desc" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="集運費、運費、關稅" /></div>
              <div className="space-y-1.5"><Label htmlFor="lc-date">日期</Label><Input id="lc-date" type="date" max={todayText()} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="lc-amount">金額（台幣）*</Label><Input id="lc-amount" type="number" inputMode="decimal" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="lc-tax">其中的營業稅</Label><Input id="lc-tax" type="number" inputMode="decimal" min="0" value={form.taxAmount} onChange={e => setForm({ ...form, taxAmount: e.target.value })} placeholder="有台灣發票才填" /></div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lc-mode">付款狀況</Label>
              <select id="lc-mode" className={selectClass} value={form.payMode} onChange={e => setForm({ ...form, payMode: e.target.value })}>
                <option value="paid">已經付了</option>
                <option value="payable">還沒付（記成應付帳款）</option>
              </select>
            </div>
            {form.payMode === "paid"
              ? <div><Label>從哪個帳戶付的 *</Label><MasterLookup source="accounts" value={form.cashAccountId} onValueChange={v => setForm({ ...form, cashAccountId: v })} filter={isCashAccount} clearable={false} placeholder="銀行、現金、支付寶" /></div>
              : <div><Label>要付給哪家廠商 *</Label><MasterLookup source="suppliers" value={form.supplierId} onValueChange={v => setForm({ ...form, supplierId: v })} clearable={false} placeholder="集運公司、貨運行" /></div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={submit} disabled={!valid || saving}>{saving ? "處理中…" : "攤進成本"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
