import { useState } from "react";
import { useAdjustAdminStock } from "@workspace/api-client-react";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const REASONS = ["進貨入庫", "盤點調整", "報廢", "退貨入庫", "其他"];

/**
 * 調整庫存（入庫、出庫、盤點）。商城的庫存在這裡管理，每次調整都會留下異動紀錄。
 * 有多種規格的商品，要在各規格那一列調整。
 */
export function StockAdjustDialog({
  productId, variantId, label, currentStock, onDone, compact,
}: {
  productId: number;
  variantId?: number | null;
  label: string;
  currentStock: number;
  onDone: () => void;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const adjust = useAdjustAdminStock();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");

  const amount = Math.floor(Number(quantity));
  const valid = Number.isFinite(amount) && amount > 0;
  const after = valid ? currentStock + (direction === "in" ? amount : -amount) : currentStock;

  const submit = async () => {
    if (!valid) return;
    try {
      await adjust.mutateAsync({
        data: { productId, variantId: variantId ?? null, quantity: direction === "in" ? amount : -amount, reason, note: note.trim() || null },
      });
      toast({ title: "庫存已調整", description: `${label}：${currentStock} → ${after}` });
      setOpen(false);
      setQuantity("");
      setNote("");
      onDone();
    } catch (err) {
      const e = err as { data?: { error?: string } };
      toast({ title: "調整失敗", description: e?.data?.error ?? "請稍後再試", variant: "destructive" });
    }
  };

  return (
    <>
      <Button
        type="button" size="sm" variant="outline"
        className={compact ? "h-6 px-2 text-xs" : "h-8"}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        data-testid={`button-adjust-stock-${productId}${variantId ? `-${variantId}` : ""}`}
      >
        <PackagePlus size={compact ? 12 : 14} className="mr-1" /> 調整
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>調整庫存</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {label}，目前庫存 <span className="font-semibold text-foreground">{currentStock}</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={direction === "in" ? "default" : "outline"} onClick={() => setDirection("in")} data-testid="button-stock-in">
                入庫（增加）
              </Button>
              <Button type="button" variant={direction === "out" ? "default" : "outline"} onClick={() => setDirection("out")} data-testid="button-stock-out">
                出庫（減少）
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stock-qty">數量</Label>
              <Input id="stock-qty" type="number" min={1} step={1} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="input-stock-qty" />
              {valid && (
                <p className={`text-xs ${after < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                  調整後庫存：{after}{after < 0 ? "（不能小於 0）" : ""}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stock-reason">原因</Label>
              <select
                id="stock-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                data-testid="select-stock-reason"
              >
                {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stock-note">備註（選填）</Label>
              <Input id="stock-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：進貨單號、盤點日期" data-testid="input-stock-note" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={submit} disabled={!valid || after < 0 || adjust.isPending} data-testid="button-stock-submit">
              {adjust.isPending ? "處理中..." : "確認調整"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
