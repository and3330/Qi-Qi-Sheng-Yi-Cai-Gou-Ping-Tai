import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * 審批頁上的「異動申請」內容：改之前、改之後；修改類的審核人可以直接調整（老闆 2026-11-16：審核人可改）。
 * 調整後的內容透過 onChange 交回去，核准時一起送出，後端會再檢查一次（借貸要平衡等）。
 */
interface Change { kind: string; targetType: string; targetId: number | null; payload: any; original: any }
type Opt = { id: number; name: string };

const lockText = (d: string | null) => {
  if (!d) return "未鎖帳";
  const [y, m, day] = d.split("-").map(Number);
  return day === new Date(y, m, 0).getDate() ? `${y} 年 ${m} 月底` : d;
};
const num = (n: unknown) => (Number(n) || 0).toLocaleString();
const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const DOC_FIELD_LABELS: Record<string, string> = {
  remarks: "備註", note: "備註", status: "狀態", reason: "原因", amount: "金額", dueDate: "到期日", items: "品項",
  customerId: "客戶", supplierId: "供應商", orderDate: "單據日期", invoiceDate: "發票日期", deliveryDate: "交期", description: "說明",
  label: "標題", projectId: "專案", departmentId: "部門", paymentMethod: "付款方式", bankAccount: "銀行帳號",
  invoiceTitle: "發票抬頭", invoiceTaxId: "統一編號", location: "存放地點", name: "名稱", custodian: "保管人", newValue: "新價值",
};
const STATUS_TEXT: Record<string, string> = {
  Draft: "草稿", Submitted: "已送出", Unpaid: "未收款", Paid: "已付款", Cancelled: "已取消", Confirmed: "已確認",
  "To Deliver": "待出貨", Completed: "已完成", Voided: "已作廢", Posted: "已過帳", Open: "未結清", Settled: "已結清", paid: "已發放",
  "In Use": "使用中",
};

function useOptions(path: string, enabled: boolean, map: (r: any) => Opt | null): Opt[] {
  const [list, setList] = useState<Opt[]>([]);
  useEffect(() => {
    if (!enabled) return;
    fetch(`/erp-api/${path}`, { credentials: "include" }).then(r => r.ok ? r.json() : []).then(d => {
      const rows = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
      setList(rows.map(map).filter(Boolean) as Opt[]);
    }).catch(() => {});
  }, [path, enabled]);
  return list;
}

