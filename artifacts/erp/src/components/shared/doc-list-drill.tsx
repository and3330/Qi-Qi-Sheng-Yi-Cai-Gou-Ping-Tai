import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { call, money } from "@/lib/call";
import { payrollApi } from "@/lib/api";
import { DocWindow, DocStatus, statusTone } from "@/components/shared/doc-window";
import { SalarySlipDetailDialog } from "@/components/hr/salary-slip-detail";

/**
 * 點數字看單據（全系統共用，老闆 2026-11-17）：營運報表上從單據加總出來的數字
 * （銷售分析、採購分析、應收應付帳齡、庫存數量、薪資彙總、出勤彙總），點下去開這個視窗，列出算進去的每一張單；
 * 點任何一列就開那張單。分錄算出來的數字用 account-drill 的 AccountDrillDialog。
 *
 * 用法：數字用 <DrillAmount onClick={() => setDocs({...})}> 包起來，頁面最下面放
 *   <DocListDrillDialog target={docs} onClose={() => setDocs(null)} />
 */
export type SalaryField = "gross" | "net" | "deductions" | "laborInsEmployer" | "healthInsEmployer" | "pensionEmployer" | "employer";
export type AttendanceMetric = "present" | "absent" | "late" | "lateMinutes" | "earlyLeave" | "hours" | "overtime" | "employees";
export type DocListTarget =
  | { kind: "sales-orders"; title: string; note?: string; startDate?: string; endDate?: string; customerId?: number; salespersonId?: number; month?: string; itemName?: string }
  | { kind: "purchase-orders"; title: string; note?: string; startDate?: string; endDate?: string; supplierId?: number; month?: string; itemName?: string }
  | { kind: "open-invoices"; title: string; note?: string; type: "Sales" | "Purchase"; partyId?: number; bucket?: "current" | "d30" | "d60" | "d90" | "d120" }
  | { kind: "stock-entries"; title: string; note?: string; itemId: number; warehouseId?: number }
  /** 薪資彙總：year、month 跟報表查詢時一樣（month 不給＝全年）；field 是點的那個金額 */
  | { kind: "salary-slips"; title: string; note?: string; year?: number; month?: number; field: SalaryField }
  /** 出勤彙總：employeeId 是員工的資料編號（不給＝全部員工）；metric 是點的那個數字 */
  | { kind: "attendance"; title: string; note?: string; year: number; month: number; employeeId?: number; metric: AttendanceMetric };

/** 薪資單沒有自己的網址，用這幾個值把它讀出來開視窗 */
export interface SlipRef { id: number; employeeId: number; year: number; month: number }

interface Row { id: number; number: string; date: string | null; party: string | null; status: string | null; amount: number | null; quantity?: number | null; note?: string | null; href: string | null; slip?: Omit<SlipRef, "id"> }
interface Result { count: number; total: number; quantity: number | null; truncated: boolean; rows: Row[] }

const STATUS: Record<string, string> = {
  Draft: "草稿", Confirmed: "已確認", "To Deliver": "待出貨", "To Receive": "待收貨", Completed: "已完成", Cancelled: "已取消",
  Unpaid: "未付款", "Partially Paid": "部分付款", Overdue: "逾期", Submitted: "已送出", Paid: "已付款", WrittenOff: "已沖呆帳",
  draft: "草稿", confirmed: "已確認", paid: "已發放",
  Present: "出勤", Late: "遲到", Absent: "缺勤", "On Leave": "請假", "Early Leave": "早退", Active: "在職", Resigned: "已離職",
};
interface Head { date: string; number: string; party: string; amount: string | null; quantity: string }
const HEAD: Record<DocListTarget["kind"], Head> = {
  "sales-orders": { date: "日期", number: "銷貨單號", party: "客戶", amount: "金額", quantity: "數量" },
  "purchase-orders": { date: "日期", number: "採購單號", party: "供應商", amount: "金額", quantity: "數量" },
  "open-invoices": { date: "日期", number: "發票", party: "對象", amount: "未收付", quantity: "數量" },
  "stock-entries": { date: "日期", number: "來源", party: "倉庫", amount: "金額", quantity: "數量" },
  "salary-slips": { date: "期間", number: "員工編號", party: "姓名", amount: "金額", quantity: "數量" },
  "attendance": { date: "日期", number: "員工編號", party: "姓名", amount: null, quantity: "數量" },
};
const SALARY_LABEL: Record<SalaryField, string> = { gross: "應發", net: "實發", deductions: "應扣", laborInsEmployer: "雇主勞保", healthInsEmployer: "雇主健保", pensionEmployer: "雇主勞退", employer: "雇主負擔" };
const ATTENDANCE_UNIT: Record<AttendanceMetric, string> = { present: "天數", absent: "天數", late: "次數", earlyLeave: "次數", lateMinutes: "分鐘", hours: "時數", overtime: "時數", employees: "人數" };

