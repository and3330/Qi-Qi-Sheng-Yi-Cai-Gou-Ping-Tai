import { useState, useEffect } from "react";
import { ProjectField } from "@/components/shared/project-field";
import { useListEmployees } from "@workspace/erp-api-client-react";
import { payrollApi, type SalaryCalcResult, type AttendanceBasis, type PayrollSettings, type BatchGenerateResult } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calculator, Save, DollarSign, CalendarCheck, Settings2, ChevronDown, Users } from "lucide-react";

import { LookupSelect } from "@/components/shared/lookup-select";
const fmt = (n: number) => `$${n.toLocaleString()}`;

export default function SalaryCalcPage() {
  const { data: employees } = useListEmployees();
  const now = new Date();
  const [employeeId, setEmployeeId] = useState("");
  const [year, setYear] = useState(String(now.getFullYear()));
  // 薪資成本歸屬的專案；選過會記住，下個月不用重選
  const [projectId, setProjectIdState] = useState<string>(() => {
    try { return localStorage.getItem("erp-payroll-project") || ""; } catch { return ""; }
  });
  const setProjectId = (value: string) => {
    setProjectIdState(value);
    try { localStorage.setItem("erp-payroll-project", value); } catch { /* 記不住也不影響使用 */ }
  };
  const PROJECT_REQUIRED = "請先選擇歸屬專案：薪資成本要記到專案上";
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [overtimePay, setOvertimePay] = useState("0");
  const [otherAllowances, setOtherAllowances] = useState("0");
  const [attendanceDeduction, setAttendanceDeduction] = useState("0");
  const [basis, setBasis] = useState<AttendanceBasis | null>(null);
  const [loadingBasis, setLoadingBasis] = useState(false);
  const [result, setResult] = useState<SalaryCalcResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 批次產生
  const [batchPreview, setBatchPreview] = useState<BatchGenerateResult | null>(null);
  const [batchResult, setBatchResult] = useState<BatchGenerateResult | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);

  // 設定
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const invalidateCalculation = () => {
    setResult(null);
    setMessage(null);
  };

  useEffect(() => {
    payrollApi.getPayrollSettings().then(setSettings).catch(() => {});
  }, []);

  const loadAttendance = async () => {
    if (!employeeId) return;
    invalidateCalculation();
    setLoadingBasis(true);
    try {
      const data = await payrollApi.attendanceBasis(Number(employeeId), Number(year), Number(month));
      setBasis(data);
      setOvertimePay(String(data.overtime.suggestedOvertimePay));
      setAttendanceDeduction(String(data.deductions.suggestedAttendanceDeduction));
      setMessage(null);
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setLoadingBasis(false);
    }
  };

  const handleCalc = async () => {
    if (!employeeId) return;
    try {
      const res = await payrollApi.calculateSalary({
        employeeId: Number(employeeId),
        year: Number(year),
        month: Number(month),
        overtimePay: Number(overtimePay),
        otherAllowances: Number(otherAllowances),
        attendanceDeduction: Number(attendanceDeduction),
      });
      setResult(res);
      setMessage(null);
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    }
  };

  const handleSave = async () => {
    if (!result) return;
    if (!projectId) { setMessage({ type: "error", text: PROJECT_REQUIRED }); return; }
    setSaving(true);
    try {
      await payrollApi.saveSalarySlip({
        ...result,
        projectId: Number(projectId),
        attendanceSummary: basis && basis.employeeId === result.employeeId ? basis.summary : null,
        status: "draft",
        note: null,
      } as any);
      setMessage({ type: "success", text: "薪資單已儲存！" });
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const loadBatchPreview = async () => {
    setBatchLoading(true);
    setBatchResult(null);
    try {
      const data = await payrollApi.batchGenerate({ year: Number(year), month: Number(month), dryRun: true });
      setBatchPreview(data);
      setMessage(null);
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBatchLoading(false);
    }
  };

  const confirmBatchGenerate = async () => {
    if (!projectId) { setMessage({ type: "error", text: PROJECT_REQUIRED }); return; }
    setBatchLoading(true);
    try {
      const data = await payrollApi.batchGenerate({ year: Number(year), month: Number(month), projectId: Number(projectId) });
      setBatchResult(data);
      setBatchPreview(null);
      setMessage({
        type: "success",
        text: `批次產生完成：成功 ${data.counts.success} 筆、跳過 ${data.counts.skipped} 筆、失敗 ${data.counts.failed} 筆`,
      });
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBatchLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const updated = await payrollApi.updatePayrollSettings({
        monthlyDivisor: Number(settings.monthlyDivisor),
        otRate1: settings.otRate1,
        otRate2: settings.otRate2,
        otThresholdHours: settings.otThresholdHours,
        lateDeductionEnabled: settings.lateDeductionEnabled,
        absenceDeductionEnabled: settings.absenceDeductionEnabled,
      } as any);
      setSettings(updated);
      setMessage({ type: "success", text: "設定已儲存，重新帶入出勤資料即可套用新費率。" });
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="薪資計算" description="依投保級距表與現行勞健保費率計算薪資" />

      <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2"><Settings2 className="h-4 w-4" /> 加班費率與扣款設定</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${settingsOpen ? "rotate-180" : ""}`} />
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {settings && (
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">時薪除數（月薪 ÷）</label>
                    <Input type="number" value={settings.monthlyDivisor}
                      onChange={(e) => setSettings({ ...settings, monthlyDivisor: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">前段加班倍率</label>
                    <Input type="number" step="0.01" value={settings.otRate1}
                      onChange={(e) => setSettings({ ...settings, otRate1: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">後段加班倍率</label>
                    <Input type="number" step="0.01" value={settings.otRate2}
                      onChange={(e) => setSettings({ ...settings, otRate2: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">前段時數上限（小時/日）</label>
                    <Input type="number" step="0.5" value={settings.otThresholdHours}
                      onChange={(e) => setSettings({ ...settings, otThresholdHours: e.target.value })} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={settings.lateDeductionEnabled}
                      onCheckedChange={(v) => setSettings({ ...settings, lateDeductionEnabled: v })} />
                    遲到扣款（遲到分鐘 × 時薪 ÷ 60）
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={settings.absenceDeductionEnabled}
                      onCheckedChange={(v) => setSettings({ ...settings, absenceDeductionEnabled: v })} />
                    缺勤扣款（缺勤天數 × 月薪 ÷ 30）
                  </label>
                </div>
                <Button size="sm" onClick={saveSettings} disabled={savingSettings}>
                  {savingSettings ? "儲存中..." : "儲存設定"}
                </Button>
              </CardContent>
            )}
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5" /> 計算參數</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">員工</label>
              <LookupSelect value={employeeId} onValueChange={(v) => { setEmployeeId(v); setBasis(null); invalidateCalculation(); }}>
                <SelectTrigger><SelectValue placeholder="選擇員工" /></SelectTrigger>
                <SelectContent>
                  {employees?.map((emp) => (
                    <SelectItem key={emp.id} value={String(emp.id)}>
                      {emp.firstName} {emp.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </LookupSelect>
            </div>
            <ProjectField value={projectId} onChange={setProjectId} />
            <div>
              <label className="text-sm font-medium mb-1 block">年度</label>
              <Input type="number" value={year} onChange={(e) => { setYear(e.target.value); setBasis(null); setBatchPreview(null); setBatchResult(null); invalidateCalculation(); }} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">月份</label>
              <Select value={month} onValueChange={(v) => { setMonth(v); setBasis(null); setBatchPreview(null); setBatchResult(null); invalidateCalculation(); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{i + 1} 月</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">加班費{basis ? "（可覆蓋）" : ""}</label>
              <Input type="number" value={overtimePay} onChange={(e) => { setOvertimePay(e.target.value); invalidateCalculation(); }} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">出勤扣款{basis ? "（可覆蓋）" : ""}</label>
              <Input type="number" value={attendanceDeduction} onChange={(e) => { setAttendanceDeduction(e.target.value); invalidateCalculation(); }} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">其他津貼（臨時）</label>
              <Input type="number" value={otherAllowances} onChange={(e) => { setOtherAllowances(e.target.value); invalidateCalculation(); }} />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">每月固定的津貼與扣款請到「薪資項目」設定，計算時會自動帶入；這裡的「其他津貼」只填這個月臨時多給的金額。</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={loadAttendance} disabled={!employeeId || loadingBasis}>
              <CalendarCheck className="h-4 w-4 mr-2" /> {loadingBasis ? "載入中..." : "帶入出勤資料"}
            </Button>
            <Button onClick={handleCalc} disabled={!employeeId}><Calculator className="h-4 w-4 mr-2" /> 計算薪資</Button>
            <Button variant="secondary" onClick={loadBatchPreview} disabled={batchLoading}>
              <Users className="h-4 w-4 mr-2" /> {batchLoading ? "處理中..." : "批次產生（全公司）"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {(batchPreview || batchResult) && (() => {
        const data = (batchPreview || batchResult)!;
        const isPreview = Boolean(batchPreview);
        const badge = (status: string, reason?: string) => {
          if (status === "preview") return <Badge variant="outline" className="border-blue-300 text-blue-700">待建立</Badge>;
          if (status === "created") return <Badge className="bg-green-600">已建立</Badge>;
          if (status === "skipped") return <Badge variant="secondary" title={reason}>跳過</Badge>;
          return <Badge variant="destructive" title={reason}>失敗</Badge>;
        };
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" /> 批次產生 — {data.year} 年 {data.month} 月{isPreview ? "（預覽）" : "（結果）"}
                </span>
                <span className="text-sm font-normal text-gray-500">
                  {isPreview
                    ? `可建立 ${data.counts.success} 筆、跳過 ${data.counts.skipped} 筆、失敗 ${data.counts.failed} 筆`
                    : `成功 ${data.counts.success} 筆、跳過 ${data.counts.skipped} 筆、失敗 ${data.counts.failed} 筆`}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="py-2 pr-2">員工</th>
                      <th className="py-2 pr-2">狀態</th>
                      <th className="py-2 pr-2 text-right">加班費</th>
                      <th className="py-2 pr-2 text-right">出勤扣款</th>
                      <th className="py-2 pr-2 text-right">應發合計</th>
                      <th className="py-2 text-right">實發金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.results.map((r) => (
                      <tr key={r.employeeId} className="border-b last:border-0">
                        <td className="py-2 pr-2">{r.employeeName}</td>
                        <td className="py-2 pr-2">
                          {badge(r.status, r.reason)}
                          {r.reason && <span className="ml-2 text-xs text-gray-400">{r.reason}</span>}
                        </td>
                        <td className="py-2 pr-2 text-right font-mono">{r.overtimePay !== undefined ? fmt(r.overtimePay) : "—"}</td>
                        <td className="py-2 pr-2 text-right font-mono">{r.attendanceDeduction !== undefined ? (r.attendanceDeduction > 0 ? `-${fmt(r.attendanceDeduction)}` : fmt(0)) : "—"}</td>
                        <td className="py-2 pr-2 text-right font-mono">{r.grossSalary !== undefined ? fmt(r.grossSalary) : "—"}</td>
                        <td className="py-2 text-right font-mono font-semibold">{r.netSalary !== undefined ? fmt(r.netSalary) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {isPreview && (
                <div className="mt-4 flex items-center gap-3">
                  <Button onClick={confirmBatchGenerate} disabled={batchLoading || data.counts.success === 0}>
                    <Save className="h-4 w-4 mr-2" /> {batchLoading ? "建立中..." : `確認建立 ${data.counts.success} 筆草稿薪資單`}
                  </Button>
                  <Button variant="outline" onClick={() => setBatchPreview(null)} disabled={batchLoading}>取消</Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {basis && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarCheck className="h-4 w-4" /> {basis.year} 年 {basis.month} 月出勤摘要
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 text-sm">
              <div className="p-2 rounded bg-gray-50"><div className="text-gray-500 text-xs">應出勤天數</div><div className="font-semibold">{basis.summary.workingDays} 天</div></div>
              <div className="p-2 rounded bg-green-50"><div className="text-gray-500 text-xs">出勤天數</div><div className="font-semibold text-green-700">{basis.summary.presentDays} 天</div></div>
              <div className="p-2 rounded bg-yellow-50"><div className="text-gray-500 text-xs">遲到</div><div className="font-semibold text-yellow-700">{basis.summary.lateCount} 次 / {basis.summary.totalLateMinutes} 分</div></div>
              <div className="p-2 rounded bg-red-50"><div className="text-gray-500 text-xs">缺勤</div><div className="font-semibold text-red-700">{basis.summary.absentDays} 天</div></div>
              <div className="p-2 rounded bg-blue-50"><div className="text-gray-500 text-xs">請假</div><div className="font-semibold text-blue-700">{basis.summary.leaveDays} 天</div></div>
              <div className="p-2 rounded bg-purple-50"><div className="text-gray-500 text-xs">加班時數</div><div className="font-semibold text-purple-700">{basis.summary.totalOvertimeHours} 小時</div></div>
              <div className="p-2 rounded bg-gray-50"><div className="text-gray-500 text-xs">總工時</div><div className="font-semibold">{basis.summary.totalWorkingHours} 小時</div></div>
              <div className="p-2 rounded bg-gray-50"><div className="text-gray-500 text-xs">時薪</div><div className="font-semibold">{fmt(basis.hourlyRate)}</div></div>
            </div>
            <div className="mt-3 text-xs text-gray-500 space-y-1">
              <div>
                建議加班費 {fmt(basis.overtime.suggestedOvertimePay)}：
                前段 {basis.overtime.hoursAtRate1} 小時 × {basis.settings.otRate1} 倍
                {basis.overtime.hoursAtRate2 > 0 ? ` + 後段 ${basis.overtime.hoursAtRate2} 小時 × ${basis.settings.otRate2} 倍` : ""}
                （時薪 = 月薪 ÷ {basis.settings.monthlyDivisor}）
              </div>
              <div>
                建議出勤扣款 {fmt(basis.deductions.suggestedAttendanceDeduction)}：
                遲到扣款 {basis.settings.lateDeductionEnabled ? fmt(basis.deductions.lateDeduction) : "未啟用"}、
                缺勤扣款 {basis.settings.absenceDeductionEnabled ? fmt(basis.deductions.absenceDeduction) : "未啟用"}、
                請假扣薪 {fmt(basis.deductions.leaveDeduction ?? 0)}（事假不給薪、病假與生理假半薪）
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5" /> 薪資明細 — {result.employeeName}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b"><span>底薪</span><span className="font-mono">{fmt(result.baseSalary)}</span></div>
                <div className="flex justify-between py-2 border-b"><span>加班費</span><span className="font-mono">{fmt(result.overtimePay)}</span></div>
                {(result.components || []).filter(c => c.kind === "earning").length > 0
                  ? (result.components || []).filter(c => c.kind === "earning").map((c, i) => (
                    <div key={i} className="flex justify-between py-2 border-b"><span>{c.name}</span><span className="font-mono">{fmt(c.amount)}</span></div>
                  ))
                  : <div className="flex justify-between py-2 border-b"><span>其他津貼</span><span className="font-mono">{fmt(result.otherAllowances)}</span></div>}
                <div className="flex justify-between py-2 border-b font-semibold text-blue-600"><span>應發合計</span><span className="font-mono">{fmt(result.grossSalary)}</span></div>

                <div className="pt-2 text-sm font-semibold text-gray-500">扣繳項目</div>
                <div className="flex justify-between py-2 border-b text-red-600">
                  <span>勞保費（員工自付 20%）</span>
                  <span className="font-mono">-{fmt(result.laborInsuranceEmployee)}</span>
                </div>
                <div className="text-xs text-gray-400 -mt-2 mb-1">投保級距：{fmt(result.laborInsuranceBracket)} × 12.5% × 20%</div>

                <div className="flex justify-between py-2 border-b text-red-600">
                  <span>健保費（員工自付 30%）{result.healthInsuranceDependents > 0 ? `含${result.healthInsuranceDependents}位眷屬` : ""}</span>
                  <span className="font-mono">-{fmt(result.healthInsuranceEmployee)}</span>
                </div>
                <div className="text-xs text-gray-400 -mt-2 mb-1">投保級距：{fmt(result.healthInsuranceBracket)} × 5.17% × 30% × (1+{Math.min(result.healthInsuranceDependents, 3)})</div>

                {result.pensionEmployeeSelf > 0 && (
                  <div className="flex justify-between py-2 border-b text-red-600">
                    <span>勞退自提（{result.pensionEmployeeSelfRate}%）</span>
                    <span className="font-mono">-{fmt(result.pensionEmployeeSelf)}</span>
                  </div>
                )}

                {result.attendanceDeduction > 0 && (
                  <div className="flex justify-between py-2 border-b text-red-600">
                    <span>出勤扣款（遲到/缺勤）</span>
                    <span className="font-mono">-{fmt(result.attendanceDeduction)}</span>
                  </div>
                )}

                {(result.components || []).filter(c => c.kind === "deduction").map((c, i) => (
                  <div key={i} className="flex justify-between py-2 border-b text-red-600"><span>{c.name}</span><span className="font-mono">-{fmt(c.amount)}</span></div>
                ))}

                <div className="flex justify-between py-2 border-b font-semibold text-red-600"><span>扣繳合計</span><span className="font-mono">-{fmt(result.totalDeductions)}</span></div>
                <div className="flex justify-between py-3 text-xl font-bold text-green-600 bg-green-50 rounded-lg px-3"><span>實發金額</span><span className="font-mono">{fmt(result.netSalary)}</span></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>雇主負擔</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b">
                  <span>勞保（雇主 70%）</span>
                  <span className="font-mono text-orange-600">{fmt(result.laborInsuranceEmployer)}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span>健保（雇主 60%）</span>
                  <span className="font-mono text-orange-600">{fmt(result.healthInsuranceEmployer)}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span>勞退提撥（6%）</span>
                  <span className="font-mono text-orange-600">{fmt(result.pensionEmployer)}</span>
                </div>
                <div className="text-xs text-gray-400 -mt-2 mb-1">提繳級距：{fmt(result.pensionBracket)} × 6%</div>

                <div className="flex justify-between py-3 font-bold text-orange-600 bg-orange-50 rounded-lg px-3">
                  <span>雇主負擔合計</span>
                  <span className="font-mono">{fmt(result.laborInsuranceEmployer + result.healthInsuranceEmployer + result.pensionEmployer)}</span>
                </div>
                <div className="flex justify-between py-3 font-bold text-purple-600 bg-purple-50 rounded-lg px-3">
                  <span>人事總成本</span>
                  <span className="font-mono">{fmt(result.grossSalary + result.laborInsuranceEmployer + result.healthInsuranceEmployer + result.pensionEmployer)}</span>
                </div>
              </div>

              <div className="mt-6">
                <Button onClick={handleSave} disabled={saving} className="w-full" size="lg">
                  <Save className="h-4 w-4 mr-2" /> {saving ? "儲存中..." : "儲存薪資單"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
