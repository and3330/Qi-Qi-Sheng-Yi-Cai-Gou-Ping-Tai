import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocWindow } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";

/**
 * 對單一發票直接收款的對話框：建立一張收款單（voucherType: 收款單）並沖銷此發票。
 */
export function InvoiceReceiptDialog({
  invoice,
  open,
  onOpenChange,
  onSuccess,
}: {
  invoice: any | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess?: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const total = Number(invoice?.totalAmount || 0);
  const paid = Number(invoice?.paidAmount || 0);
  const outstanding = Math.max(0, Math.round((total - paid) * 100) / 100);

  useEffect(() => {
    if (open && invoice) {
      setAmount(String(outstanding));
      setDate(new Date().toISOString().slice(0, 10));
      setRemarks("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice?.id]);

  const handleSubmit = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "請輸入大於 0 的收款金額", variant: "destructive" }); return;
    }
    if (amt > outstanding + 0.001) {
      toast({ title: "收款金額超過未收餘額", description: `未收餘額為 NT$ ${outstanding.toLocaleString()}`, variant: "destructive" }); return;
    }
    if (!invoice?.customerId) {
      toast({ title: "此發票未關聯客戶，無法直接收款", description: "請改用「收款單」頁面手動建立", variant: "destructive" }); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/erp-api/vouchers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voucherType: "收款單",
          voucherDate: date,
          description: remarks || `收款 - 發票 ${invoice.invoiceNumber}`,
          customerId: Number(invoice.customerId),
          items: [{ description: `發票 ${invoice.invoiceNumber} 收款`, amount: amt, invoiceId: invoice.id }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "收款失敗");
      toast({
        title: "收款已入帳",
        description: amt >= outstanding
          ? `發票 ${invoice.invoiceNumber} 已全數收清`
          : `發票 ${invoice.invoiceNumber} 尚餘 NT$ ${(outstanding - amt).toLocaleString()} 未收`,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast({ title: "收款失敗", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DocWindow
      open={open}
      onClose={() => onOpenChange(false)}
      name="收款"
      number={invoice?.invoiceNumber}
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button onClick={handleSubmit} disabled={submitting || outstanding <= 0} data-testid="button-confirm-receipt">
          {submitting ? "處理中..." : "確認收款"}
        </Button>
      </>}
    >
        <div className="grid gap-4">
          <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">客戶</span><span>{invoice?.customerName || "-"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">發票總額</span><span>NT$ {total.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">已收</span><span>NT$ {paid.toLocaleString()}</span></div>
            <div className="flex justify-between font-semibold"><span>未收餘額</span><span className="text-blue-600">NT$ {outstanding.toLocaleString()}</span></div>
          </div>
          <div>
            <Label>本次收款金額 *</Label>
            <Input type="number" inputMode="decimal" min={0} value={amount} onChange={e => setAmount(e.target.value)} data-testid="input-receipt-amount" />
            {Number(amount) > 0 && Number(amount) < outstanding && (
              <p className="text-xs text-muted-foreground mt-1">部分收款：收款後仍餘 NT$ {(outstanding - Number(amount)).toLocaleString()}</p>
            )}
          </div>
          <div><Label>收款日期</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div><Label>備註</Label><Input value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="例如：匯款、現金…" /></div>
        </div>
    </DocWindow>
  );
}
