import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetShopPaymentInfo,
  useUpdateShopPaymentInfo,
  getGetShopPaymentInfoQueryKey,
} from "@workspace/api-client-react";
import { Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

const EMPTY = { bankName: "", bankBranch: "", bankAccount: "", bankHolder: "", bankNote: "" };

/**
 * 匯款帳號設定（系統管理員）。會員選「銀行匯款」後，會在訂單頁看到這裡填的帳號。
 * 沒填帳號時，訂單頁會請會員洽客服。
 */
export function PaymentInfoSettings() {
  const { me } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useGetShopPaymentInfo();
  const update = useUpdateShopPaymentInfo();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (open && data) setForm({ ...EMPTY, ...data });
  }, [open, data]);

  if (me?.role !== "admin") return null;

  const missing = data && !data.bankAccount;
  const save = async () => {
    try {
      await update.mutateAsync({ data: form });
      queryClient.invalidateQueries({ queryKey: getGetShopPaymentInfoQueryKey() });
      toast({ title: "匯款帳號已儲存" });
      setOpen(false);
    } catch (err) {
      const e = err as { data?: { error?: string } };
      toast({ title: "儲存失敗", description: e?.data?.error ?? "請稍後再試", variant: "destructive" });
    }
  };

  const field = (key: keyof typeof EMPTY, label: string, placeholder = "") => (
    <div className="space-y-1.5">
      <Label htmlFor={`pay-${key}`}>{label}</Label>
      <Input
        id={`pay-${key}`}
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        data-testid={`input-pay-${key}`}
      />
    </div>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        {missing && (
          <p className="text-xs text-amber-700" data-testid="text-pay-missing">
            尚未設定匯款帳號，選擇匯款的會員看不到帳號
          </p>
        )}
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="button-open-payment-info">
          <Banknote size={14} className="mr-1.5" /> 匯款帳號設定
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>匯款帳號設定</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {field("bankName", "銀行名稱", "例如：玉山銀行（808）")}
            {field("bankBranch", "分行")}
            {field("bankAccount", "帳號")}
            {field("bankHolder", "戶名")}
            <div className="space-y-1.5">
              <Label htmlFor="pay-bankNote">給會員的說明（選填）</Label>
              <Textarea
                id="pay-bankNote"
                value={form.bankNote}
                placeholder="例如：請於 3 日內完成匯款，逾期訂單將取消"
                onChange={(e) => setForm({ ...form, bankNote: e.target.value })}
                className="resize-none"
                data-testid="input-pay-bankNote"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={save} disabled={update.isPending} data-testid="button-save-payment-info">
              {update.isPending ? "儲存中..." : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