function headOf(t: DocListTarget | null): Head {
  if (!t) return HEAD["sales-orders"];
  if (t.kind === "salary-slips") return { ...HEAD[t.kind], amount: SALARY_LABEL[t.field] };
  if (t.kind === "attendance") return { ...HEAD[t.kind], quantity: ATTENDANCE_UNIT[t.metric], date: t.metric === "employees" ? "到職日" : "日期" };
  return HEAD[t.kind];
}

function periodOf(t: DocListTarget): string {
  if (t.kind === "salary-slips") return t.year ? `${t.year} 年${t.month ? ` ${t.month} 月` : "全年"}` : "";
  if (t.kind === "attendance") return `${t.year} 年 ${t.month} 月`;
  if ("startDate" in t && (t.startDate || t.endDate)) return `${t.startDate ?? "最早"} ～ ${t.endDate ?? "今天"}`;
  return "";
}

function hintOf(t: DocListTarget): string {
  if (t.kind === "stock-entries") return "這個品項的每一筆進出。";
  if (t.kind === "salary-slips") return "點任何一列可以開那張薪資單。";
  if (t.kind === "attendance") return t.metric === "employees" ? "算進去的每一位員工。" : t.metric === "absent" ? "缺勤的每一天；沒打卡也沒請假的日子沒有打卡紀錄。" : "算進去的每一筆打卡紀錄。";
  return "點任何一列可以開那張單。";
}

