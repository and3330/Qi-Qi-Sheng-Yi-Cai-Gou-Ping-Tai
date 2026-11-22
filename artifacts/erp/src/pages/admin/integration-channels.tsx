import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/shared/data-table";
import { MasterLookup } from "@/components/shared/master-lookup";
import { ProjectField } from "@/components/shared/project-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocWindow } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";
import { Banknote, Plus } from "lucide-react";
import { call, money, post, selectClass, todayText } from "@/lib/call";

/**
 * 金流通路：每家通路（藍新、綠界、Stripe…）還欠公司多少，撥款進來時貼上明細逐筆沖銷。
 * 放在「外部串接」頁面裡當一個分頁。
 */
interface Channel {
  id: number; code: string; name: string; methods: string[]; startDate: string | null; isActive: boolean; note: string | null;
  receivableAccountId: number; receivableAccountName: string | null; feeAccountId: number | null; feeAccountName: string | null;
  bankAccountId: number | null; bankAccountName: string | null; outstanding: number; openCount: number; oldestDate: string | null;
}
interface Preset { code: string; name: string; methods: string[] }
interface Receivable { id: number; kind: string; externalRef: string; orderNumber: string | null; entryDate: string; amount: number; expectedFee: number | null; settledFee: number | null; projectName: string | null; payoutNumber: string | null; daysOpen: number | null }
interface Payout { id: number; payoutNumber: string; channelId: number; channelName: string | null; payoutDate: string; grossAmount: number; feeAmount: number; extraFee: number; bankAmount: number; lineCount: number; reference: string | null; status: string; bankAccountName: string | null }
interface Preview {
  matched: Array<{ ref: string; amount: number; fee: number }>; problems: Array<{ line: number; ref: string; reason: string }>;
  gross: number; fee: number; extraFee: number; net: number; balanceProblem: string | null; inputProblem: string | null;
  feeWarnings: Array<{ ref: string; expected: number; actual: number }>;
}

interface LegacyOrder { eventId: number; sourceName: string | null; ref: string; entryDate: string; amount: number; fee: number }

const KIND: Record<string, string> = { order: "訂單收款", refund: "退款", topup: "會員儲值" };
const emptyChannel = { id: 0, code: "", name: "", methods: "", receivableAccountId: "", feeAccountId: "", bankAccountId: "", startDate: "", isActive: true, note: "" };
const emptyPayout = { payoutDate: "", bankAccountId: "", bankAmount: "", text: "", reference: "", extraAmount: "", extraProjectId: "", extraNote: "" };
const isCash = (row: Record<string, unknown>) => !row.isGroup && row.accountType === "Asset" && /現金|銀行存款|零用金/.test(String(row.accountName || ""));
const isReceivable = (row: Record<string, unknown>) => !row.isGroup && row.accountType === "Asset" && !isCash(row);
const isExpense = (row: Record<string, unknown>) => !row.isGroup && row.accountType === "Expense";
const daysSince = (date: string | null) => (date ? Math.max(0, Math.floor((Date.now() - new Date(`${date}T00:00:00+08:00`).getTime()) / 86400000)) : null);

