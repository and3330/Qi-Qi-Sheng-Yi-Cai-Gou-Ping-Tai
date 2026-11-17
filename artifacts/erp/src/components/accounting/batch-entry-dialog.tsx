import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocWindow } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";

export type BatchMode = "receipt" | "payment";
interface Acc { id: number; accountNumber: string; accountName: string; accountType: string; isGroup?: boolean }
interface Named { id: number; name: string }
interface Line { accountId: string; party: string; amount: string; fee: string; summary: string; departmentId: string; projectId: string }

const CASH = /(銀行存款|庫存現金|零用金|電子支付存款|約當現金|在途現金)/;
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
const emptyLine = (prev?: Line): Line => ({ accountId: prev?.accountId ?? "", party: "", amount: "", fee: "", summary: "", departmentId: prev?.departmentId ?? "", projectId: prev?.projectId ?? "" });
const num = (s: string) => Number(String(s).replace(/,/g, "")) || 0;
const cell = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

/**
 * 照 Ecount 收款單／付款單：一張單打很多筆。表頭選日期和哪個銀行（現金）帳戶，
 * 下面每一行各填科目、客戶或廠商、金額、手續費、摘要、部門、專案；存檔時每行各開一張分錄。
 */
export function BatchEntryDialog({ open, mode, onOpenChange, onSaved, accounts, departments, projects }: {
  open: boolean; mode: BatchMode; onOpenChange: (v: boolean) => void; onSaved: () => void;
  accounts: Acc[]; departments: Named[]; projects: (Named & { isActive?: boolean })[];
}) {
  const { toast } = useToast();
  const leaf = useMemo(() => accounts.filter(a => !a.isGroup).sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, "zh-Hant", { numeric: true })), [accounts]);
  const cashAccounts = useMemo(() => leaf.filter(a => CASH.test(a.accountName)), [leaf]);
  const feeAccounts = useMemo(() => leaf.filter(a => /手續費/.test(a.accountName)), [leaf]);
  const [parties, setParties] = useState<string[]>([]);
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState("");
  const [cashId, setCashId] = useState("");
  const [feeId, setFeeId] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const label = mode === "receipt" ? "收款" : "付款";

  useEffect(() => {
    if (!open) return;
    setDate(today()); setMemo(""); setLines([emptyLine(), emptyLine(), emptyLine()]);
    setCashId(prev => prev || String(cashAccounts.find(a => /銀行存款/.test(a.accountName))?.id ?? cashAccounts[0]?.id ?? ""));
    setFeeId(prev => prev || String(feeAccounts[0]?.id ?? ""));
    // 客戶、廠商名稱給「客戶／廠商」欄打字時提示用
    Promise.all([fetch("/erp-api/customers").then(r => r.ok ? r.json() : []), fetch("/erp-api/suppliers").then(r => r.ok ? r.json() : [])])
      .then(([c, s]) => setParties([...new Set([...(Array.isArray(c) ? c : []), ...(Array.isArray(s) ? s : [])].map((x: any) => x.name).filter(Boolean))]))
      .catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (i: number, k: keyof Line, v: string) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const filled = lines.filter(l => l.accountId || num(l.amount) > 0);
  const totalAmount = filled.reduce((s, l) => s + num(l.amount), 0);
  const totalFee = filled.reduce((s, l) => s + num(l.fee), 0);
  const net = mode === "receipt" ? totalAmount - totalFee : totalAmount + totalFee;

  const save = async () => {
    if (!cashId) { toast({ title: `請選擇${label}帳戶`, variant: "destructive" }); return; }
    if (filled.length === 0) { toast({ title: "至少填一行", variant: "destructive" }); return; }
    const bad = filled.findIndex(l => !l.accountId || num(l.amount) <= 0);
    if (bad >= 0) { toast({ title: `第 ${lines.indexOf(filled[bad]) + 1} 行要選科目並填金額`, variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch("/erp-api/journal-entries/batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode, entryDate: date, memo, cashAccountId: Number(cashId), feeAccountId: feeId ? Number(feeId) : undefined,
          lines: filled.map(l => ({ accountId: Number(l.accountId), party: l.party, amount: num(l.amount), fee: num(l.fee), summary: l.summary, departmentId: l.departmentId ? Number(l.departmentId) : null, projectId: l.projectId ? Number(l.projectId) : null })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "儲存失敗");
      toast({ title: `${label}單已存檔`, description: `共 ${json.count} 筆分錄` });
      onOpenChange(false); onSaved();
    } catch (e: any) {
      toast({ title: "儲存失敗", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    // 外框和其他單據視窗一樣：標題列 → 表頭欄位 → 明細 → 底部按鈕列；欄位和存檔方式照原樣
    <DocWindow
      open={open} onClose={() => onOpenChange(false)} extraWide
      name={`新增${label}單`}
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button onClick={save} disabled={saving}>{saving ? "存檔中..." : `存檔（${filled.length} 筆）`}</Button>
      </>}
    >
        <div className="grid gap-3 md:grid-cols-[160px_1fr_1fr_1fr]">
          <div><Label>日期 *</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div><Label>{label}帳戶（存摺）*</Label>
            <select className={cell + " h-10"} value={cashId} onChange={e => setCashId(e.target.value)} aria-label={`${label}帳戶`}>
              <option value="">請選擇</option>
              {cashAccounts.map(a => <option key={a.id} value={a.id}>{a.accountNumber} {a.accountName}</option>)}
            </select>
          </div>
          <div><Label>手續費科目</Label>
            <select className={cell + " h-10"} value={feeId} onChange={e => setFeeId(e.target.value)} aria-label="手續費科目">
              <option value="">無</option>
              {feeAccounts.map(a => <option key={a.id} value={a.id}>{a.accountNumber} {a.accountName}</option>)}
            </select>
          </div>
          <div><Label>備註</Label><Input value={memo} onChange={e => setMemo(e.target.value)} placeholder="每行沒填摘要時用這個" /></div>
        </div>

        <datalist id="batch-parties">{parties.map(p => <option key={p} value={p} />)}</datalist>
        {/* 視窗比原本窄，欄位多：表格自己可以左右捲、上下捲，表頭固定 */}
        <div className="max-h-[50dvh] overflow-auto rounded-md border">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="sticky top-0 bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2">#</th>
                <th className="px-1 py-2 text-left">科目 *</th>
                <th className="w-40 px-1 py-2 text-left">客戶／廠商</th>
                <th className="w-28 px-1 py-2 text-right">金額 *</th>
                <th className="w-20 px-1 py-2 text-right">手續費</th>
                <th className="w-44 px-1 py-2 text-left">摘要</th>
                <th className="w-32 px-1 py-2 text-left">部門</th>
                <th className="w-40 px-1 py-2 text-left">專案</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 text-center text-xs text-muted-foreground">{i + 1}</td>
                  <td className="px-1 py-1">
                    <select className={cell} value={l.accountId} onChange={e => set(i, "accountId", e.target.value)} aria-label={`第 ${i + 1} 行科目`}>
                      <option value="">請選擇科目</option>
                      {leaf.filter(a => String(a.id) !== cashId).map(a => <option key={a.id} value={a.id}>{a.accountNumber} {a.accountName}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><Input className="h-9" list="batch-parties" value={l.party} onChange={e => set(i, "party", e.target.value)} aria-label={`第 ${i + 1} 行客戶或廠商`} /></td>
                  <td className="px-1 py-1"><Input className="h-9 text-right" inputMode="decimal" value={l.amount} onChange={e => set(i, "amount", e.target.value)} aria-label={`第 ${i + 1} 行金額`} /></td>
                  <td className="px-1 py-1"><Input className="h-9 text-right" inputMode="decimal" value={l.fee} onChange={e => set(i, "fee", e.target.value)} aria-label={`第 ${i + 1} 行手續費`} /></td>
                  <td className="px-1 py-1"><Input className="h-9" value={l.summary} onChange={e => set(i, "summary", e.target.value)} aria-label={`第 ${i + 1} 行摘要`} /></td>
                  <td className="px-1 py-1">
                    <select className={cell} value={l.departmentId} onChange={e => set(i, "departmentId", e.target.value)} aria-label={`第 ${i + 1} 行部門`}>
                      <option value="">無</option>
                      {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <select className={cell} value={l.projectId} onChange={e => set(i, "projectId", e.target.value)} aria-label={`第 ${i + 1} 行專案`}>
                      <option value="">無</option>
                      {projects.filter(p => p.isActive !== false || String(p.id) === l.projectId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td className="whitespace-nowrap px-1">
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="複製這一行" aria-label={`複製第 ${i + 1} 行`} onClick={() => setLines(ls => [...ls.slice(0, i + 1), { ...l }, ...ls.slice(i + 1)])}><Copy size={14} /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="刪除這一行" aria-label={`刪除第 ${i + 1} 行`} disabled={lines.length <= 1} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}><Trash2 size={14} className="text-destructive" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Button type="button" variant="outline" size="sm" onClick={() => setLines(ls => [...ls, emptyLine(ls[ls.length - 1])])}><Plus size={14} className="mr-1" />新增行</Button>
          <span>
            {filled.length} 行　金額合計 <b className="font-mono">{fmt(totalAmount)}</b>
            {totalFee > 0 && <>　手續費 <b className="font-mono">{fmt(totalFee)}</b></>}
            　{mode === "receipt" ? "實際入帳" : "實際付出"} <b className="font-mono">{fmt(net)}</b>
          </span>
        </div>
        <p className="text-xs text-muted-foreground">存檔後每一行會各開一張分錄（借貸自動帶好），部門、專案各自算在自己那一行；有收入或費用科目的行要選專案。</p>
    </DocWindow>
  );
}