function queryOf(t: DocListTarget): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(t)) {
    if (k === "title" || k === "note" || v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  return p.toString();
}

/** 開一張薪資單的視窗（薪資彙總的個人明細、薪資單明細清單共用）。slip 給 null 就不開 */
export function SalarySlipOpener({ slip, onClose }: { slip: SlipRef | null; onClose: () => void }) {
  const { data, isError } = useQuery({
    queryKey: ["/salary-slips", slip?.employeeId, slip?.year, slip?.month],
    queryFn: () => payrollApi.listSalarySlips({ employeeId: slip!.employeeId, year: slip!.year, month: slip!.month }),
    enabled: !!slip,
    staleTime: 15_000,
  });
  const found = slip && data ? data.find(s => s.id === slip.id) ?? null : null;
  const failed = !!slip && (isError || (!!data && !found));
  useEffect(() => { if (failed) { alert("這張薪資單讀不到，可能已經被刪除，或你沒有看薪資單的權限。"); onClose(); } }, [failed]);
  return <SalarySlipDetailDialog slip={found} open={!!found} onOpenChange={o => { if (!o) onClose(); }} />;
}

export function DocListDrillDialog({ target, onClose }: { target: DocListTarget | null; onClose: () => void }) {
  const [, navigate] = useLocation();
  const [slip, setSlip] = useState<SlipRef | null>(null);
  const query = target ? queryOf(target) : "";
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["/report-drill/documents", query],
    queryFn: () => call<Result>(`report-drill/documents?${query}`),
    enabled: !!target,
    staleTime: 15_000,
  });
  const head = headOf(target);
  const showQty = !!data?.rows.some(r => r.quantity != null);
  const showNote = !!data?.rows.some(r => r.note);
  const period = target ? periodOf(target) : "";
  const canOpen = (r: Row) => !!r.href || !!r.slip;
  const open = (r: Row) => {
    if (r.slip) setSlip({ id: r.id, ...r.slip });
    else if (r.href) { onClose(); navigate(r.href); }
  };

  return (
    <>
      <DocWindow
        open={!!target} onClose={onClose} wide name="明細" layoutKey="單據明細" number={target?.title}
        description={target ? <>{[period, target.note].filter(Boolean).join("・")}{period || target.note ? "。" : ""}{hintOf(target)}</> : undefined}
        footer={<Button variant="outline" onClick={onClose}>關閉</Button>}
      >
        {isLoading ? <p className="text-muted-foreground">讀取中…</p>
          : isError ? <p className="text-destructive">{error instanceof Error ? error.message : "明細讀取失敗"}</p>
          : !data || data.rows.length === 0 ? <p className="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground">沒有符合的資料。</p>
          : (
            <div className="space-y-3" data-testid="doc-list-drill">
              <div className="flex flex-wrap gap-2">
                <div className="rounded-md border px-3 py-2"><p className="text-xs text-muted-foreground">筆數</p><p className="font-medium tabular-nums">{data.count.toLocaleString()} 筆</p></div>
                {data.quantity != null && <div className="rounded-md border px-3 py-2"><p className="text-xs text-muted-foreground">{head.quantity}合計</p><p className={head.amount ? "font-medium tabular-nums" : "text-base font-semibold tabular-nums"}>{data.quantity.toLocaleString()}</p></div>}
                {head.amount && <div className="rounded-md border px-3 py-2"><p className="text-xs text-muted-foreground">{head.amount}合計</p><p className="text-base font-semibold tabular-nums">{money(data.total)}</p></div>}
              </div>
              {data.truncated && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">筆數很多，下面只列出前 {data.rows.length} 筆（上面的合計是全部 {data.count.toLocaleString()} 筆）。把報表的期間縮短可以看到完整清單。</p>}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">{head.date}</th>
                      <th className="px-3 py-1.5 text-left font-medium">{head.number}</th>
                      <th className="px-3 py-1.5 text-left font-medium">{head.party}</th>
                      <th className="px-3 py-1.5 text-left font-medium">狀態</th>
                      {showNote && <th className="px-3 py-1.5 text-left font-medium">說明</th>}
                      {showQty && <th className="px-3 py-1.5 text-right font-medium">{head.quantity}</th>}
                      {head.amount && <th className="px-3 py-1.5 text-right font-medium">{head.amount}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(r => (
                      <tr key={r.id} className={canOpen(r) ? "cursor-pointer border-t hover:bg-muted/50" : "border-t"} onClick={() => open(r)} data-testid={`drill-doc-${r.id}`}>
                        <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{r.date}</td>
                        <td className={canOpen(r) ? "px-3 py-1.5 font-medium text-primary" : "px-3 py-1.5 font-medium"}>{r.number}</td>
                        <td className="px-3 py-1.5">{r.party}</td>
                        <td className="px-3 py-1.5">{r.status ? <DocStatus label={STATUS[r.status] ?? r.status} tone={statusTone(r.status)} /> : null}</td>
                        {showNote && <td className="px-3 py-1.5 text-muted-foreground">{r.note}</td>}
                        {showQty && <td className="px-3 py-1.5 text-right tabular-nums">{r.quantity?.toLocaleString()}</td>}
                        {head.amount && <td className="px-3 py-1.5 text-right tabular-nums">{r.amount == null ? "" : money(r.amount)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
      </DocWindow>
      <SalarySlipOpener slip={slip} onClose={() => setSlip(null)} />
    </>
  );
}
