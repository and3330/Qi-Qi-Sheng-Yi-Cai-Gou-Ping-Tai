import { useEffect, useMemo, useState } from "react";
import { selectableProjects, projectPickerLabel } from "@/lib/select-options";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocWindow } from "@/components/shared/doc-window";
import { PayAccountDialog, type PayAccountChoice } from "@/components/shared/pay-account-dialog";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Ban, Banknote, Download, Plus } from "lucide-react";

interface Fee {
  id: number; feeNumber: string; payeeType: "teacher" | "employee"; payeeName: string;
  salesOrderId: number | null; orderNumber: string | null; projectId: number; projectName: string | null;
  serviceDate: string; description: string | null; hours: number | null; rate: number | null; amount: number;
  incomeType: string; incomeTypeLabel: string; withholdingTax: number; nhiSupplement: number; netAmount: number;
  status: string; paidDate: string | null;
}
interface Summary {
  year: number;
  rows: Array<{ key: string; payeeType: string; payeeName: string; payeeCode: string; idNumber: string; address: string; incomeType: string; incomeTypeLabel: string; count: number; gross: number; withholdingTax: number; nhiSupplement: number; net: number; unpaid: number; salaryGross: number; salarySlipCount: number }>;
  totals: { gross: number; withholdingTax: number; nhiSupplement: number; net: number; unpaid: number };
  missingIdNumber: string[];
}

