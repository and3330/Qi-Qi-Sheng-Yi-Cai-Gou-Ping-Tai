import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { MasterLookup } from "@/components/shared/master-lookup";
import { ProjectField } from "@/components/shared/project-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { ClipboardCheck, Plus, Search } from "lucide-react";
import { call, money, post, selectClass, todayText } from "@/lib/call";
import { LegacyStockDialog } from "@/components/inventory/legacy-stock-dialog";
import { DocWindow, DocStatus, statusTone, DocFields, DocLines, DocNote } from "@/components/shared/doc-window";
import { RelatedDocs, useOpenFromUrl } from "@/components/shared/related-docs";

interface Line { itemId: number; itemCode: string; itemName: string; systemQty: number; countedQty: number | null; unitCost: number }
interface CountHead {
  id: number; countNumber: string; warehouseId: number; warehouseName: string | null; projectName: string | null; countDate: string;
  basis: string; status: string; remarks: string | null; lineCount: number; countedLines: number; diffLines: number; gain: number; loss: number;
  createdBy?: string | null; postedBy?: string | null;
}
interface CountDetail extends CountHead { lines: Line[] }

const STATUS: Record<string, string> = { Draft: "盤點中", Posted: "已過帳", Cancelled: "已取消" };
const POST_ROLES = ["owner", "admin", "finance_admin", "accountant", "manager", "super_admin"];
const emptyForm = { warehouseId: "", projectId: "", countDate: todayText(), basis: "warehouse", remarks: "" };