export function ChannelsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<typeof emptyChannel | null>(null);
  const [viewing, setViewing] = useState<Channel | null>(null);
  const [showSettled, setShowSettled] = useState(false);
  const [paying, setPaying] = useState<Channel | null>(null);
  const [payout, setPayout] = useState(emptyPayout);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [legacyFor, setLegacyFor] = useState<Channel | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery({ queryKey: ["/integrations/channels"], queryFn: () => call<{ channels: Channel[]; presets: Preset[] }>("integrations/channels") });
  const channels = data?.channels ?? [];
  const presets = (data?.presets ?? []).filter(p => !channels.some(c => c.code === p.code));
  const { data: payouts = [], isLoading: loadingPayouts } = useQuery({ queryKey: ["/integrations/channel-payouts"], queryFn: () => call<Payout[]>("integrations/channel-payouts") });
  const { data: receivables, isLoading: loadingReceivables } = useQuery({
    queryKey: ["/integrations/channels", viewing?.id, "receivables", showSettled],
    queryFn: () => call<Receivable[]>(`integrations/channels/${viewing!.id}/receivables${showSettled ? "?status=settled" : ""}`),
    enabled: viewing !== null,
  });

  const { data: legacy, isLoading: loadingLegacy } = useQuery({
    queryKey: ["/integrations/channels", legacyFor?.id, "legacy-orders"],
    queryFn: () => call<{ startDate: string | null; orders: LegacyOrder[] }>(`integrations/channels/${legacyFor!.id}/legacy-orders`),
    enabled: legacyFor !== null,
  });
  const legacyOrders = legacy?.orders ?? [];
  const pickedTotal = legacyOrders.filter(o => picked.has(o.eventId)).reduce((sum, o) => sum + o.amount, 0);
  const togglePick = (id: number) => { const next = new Set(picked); if (next.has(id)) next.delete(id); else next.add(id); setPicked(next); };
  const convertLegacy = () => run(async () => {
    if (!legacyFor) return;
    const result = await post<{ count: number; amount: number }>(`integrations/channels/${legacyFor.id}/legacy-orders/convert`, { eventIds: [...picked] });
    toast({ title: `已轉入 ${result.count} 筆`, description: `${money(result.amount)} 從銀行存款轉回${legacyFor.name}的欠款，之後的撥款就對得到這些訂單。` });
    setLegacyFor(null);
  });

  const refresh = () => queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith("/integrations/channel") });
  const fail = (error: unknown) => toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
  const run = async (work: () => Promise<void>) => { setBusy(true); try { await work(); refresh(); } catch (error) { fail(error); } finally { setBusy(false); } };
  const totalOutstanding = channels.reduce((sum, c) => sum + c.outstanding, 0);
  const changePayout = (patch: Partial<typeof emptyPayout>) => { setPayout({ ...payout, ...patch }); setPreview(null); };

  const saveChannel = () => run(async () => {
    if (!form) return;
    const body = {
      code: form.code, name: form.name, methods: form.methods, note: form.note, isActive: form.isActive, startDate: form.startDate || null,
      receivableAccountId: Number(form.receivableAccountId) || null, feeAccountId: Number(form.feeAccountId) || null, bankAccountId: Number(form.bankAccountId) || null,
    };
    await post(form.id ? `integrations/channels/${form.id}` : "integrations/channels", body, form.id ? "PUT" : "POST");
    toast({ title: "已儲存通路", description: form.startDate ? `${form.startDate} 起的訂單會先掛在這個通路的欠款。` : "還沒填啟用日，訂單暫時維持原本的記法。" });
    setForm(null);
  });
  const payoutBody = () => ({
    payoutDate: payout.payoutDate, bankAccountId: Number(payout.bankAccountId) || null, bankAmount: payout.bankAmount === "" ? null : Number(payout.bankAmount),
    text: payout.text, reference: payout.reference,
    extraFee: Number(payout.extraAmount) > 0 ? { amount: Number(payout.extraAmount), projectId: Number(payout.extraProjectId) || null, note: payout.extraNote } : null,
  });
  const runPreview = async () => {
    if (!paying) return;
    setBusy(true);
    try { setPreview(await post<Preview>(`integrations/channels/${paying.id}/payouts/preview`, payoutBody())); } catch (error) { fail(error); } finally { setBusy(false); }
  };
  const confirmPayout = () => run(async () => {
    if (!paying) return;
    const result = await post<{ payout: Payout; net: number; count: number; fee: number }>(`integrations/channels/${paying.id}/payouts`, payoutBody());
    toast({ title: `已入帳 ${result.payout.payoutNumber}`, description: `沖銷 ${result.count} 筆，手續費 ${money(result.fee)}，銀行入帳 ${money(result.net)}` });
    setPaying(null);
  });
  const voidPayout = (row: Payout) => {
    if (!confirm(`確定作廢撥款 ${row.payoutNumber}？\n分錄會反向沖回，這 ${row.lineCount} 筆欠款會重新變成「還沒撥款」。`)) return;
    run(async () => { await post(`integrations/channel-payouts/${row.id}/void`, {}); toast({ title: "已作廢", description: "欠款已恢復，可以重新沖銷。" }); });
  };
  const openPayout = (channel: Channel) => { setPaying(channel); setPreview(null); setPayout({ ...emptyPayout, payoutDate: todayText(), bankAccountId: channel.bankAccountId ? String(channel.bankAccountId) : "" }); };
  const editChannel = (c: Channel) => setForm({
    id: c.id, code: c.code, name: c.name, methods: c.methods.join("、"), receivableAccountId: String(c.receivableAccountId), feeAccountId: c.feeAccountId ? String(c.feeAccountId) : "",
    bankAccountId: c.bankAccountId ? String(c.bankAccountId) : "", startDate: c.startDate || "", isActive: c.isActive, note: c.note || "",
  });
  const canConfirm = !!preview && preview.problems.length === 0 && !preview.balanceProblem && !preview.inputProblem && preview.matched.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">各通路還沒撥款的金額合計：<span className="font-semibold text-foreground tabular-nums">{money(totalOutstanding)}</span></p>
        <Button onClick={() => setForm({ ...emptyChannel })} data-testid="button-add-channel"><Plus className="h-4 w-4 mr-1" />新增通路</Button>
      </div>

      <Card><CardContent className="p-0 overflow-x-auto">
        <DataTable
          isLoading={isLoading} data={channels} onRowClick={(c: Channel) => { setShowSettled(false); setViewing(c); }}
          emptyMessage="還沒有通路。新增藍新、綠界等通路並填啟用日之後，訂單收的錢會先記成通路欠款，撥款進來再逐筆沖銷。"
          columns={[
            { header: "通路", accessor: (c: Channel) => <div><span className="font-medium">{c.name}</span><span className="block text-xs text-muted-foreground">{c.isActive ? (c.startDate ? `${c.startDate} 起啟用` : "還沒啟用（未填啟用日）") : "已停用"}・{c.receivableAccountName || "—"}</span></div> },
            { header: "還沒撥款", accessor: (c: Channel) => <span className="font-semibold tabular-nums">{money(c.outstanding)}</span>, className: "text-right" },
            { header: "筆數", accessor: (c: Channel) => `${c.openCount} 筆`, className: "text-right hidden lg:table-cell" },
            { header: "最久的一筆", accessor: (c: Channel) => { const days = daysSince(c.oldestDate); return days === null ? "—" : <span className={days > 14 ? "text-amber-700 dark:text-amber-400" : ""}>{days} 天前</span>; }, className: "hidden xl:table-cell" },
            { header: "操作", accessor: (c: Channel) => (
              <div className="flex flex-wrap gap-2" onClick={e => e.stopPropagation()}>
                <Button size="sm" className="h-9" disabled={c.openCount === 0} onClick={() => openPayout(c)} data-testid={`button-payout-${c.code}`}><Banknote className="h-4 w-4 mr-1" />撥款沖銷</Button>
                <Button size="sm" variant="outline" className="h-9" onClick={() => editChannel(c)}>設定</Button>
              </div>
            ) },
          ]}
        />
      </CardContent></Card>

      <div>
        <h3 className="text-sm font-medium mb-2">撥款紀錄</h3>
        <Card><CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={loadingPayouts} data={payouts} emptyMessage="還沒有撥款紀錄"
            columns={[
              { header: "撥款", accessor: (p: Payout) => <div><span className="font-medium">{p.payoutNumber}</span><span className="block text-xs text-muted-foreground">{p.payoutDate}・{p.channelName || "—"}・{p.lineCount} 筆{p.reference ? `・${p.reference}` : ""}</span></div> },
              { header: "欠款沖銷", accessor: (p: Payout) => money(p.grossAmount), className: "text-right hidden md:table-cell" },
              { header: "手續費", accessor: (p: Payout) => money(p.feeAmount + p.extraFee), className: "text-right hidden md:table-cell" },
              { header: "銀行入帳", accessor: (p: Payout) => <span className="font-semibold tabular-nums">{money(p.bankAmount)}</span>, className: "text-right" },
              { header: "狀態", accessor: (p: Payout) => p.status === "Voided" ? <Badge variant="outline">已作廢</Badge> : <Button size="sm" variant="ghost" className="h-9 text-red-600 dark:text-red-400" disabled={busy} onClick={() => voidPayout(p)}>作廢</Button> },
            ]}
          />
        </CardContent></Card>
      </div>

      <Dialog open={form !== null} onOpenChange={(o) => { if (!o) setForm(null); }}>
        <DialogContent className="md:max-w-lg max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form?.id ? "通路設定" : "新增通路"}</DialogTitle><DialogDescription>客人付的錢會先在通路手上，過幾天才扣掉手續費撥進銀行。設定後，啟用日起的訂單會先記成這個通路的欠款。</DialogDescription></DialogHeader>
          {form && (
            <div className="space-y-4">
              {!form.id && presets.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="ch-preset">常用通路</Label>
                  <select id="ch-preset" className={selectClass} value="" onChange={e => { const p = presets.find(x => x.code === e.target.value); if (p) setForm({ ...form, code: p.code, name: p.name, methods: p.methods.join("、") }); }}>
                    <option value="">選一個帶入，或自己填</option>
                    {presets.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label htmlFor="ch-name">名稱 *</Label><Input id="ch-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="藍新金流" /></div>
                <div className="space-y-1.5"><Label htmlFor="ch-code">代號 *</Label><Input id="ch-code" value={form.code} disabled={!!form.id} onChange={e => setForm({ ...form, code: e.target.value.toLowerCase() })} placeholder="newebpay" /></div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ch-methods">訂單上的付款方式會寫成 *</Label>
                <Input id="ch-methods" value={form.methods} onChange={e => setForm({ ...form, methods: e.target.value })} placeholder="newebpay、藍新" />
                <p className="text-xs text-muted-foreground">外部網站送訂單時「付款方式」填的字，用頓號或逗號分開。對得上的訂單才會掛到這個通路。</p>
              </div>
              <div><Label>欠款記在哪個科目 *</Label><MasterLookup source="accounts" value={form.receivableAccountId} onValueChange={v => setForm({ ...form, receivableAccountId: v })} filter={isReceivable} clearable={false} placeholder="例如：應收帳款-綠界" /></div>
              <div><Label>撥款進哪個銀行帳戶</Label><MasterLookup source="accounts" value={form.bankAccountId} onValueChange={v => setForm({ ...form, bankAccountId: v })} filter={isCash} placeholder="沖銷時可以再改" /></div>
              <div><Label>手續費記在哪個科目</Label><MasterLookup source="accounts" value={form.feeAccountId} onValueChange={v => setForm({ ...form, feeAccountId: v })} filter={isExpense} placeholder="不選就用「金流手續費」" /></div>
              <div className="space-y-1.5">
                <Label htmlFor="ch-start">啟用日</Label>
                <Input id="ch-start" type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
                <p className="text-xs text-muted-foreground">這一天（含）之後的訂單才會先掛通路欠款；之前的訂單維持原本記法、不會被改。沒填就是還沒啟用。</p>
              </div>
              <label className="flex items-center gap-2 text-sm min-h-11"><input type="checkbox" className="h-4 w-4" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />啟用</label>
            </div>
          )}
          <DialogFooter className="gap-2">
            {form?.id ? <Button variant="ghost" className="text-red-600 dark:text-red-400 md:mr-auto" disabled={busy} onClick={() => { if (confirm("確定刪除這個通路？已經有帳款紀錄的通路不能刪除，只能停用。")) run(async () => { await post(`integrations/channels/${form.id}`, undefined, "DELETE"); toast({ title: "已刪除" }); setForm(null); }); }}>刪除</Button> : null}
            <Button variant="outline" onClick={() => setForm(null)}>取消</Button>
            <Button onClick={saveChannel} disabled={busy || !form?.name || !form?.code || !form?.methods || !form?.receivableAccountId}>{busy ? "處理中…" : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 一家通路的帳款明細：通路名稱放在單號的位置，版面固定存在「通路帳款」底下 */}
      <DocWindow
        open={viewing !== null} onClose={() => setViewing(null)} wide
        name="通路帳款" layoutKey="通路帳款" number={viewing?.name}
        description={showSettled ? "已經被撥款沖掉的帳款，以及每一筆實際被扣的手續費。" : "還在通路手上、還沒撥進銀行的錢。退款是負數，會從之後的撥款扣回。"}
        footer={<>
            {viewing?.startDate && <Button variant="ghost" className="md:mr-auto" onClick={() => { setPicked(new Set()); setLegacyFor(viewing); setViewing(null); }} data-testid="button-legacy-orders">轉入啟用日前的訂單</Button>}
            <Button variant="outline" onClick={() => setViewing(null)}>關閉</Button>
        </>}
      >
          <div className="flex gap-2">
            <Button size="sm" variant={showSettled ? "outline" : "default"} className="h-9" onClick={() => setShowSettled(false)}>還沒撥款</Button>
            <Button size="sm" variant={showSettled ? "default" : "outline"} className="h-9" onClick={() => setShowSettled(true)}>已沖銷</Button>
          </div>
          <div className="overflow-x-auto">
            <DataTable
              isLoading={loadingReceivables} data={receivables} emptyMessage={showSettled ? "還沒有沖銷過的帳款" : "目前沒有還沒撥款的帳款"}
              columns={[
                { header: "訂單", accessor: (r: Receivable) => <div><span className="font-medium">{r.externalRef}</span><span className="block text-xs text-muted-foreground">{r.entryDate}・{KIND[r.kind] || r.kind}・{r.projectName || "未掛專案"}</span></div> },
                { header: "金額", accessor: (r: Receivable) => <span className={`tabular-nums ${r.amount < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{money(r.amount)}</span>, className: "text-right" },
                showSettled
                  ? { header: "手續費／撥款", accessor: (r: Receivable) => <div className="text-right"><span className="tabular-nums">{money(r.settledFee)}</span><span className="block text-xs text-muted-foreground">{r.payoutNumber}</span></div>, className: "text-right" }
                  : { header: "掛了幾天", accessor: (r: Receivable) => <span className={(r.daysOpen ?? 0) > 14 ? "text-amber-700 dark:text-amber-400" : ""}>{r.daysOpen} 天</span>, className: "text-right" },
              ]}
            />
          </div>
      </DocWindow>

      <Dialog open={legacyFor !== null} onOpenChange={(o) => { if (!o) setLegacyFor(null); }}>
        <DialogContent className="md:max-w-2xl max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>轉入啟用日前的訂單</DialogTitle><DialogDescription>{legacyFor?.startDate} 之前用{legacyFor?.name}收款的訂單，當時已經直接記成銀行收款。請只勾「通路到現在還沒撥款」的那些：系統會把這些錢從銀行存款轉回通路欠款，之後的撥款明細才對得到。已經撥過款的不要勾。</DialogDescription></DialogHeader>
          <div className="space-y-2">
            {loadingLegacy ? <p className="py-6 text-center text-sm text-muted-foreground">讀取中…</p> : legacyOrders.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">沒有需要轉入的訂單</p> : (
              <>
                <label className="flex items-center gap-2 text-sm min-h-11 border-b">
                  <input type="checkbox" className="h-4 w-4" checked={picked.size === legacyOrders.length} onChange={e => setPicked(e.target.checked ? new Set(legacyOrders.map(o => o.eventId)) : new Set())} />
                  全選（共 {legacyOrders.length} 筆）
                </label>
                <div className="max-h-[45dvh] overflow-y-auto divide-y">
                  {legacyOrders.map(o => (
                    <label key={o.eventId} className="flex items-center gap-3 py-2 min-h-11 text-sm cursor-pointer">
                      <input type="checkbox" className="h-4 w-4 shrink-0" checked={picked.has(o.eventId)} onChange={() => togglePick(o.eventId)} />
                      <span className="min-w-0 flex-1"><span className="font-medium">{o.ref}</span><span className="block text-xs text-muted-foreground">{o.entryDate}・{o.sourceName || "—"}{o.fee > 0 ? `・當時先扣手續費 ${money(o.fee)}` : ""}</span></span>
                      <span className="tabular-nums">{money(o.amount)}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <DialogFooter className="gap-2">
            <span className="text-sm text-muted-foreground md:mr-auto">已選 {picked.size} 筆，{money(pickedTotal)}</span>
            <Button variant="outline" onClick={() => setLegacyFor(null)}>取消</Button>
            <Button onClick={convertLegacy} disabled={busy || picked.size === 0} data-testid="button-legacy-convert">{busy ? "處理中…" : "轉成通路欠款"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paying !== null} onOpenChange={(o) => { if (!o) setPaying(null); }}>
        <DialogContent className="md:max-w-2xl max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{paying?.name} 撥款沖銷</DialogTitle><DialogDescription>把通路這一次撥款的明細貼上來，系統逐筆沖掉欠款、認列手續費。算出來的金額要跟銀行實際入帳的一樣才能入帳；有任何一筆對不上，整批都不會入帳。</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="po-date">撥款進銀行的日期 *</Label><Input id="po-date" type="date" value={payout.payoutDate} onChange={e => changePayout({ payoutDate: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="po-bank">銀行實際入帳金額 *</Label><Input id="po-bank" type="number" inputMode="decimal" value={payout.bankAmount} onChange={e => changePayout({ bankAmount: e.target.value })} placeholder="存摺上的數字" /></div>
            </div>
            <div><Label>進哪個銀行帳戶 *</Label><MasterLookup source="accounts" value={payout.bankAccountId} onValueChange={v => changePayout({ bankAccountId: v })} filter={isCash} clearable={false} placeholder="選銀行帳戶" /></div>
            <div className="space-y-1.5">
              <Label htmlFor="po-text">撥款明細 *</Label>
              <Textarea id="po-text" rows={7} className="font-mono text-sm" value={payout.text} onChange={e => changePayout({ text: e.target.value })} placeholder={"訂單編號　金額　手續費\nCM-1001　1000　28\nCM-1002　2000　56"} data-testid="input-payout-text" />
              <p className="text-xs text-muted-foreground">每行一筆：訂單編號、金額、手續費。可以直接從 Excel 複製三欄貼上（Tab、逗號、空白分隔都可以）。金額可以不填；同一張訂單同時有收款和退款時要填金額。</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="po-extra">其他扣款（不屬於任何訂單）</Label><Input id="po-extra" type="number" inputMode="decimal" value={payout.extraAmount} onChange={e => changePayout({ extraAmount: e.target.value })} placeholder="例如撥款匯費、月費" /></div>
              <div className="space-y-1.5"><Label htmlFor="po-ref">備註</Label><Input id="po-ref" value={payout.reference} onChange={e => changePayout({ reference: e.target.value })} placeholder="例如：12/05 撥款" /></div>
            </div>
            {Number(payout.extraAmount) > 0 && <ProjectField label="其他扣款掛哪個專案" value={payout.extraProjectId} onChange={v => changePayout({ extraProjectId: v })} />}

            {preview && (
              <div className={`rounded-lg border p-3 text-sm space-y-2 ${canConfirm ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40" : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"}`} data-testid="payout-preview">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 tabular-nums">
                  <div><p className="text-xs text-muted-foreground">對上</p><p className="font-semibold">{preview.matched.length} 筆</p></div>
                  <div><p className="text-xs text-muted-foreground">沖銷欠款</p><p className="font-semibold">{money(preview.gross)}</p></div>
                  <div><p className="text-xs text-muted-foreground">手續費</p><p className="font-semibold">{money(preview.fee + preview.extraFee)}</p></div>
                  <div><p className="text-xs text-muted-foreground">應入帳</p><p className="font-semibold">{money(preview.net)}</p></div>
                </div>
                {preview.problems.length > 0 && (
                  <div>
                    <p className="font-medium text-amber-800 dark:text-amber-300">有 {preview.problems.length} 筆對不上：</p>
                    <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">{preview.problems.map(p => <li key={p.line}>第 {p.line} 筆　{p.ref || "（空白）"}：{p.reason}</li>)}</ul>
                  </div>
                )}
                {preview.inputProblem && <p className="text-amber-800 dark:text-amber-300">{preview.inputProblem}</p>}
                {preview.balanceProblem && <p className="text-amber-800 dark:text-amber-300">{preview.balanceProblem}</p>}
                {preview.feeWarnings.length > 0 && <p className="text-xs text-muted-foreground">提醒：有 {preview.feeWarnings.length} 筆的手續費和來源網站回報的不一樣（例如 {preview.feeWarnings[0].ref}：回報 {preview.feeWarnings[0].expected}、實扣 {preview.feeWarnings[0].actual}）。會以這次的明細為準。</p>}
                {canConfirm && <p className="text-emerald-800 dark:text-emerald-300">全部對上，金額也和銀行入帳一致，可以入帳。</p>}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPaying(null)}>取消</Button>
            <Button variant={canConfirm ? "outline" : "default"} onClick={runPreview} disabled={busy || !payout.text.trim()} data-testid="button-payout-preview">{busy && !preview ? "試算中…" : "試算"}</Button>
            <Button onClick={confirmPayout} disabled={busy || !canConfirm} data-testid="button-payout-confirm">{busy && canConfirm ? "入帳中…" : "確認入帳"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
