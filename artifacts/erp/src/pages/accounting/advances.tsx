import { useEffect, useState } from "react";
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
import { DocWindow, DocStatus, DocFields, DocLines, DocNote, DocSection, statusTone } from "@/components/shared/doc-window";
import { RelatedDocs, useOpenFromUrl } from "@/components/shared/related-docs";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";
import { call, money, post, selectClass, todayText } from "@/lib/call";

interface Advance {
  id: number; advanceNumber: string; partyType: string; partyName: string; kind: string; amount: number; taxAmount: number; repaidAmount: number; outstanding: number;
  entryDate: string; description: string | null; status: string; projectName: string | null; counterAccountName: string | null;
  repayments: Array<{ date: string; amount: number; cashAccountName: string }>;
}
interface Listing { advances: Advance[]; balances: Array<{ partyType: string; partyName: string; total: number; repaid: number; outstanding: number; count: number }>; totalOutstanding: number }

const STATUS: Record<string, string> = { Open: "還沒還清", Settled: "已還清", Voided: "已作廢" };
const KIND: Record<string, string> = { loan: "借錢給公司", expense: "代墊" };
const emptyForm = { partyType: "owner", partyName: "", employeeId: "", kind: "expense", amount: "", taxAmount: "", entryDate: "", description: "", projectId: "", accountId: "", cashAccountId: "" };
const isCashAccount = (row: Record<string, unknown>) => !row.isGroup && row.accountType === "Asset" && /現金|銀行存款|零用金|電子支付/.test(String(row.accountName || ""));
const isSpendAccount = (row: Record<string, unknown>) => !row.isGroup && (row.accountType === "Expense" || row.accountType === "Asset" || row.accountType === "Liability");

