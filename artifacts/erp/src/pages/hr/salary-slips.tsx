import { useState, useEffect } from "react";
import { payrollApi, type SalarySlip } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Trash2, CheckCircle, FileText, Banknote } from "lucide-react";
import { PayAccountDialog, type PayAccountChoice } from "@/components/shared/pay-account-dialog";
import { SalarySlipDetailDialog } from "@/components/hr/salary-slip-detail";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useAutoReloadKey } from "@/lib/auto-refresh";

const statusMap: Record<string, string> = { draft: "草稿", confirmed: "已確認", paid: "已發放" };
const statusColor: Record<string, "default" | "secondary" | "outline"> = { draft: "secondary", confirmed: "outline", paid: "default" };
const fmt = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString()}`;

// 狀態會連動入帳，只能逐筆確認、發放
const salarySlipBatchFields: BatchField[] = [];

export default function SalarySlipsPage() {
  const reloadKey = useAutoReloadKey();
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState("");
  const [slips, setSlips] = useState<SalarySlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailSlip, setDetailSlip] = useState<SalarySlip | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = { year: Number(year) };
      if (month && month !== "all") params.month = Number(month);
      const data = await payrollApi.listSalarySlips(params);
      setSlips(data);
    } catch { setSlips([]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [year, month, reloadKey]);

  const handleConfirm = async (id: number) => {
    try {
      await payrollApi.updateSlipStatus(id, "confirmed");
    } catch (error) {
      alert(error instanceof Error ? error.message : "確認失敗");
    }
    load();
  };

  // 發放：選從哪個帳戶付薪水，系統同時產生薪資分錄
  const [payingSlip, setPayingSlip] = useState<SalarySlip | null>(null);
  const handlePay = async (choice: PayAccountChoice) => {
    if (!payingSlip) return;
    try {
      await payrollApi.updateSlipStatus(payingSlip.id, "paid", choice.cashAccountId);
      setPayingSlip(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "發放失敗");
    }
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("確定刪除此薪資單？")) return;
    try {
      await payrollApi.deleteSlip(id);
    } catch (error) {
      // 只有草稿可以刪；已確認的要先退回草稿，已發放的已入帳不能刪
      alert(error instanceof Error ? error.message : "刪除失敗");
    }
    load();
  };

  const batch = useBatchSelection(slips);

  return (
    <div className="space-y-6">
      <PageHeader title="薪資單列表" description="檢視與管理每月薪資單" />

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="薪資單"
          entityEndpoint="salary-slips"
          ids={batch.ids}
          batchFields={salarySlipBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => load()}
        />
      )}

      <div className="flex gap-4 flex-wrap">
        <div>
          <label className="text-sm font-medium mb-1 block">年度</label>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026].map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">月份</label>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-32"><SelectValue placeholder="全部" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              {Array.from({ length: 12 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>{i + 1} 月</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="md:hidden space-y-3">
        {loading && <Card><CardContent className="p-6 text-center text-muted-foreground">載入中...</CardContent></Card>}
        {!loading && slips.length === 0 && <Card><CardContent className="p-6 text-center text-muted-foreground">尚無薪資單</CardContent></Card>}
        {!loading && slips.map((r) => (
          <Card key={r.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={batch.selectedIds.has(r.id)}
                    onChange={() => batch.toggle(r.id)}
                  />
                  <div>
                    <div className="font-medium">{r.employeeName || `ID: ${r.employeeId}`}</div>
                    <div className="text-xs text-muted-foreground">{r.year}/{String(r.month).padStart(2, "0")}</div>
                  </div>
                </div>
                <Badge variant={statusColor[r.status] || "secondary"}>{statusMap[r.status] || r.status}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="text-muted-foreground">應發</div><div className="text-right font-mono">{fmt(r.grossSalary)}</div>
                {r.overtimePay > 0 && <><div className="text-muted-foreground">加班費</div><div className="text-right font-mono">{fmt(r.overtimePay)}</div></>}
                <div className="text-muted-foreground">實發</div><div className="text-right font-mono font-semibold text-green-600">{fmt(r.netSalary)}</div>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Button variant="outline" size="sm" className="h-8" onClick={() => { setDetailSlip(r); setDetailOpen(true); }}>
                  <FileText className="h-3.5 w-3.5 mr-1 text-blue-600" />明細
                </Button>
                {r.status === "draft" && (
                  <Button variant="outline" size="sm" className="h-8 text-green-700 border-green-300" onClick={() => handleConfirm(r.id)}>
                    <CheckCircle className="h-3.5 w-3.5 mr-1" />確認
                  </Button>
                )}
                {r.status === "confirmed" && (
                  <Button size="sm" className="h-8" onClick={() => setPayingSlip(r)}>
                    <Banknote className="h-3.5 w-3.5 mr-1" />發放
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-8 text-red-500" onClick={() => handleDelete(r.id)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />刪除
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={loading}
            data={slips}
            emptyMessage="尚無薪資單"
            columns={[
              {
                header: () => <CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} />,
                accessor: (r) => <CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} />,
                className: "w-10 px-2",
              },
              { header: "員工", accessor: (r) => r.employeeName || `ID: ${r.employeeId}` },
              { header: "年/月", accessor: (r) => `${r.year}/${String(r.month).padStart(2, "0")}` },
              {
                header: "出勤摘要",
                accessor: (r) => r.attendanceSummary ? (
                  <span className="text-xs text-gray-600">
                    出勤{r.attendanceSummary.presentDays}天
                    {r.attendanceSummary.lateCount > 0 ? ` · 遲到${r.attendanceSummary.lateCount}次` : ""}
                    {r.attendanceSummary.absentDays > 0 ? ` · 缺勤${r.attendanceSummary.absentDays}天` : ""}
                    {r.attendanceSummary.totalOvertimeHours > 0 ? ` · 加班${r.attendanceSummary.totalOvertimeHours}h` : ""}
                  </span>
                ) : <span className="text-xs text-gray-400">—</span>,
                className: "hidden lg:table-cell",
              },
              { header: "加班費", accessor: (r) => fmt(r.overtimePay), className: "text-right font-mono hidden md:table-cell" },
              { header: "應發", accessor: (r) => fmt(r.grossSalary), className: "text-right font-mono" },
              { header: "勞保扣繳", accessor: (r) => fmt(r.laborInsuranceEmployee), className: "text-right font-mono hidden md:table-cell" },
              { header: "健保扣繳", accessor: (r) => fmt(r.healthInsuranceEmployee), className: "text-right font-mono hidden md:table-cell" },
              { header: "實發", accessor: (r) => fmt(r.netSalary), className: "text-right font-mono font-semibold text-green-600" },
              {
                header: "狀態",
                accessor: (r) => <Badge variant={statusColor[r.status] || "secondary"}>{statusMap[r.status] || r.status}</Badge>
              },
              {
                header: "操作",
                accessor: (r) => (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => { setDetailSlip(r); setDetailOpen(true); }} title="檢視明細 / 列印">
                      <FileText className="h-4 w-4 text-blue-600" />
                    </Button>
                    {r.status === "draft" && (
                      <Button variant="ghost" size="icon" onClick={() => handleConfirm(r.id)} title="確認">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      </Button>
                    )}
                    {r.status === "confirmed" && (
                      <Button variant="outline" size="sm" className="h-8" onClick={() => setPayingSlip(r)} title="發放薪資並入帳">
                        <Banknote className="h-3.5 w-3.5 mr-1" />發放
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)} title="刪除">
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <SalarySlipDetailDialog slip={detailSlip} open={detailOpen} onOpenChange={setDetailOpen} />
      <PayAccountDialog
        open={!!payingSlip}
        onOpenChange={(o) => { if (!o) setPayingSlip(null); }}
        title="發放薪資"
        confirmLabel="確認發放"
        summary={payingSlip ? <>{payingSlip.year} 年 {payingSlip.month} 月薪資，實發 <span className="font-semibold text-foreground">{fmt(Number(payingSlip.netSalary) || 0)}</span>。發放後會自動產生薪資分錄，而且不能再修改。</> : null}
        onConfirm={handlePay}
      />
    </div>
  );
}
