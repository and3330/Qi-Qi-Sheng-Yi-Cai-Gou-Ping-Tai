import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DocWindow, DocStatus, DocFields, DocLines, type DocColumn } from "@/components/shared/doc-window";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { call, money, post } from "@/lib/call";

/**
 * 舊系統（Ecount）的庫存單：調撥、領用（內部使用）、盤點。
 * 可以看整張單、點到品項、補備註；品項、數量、金額是舊紀錄，不能改，也不影響現在的庫存。
 */
interface MovementLine { itemName: string; itemId: number | null; quantity: number; amount: number; remarks: string | null; fromWarehouse: string | null; toWarehouse: string | null; partyName: string | null }
interface MovementDoc { id: number; kind: string; docNumber: string; docDate: string | null; total: number | null; note: string | null; lines: MovementLine[] }
interface CountLine { itemCode: string | null; itemName: string; itemId: number | null; warehouseName: string | null; systemQty: number; countedQty: number; diffQty: number; amount: number; remarks: string | null }
interface CountDoc { id: number; countNumber: string; countDate: string | null; total: number | null; note: string | null; lines: CountLine[] }

/** 品項：主檔對得到就可以點過去（用品名或編碼搜尋），對不到只顯示文字 */
function ItemCell({ name, code, itemId }: { name: string; code?: string | null; itemId: number | null }) {
  return (
    <div className="min-w-0">
      {itemId
        ? <Link href={`/inventory/items?q=${encodeURIComponent(code || name.replace(/\s*\[.*\]$/, ""))}`} className="text-primary hover:underline break-words">{name}</Link>
        : <span className="break-words">{name}</span>}
      {code && <span className="block font-mono text-xs text-muted-foreground">{code}</span>}
    </div>
  );
}

export function LegacyStockDialog({ target, onClose }: { target: { type: "movement" | "count"; id: number } | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const path = target ? (target.type === "movement" ? `stock-entries/legacy/${target.id}` : `stock-counts/legacy/${target.id}`) : "";
  const { data, isLoading, error } = useQuery({ queryKey: ["/legacy-stock", target?.type, target?.id], enabled: target !== null, queryFn: () => call<MovementDoc | CountDoc>(path) });
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setNote(data?.note ?? ""); }, [data?.id, data?.note]);

  const save = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await post(path, { note }, "PATCH");
      toast({ title: "備註已儲存" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/legacy-stock"] }),
        queryClient.invalidateQueries({ queryKey: ["/stock-entries/legacy-lines"] }),
        queryClient.invalidateQueries({ queryKey: ["/stock-counts/legacy"] }),
      ]);
    } catch (e) {
      toast({ title: "沒有成功", description: e instanceof Error ? e.message : "請稍後再試", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const movement = target?.type === "movement" ? (data as MovementDoc | undefined) : undefined;
  const count = target?.type === "count" ? (data as CountDoc | undefined) : undefined;
  const name = movement ? `${movement.kind}單` : count ? "盤點單" : "歷史庫存單";
  const number = movement ? movement.docNumber : count ? count.countNumber : null;

  const movementColumns: DocColumn<MovementLine>[] = [
    { header: "品項", cell: line => <><ItemCell name={line.itemName} itemId={line.itemId} />{line.remarks && <span className="block text-xs text-muted-foreground">{line.remarks}</span>}</> },
    { header: movement?.kind === "調撥" ? "從哪個倉 → 到哪個倉" : "倉庫", cell: line => <>{line.fromWarehouse || "—"}{line.toWarehouse ? ` → ${line.toWarehouse}` : ""}{line.partyName ? <span className="block text-xs text-muted-foreground">{line.partyName}</span> : null}</> },
    { header: "數量", align: "right", cell: line => line.quantity.toLocaleString() },
    { header: "金額", align: "right", cell: line => line.amount ? money(line.amount) : "—" },
  ];
  const countColumns: DocColumn<CountLine>[] = [
    { header: "品項", cell: line => <ItemCell name={line.itemName} code={line.itemCode} itemId={line.itemId} /> },
    { header: "倉庫", cell: line => line.warehouseName || "—" },
    { header: "帳上", align: "right", cell: line => line.systemQty.toLocaleString() },
    { header: "實盤", align: "right", cell: line => line.countedQty.toLocaleString() },
    { header: "差異", align: "right", cell: line => <span className={line.diffQty < 0 ? "text-red-600" : line.diffQty > 0 ? "text-emerald-700" : ""}>{line.diffQty > 0 ? "+" : ""}{line.diffQty.toLocaleString()}</span> },
    { header: "金額", align: "right", cell: line => line.amount ? money(line.amount) : "—" },
  ];

  return (
    <DocWindow
      open={target !== null}
      onClose={onClose}
      name={name}
      number={number}
      status={<DocStatus label="歷史" tone="outline" />}
      description="舊系統 Ecount 的紀錄。可以補備註；品項、數量、金額不能改，也不影響現在的庫存數量。"
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose}>關閉</Button>
          <Button onClick={save} disabled={saving || !data || note === (data?.note ?? "")} data-testid="button-save-legacy-stock-note">{saving ? "儲存中…" : "儲存備註"}</Button>
        </>
      }
    >
      {isLoading && <p className="text-sm text-muted-foreground">讀取中…</p>}
      {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : "讀取失敗"}</p>}
      {movement && (
        <>
          <DocFields items={[
            ["日期", movement.docDate],
            ["品項數", `${movement.lines.length} 個品項`],
            ["金額", movement.total ? money(movement.total) : null],
          ]} />
          <DocLines columns={movementColumns} rows={movement.lines} scroll />
        </>
      )}
      {count && (
        <>
          <DocFields items={[
            ["日期", count.countDate],
            ["品項數", `${count.lines.length} 個品項`],
            ["有差異", `${count.lines.filter(l => l.diffQty !== 0).length} 項`],
            ["調整金額", count.total ? money(count.total) : null],
          ]} />
          <DocLines columns={countColumns} rows={count.lines} scroll />
        </>
      )}
      {data && (
        <div className="space-y-1.5">
          <Label htmlFor="legacy-stock-note">備註</Label>
          <Textarea id="legacy-stock-note" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="可以補上這張單的說明" />
        </div>
      )}
    </DocWindow>
  );
}
