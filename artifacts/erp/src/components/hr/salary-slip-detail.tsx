import { useRef } from "react";
import type { SalarySlip } from "@/lib/api";
import { DocWindow, DocStatus, statusTone } from "@/components/shared/doc-window";
import { RelatedDocs } from "@/components/shared/related-docs";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

const fmt = (n: number) => `$${n.toLocaleString()}`;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const statusMap: Record<string, string> = { draft: "草稿", confirmed: "已確認", paid: "已發放" };

function Row({ label, value, bold, negative }: { label: string; value: string; bold?: boolean; negative?: boolean }) {
  return (
    <div className={`flex justify-between py-1.5 text-sm ${bold ? "font-semibold" : ""}`}>
      <span className="text-gray-600">{label}</span>
      <span className={`font-mono ${negative ? "text-red-600" : ""} ${bold ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide border-b pb-1 mt-4 mb-1">{children}</div>;
}

export function SalarySlipDetailDialog({ slip, open, onOpenChange }: {
  slip: SalarySlip | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);

  if (!slip) return null;

  const handlePrint = () => {
    const content = printRef.current?.innerHTML;
    if (!content) return;
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) {
      alert("請允許彈出視窗以進行列印");
      return;
    }
    win.document.write(`<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8" />
<title>薪資條 ${slip.year}-${String(slip.month).padStart(2, "0")} ${esc(slip.employeeName || "")}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif; padding: 32px; color: #111; }
  .font-mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .flex { display: flex; } .justify-between { justify-content: space-between; }
  .py-1\\.5 { padding: 5px 0; } .text-sm { font-size: 13px; }
  .font-semibold { font-weight: 600; }
  .text-gray-600 { color: #4b5563; } .text-gray-500 { color: #6b7280; } .text-gray-400 { color: #9ca3af; }
  .text-red-600 { color: #dc2626; } .text-green-600 { color: #16a34a; }
  .text-xs { font-size: 11px; } .uppercase { text-transform: uppercase; } .tracking-wide { letter-spacing: .05em; }
  .border-b { border-bottom: 1px solid #e5e7eb; } .pb-1 { padding-bottom: 4px; }
  .mt-4 { margin-top: 16px; } .mb-1 { margin-bottom: 4px; }
  .slip-header { text-align: center; margin-bottom: 16px; }
  .slip-header h1 { font-size: 18px; margin-bottom: 4px; }
  .slip-header p { font-size: 13px; color: #6b7280; }
  .net-box { margin-top: 20px; padding: 12px 16px; border: 2px solid #111; display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; }
  .badge, button { display: none !important; }
  .print-only { display: block !important; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<div class="slip-header">
  <h1>薪資條</h1>
  <p>${slip.year} 年 ${slip.month} 月 · ${esc(slip.employeeName || `員工 ID: ${slip.employeeId}`)}${slip.employeeCode ? `（${esc(slip.employeeCode)}）` : ""}</p>
</div>
${content}
<script>window.onload = function(){ window.print(); };</script>
</body>
</html>`);
    win.document.close();
  };

  const att = slip.attendanceSummary;
  // 薪資項目明細；舊薪資單沒有明細時只顯示一行「其他津貼」
  const earningLines = (slip.components || []).filter(c => c.kind === "earning");
  const deductionLines = (slip.components || []).filter(c => c.kind === "deduction");

  return (
    <DocWindow
      open={open}
      onClose={() => onOpenChange(false)}
      name="薪資單"
      number={`${slip.year}/${String(slip.month).padStart(2, "0")}`}
      status={<DocStatus label={statusMap[slip.status] || slip.status} tone={statusTone(slip.status)} />}
      description={`${slip.employeeName || `員工 ID: ${slip.employeeId}`}${slip.employeeCode ? `（${slip.employeeCode}）` : ""}`}
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>關閉</Button>
        <Button onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-2" />
          列印 / 下載 PDF
        </Button>
      </>}
    >

        <div ref={printRef}>
          {att && (
            <>
              <SectionTitle>出勤摘要</SectionTitle>
              <Row label="應出勤天數" value={`${att.workingDays} 天`} />
              <Row label="實際出勤" value={`${att.presentDays} 天`} />
              {att.leaveDays > 0 && <Row label="請假" value={`${att.leaveDays} 天`} />}
              {att.absentDays > 0 && <Row label="缺勤" value={`${att.absentDays} 天`} negative />}
              {att.lateCount > 0 && <Row label="遲到" value={`${att.lateCount} 次（共 ${att.totalLateMinutes} 分鐘）`} />}
              {att.earlyLeaveCount > 0 && <Row label="早退" value={`${att.earlyLeaveCount} 次`} />}
              <Row label="總工時" value={`${att.totalWorkingHours} 小時`} />
              {att.totalOvertimeHours > 0 && <Row label="加班時數" value={`${att.totalOvertimeHours} 小時`} />}
            </>
          )}

          <SectionTitle>應發項目</SectionTitle>
          <Row label="本薪" value={fmt(slip.baseSalary)} />
          {slip.overtimePay > 0 && <Row label="加班費" value={fmt(slip.overtimePay)} />}
          {earningLines.length > 0
            ? earningLines.map((line, i) => <Row key={`e${i}`} label={line.name} value={fmt(line.amount)} />)
            : slip.otherAllowances > 0 && <Row label="其他津貼" value={fmt(slip.otherAllowances)} />}
          {slip.attendanceDeduction > 0 && <Row label="出勤扣款" value={`-${fmt(slip.attendanceDeduction)}`} negative />}
          <Row label="應發薪資" value={fmt(slip.grossSalary)} bold />

          <SectionTitle>員工扣繳項目</SectionTitle>
          <Row label={`勞保費（投保級距 ${fmt(slip.laborInsuranceBracket)}）`} value={`-${fmt(slip.laborInsuranceEmployee)}`} negative />
          <Row
            label={`健保費（投保級距 ${fmt(slip.healthInsuranceBracket)}${slip.healthInsuranceDependents > 0 ? `，眷屬 ${slip.healthInsuranceDependents} 人` : ""}）`}
            value={`-${fmt(slip.healthInsuranceEmployee)}`}
            negative
          />
          {slip.pensionEmployeeSelf > 0 && (
            <Row label={`勞退自提（${slip.pensionEmployeeSelfRate}%）`} value={`-${fmt(slip.pensionEmployeeSelf)}`} negative />
          )}
          {deductionLines.map((line, i) => <Row key={`d${i}`} label={line.name} value={`-${fmt(line.amount)}`} negative />)}
          <Row label="扣繳合計" value={`-${fmt(slip.totalDeductions)}`} bold negative />

          <SectionTitle>雇主負擔（不影響實發）</SectionTitle>
          <Row label="勞保費（雇主）" value={fmt(slip.laborInsuranceEmployer)} />
          <Row label="健保費（雇主）" value={fmt(slip.healthInsuranceEmployer)} />
          <Row label={`勞退提繳 6%（級距 ${fmt(slip.pensionBracket)}）`} value={fmt(slip.pensionEmployer)} />

          {slip.note && (
            <>
              <SectionTitle>備註</SectionTitle>
              <div className="text-sm text-gray-600 py-1.5">{slip.note}</div>
            </>
          )}

          <div className="net-box mt-5 p-3 border-2 border-gray-900 rounded flex justify-between text-base font-bold">
            <span>實發金額</span>
            <span className="font-mono text-green-600">{fmt(slip.netSalary)}</span>
          </div>
        </div>
        {slip && <RelatedDocs type="salary_slip" id={slip.id} />}
    </DocWindow>
  );
}