const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const money = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString()}`;
const STATUS: Record<string, string> = { Confirmed: "未付款", Paid: "已付款", Voided: "已作廢" };
const PAY_ROLES = ["owner", "admin", "finance_admin", "accountant", "super_admin"];

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/erp-api/${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json as T;
}

const emptyForm = { payeeType: "teacher", payeeId: "", salesOrderId: "", projectId: "", serviceDate: new Date().toISOString().slice(0, 10), description: "", hours: "", rate: "", amount: "", incomeType: "50", withholdingTax: "", nhiSupplement: "" };

export default function ServiceFeesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canPay = PAY_ROLES.includes(user?.role || "");
  const search = useSearch();
  const [tab, setTab] = useState<"list" | "annual">("list");
  const [year, setYear] = useState(new Date().getFullYear());
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState<Fee | null>(null);

  const { data: fees, isLoading } = useQuery({ queryKey: ["/service-fees", year], queryFn: () => call<Fee[]>(`service-fees?from=${year}-01-01&to=${year}-12-31`) });
  const { data: summary, isLoading: summaryLoading } = useQuery({ queryKey: ["/service-fees/annual-summary", year], queryFn: () => call<Summary>(`service-fees/annual-summary?year=${year}`), enabled: tab === "annual" });
  const { data: teachers = [] } = useQuery({ queryKey: ["/teachers"], queryFn: () => call<any[]>("teachers"), enabled: open });
  const { data: employees = [] } = useQuery({ queryKey: ["/employees"], queryFn: () => call<any[]>("employees"), enabled: open });
  const { data: projects = [] } = useQuery({ queryKey: ["/projects"], queryFn: () => call<any[]>("projects"), enabled: open });
  const { data: orders = [] } = useQuery({ queryKey: ["/sales-orders"], queryFn: () => call<any[]>("sales-orders"), enabled: open });

  // 從銷貨單明細點「登錄服務費」過來：帶入那張單與專案
  useEffect(() => {
    const params = new URLSearchParams(search);
    const orderId = params.get("salesOrderId");
    if (orderId) {
      setForm(f => ({ ...f, salesOrderId: orderId, projectId: params.get("projectId") || f.projectId }));
      setOpen(true);
    }
  }, [search]);

  const amount = Number(form.amount) || (Number(form.hours) > 0 && Number(form.rate) > 0 ? Math.round(Number(form.hours) * Number(form.rate) * 100) / 100 : 0);
  const { data: suggestion } = useQuery({
    queryKey: ["/service-fees/suggest", form.incomeType, amount, form.payeeType],
    queryFn: () => call<{ withholdingTax: number; nhiSupplement: number; netAmount: number; notes: string[] }>(`service-fees/suggest?incomeType=${form.incomeType}&amount=${amount}&payeeType=${form.payeeType}`),
    enabled: open && amount > 0,
  });
  const tax = form.withholdingTax !== "" ? Number(form.withholdingTax) : (suggestion?.withholdingTax ?? 0);
  const nhi = form.nhiSupplement !== "" ? Number(form.nhiSupplement) : (suggestion?.nhiSupplement ?? 0);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/service-fees"] });
    queryClient.invalidateQueries({ queryKey: ["/service-fees/annual-summary"] });
  };

  const pickOrder = (orderId: string) => {
    const order = (orders as any[]).find(o => String(o.id) === orderId);
    setForm(f => ({ ...f, salesOrderId: orderId, projectId: order?.projectId ? String(order.projectId) : f.projectId, rate: f.rate || (order?.teacherFeePerSession ? String(order.teacherFeePerSession) : "") }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const created = await call<Fee>("service-fees", {
        method: "POST",
        body: JSON.stringify({
          payeeType: form.payeeType,
          ...(form.payeeType === "teacher" ? { teacherId: Number(form.payeeId) } : { employeeId: Number(form.payeeId) }),
          salesOrderId: form.salesOrderId ? Number(form.salesOrderId) : undefined,
          projectId: Number(form.projectId), serviceDate: form.serviceDate, description: form.description,
          hours: form.hours, rate: form.rate, amount, incomeType: form.incomeType,
          withholdingTax: form.withholdingTax, nhiSupplement: form.nhiSupplement,
        }),
      });
      toast({ title: "已登錄服務費", description: `${created.feeNumber}，已計入專案成本` });
      setOpen(false); setForm(emptyForm); refresh();
    } catch (e: any) {
      toast({ title: "登錄失敗", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const pay = async (choice: PayAccountChoice) => {
    if (!paying) return;
    try {
      await call(`service-fees/${paying.id}/pay`, { method: "POST", body: JSON.stringify({ cashAccountId: choice.cashAccountId }) });
      toast({ title: "已付款並入帳" });
      setPaying(null); refresh();
    } catch (e: any) { toast({ title: "付款失敗", description: e?.message, variant: "destructive" }); }
  };

  const voidFee = async (fee: Fee) => {
    const reason = window.prompt(`作廢 ${fee.feeNumber}（${fee.payeeName} ${money(fee.amount)}）？\n系統會開沖銷分錄，這筆成本會從專案扣回。\n\n請輸入作廢原因：`);
    if (!reason || !reason.trim()) return;
    try {
      await call(`service-fees/${fee.id}/void`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      toast({ title: "已作廢" }); refresh();
    } catch (e: any) { toast({ title: "作廢失敗", description: e?.message, variant: "destructive" }); }
  };

  const exportCsv = () => {
    if (!summary) return;
    const header = ["對象", "編號", "身分證字號", "戶籍地址", "所得類別", "給付次數", "給付總額", "扣繳稅額", "補充保費", "實付金額", "同年度薪資", "尚未付款"];
    const lines = summary.rows.map(r => [r.payeeName, r.payeeCode, r.idNumber, r.address, r.incomeTypeLabel, r.count, r.gross, r.withholdingTax, r.nhiSupplement, r.net, r.salaryGross, r.unpaid]);
    const csv = [header, ...lines].map(row => row.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${summary.year}年度所得彙總.csv`; link.click();
    URL.revokeObjectURL(url);
  };

  const payees = form.payeeType === "teacher"
    ? (teachers as any[]).filter(t => t.status !== "Inactive").map(t => ({ id: t.id, label: `${t.teacherId} ${t.name}` }))
    : (employees as any[]).filter(e => e.status === "Active").map(e => ({ id: e.id, label: `${e.employeeId} ${e.firstName}${e.lastName}` }));
  const yearTotals = useMemo(() => {
    const live = (fees || []).filter(f => f.status !== "Voided");
    return { amount: live.reduce((s, f) => s + f.amount, 0), unpaid: live.filter(f => f.status === "Confirmed").reduce((s, f) => s + f.netAmount, 0) };
  }, [fees]);

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="講師與服務費" description="登錄課程、活動的講師鐘點費與員工授課費，計入專案成本並彙總年度所得"
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />登錄服務費</Button>} />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={tab === "list" ? "default" : "outline"} onClick={() => setTab("list")}>服務費明細</Button>
        <Button size="sm" variant={tab === "annual" ? "default" : "outline"} onClick={() => setTab("annual")}>年度所得彙總</Button>
        <Input type="number" inputMode="numeric" className="w-28" value={year} onChange={e => setYear(Number(e.target.value) || new Date().getFullYear())} aria-label="年度" />
      </div>

      {tab === "list" ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{year} 年服務費合計</div><div className="text-xl font-bold mt-1">{money(yearTotals.amount)}</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">尚未付款（實付）</div><div className="text-xl font-bold mt-1">{money(yearTotals.unpaid)}</div></CardContent></Card>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <DataTable layoutId="service-fees-list"
                isLoading={isLoading}
                data={fees}
                emptyMessage="這一年還沒有登錄服務費"
                columns={[
                  { header: "對象", accessor: (f: Fee) => <div><span className="font-medium">{f.payeeName}</span><span className="ml-2 text-xs text-muted-foreground">{f.payeeType === "teacher" ? "講師" : "員工"}</span></div> },
                  { header: "日期", accessor: "serviceDate" },
                  { header: "專案／訂單", accessor: (f: Fee) => [f.projectName, f.orderNumber].filter(Boolean).join("・") || "—" },
                  { header: "金額", accessor: (f: Fee) => money(f.amount) },
                  { header: "代扣", accessor: (f: Fee) => f.withholdingTax + f.nhiSupplement > 0 ? `稅 ${money(f.withholdingTax)}・健保 ${money(f.nhiSupplement)}` : "—" },
                  { header: "實付", accessor: (f: Fee) => <span className="font-semibold">{money(f.netAmount)}</span> },
                  { header: "所得類別", accessor: (f: Fee) => f.incomeTypeLabel, className: "hidden lg:table-cell" },
                  { header: "狀態", accessor: (f: Fee) => <Badge variant={f.status === "Paid" ? "default" : f.status === "Voided" ? "outline" : "secondary"}>{STATUS[f.status] || f.status}</Badge> },
                  {
                    header: "操作",
                    accessor: (f: Fee) => f.status === "Voided" ? null : (
                      <div className="flex gap-1.5">
                        {f.status === "Confirmed" && canPay && <Button size="sm" className="h-8" onClick={() => setPaying(f)}><Banknote className="h-3.5 w-3.5 mr-1" />付款</Button>}
                        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => voidFee(f)}><Ban className="h-3.5 w-3.5 mr-1" />作廢</Button>
                      </div>
                    ),
                  },
                ]}
              />
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
              <div className="text-sm text-muted-foreground">
                依實際付款日歸屬年度，同一個人同一種所得合成一列，可以匯出給會計師辦理扣繳憑單申報。員工的列會另外帶出同年度已發放的薪資。
                {summary && summary.missingIdNumber.length > 0 && <span className="block mt-1 text-amber-600 dark:text-amber-400">還沒填身分證字號：{summary.missingIdNumber.join("、")}（請到「老師管理」補上）</span>}
              </div>
              <Button variant="outline" onClick={exportCsv} disabled={!summary || summary.rows.length === 0} className="shrink-0"><Download className="h-4 w-4 mr-1" />匯出 CSV</Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <DataTable layoutId="service-fees-summary"
                isLoading={summaryLoading}
                data={summary?.rows.map((r, i) => ({ ...r, id: i + 1 }))}
                defaultPageSize={0}
                emptyMessage="這一年沒有已付款的服務費"
                columns={[
                  { header: "對象", accessor: (r: any) => <div><span className="font-medium">{r.payeeName}</span><span className="ml-2 text-xs text-muted-foreground">{r.payeeCode}</span></div> },
                  { header: "所得類別", accessor: "incomeTypeLabel" },
                  { header: "次數", accessor: (r: any) => `${r.count} 次` },
                  { header: "給付總額", accessor: (r: any) => money(r.gross) },
                  { header: "扣繳稅額", accessor: (r: any) => money(r.withholdingTax) },
                  { header: "補充保費", accessor: (r: any) => money(r.nhiSupplement) },
                  { header: "實付", accessor: (r: any) => money(r.net) },
                  { header: "同年度薪資", accessor: (r: any) => r.salaryGross > 0 ? `${money(r.salaryGross)}（合計 ${money(r.salaryGross + r.gross)}）` : "—" },
                  { header: "尚未付款", accessor: (r: any) => r.unpaid > 0 ? <span className="text-amber-600 dark:text-amber-400">{money(r.unpaid)}</span> : "—" },
                ]}
              />
            </CardContent>
          </Card>
          {summary && summary.rows.length > 0 && (
            <p className="text-sm text-muted-foreground">合計：給付 {money(summary.totals.gross)}、扣繳稅額 {money(summary.totals.withholdingTax)}、補充保費 {money(summary.totals.nhiSupplement)}、實付 {money(summary.totals.net)}</p>
          )}
        </>
      )}

      <DocWindow
        open={open}
        onClose={() => setOpen(false)}
        name="登錄服務費"
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={save} disabled={saving || !form.payeeId || !form.projectId || !form.serviceDate || amount <= 0}>{saving ? "處理中…" : "登錄"}</Button>
        </>}
      >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[["teacher", "外聘講師"], ["employee", "公司員工"]].map(([value, label]) => (
                <Button key={value} type="button" variant={form.payeeType === value ? "default" : "outline"} onClick={() => setForm({ ...form, payeeType: value, payeeId: "" })}>{label}</Button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>{form.payeeType === "teacher" ? "講師" : "員工"} *</Label>
              <select className={selectClass} value={form.payeeId} onChange={e => setForm({ ...form, payeeId: e.target.value })}>
                <option value="">請選擇</option>
                {payees.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>銷貨單（選填）</Label>
                <select className={selectClass} value={form.salesOrderId} onChange={e => pickOrder(e.target.value)}>
                  <option value="">不指定</option>
                  {(orders as any[]).filter(o => o.status !== "Cancelled").map(o => <option key={o.id} value={o.id}>{o.orderNumber} {o.customerName || ""}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>專案 *</Label>
                <select className={selectClass} value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })}>
                  <option value="">請選擇專案</option>
                  {selectableProjects(projects as any[], form.projectId).map(p => <option key={p.id} value={p.id}>{projectPickerLabel(p)}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>服務日期 *</Label><Input type="date" value={form.serviceDate} onChange={e => setForm({ ...form, serviceDate: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>說明</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="例如：11 月週六班 4 堂" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>時數／堂數</Label><Input type="number" inputMode="decimal" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value, amount: "" })} /></div>
              <div className="space-y-1.5"><Label>每時（堂）費用</Label><Input type="number" inputMode="decimal" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value, amount: "" })} /></div>
              <div className="space-y-1.5"><Label>金額 *</Label><Input type="number" inputMode="decimal" value={form.amount || (amount > 0 ? String(amount) : "")} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>所得類別</Label>
              <select className={selectClass} value={form.incomeType} onChange={e => setForm({ ...form, incomeType: e.target.value, withholdingTax: "", nhiSupplement: "" })}>
                <option value="50">薪資（授課鐘點費、兼職）</option>
                <option value="9B">稿費及講演鐘點費</option>
                <option value="9A">執行業務所得</option>
              </select>
              <p className="text-xs text-muted-foreground">開班授課的鐘點費屬於薪資；一次性的專題演講屬於講演鐘點費。</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>代扣所得稅</Label><Input type="number" inputMode="numeric" value={form.withholdingTax} placeholder={String(suggestion?.withholdingTax ?? 0)} onChange={e => setForm({ ...form, withholdingTax: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>代扣補充保費</Label><Input type="number" inputMode="numeric" value={form.nhiSupplement} placeholder={String(suggestion?.nhiSupplement ?? 0)} onChange={e => setForm({ ...form, nhiSupplement: e.target.value })} /></div>
            </div>
            {amount > 0 && (
              <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
                <div className="flex justify-between font-semibold"><span>實付金額</span><span>{money(amount - tax - nhi)}</span></div>
                {suggestion?.notes.map(note => <div key={note} className="text-xs text-muted-foreground">・{note}</div>)}
                <div className="text-xs text-muted-foreground">代扣金額是系統依一般情況試算，留空就採用試算值；非居住者或特殊情況請依會計師指示修改。</div>
              </div>
            )}
          </div>
      </DocWindow>

      <PayAccountDialog
        open={!!paying}
        onOpenChange={(o) => { if (!o) setPaying(null); }}
        title="支付服務費"
        summary={paying ? <>{paying.feeNumber} {paying.payeeName}，實付 <span className="font-semibold text-foreground">{money(paying.netAmount)}</span>{paying.withholdingTax + paying.nhiSupplement > 0 ? `（已扣稅 ${money(paying.withholdingTax)}、補充保費 ${money(paying.nhiSupplement)}）` : ""}。</> : null}
        onConfirm={pay}
      />
    </div>
  );
}