export function ChangeReview({ change, editable, onChange }: { change: Change; editable: boolean; onChange: (payload: any) => void }) {
  const [draft, setDraft] = useState<any>(change.payload);
  useEffect(() => { setDraft(change.payload); }, [change.payload]);
  const isEntry = change.targetType === "journal_entry" && change.kind === "edit";
  const isVoucher = change.targetType === "voucher" && change.kind === "edit";
  const accounts = useOptions("accounts", isEntry, (a: any) => a.isGroup ? null : { id: a.id, name: `${a.accountNumber ?? ""} ${a.accountName}`.trim() });
  const projects = useOptions("projects", isEntry || isVoucher, (p: any) => ({ id: p.id, name: p.name }));
  const departments = useOptions("departments", isEntry || isVoucher, (d: any) => ({ id: d.id, name: d.name }));
  const nameOf = (list: Opt[], id: unknown) => list.find(o => o.id === Number(id))?.name ?? (id ? `#${id}` : "（不指定）");

  const set = (patch: any) => { const next = { ...draft, ...patch }; setDraft(next); onChange(next); };
  const setLine = (i: number, patch: any) => set({ lines: draft.lines.map((l: any, j: number) => (j === i ? { ...l, ...patch } : l)) });

  if (change.targetType.startsWith("doc:")) {
    // 發票、銷貨單等一般單據：列出這次要改的欄位，改之前／改之後；修改類審核人可以直接調整
    const body: Record<string, unknown> = draft?.body ?? {};
    const o: Record<string, unknown> = change.original ?? {};
    const canEdit = editable && change.kind === "edit";
    const keys = Object.keys(body).filter(k => !["reason", "changeReason"].includes(k) || change.kind !== "edit");
    const show = (v: unknown) => v == null || v === "" ? "（空白）" : typeof v === "object" ? (Array.isArray(v) ? `${v.length} 筆明細` : "（明細）") : String(STATUS_TEXT[String(v)] ?? v);
    const setField = (k: string, v: unknown) => set({ body: { ...body, [k]: v } });
    return (
      <div className="space-y-2 text-sm">
        <table className="w-full text-left">
          <thead className="text-xs text-muted-foreground"><tr><th className="w-24"></th><th>改之前</th><th>改之後{canEdit && "（可直接調整）"}</th></tr></thead>
          <tbody>{keys.map(k => {
            const v = body[k];
            const primitive = v == null || ["string", "number", "boolean"].includes(typeof v);
            return (
              <tr key={k} className="border-t align-top">
                <td className="py-1 text-muted-foreground">{DOC_FIELD_LABELS[k] ?? k}</td>
                <td className="py-1">{k in o ? show(o[k]) : "—"}</td>
                <td className="py-1">{canEdit && primitive && k !== "status"
                  ? <Input value={v == null ? "" : String(v)} onChange={e => setField(k, typeof v === "number" ? (Number(e.target.value) || 0) : e.target.value)} />
                  : show(v)}</td>
              </tr>
            );
          })}</tbody>
        </table>
        {keys.length === 0 && <p className="text-muted-foreground">沒有其他內容。</p>}
      </div>
    );
  }
  if (change.targetType === "period") {
    return <p className="text-sm">鎖帳 <b>{lockText(change.original?.lockDate ?? null)}</b> → 改成 <b>{lockText(change.payload?.lockDate ?? null)}</b>。核准後這段期間的帳就可以再新增、修改、刪除，改完記得再鎖回去。</p>;
  }
  if (change.kind === "delete") {
    const entries: any[] = change.original?.entries ?? [];
    return (
      <div className="space-y-1 text-sm">
        <p className="font-medium text-destructive">核准後會刪除：</p>
        {change.targetType === "voucher" && <p>{change.original?.voucherNumber}（{change.original?.voucherDate}，{num(change.original?.totalAmount)} 元）{change.original?.description ? `　${change.original.description}` : ""}</p>}
        {entries.map((e: any, i: number) => typeof e === "string" ? <p key={i}>分錄 {e}</p> : <p key={i}>分錄 {e.entryNumber}（{e.entryDate}，{num(e.totalDebit)} 元）{e.description ? `　${e.description}` : ""}</p>)}
      </div>
    );
  }
  if (isVoucher) {
    const o = change.original ?? {};
    return (
      <div className="space-y-2 text-sm">
        <table className="w-full text-left">
          <thead className="text-xs text-muted-foreground"><tr><th className="w-14"></th><th>改之前</th><th>改之後{editable && "（可直接調整）"}</th></tr></thead>
          <tbody>
            <tr><td className="text-muted-foreground">備註</td><td>{o.description || "（空白）"}</td><td>{editable ? <Input value={draft.description ?? ""} onChange={e => set({ description: e.target.value })} /> : draft.description || "（空白）"}</td></tr>
            <tr><td className="text-muted-foreground">專案</td><td>{nameOf(projects, o.projectId)}</td><td>{editable ? <select className={sel} value={draft.projectId ?? ""} onChange={e => set({ projectId: e.target.value ? Number(e.target.value) : null })}><option value="">（不指定）</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : nameOf(projects, draft.projectId)}</td></tr>
            <tr><td className="text-muted-foreground">部門</td><td>{nameOf(departments, o.departmentId)}</td><td>{editable ? <select className={sel} value={draft.departmentId ?? ""} onChange={e => set({ departmentId: e.target.value ? Number(e.target.value) : null })}><option value="">（不指定）</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select> : nameOf(departments, draft.departmentId)}</td></tr>
          </tbody>
        </table>
      </div>
    );
  }
  if (isEntry) {
    const o = change.original ?? { lines: [] };
    const totals = (lines: any[]) => lines.reduce((s, l) => [s[0] + (Number(l.debit) || 0), s[1] + (Number(l.credit) || 0)], [0, 0]);
    const [d, c] = totals(draft.lines ?? []);
    const lineTable = (lines: any[], edit: boolean) => (
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-2 py-1 text-left">科目</th><th className="px-2 py-1 text-left">對象</th><th className="px-2 py-1 text-left">摘要</th><th className="w-24 px-2 py-1 text-right">借方</th><th className="w-24 px-2 py-1 text-right">貸方</th></tr></thead>
        <tbody>{lines.map((l: any, i: number) => (
          <tr key={i} className="border-t">
            <td className="px-2 py-1">{edit ? <select className={sel} value={l.accountId} onChange={e => setLine(i, { accountId: Number(e.target.value) })}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select> : nameOf(accounts, l.accountId)}</td>
            <td className="px-2 py-1">{edit ? <Input value={l.party ?? ""} onChange={e => setLine(i, { party: e.target.value })} /> : l.party}</td>
            <td className="px-2 py-1">{edit ? <Input value={l.description ?? ""} onChange={e => setLine(i, { description: e.target.value })} /> : l.description}</td>
            <td className="px-2 py-1 text-right">{edit ? <Input type="number" className="text-right" value={l.debit || ""} onChange={e => setLine(i, { debit: Number(e.target.value) || 0 })} /> : (Number(l.debit) ? num(l.debit) : "")}</td>
            <td className="px-2 py-1 text-right">{edit ? <Input type="number" className="text-right" value={l.credit || ""} onChange={e => setLine(i, { credit: Number(e.target.value) || 0 })} /> : (Number(l.credit) ? num(l.credit) : "")}</td>
          </tr>
        ))}</tbody>
      </table>
    );
    return (
      <div className="space-y-3 text-sm">
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">改之前：{o.entryDate}　{o.description}　{nameOf(projects, o.projectId)}</p>
          <div className="overflow-x-auto rounded-md border">{lineTable(o.lines ?? [], false)}</div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">改之後{editable && "（可直接調整，核准時一起套用）"}</p>
          {editable ? (
            <div className="mb-2 grid gap-2 sm:grid-cols-3">
              <Input type="date" value={draft.entryDate ?? ""} onChange={e => set({ entryDate: e.target.value })} aria-label="日期" />
              <Input value={draft.description ?? ""} onChange={e => set({ description: e.target.value })} aria-label="說明" placeholder="說明" />
              <select className={sel} value={draft.projectId ?? ""} onChange={e => set({ projectId: e.target.value ? Number(e.target.value) : null })} aria-label="專案"><option value="">（不指定專案）</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </div>
          ) : <p className="mb-1 text-xs">{draft.entryDate}　{draft.description}　{nameOf(projects, draft.projectId)}</p>}
          <div className="overflow-x-auto rounded-md border">{lineTable(draft.lines ?? [], editable)}</div>
          <p className={`mt-1 text-xs ${Math.abs(d - c) < 0.01 ? "text-muted-foreground" : "text-destructive"}`}>借方 {num(d)}　貸方 {num(c)}{Math.abs(d - c) >= 0.01 && "　借貸不平衡，不能核准"}</p>
        </div>
      </div>
    );
  }
  return null;
}
