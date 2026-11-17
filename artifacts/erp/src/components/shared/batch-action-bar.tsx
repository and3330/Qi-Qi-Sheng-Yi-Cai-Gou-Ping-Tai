import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

function errorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const data = value as Record<string, unknown>;
  if (typeof data.error === "string" && data.error) return data.error;
  if (typeof data.message === "string" && data.message) return data.message;
  if (data.error && typeof data.error === "object") {
    const nested = data.error as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message) return nested.message;
  }
  return fallback;
}

const STATUS_LOCKED_ENTITIES = new Set([
  "sales-orders", "purchase-orders", "delivery-notes", "purchase-receipts",
  "sales-returns", "purchase-returns", "journal-entries", "invoices", "vouchers",
  "salary-slips", "payment-requests", "work-orders", "assets", "stock-entries",
]);
const DELETE_FORBIDDEN_ENTITIES = new Set(["stock-entries", "invoices", "vouchers", "asset-depreciation"]);

export interface BatchField {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "date";
  options?: { value: string; label: string }[];
  /** 文字欄位的建議值（例如已經有的組別），可以選也可以自己打新的 */
  suggestions?: string[];
  /** 可以清空這個欄位 */
  clearable?: boolean;
}

interface BatchActionBarProps {
  count: number;
  entityName: string;
  entityEndpoint: string;
  ids: (number | string)[];
  batchFields?: BatchField[];
  allowDelete?: boolean;
  onClear: () => void;
  onComplete: () => void;
}

export function BatchActionBar({
  count, entityName, entityEndpoint, ids, batchFields: rawBatchFields, allowDelete: allowDeleteProp = true, onClear, onComplete,
}: BatchActionBarProps) {
  // 與後端 lib/batch-policy.ts 一致：狀態會連動庫存或帳務的單據不提供批次改狀態；已入帳的流水紀錄不提供批次刪除
  const batchFields = rawBatchFields?.filter(f => !(f.key === "status" && STATUS_LOCKED_ENTITIES.has(entityEndpoint)));
  const allowDelete = allowDeleteProp && !DELETE_FORBIDDEN_ENTITIES.has(entityEndpoint);
  const { toast } = useToast();
  const [showEdit, setShowEdit] = useState(false);
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [processing, setProcessing] = useState(false);

  const handleBatchDelete = async () => {
    if (!confirm(`確定要刪除選取的 ${count} 筆${entityName}？此操作無法復原。`)) return;
    setProcessing(true);
    try {
      const res = await fetch(`/erp-api/batch/${entityEndpoint}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(errorMessage(err, `批次刪除失敗（HTTP ${res.status}）`));
      }
      const result = await res.json();
      const deleted = Number(result.deleted) || 0;
      const blockedCount = Array.isArray(result.blocked) ? result.blocked.length : 0;
      if (deleted === 0 && blockedCount > 0) {
        toast({
          title: `批次刪除失敗：${blockedCount} 筆${entityName}無法刪除`,
          description: result.error || "資料仍被其他模組參照（如訂單、發票、出勤等）",
          variant: "destructive",
        });
      } else if (blockedCount > 0) {
        toast({
          title: `已刪除 ${deleted} 筆，${blockedCount} 筆無法刪除`,
          description: result.error || "部分資料仍被其他模組參照",
          variant: "destructive",
        });
      } else if (deleted === 0) {
        toast({
          title: "批次刪除失敗",
          description: result.error || "未刪除任何資料",
          variant: "destructive",
        });
      } else {
        toast({ title: "批次刪除完成", description: `已刪除 ${deleted} 筆${entityName}` });
      }
      onClear();
      onComplete();
    } catch (err: any) {
      toast({ title: "批次刪除失敗", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const handleBatchUpdate = async () => {
    if (!field || !value) {
      toast({ title: "請選擇欄位並填寫值", variant: "destructive" });
      return;
    }
    setProcessing(true);
    try {
      const res = await fetch(`/erp-api/batch/${entityEndpoint}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, updates: { [field]: value === "__none__" ? null : value } }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(errorMessage(err, `批次更新失敗（HTTP ${res.status}）`));
      }
      const result = await res.json();
      const updated = Number(result.updated) || 0;
      if (updated === 0) {
        toast({ title: "批次更新失敗", description: result.error || "未更新任何資料", variant: "destructive" });
      } else {
        toast({ title: "批次更新完成", description: `已更新 ${updated} 筆${entityName}` });
      }
      setShowEdit(false);
      onClear();
      onComplete();
    } catch (err: any) {
      toast({ title: "批次更新失敗", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const openEdit = () => {
    setField("");
    setValue("");
    setShowEdit(true);
  };

  const selectedField = batchFields?.find(f => f.key === field);

  if (count === 0) return null;

  return (
    <>
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="default" className="text-sm px-3 py-1">已選取 {count} 筆</Badge>
            <Button variant="ghost" size="sm" onClick={onClear} className="h-7">
              <X size={14} className="mr-1" />取消選取
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {batchFields && batchFields.length > 0 && (
              <Button variant="outline" size="sm" onClick={openEdit} disabled={processing}>
                <Settings2 size={14} className="mr-1" />批次編輯
              </Button>
            )}
            {allowDelete && <Button variant="destructive" size="sm" onClick={handleBatchDelete} disabled={processing}>
              <Trash2 size={14} className="mr-1" />批次刪除
            </Button>}
          </div>
        </CardContent>
      </Card>

      {batchFields && batchFields.length > 0 && (
        <Dialog open={showEdit} onOpenChange={setShowEdit}>
          <DialogContent className="md:max-w-md">
            <DialogHeader>
              <DialogTitle>批次編輯 — {count} 筆{entityName}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">選擇要修改的欄位和新值，將套用到所有選取的資料。</p>
            <div className="space-y-4 mt-2">
              <div>
                <Label>修改欄位</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={field}
                  onChange={e => { setField(e.target.value); setValue(""); }}
                >
                  <option value="">請選擇欄位</option>
                  {batchFields.map(f => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
              </div>
              {selectedField && (
                <div>
                  <Label>新值 — {selectedField.label}</Label>
                  {selectedField.type === "select" && selectedField.options ? (
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={value}
                      onChange={e => setValue(e.target.value)}
                    >
                      <option value="">請選擇</option>
                      {selectedField.options.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : selectedField.type === "number" ? (
                    <Input type="number" value={value} onChange={e => setValue(e.target.value)} placeholder={`輸入${selectedField.label}`} />
                  ) : selectedField.type === "date" ? (
                    <Input type="date" value={value} onChange={e => setValue(e.target.value)} />
                  ) : (
                    <>
                      <Input value={value === "__none__" ? "" : value} onChange={e => setValue(e.target.value)} placeholder={`輸入${selectedField.label}`} list={selectedField.suggestions?.length ? "batch-suggestions" : undefined} />
                      {selectedField.suggestions?.length ? <datalist id="batch-suggestions">{selectedField.suggestions.map(s => <option key={s} value={s} />)}</datalist> : null}
                    </>
                  )}
                  {selectedField.clearable && (
                    <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                      <input type="checkbox" checked={value === "__none__"} onChange={e => setValue(e.target.checked ? "__none__" : "")} />
                      清空這個欄位
                    </label>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEdit(false)}>取消</Button>
              <Button onClick={handleBatchUpdate} disabled={processing || !field || !value}>
                {processing ? "處理中..." : `更新 ${count} 筆`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