export default function StockCountsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canPost = POST_ROLES.includes(user?.role || "");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [openId, setOpenId] = useState<number | null>(null);
  const [counted, setCounted] = useState<Record<number, string>>({});
  const [keyword, setKeyword] = useState("");
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: counts, isLoading } = useQuery({ queryKey: ["/stock-counts"], queryFn: () => call<CountHead[]>("stock-counts") });
  // 舊系統（Ecount）的盤點單：只供查看與補備註
  const { data: legacyCounts } = useQuery({ queryKey: ["/stock-counts/legacy"], queryFn: () => call<any[]>("stock-counts/legacy"), staleTime: 5 * 60 * 1000 });
  const [legacyTarget, setLegacyTarget] = useState<{ type: "movement" | "count"; id: number } | null>(null);
  const countRows: any[] = [...(counts ?? []), ...(legacyCounts ?? []).map(row => ({ ...row, id: `legacy-${row.legacyDocumentId}` }))];
  const { data: detail } = useQuery({ queryKey: ["/stock-counts", openId], queryFn: () => call<CountDetail>(`stock-counts/${openId}`), enabled: openId !== null });

  const fail = (error: unknown) => toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/stock-counts"] });

  const create = async () => {
    setSaving(true);
    try {
      const created = await post<CountDetail>("stock-counts", { warehouseId: Number(form.warehouseId), projectId: Number(form.projectId), countDate: form.countDate, basis: form.basis, remarks: form.remarks });
      toast({ title: "已開立盤點單", description: `${created.countNumber}，共 ${created.lineCount} 個品項` });
      setCreating(false);
      setForm(emptyForm);
      refresh();
      open(created.id);
    } catch (error) { fail(error); } finally { setSaving(false); }
  };

  const open = (id: number) => { setCounted({}); setKeyword(""); setOnlyDiff(false); setOpenId(id); };
  useOpenFromUrl(counts, c => open(c.id));
  const valueOf = (line: Line) => counted[line.itemId] ?? (line.countedQty === null ? "" : String(line.countedQty));
  const isDraft = detail?.status === "Draft";

  const rows = useMemo(() => {
    const word = keyword.trim().toLowerCase();
    return (detail?.lines || []).filter(line => {
      if (word && !`${line.itemCode} ${line.itemName}`.toLowerCase().includes(word)) return false;
      if (onlyDiff) { const v = valueOf(line); return v !== "" && Number(v) !== line.systemQty; }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, keyword, onlyDiff, counted]);

  const live = useMemo(() => {
    let countedLines = 0, diffLines = 0, gain = 0, loss = 0;
    for (const line of detail?.lines || []) {
      const v = valueOf(line);
      if (v === "") continue;
      countedLines++;
      const diff = Number(v) - line.systemQty;
      if (Math.abs(diff) < 0.0001) continue;
      diffLines++;
      if (diff > 0) gain += diff * line.unitCost; else loss += -diff * line.unitCost;
    }
    return { countedLines, diffLines, gain, loss };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, counted]);

  const saveLines = async () => {
    if (!detail) return false;
    const lines = Object.entries(counted).map(([itemId, value]) => ({ itemId: Number(itemId), countedQty: value === "" ? null : Number(value) }));
    if (lines.length === 0) return true;
    await post(`stock-counts/${detail.id}`, { lines }, "PUT");
    setCounted({});
    queryClient.invalidateQueries({ queryKey: ["/stock-counts", detail.id] });
    refresh();
    return true;
  };
  const save = async () => {
    setSaving(true);
    try { await saveLines(); toast({ title: "已儲存實盤數量" }); } catch (error) { fail(error); } finally { setSaving(false); }
  };
  const fillSystem = () => {
    if (!detail) return;
    const next = { ...counted };
    for (const line of detail.lines) if (valueOf(line) === "") next[line.itemId] = String(line.systemQty);
    setCounted(next);
  };
  const postCount = async () => {
    if (!detail) return;
    if (!confirm(`確定過帳？會調整 ${live.diffLines} 個品項的庫存（盤盈 ${money(live.gain)}、盤損 ${money(live.loss)}），過帳後不能修改。`)) return;
    setSaving(true);
    try {
      await saveLines();
      await post(`stock-counts/${detail.id}/post`);
      toast({ title: "已過帳", description: "庫存與帳務已依盤點差異調整" });
      setOpenId(null);
      refresh();
      queryClient.invalidateQueries({ queryKey: ["/erp-api/stock-entries"] });
      queryClient.invalidateQueries({ queryKey: ["master-lookup", "items"] });
    } catch (error) { fail(error); } finally { setSaving(false); }
  };
  const cancelCount = async () => {
    if (!detail || !confirm("確定取消這張盤點單？已填的數量不會調整庫存。")) return;
    setSaving(true);
    try { await post(`stock-counts/${detail.id}/cancel`); toast({ title: "已取消" }); setOpenId(null); refresh(); } catch (error) { fail(error); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="盤點" description="開單時記下帳上數量，現場填實際點到的數量，過帳後自動調整庫存並產生盤盈、盤損分錄"
        action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1" />開盤點單</Button>} />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={countRows as any}
            onRowClick={(c: any) => (c.legacy ? setLegacyTarget({ type: "count", id: c.legacyDocumentId }) : open(c.id))}
            emptyMessage="還沒有盤點單"
            columns={[
              { header: "單號", accessor: (c: any) => <span className="whitespace-nowrap font-medium text-primary">{c.countNumber}{c.legacy && <span className="ml-1.5 inline-block rounded border px-1 text-[10px] font-normal text-muted-foreground align-middle" title="舊系統 Ecount 的紀錄，不影響現在的庫存數量">歷史</span>}</span> },
              { header: "日期", accessor: "countDate" },
              { header: "倉庫", accessor: (c: any) => c.warehouseName || "—" },
              { header: "進度", accessor: (c: any) => c.legacy ? `${c.lineCount} 項` : `已盤 ${c.countedLines}／${c.lineCount}` },
              { header: "差異", accessor: (c: any) => c.diffLines === 0 ? "—" : `${c.diffLines} 項（盈 ${money(c.gain)}、損 ${money(c.loss)}）`, className: "hidden md:table-cell" },
              { header: "狀態", accessor: (c: any) => c.legacy ? <Badge variant="outline">已過帳（舊系統）</Badge> : <Badge variant={c.status === "Posted" ? "default" : c.status === "Cancelled" ? "outline" : "secondary"}>{STATUS[c.status] || c.status}</Badge> },
              { header: "操作", accessor: (c: any) => <Button size="sm" variant="outline" className="h-8" onClick={(e) => { e.stopPropagation(); c.legacy ? setLegacyTarget({ type: "count", id: c.legacyDocumentId }) : open(c.id); }}><ClipboardCheck className="h-3.5 w-3.5 mr-1" />{c.legacy ? "查看／備註" : c.status === "Draft" ? "填數量" : "查看"}</Button> },
            ]}
          />
          <LegacyStockDialog target={legacyTarget} onClose={() => setLegacyTarget(null)} />
        </CardContent>
      </Card>

      <DocWindow
        open={creating}
        onClose={() => setCreating(false)}
        name="開盤點單"
        description="開單當下的帳上數量會被記下來。同一時間只能有一張盤點中的單。"
        footer={<>
          <Button variant="outline" onClick={() => setCreating(false)}>取消</Button>
          <Button onClick={create} disabled={saving || !form.warehouseId || !form.projectId || !form.countDate}>{saving ? "處理中…" : "開單"}</Button>
        </>}
      >
          <div className="grid gap-4">
            <div>
              <Label>倉庫 *</Label>
              <MasterLookup source="warehouses" value={form.warehouseId} onValueChange={v => setForm(f => ({ ...f, warehouseId: v }))} clearable={false} placeholder="選擇倉庫" />
            </div>
            <div>
              <Label htmlFor="count-basis">帳上數量怎麼算</Label>
              <select id="count-basis" className={selectClass} value={form.basis} onChange={e => setForm(f => ({ ...f, basis: e.target.value }))}>
                <option value="warehouse">這間倉庫的數量（有多間倉庫時）</option>
                <option value="total">全公司合計（只有一間倉庫，或第一次盤點）</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">各倉庫的數量是從這次更新之後的進出貨開始記錄的；更早的庫存沒有分倉紀錄，第一次盤點請選「全公司合計」。</p>
            </div>
            <div><Label htmlFor="count-date">盤點日期 *</Label><Input id="count-date" type="date" value={form.countDate} onChange={e => setForm(f => ({ ...f, countDate: e.target.value }))} /></div>
            <ProjectField value={form.projectId} onChange={v => setForm(f => ({ ...f, projectId: v }))} />
            <div><Label htmlFor="count-note">備註</Label><Input id="count-note" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="例如：年度盤點" /></div>
          </div>
      </DocWindow>

      {/* 盤點單視窗：照全系統共用的單據版面（標題列 → 表頭欄位 → 明細 → 其他區塊 → 底部按鈕列） */}
      <DocWindow
        wide
        open={openId !== null}
        onClose={() => setOpenId(null)}
        name="盤點單"
        number={detail?.countNumber}
        // 盤點中是進行中（灰色），不是草稿
        status={detail && <DocStatus label={STATUS[detail.status] || detail.status} tone={detail.status === "Draft" ? "secondary" : statusTone(detail.status)} />}
        footer={
          <>
            {isDraft && <Button variant="ghost" className="mr-auto text-red-600 dark:text-red-400" onClick={cancelCount} disabled={saving}>取消盤點單</Button>}
            <Button variant="outline" onClick={() => setOpenId(null)}>關閉</Button>
            {isDraft && <Button variant="outline" onClick={save} disabled={saving || Object.keys(counted).length === 0}>儲存</Button>}
            {isDraft && canPost && <Button onClick={postCount} disabled={saving || live.countedLines === 0}>{saving ? "處理中…" : "過帳"}</Button>}
          </>
        }
      >
        {!detail && <p className="py-6 text-center text-muted-foreground">載入中…</p>}
        {detail && (
          <>
            <DocFields items={[
              ["倉庫", detail.warehouseName],
              ["盤點日期", detail.countDate],
              ["專案", detail.projectName],
              ["帳上數量", detail.basis === "total" ? "全公司合計" : "這間倉庫的數量"],
              ["已盤", `${live.countedLines}／${detail.lines.length}`],
              ["有差異", `${live.diffLines} 項`],
              ["盤盈", <span className="text-green-600 dark:text-green-400">{money(live.gain)}</span>],
              ["盤損", <span className="text-red-600 dark:text-red-400">{money(live.loss)}</span>],
              ["開單人", detail.createdBy],
              ["過帳人", detail.postedBy],
            ]} />
            {/* 明細：上面一排是找品項用的工具，下面一行一個品項，實盤數量直接填 */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-40">
                  <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
                  <Input aria-label="搜尋品項" className="pl-8" placeholder="搜尋品號或品名" value={keyword} onChange={e => setKeyword(e.target.value)} />
                </div>
                <Button size="sm" variant={onlyDiff ? "default" : "outline"} className="h-10" onClick={() => setOnlyDiff(v => !v)}>只看有差異</Button>
                {isDraft && <Button size="sm" variant="outline" className="h-10" onClick={fillSystem}>沒填的帶入帳上數量</Button>}
              </div>
              <DocLines<Line>
                rows={rows} scroll
                empty="沒有符合的品項"
                columns={[
                  { header: "品項", cell: (line) => (
                    <>
                      <div className="font-medium">{line.itemName}</div>
                      <div className="text-xs text-muted-foreground">{line.itemCode}</div>
                    </>
                  ) },
                  { header: "帳上數量", align: "right", className: "whitespace-nowrap", cell: (line) => line.systemQty },
                  { header: "差異", align: "right", className: "whitespace-nowrap", cell: (line) => {
                    const v = valueOf(line);
                    const diff = v === "" ? null : Math.round((Number(v) - line.systemQty) * 100) / 100;
                    if (diff === null || diff === 0) return null;
                    return <span className={`font-medium ${diff > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{diff > 0 ? "+" : ""}{diff}</span>;
                  } },
                  { header: "實盤數量", align: "right", cell: (line) => (
                    <Input aria-label={`${line.itemName} 實盤數量`} type="number" inputMode="decimal" min="0" className="ml-auto w-24 text-right" value={valueOf(line)} placeholder="未盤" disabled={!isDraft}
                      onChange={e => setCounted(c => ({ ...c, [line.itemId]: e.target.value }))} />
                  ) },
                ]}
              />
              {isDraft && <p className="text-xs text-muted-foreground">沒填的品項視為「未盤」，過帳時不會調整。過帳是依差異加減庫存，開單之後才發生的進出貨不會被蓋掉。</p>}
            </div>
            <DocNote>{detail.remarks}</DocNote>
            <RelatedDocs type="stock_count" id={detail.id} onNavigate={() => setOpenId(null)} />
          </>
        )}
      </DocWindow>
    </div>
  );
}