export default function AdvancesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("Open");
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [viewing, setViewing] = useState<Advance | null>(null);
  const [repay, setRepay] = useState({ amount: "", cashAccountId: "", date: "" });
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ["/advances", status], queryFn: () => call<Listing>(`advances${status ? `?status=${status}` : ""}`) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/advances"] });
  const openAdvance = (a: Advance) => { setRepay({ amount: String(a.outstanding), cashAccountId: "", date: todayText() }); setViewing(a); };
  // 別的頁面用 ?open=<編號> 連過來：開那一張。清單預設只列「還沒還清」，找不到就改成「全部」再找一次
  const [linkedId, setLinkedId] = useState<number | null>(() => {
    const id = Number(new URLSearchParams(window.location.search).get("open"));
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  const linkedMissing = linkedId !== null && !!data && !data.advances.some(a => a.id === linkedId);
  useEffect(() => {
    if (!linkedMissing) return;
    if (status !== "") setStatus(""); else setLinkedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedMissing]);
  useOpenFromUrl(linkedMissing && status !== "" ? undefined : data?.advances, a => { setLinkedId(null); openAdvance(a); });
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); refresh(); } catch (error) { toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" }); } finally { setBusy(false); }
  };

  const create = () => run(async () => {
    if (!form) return;
    const created = await post<Advance>("advances", {
      partyType: form.partyType, partyName: form.partyName, employeeId: form.employeeId ? Number(form.employeeId) : undefined,
      kind: form.kind, amount: Number(form.amount), taxAmount: form.kind === "expense" ? Number(form.taxAmount) || 0 : 0,
      entryDate: form.entryDate || undefined, description: form.description, projectId: form.projectId ? Number(form.projectId) : undefined,
      accountId: form.kind === "expense" && form.accountId ? Number(form.accountId) : undefined,
      cashAccountId: form.kind === "loan" && form.cashAccountId ? Number(form.cashAccountId) : undefined,
    });
    toast({ title: "已登錄", description: `${created.advanceNumber}：公司欠 ${created.partyName} ${money(created.amount)}` });
    setForm(null);
  });
  const submitRepay = () => run(async () => {
    if (!viewing) return;
    const result = await post<Advance>(`advances/${viewing.id}/repay`, { amount: Number(repay.amount), cashAccountId: Number(repay.cashAccountId), date: repay.date || undefined });
    toast({ title: result.status === "Settled" ? "已還清" : "已還款", description: result.outstanding > 0 ? `還欠 ${money(result.outstanding)}` : undefined });
    setViewing(null);
  });
  const voidAdvance = () => {
    if (!viewing || !confirm(`確定作廢 ${viewing.advanceNumber}？系統會開一張相反的分錄。`)) return;
    run(async () => { await post(`advances/${viewing.id}/void`); toast({ title: "已作廢" }); setViewing(null); });
  };
  const formValid = !!form && Number(form.amount) > 0 && (form.partyType === "owner" ? !!form.partyName.trim() : !!form.employeeId)
    && (form.kind === "loan" ? !!form.cashAccountId : !!form.accountId);

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="代墊款與借款" description="老闆或員工先幫公司出錢：借錢給公司周轉、代墊費用或貨款，以及公司還款"
        action={<Button onClick={() => setForm({ ...emptyForm, entryDate: todayText() })} data-testid="button-new-advance"><Plus className="h-4 w-4 mr-1" />登錄代墊／借款</Button>} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">公司還欠（全部）</p><p className="text-2xl font-semibold tabular-nums">{money(data?.totalOutstanding)}</p></CardContent></Card>
        {(data?.balances || []).filter(b => b.outstanding > 0).slice(0, 2).map(b => (
          <Card key={`${b.partyType}-${b.partyName}`}><CardContent className="p-4"><p className="text-xs text-muted-foreground">欠 {b.partyName}（{b.partyType === "owner" ? "老闆" : "員工"}）</p><p className="text-2xl font-semibold tabular-nums">{money(b.outstanding)}</p></CardContent></Card>
        ))}
      </div>

      <div className="w-40">
        <Label htmlFor="adv-status" className="text-xs">狀態</Label>
        <select id="adv-status" className={selectClass} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部</option>
          {Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <Card><CardContent className="p-0 overflow-x-auto">
        <DataTable
          isLoading={isLoading} data={data?.advances} emptyMessage="沒有代墊款或借款"
          onRowClick={openAdvance}
          columns={[
            { header: "單號", accessor: (a: Advance) => <div><span className="font-medium">{a.advanceNumber}</span><span className="block text-xs text-muted-foreground">{a.entryDate}・{a.partyName}</span></div> },
            { header: "內容", accessor: (a: Advance) => <div className="text-sm">{KIND[a.kind] || a.kind}{a.description ? `：${a.description}` : ""}<span className="block text-xs text-muted-foreground">{a.counterAccountName || ""}{a.projectName ? `・${a.projectName}` : ""}</span></div> },
            { header: "金額", accessor: (a: Advance) => money(a.amount), className: "text-right hidden xl:table-cell" },
            { header: "還欠", accessor: (a: Advance) => <span className="font-medium">{money(a.outstanding)}</span>, className: "text-right" },
            { header: "狀態", accessor: (a: Advance) => <Badge variant={a.status === "Open" ? "default" : "outline"}>{STATUS[a.status] || a.status}</Badge> },
          ]}
        />
      </CardContent></Card>

      {/* 登錄表單：外框和其他單據視窗一樣，欄位照原樣 */}
      <DocWindow
        open={form !== null} onClose={() => setForm(null)}
        name="登錄代墊／借款" description="登錄後帳上會記成公司欠這個人的錢，還款時再沖掉。"
        footer={<>
          <Button variant="outline" onClick={() => setForm(null)}>取消</Button>
          <Button onClick={create} disabled={busy || !formValid}>{busy ? "處理中…" : "登錄"}</Button>
        </>}
      >
          {form && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="adv-party">誰出的錢 *</Label>
                  <select id="adv-party" className={selectClass} value={form.partyType} onChange={e => setForm({ ...form, partyType: e.target.value })}>
                    <option value="owner">老闆（股東）</option>
                    <option value="employee">員工</option>
                  </select>
                </div>
                {form.partyType === "owner"
                  ? <div className="space-y-1.5"><Label htmlFor="adv-name">姓名 *</Label><Input id="adv-name" value={form.partyName} onChange={e => setForm({ ...form, partyName: e.target.value })} /></div>
                  : <div><Label>員工 *</Label><MasterLookup source="employees" value={form.employeeId} onValueChange={v => setForm({ ...form, employeeId: v })} clearable={false} placeholder="選擇員工" /></div>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adv-kind">情況 *</Label>
                <select id="adv-kind" className={selectClass} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
                  <option value="expense">代墊：直接幫公司付掉（錢沒有經過公司帳戶）</option>
                  <option value="loan">借錢給公司：錢匯進公司帳戶</option>
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label htmlFor="adv-amount">金額 *</Label><Input id="adv-amount" type="number" inputMode="decimal" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor="adv-date">日期</Label><Input id="adv-date" type="date" max={todayText()} value={form.entryDate} onChange={e => setForm({ ...form, entryDate: e.target.value })} /></div>
              </div>
              {form.kind === "loan"
                ? <div><Label>錢進到公司的哪個帳戶 *</Label><MasterLookup source="accounts" value={form.cashAccountId} onValueChange={v => setForm({ ...form, cashAccountId: v })} filter={isCashAccount} clearable={false} placeholder="銀行、現金" /></div>
                : (
                  <>
                    <div><Label>錢花在哪個科目 *</Label><MasterLookup source="accounts" value={form.accountId} onValueChange={v => setForm({ ...form, accountId: v })} filter={isSpendAccount} clearable={false} placeholder="例如：廣告費、文具用品；代付貨款選應付帳款" /></div>
                    <div className="space-y-1.5"><Label htmlFor="adv-tax">其中的營業稅</Label><Input id="adv-tax" type="number" inputMode="decimal" min="0" value={form.taxAmount} onChange={e => setForm({ ...form, taxAmount: e.target.value })} placeholder="有統一發票才填，可以扣抵" /></div>
                    <ProjectField required={false} value={form.projectId} onChange={v => setForm({ ...form, projectId: v })} />
                    <p className="text-xs text-muted-foreground -mt-2">花在費用科目時一定要選專案。</p>
                  </>
                )}
              <div className="space-y-1.5"><Label htmlFor="adv-desc">說明</Label><Input id="adv-desc" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="例如：Meta 廣告、周轉" /></div>
            </div>
          )}
      </DocWindow>

      {/* 檢視一張代墊／借款：標題列 → 表頭欄位 → 還款紀錄（明細）→ 說明 → 還款 → 底部按鈕列 */}
      <DocWindow
        open={viewing !== null} onClose={() => setViewing(null)}
        name="代墊款／借款" number={viewing?.advanceNumber}
        status={viewing ? <DocStatus label={STATUS[viewing.status] || viewing.status} tone={statusTone(viewing.status)} /> : undefined}
        footer={<>
          {viewing?.status === "Open" && viewing.repaidAmount === 0 && <Button variant="ghost" className="mr-auto text-red-600 dark:text-red-400" onClick={voidAdvance} disabled={busy}>作廢</Button>}
          {viewing?.status === "Open" && <Button onClick={submitRepay} disabled={busy || !(Number(repay.amount) > 0) || Number(repay.amount) > viewing.outstanding || !repay.cashAccountId}>{busy ? "處理中…" : "還款"}</Button>}
          <Button variant="outline" onClick={() => setViewing(null)}>關閉</Button>
        </>}
      >
        {viewing && (
          <>
            <DocFields items={[
              ["日期", viewing.entryDate],
              ["誰出的錢", `${viewing.partyName}（${viewing.partyType === "owner" ? "老闆" : "員工"}）`],
              ["情況", KIND[viewing.kind] || viewing.kind],
              ["科目", viewing.counterAccountName],
              ["專案", viewing.projectName],
              ["金額", money(viewing.amount)],
              viewing.taxAmount > 0 && ["營業稅", money(viewing.taxAmount)],
              ["已還", money(viewing.repaidAmount)],
              ["還欠", money(viewing.outstanding)],
            ]} />
            <DocSection title="還款紀錄">
              <DocLines
                columns={[
                  { header: "日期", cell: (r: Advance["repayments"][number]) => r.date },
                  { header: "還款帳戶", cell: (r: Advance["repayments"][number]) => r.cashAccountName },
                  { header: "金額", align: "right", cell: (r: Advance["repayments"][number]) => money(r.amount) },
                ]}
                rows={viewing.repayments}
                total={{ label: "已還合計", value: money(viewing.repaidAmount) }}
                empty="還沒有還款"
              />
            </DocSection>
            <DocNote label="說明">{viewing.description}</DocNote>
            <RelatedDocs type="advance" id={viewing.id} onNavigate={() => setViewing(null)} />
            {viewing.status === "Open" && (
              <DocSection title="還款">
                <div className="space-y-3 rounded-md border p-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label htmlFor="rp-amount">金額 *</Label><Input id="rp-amount" type="number" inputMode="decimal" min="0" max={viewing.outstanding} value={repay.amount} onChange={e => setRepay({ ...repay, amount: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label htmlFor="rp-date">日期</Label><Input id="rp-date" type="date" max={todayText()} value={repay.date} onChange={e => setRepay({ ...repay, date: e.target.value })} /></div>
                  </div>
                  <div><Label>從哪個帳戶還 *</Label><MasterLookup source="accounts" value={repay.cashAccountId} onValueChange={v => setRepay({ ...repay, cashAccountId: v })} filter={isCashAccount} clearable={false} placeholder="銀行、現金" /></div>
                </div>
              </DocSection>
            )}
          </>
        )}
      </DocWindow>
    </div>
  );
}
