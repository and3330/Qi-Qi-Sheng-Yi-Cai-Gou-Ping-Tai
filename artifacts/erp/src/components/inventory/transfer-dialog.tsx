import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft } from "lucide-react";
import { MasterLookup } from "@/components/shared/master-lookup";
import { Button } from "@/components/ui/button";
import { DocWindow } from "@/components/shared/doc-window";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { call, post } from "@/lib/call";

const empty = { itemId: "", fromWarehouseId: "", toWarehouseId: "", quantity: "", remarks: "" };

/** 倉庫調撥：只搬位置，不影響全公司總庫存與帳務 */
export function TransferButton() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  const { data: byWarehouse = [] } = useQuery({
    queryKey: ["/stock-entries/by-warehouse", form.itemId],
    queryFn: () => call<Array<{ warehouseId: number; warehouseName: string; quantity: number }>>(`stock-entries/by-warehouse?itemId=${form.itemId}`),
    enabled: open && !!form.itemId,
  });
  const available = byWarehouse.find(w => String(w.warehouseId) === form.fromWarehouseId)?.quantity;
  const quantity = Number(form.quantity);
  const sameWarehouse = !!form.fromWarehouseId && form.fromWarehouseId === form.toWarehouseId;
  const tooMany = available !== undefined && quantity > available;
  const valid = !!form.itemId && !!form.fromWarehouseId && !!form.toWarehouseId && !sameWarehouse && quantity > 0 && !tooMany;

  const submit = async () => {
    setSaving(true);
    try {
      const result = await post<{ itemName: string; fromWarehouseName: string; toWarehouseName: string; quantity: number }>("stock-entries/transfer", {
        itemId: Number(form.itemId), fromWarehouseId: Number(form.fromWarehouseId), toWarehouseId: Number(form.toWarehouseId), quantity, remarks: form.remarks || undefined,
      });
      toast({ title: "已完成調撥", description: `${result.itemName} × ${result.quantity}：${result.fromWarehouseName} → ${result.toWarehouseName}` });
      setOpen(false);
      setForm(empty);
      queryClient.invalidateQueries({ queryKey: ["/erp-api/stock-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/stock-entries/by-warehouse"] });
    } catch (error) {
      toast({ title: "調撥失敗", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <>
      <Button variant="outline" onClick={() => { setForm(empty); setOpen(true); }} data-testid="button-transfer"><ArrowRightLeft className="mr-1.5 h-4 w-4" />倉庫調撥</Button>
      <DocWindow
        open={open}
        onClose={() => setOpen(false)}
        name="倉庫調撥"
        description="把東西從一間倉庫搬到另一間。總庫存與成本不變，不會產生分錄。"
        footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={submit} disabled={!valid || saving}>{saving ? "處理中…" : "調撥"}</Button>
        </>}
      >
          <div className="grid gap-4">
            <div>
              <Label>品項 *</Label>
              <MasterLookup source="items" value={form.itemId} onValueChange={v => setForm(f => ({ ...f, itemId: v }))} filter={(r) => !r.isVirtual} clearable={false} placeholder="選擇品項" />
              {form.itemId && byWarehouse.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">各倉數量：{byWarehouse.map(w => `${w.warehouseName} ${w.quantity}`).join("、")}</p>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>調出倉庫 *</Label>
                <MasterLookup source="warehouses" value={form.fromWarehouseId} onValueChange={v => setForm(f => ({ ...f, fromWarehouseId: v }))} clearable={false} placeholder="從哪一間" />
              </div>
              <div>
                <Label>調入倉庫 *</Label>
                <MasterLookup source="warehouses" value={form.toWarehouseId} onValueChange={v => setForm(f => ({ ...f, toWarehouseId: v }))} clearable={false} placeholder="搬到哪一間" />
              </div>
            </div>
            {sameWarehouse && <p className="text-sm text-red-600 dark:text-red-400">調出和調入不能是同一間倉庫</p>}
            <div>
              <Label htmlFor="transfer-qty">數量 *</Label>
              <Input id="transfer-qty" type="number" inputMode="decimal" min="0" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
              {available !== undefined && <p className={`mt-1 text-xs ${tooMany ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>調出倉庫目前有 {available}{tooMany ? "，不夠調出" : ""}</p>}
            </div>
            <div><Label htmlFor="transfer-note">備註</Label><Input id="transfer-note" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} /></div>
          </div>
      </DocWindow>
    </>
  );
}
