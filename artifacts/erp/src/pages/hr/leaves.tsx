import { useMemo, useState } from "react";
import { useListEmployees } from "@workspace/erp-api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DocWindow } from "@/components/shared/doc-window";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { ROLE_EMPLOYEE } from "@/lib/roles";
import { leavesApi, LEAVE_STATUS_LABEL, type LeaveRecord, type AnnualOverviewRow, type UnsettledGrant } from "@/lib/api";
import { LeaveBalanceCard } from "@/components/hr/leave-balance-card";
import { CalendarPlus, Check, X, Ban, RefreshCw, SlidersHorizontal, HandCoins } from "lucide-react";
import { LookupSelect } from "@/components/shared/lookup-select";

const HR_ROLES = ["owner", "admin", "hr_admin", "super_admin"];
const APPROVER_ROLES = [...HR_ROLES, "manager"];
const emptyForm = { employeeId: "", leaveType: "Annual Leave", fromDate: "", toDate: "", dayPart: "full", reason: "" };

const statusVariant = (s: string) => s === "Approved" ? "default" : s === "Rejected" ? "destructive" : s === "Cancelled" ? "outline" : "secondary";
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function LeavesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEmployee = user?.role === ROLE_EMPLOYEE;
  const isHr = HR_ROLES.includes(user?.role || "");
  const isApprover = APPROVER_ROLES.includes(user?.role || "");
  const myEmployeeId = user?.employeeId ?? undefined;

  const [tab, setTab] = useState<"requests" | "annual">("requests");
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: leaves, isLoading } = useQuery({ queryKey: ["/leaves"], queryFn: () => leavesApi.list() });
  const { data: types = [] } = useQuery({ queryKey: ["/leaves/types"], queryFn: leavesApi.types, staleTime: Infinity });
  const { data: employees } = useListEmployees(undefined, { query: { enabled: isApprover } as any });
  const typeLabel = (code: string) => types.find(t => t.code === code)?.label || code;

  // 申請對象：員工自己，或主管在表單選的那一位
  const targetEmployeeId = isApprover ? (form.employeeId ? Number(form.employeeId) : undefined) : myEmployeeId;
  const { data: targetBalance } = useQuery({
    queryKey: ["/leaves/balance", targetEmployeeId],
    queryFn: () => leavesApi.balance(targetEmployeeId),
    enabled: open && !!targetEmployeeId,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/leaves"] });
    queryClient.invalidateQueries({ queryKey: ["/leaves/balance"] });
    queryClient.invalidateQueries({ queryKey: ["/leaves/annual-overview"] });
    queryClient.invalidateQueries({ queryKey: ["/approval-requests"] });
  };

  const act = async (r: LeaveRecord, action: "Approved" | "Rejected" | "cancel") => {
    const label = action === "Approved" ? "核准" : action === "Rejected" ? "駁回" : r.status === "Approved" ? "銷假（取消已核准的假）" : "取消";
    if (!window.confirm(`確定要${label} ${r.employeeName} 的${typeLabel(r.leaveType)}（${r.fromDate} ~ ${r.toDate}）嗎？`)) return;
    setBusy(r.id);
    try {
      if (action === "cancel") await leavesApi.cancel(r.id); else await leavesApi.decide(r.id, action);
      toast({ title: `已${action === "cancel" ? "取消" : label}` });
      refresh();
    } catch (e: any) {
      toast({ title: "操作失敗", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const selectedType = types.find(t => t.code === form.leaveType);
  const singleDay = !!form.fromDate && form.fromDate === (form.toDate || form.fromDate);

  const submit = async () => {
    setFormError(null);
    if (!targetEmployeeId) { setFormError(isApprover ? "請選擇員工" : "您的帳號尚未綁定員工，請聯絡管理員"); return; }
    const toDate = form.toDate || form.fromDate;
    if (!form.fromDate) { setFormError("請填寫請假日期"); return; }
    if (toDate < form.fromDate) { setFormError("結束日不可早於起始日"); return; }
    setSaving(true);
    try {
      const created = await leavesApi.create({
        employeeId: targetEmployeeId, leaveType: form.leaveType, fromDate: form.fromDate, toDate,
        dayPart: singleDay ? form.dayPart : "full", reason: form.reason || undefined,
      });
      toast({ title: "已送出請假申請", description: `${typeLabel(created.leaveType)} ${created.totalDays} 天` });
      setOpen(false);
      setForm(emptyForm);
      refresh();
    } catch (e: any) {
      setFormError(e?.message || "送出失敗");
    } finally { setSaving(false); }
  };

  const rows = useMemo(() => (leaves || []).filter(r => statusFilter === "all" || r.status === statusFilter), [leaves, statusFilter]);
  const pendingCount = (leaves || []).filter(r => r.status === "Pending").length;

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="請假管理"
        description={isApprover ? "請假申請、審核與特休管理" : "查看假勤餘額並提出請假申請"}
        action={<Button onClick={() => { setFormError(null); setOpen(true); }}><CalendarPlus className="h-4 w-4 mr-2" /> 申請請假</Button>}
      />

      {myEmployeeId && <LeaveBalanceCard employeeId={myEmployeeId} />}

      {isHr && (
        <div className="flex gap-2">
          <Button variant={tab === "requests" ? "default" : "outline"} size="sm" onClick={() => setTab("requests")}>
            假單{pendingCount > 0 ? `（${pendingCount} 筆待審）` : ""}
          </Button>
          <Button variant={tab === "annual" ? "default" : "outline"} size="sm" onClick={() => setTab("annual")}>特休總覽</Button>
        </div>
      )}

      {tab === "requests" && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[["all", "全部"], ["Pending", "待審核"], ["Approved", "已核准"], ["Rejected", "已駁回"], ["Cancelled", "已取消"]].map(([value, label]) => (
              <Button key={value} size="sm" variant={statusFilter === value ? "secondary" : "ghost"} className="shrink-0" onClick={() => setStatusFilter(value)}>{label}</Button>
            ))}
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <DataTable layoutId="leaves-list"
                isLoading={isLoading}
                data={rows}
                emptyMessage="沒有假單"
                columns={[
                  { header: "員工", accessor: (r: LeaveRecord) => <span className="font-medium">{r.employeeName}</span> },
                  { header: "假別", accessor: (r: LeaveRecord) => typeLabel(r.leaveType) },
                  { header: "日期", accessor: (r: LeaveRecord) => r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} ~ ${r.toDate}` },
                  { header: "天數", accessor: (r: LeaveRecord) => `${r.totalDays} 天` },
                  { header: "事由", accessor: (r: LeaveRecord) => r.reason || "—", className: "hidden lg:table-cell max-w-[220px] truncate" },
                  { header: "狀態", accessor: (r: LeaveRecord) => <Badge variant={statusVariant(r.status)}>{LEAVE_STATUS_LABEL[r.status] || r.status}</Badge> },
                  {
                    header: "操作",
                    accessor: (r: LeaveRecord) => {
                      const mine = r.employeeId === myEmployeeId;
                      const canDecide = isApprover && r.status === "Pending";
                      const canCancel = (r.status === "Pending" && (mine || isApprover)) || (r.status === "Approved" && isApprover);
                      if (!canDecide && !canCancel) return null;
                      return (
                        <div className="flex flex-wrap gap-1.5">
                          {canDecide && <Button size="sm" variant="outline" className="h-8 px-2 text-green-700 border-green-300 dark:text-green-400" disabled={busy === r.id} onClick={() => act(r, "Approved")}><Check className="h-3.5 w-3.5 mr-1" />核准</Button>}
                          {canDecide && <Button size="sm" variant="outline" className="h-8 px-2 text-red-700 border-red-300 dark:text-red-400" disabled={busy === r.id} onClick={() => act(r, "Rejected")}><X className="h-3.5 w-3.5 mr-1" />駁回</Button>}
                          {canCancel && <Button size="sm" variant="ghost" className="h-8 px-2" disabled={busy === r.id} onClick={() => act(r, "cancel")}><Ban className="h-3.5 w-3.5 mr-1" />{r.status === "Approved" ? "銷假" : "取消"}</Button>}
                        </div>
                      );
                    },
                  },
                ]}
              />
            </CardContent>
          </Card>
        </>
      )}

      {tab === "annual" && isHr && <AnnualLeaveOverview onChanged={refresh} />}

      <DocWindow
        open={open}
        onClose={() => setOpen(false)}
        name="申請請假"
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "送出中…" : "送出申請"}</Button>
        </>}
      >
          <div className="space-y-4">
            {isApprover && (
              <div className="space-y-1.5">
                <Label>員工</Label>
                <LookupSelect value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                  <SelectTrigger><SelectValue placeholder="請選擇員工" /></SelectTrigger>
                  <SelectContent>
                    {employees?.filter((e: any) => e.status === "Active").map((e: any) => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.employeeId} - {e.firstName}{e.lastName}</SelectItem>
                    ))}
                  </SelectContent>
                </LookupSelect>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>假別</Label>
              <Select value={form.leaveType} onValueChange={(v) => setForm({ ...form, leaveType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {types.map(t => <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {selectedType && <p className="text-xs text-muted-foreground">{selectedType.note}</p>}
              {form.leaveType === "Annual Leave" && targetBalance && (
                <p className="text-xs font-medium text-primary">
                  {targetBalance.annual.period
                    ? `特休剩 ${targetBalance.annual.remaining} 天（使用期限 ${targetBalance.annual.period.periodEnd}）`
                    : `到職滿半年才有特休${targetBalance.annual.next ? `，${targetBalance.annual.next.date} 起有 ${targetBalance.annual.next.days} 天` : ""}`}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>起始日</Label>
                <Input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value, toDate: form.toDate && form.toDate >= e.target.value ? form.toDate : e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>結束日</Label>
                <Input type="date" value={form.toDate} min={form.fromDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} />
              </div>
            </div>
            {singleDay && !selectedType?.calendarDays && (
              <div className="space-y-1.5">
                <Label>時段</Label>
                <div className="grid grid-cols-3 gap-2">
                  {[["full", "整天"], ["am", "上午半天"], ["pm", "下午半天"]].map(([value, label]) => (
                    <Button key={value} type="button" variant={form.dayPart === value ? "default" : "outline"} onClick={() => setForm({ ...form, dayPart: value })}>{label}</Button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>事由（選填）</Label>
              <Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="請簡述請假事由" />
            </div>
            <p className="text-xs text-muted-foreground">天數由系統計算，六日與行事曆上的假日不會算進去。</p>
            {formError && <div className="text-sm text-red-600 dark:text-red-400">{formError}</div>}
          </div>
      </DocWindow>
    </div>
  );
}

/** 人資用：全公司特休餘額、自動發放、手動調整、期滿與離職結清 */
function AnnualLeaveOverview({ onChanged }: { onChanged: () => void }) {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery({ queryKey: ["/leaves/annual-overview"], queryFn: leavesApi.annualOverview });
  const [adjust, setAdjust] = useState<AnnualOverviewRow | null>(null);
  const [adjustForm, setAdjustForm] = useState({ days: "", note: "" });
  const [working, setWorking] = useState(false);

  const run = async () => {
    setWorking(true);
    try {
      const { created } = await leavesApi.runGrants();
      toast({ title: created.length > 0 ? `已發放 ${created.length} 位員工的特休` : "目前沒有需要發放的特休", description: created.map(c => `${c.name} ${c.days} 天`).join("、") || undefined });
      await refetch(); onChanged();
    } catch (e: any) { toast({ title: "發放失敗", description: e?.message, variant: "destructive" }); }
    finally { setWorking(false); }
  };

  const saveAdjust = async () => {
    if (!adjust) return;
    setWorking(true);
    try {
      await leavesApi.adjust({ employeeId: adjust.employeeId, days: Number(adjustForm.days), note: adjustForm.note });
      toast({ title: "特休已調整" });
      setAdjust(null); setAdjustForm({ days: "", note: "" });
      await refetch(); onChanged();
    } catch (e: any) { toast({ title: "調整失敗", description: e?.message, variant: "destructive" }); }
    finally { setWorking(false); }
  };

  const settle = async (u: UnsettledGrant) => {
    if (!window.confirm(`${u.employeeName} ${u.periodStart} ~ ${u.periodEnd} 還有 ${u.unusedDays} 天特休沒休，應折發工資 ${money(u.amount)}。\n\n確定已經發給員工了嗎？`)) return;
    try {
      await leavesApi.settle(u.grantId);
      toast({ title: "已標記結清" });
      await refetch();
    } catch (e: any) { toast({ title: "操作失敗", description: e?.message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
          <div className="text-sm text-muted-foreground">
            特休依到職日與勞基法第 38 條自動發放：滿半年 3 天、滿 1 年 7 天、滿 2 年 10 天、滿 3 年 14 天、滿 5 年 15 天，滿 10 年起每年加 1 天，最多 30 天。系統每天檢查一次。
          </div>
          <Button variant="outline" onClick={run} disabled={working} className="shrink-0"><RefreshCw className={`h-4 w-4 mr-2 ${working ? "animate-spin" : ""}`} />立即檢查發放</Button>
        </CardContent>
      </Card>

      {(data?.unsettled.length ?? 0) > 0 && (
        <Card className="border-amber-300 dark:border-amber-700">
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b font-semibold text-sm text-amber-800 dark:text-amber-300">待結清：期滿或離職沒休完的特休要折發工資（{data!.unsettled.length} 筆）</div>
            <DataTable layoutId="leaves-unsettled"
              isLoading={false}
              data={data!.unsettled.map(u => ({ ...u, id: u.grantId }))}
              defaultPageSize={0}
              columns={[
                { header: "員工", accessor: (u: UnsettledGrant) => <span className="font-medium">{u.employeeName}</span> },
                { header: "原因", accessor: (u: UnsettledGrant) => u.reason === "expired" ? "期滿" : "離職" },
                { header: "期間", accessor: (u: UnsettledGrant) => `${u.periodStart} ~ ${u.periodEnd}` },
                { header: "未休", accessor: (u: UnsettledGrant) => `${u.unusedDays} 天` },
                { header: "應折發", accessor: (u: UnsettledGrant) => `${money(u.amount)}（日薪 ${money(u.dailyWage)}）` },
                { header: "操作", accessor: (u: UnsettledGrant) => <Button size="sm" variant="outline" className="h-8" onClick={() => settle(u)}><HandCoins className="h-3.5 w-3.5 mr-1" />已發放</Button> },
              ]}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable layoutId="leaves-balance"
            isLoading={isLoading}
            data={data?.rows.map(r => ({ ...r, id: r.employeeId }))}
            emptyMessage="還沒有在職員工"
            columns={[
              { header: "員工", accessor: (r: AnnualOverviewRow) => <div><span className="font-medium">{r.employeeName}</span><span className="ml-2 text-xs text-muted-foreground">{r.employeeCode}</span></div> },
              { header: "年資", accessor: (r: AnnualOverviewRow) => r.seniority },
              { header: "本期特休", accessor: (r: AnnualOverviewRow) => r.period ? `${r.entitled} 天` : "未滿半年" },
              { header: "已休", accessor: (r: AnnualOverviewRow) => r.period ? `${r.used} 天${r.pending > 0 ? `（待審 ${r.pending}）` : ""}` : "—" },
              { header: "剩餘", accessor: (r: AnnualOverviewRow) => r.period ? <span className="font-semibold">{r.remaining} 天</span> : "—" },
              {
                header: "使用期限",
                accessor: (r: AnnualOverviewRow) => !r.period ? "—" : (
                  <span className={r.remaining > 0 && (r.daysToExpiry ?? 999) <= 60 ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>
                    {r.period.periodEnd}{r.remaining > 0 && (r.daysToExpiry ?? 999) <= 60 ? `（剩 ${r.daysToExpiry} 天）` : ""}
                  </span>
                ),
              },
              { header: "下次發放", accessor: (r: AnnualOverviewRow) => r.next ? `${r.next.date}（${r.next.days} 天）` : "—", className: "hidden lg:table-cell" },
              { header: "操作", accessor: (r: AnnualOverviewRow) => r.period ? <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setAdjust(r); setAdjustForm({ days: "", note: "" }); }}><SlidersHorizontal className="h-3.5 w-3.5 mr-1" />調整</Button> : null },
            ]}
          />
        </CardContent>
      </Card>

      <Dialog open={!!adjust} onOpenChange={(o) => { if (!o) setAdjust(null); }}>
        <DialogContent className="md:max-w-md">
          <DialogHeader><DialogTitle>調整特休 — {adjust?.employeeName}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">目前剩 {adjust?.remaining} 天。系統上線前已經休掉的天數請填負數（例如 -2），公司多給或遞延的天數填正數。</p>
            <div className="space-y-1.5"><Label>調整天數</Label><Input type="number" step="0.5" inputMode="decimal" value={adjustForm.days} onChange={(e) => setAdjustForm({ ...adjustForm, days: e.target.value })} placeholder="例如 -2 或 1.5" /></div>
            <div className="space-y-1.5"><Label>原因</Label><Input value={adjustForm.note} onChange={(e) => setAdjustForm({ ...adjustForm, note: e.target.value })} placeholder="例如：系統上線前已休 2 天" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjust(null)}>取消</Button>
            <Button onClick={saveAdjust} disabled={working || !adjustForm.days || !adjustForm.note.trim()}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
