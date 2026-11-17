import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Check, Plus, Trash2, X } from "lucide-react";
import { call, money, post, selectClass, todayText } from "@/lib/call";

interface Sheet {
  id: number; employeeId: number; employeeName: string; workDate: string; projectId: number; projectName: string | null;
  taskTitle: string | null; workOrderNumber: string | null; hours: number; hourlyCost: number | null; costAmount: number | null;
  description: string | null; status: string; costApplied: boolean;
}
interface Options {
  canApprove: boolean; ownEmployeeId: number | null;
  projects: Array<{ id: number; name: string }>; tasks: Array<{ id: number; title: string; projectId: number | null }>;
  workOrders: Array<{ id: number; workOrderNumber: string }>; employees: Array<{ id: number; name: string }>;
}
interface Summary { projects: Array<{ projectId: number; projectName: string; approvedHours: number; approvedCost: number; pendingHours: number; people: number }>; totals: { approvedHours: number; approvedCost: number; pendingHours: number } }

const STATUS: Record<string, string> = { Submitted: "待核准", Approved: "已核准", Rejected: "已退回" };
const monthStart = () => `${todayText().slice(0, 8)}01`;
const emptyForm = { employeeId: "", workDate: todayText(), projectId: "", taskId: "", workOrderId: "", hours: "", description: "" };

export default function TimesheetsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"list" | "summary">("list");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayText());
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: options } = useQuery({ queryKey: ["/timesheets/options"], queryFn: () => call<Options>("timesheets/options"), staleTime: 60_000 });
  const canApprove = !!options?.canApprove;
  const { data: sheets, isLoading } = useQuery({
    queryKey: ["/timesheets", from, to, status],
    queryFn: () => call<Sheet[]>(`timesheets?from=${from}&to=${to}${status ? `&status=${status}` : ""}`),
  });
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["/timesheets/summary", from, to],
    queryFn: () => call<Summary>(`timesheets/summary?from=${from}&to=${to}`),
    enabled: tab === "summary" && canApprove,
  });

  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["/timesheets"] }); queryClient.invalidateQueries({ queryKey: ["/timesheets/summary"] }); };
  const fail = (error: unknown) => toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
  const tasks = useMemo(() => (options?.tasks || []).filter(t => !form.projectId || t.projectId === null || String(t.projectId) === form.projectId), [options, form.projectId]);
  const totalHours = useMemo(() => Math.round((sheets || []).filter(s => s.status !== "Rejected").reduce((s, r) => s + r.hours, 0) * 100) / 100, [sheets]);
  const pending = (sheets || []).filter(s => s.status === "Submitted");

  const save = async () => {
    setSaving(true);
    try {
      await post("timesheets", {
        employeeId: form.employeeId ? Number(form.employeeId) : undefined, workDate: form.workDate, projectId: Number(form.projectId),
        taskId: form.taskId ? Number(form.taskId) : undefined, workOrderId: form.workOrderId ? Number(form.workOrderId) : undefined,
        hours: Number(form.hours), description: form.description,
      });
      toast({ title: "已登錄工時" });
      setOpen(false);
      setForm({ ...emptyForm, employeeId: form.employeeId, projectId: form.projectId });
      refresh();
    } catch (error) { fail(error); } finally { setSaving(false); }
  };
  const review = async (ids: number[], decision: "approve" | "reject") => {
    if (ids.length === 0) return;
    try {
      const result = await post<{ count: number; skipped: number }>("timesheets/review", { ids, decision });
      toast({ title: decision === "approve" ? `已核准 ${result.count} 筆` : `已退回 ${result.count} 筆`, description: result.skipped > 0 ? `${result.skipped} 筆已計入成本或狀態沒變，沒有更動` : undefined });
      setSelected(new Set());
      refresh();
    } catch (error) { fail(error); }
  };
  const remove = async (sheet: Sheet) => {
    if (!confirm(`確定刪除 ${sheet.workDate} 的 ${sheet.hours} 小時工時？`)) return;
    try { await call(`timesheets/${sheet.id}`, { method: "DELETE" }); toast({ title: "已刪除" }); refresh(); } catch (error) { fail(error); }
  };
  const toggle = (id: number) => setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const needEmployee = canApprove || !options?.ownEmployeeId;
  const valid = !!form.projectId && !!form.workDate && Number(form.hours) > 0 && (!needEmployee || !!form.employeeId || !!options?.ownEmployeeId);

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="工時表" description="把每天的工時填到專案；核准後換算成人工成本，填到工單的工時會計入成品成本"
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />填工時</Button>} />

      <div className="flex flex-wrap items-end gap-2">
        {canApprove && (
          <div className="flex gap-2">
            <Button size="sm" variant={tab === "list" ? "default" : "outline"} onClick={() => setTab("list")}>工時明細</Button>
            <Button size="sm" variant={tab === "summary" ? "default" : "outline"} onClick={() => setTab("summary")}>專案人工成本</Button>
          </div>
        )}
        <div><Label htmlFor="ts-from" className="text-xs">從</Label><Input id="ts-from" type="date" className="w-40" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><Label htmlFor="ts-to" className="text-xs">到</Label><Input id="ts-to" type="date" className="w-40" value={to} onChange={e => setTo(e.target.value)} /></div>
        {tab === "list" && (
          <div>
            <Label htmlFor="ts-status" className="text-xs">狀態</Label>
            <select id="ts-status" className={`${selectClass} w-32`} value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">全部</option><option value="Submitted">待核准</option><option value="Approved">已核准</option><option value="Rejected">已退回</option>
            </select>
          </div>
        )}
      </div>

      {tab === "list" || !canApprove ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>這段期間共 {totalHours} 小時{pending.length > 0 ? `，${pending.length} 筆待核准` : ""}</span>
            {canApprove && selected.size > 0 && (
              <span className="flex gap-2">
                <Button size="sm" onClick={() => review([...selected], "approve")}><Check className="h-3.5 w-3.5 mr-1" />核准 {selected.size} 筆</Button>
                <Button size="sm" variant="outline" onClick={() => review([...selected], "reject")}><X className="h-3.5 w-3.5 mr-1" />退回</Button>
              </span>
            )}
            {canApprove && selected.size === 0 && pending.length > 0 && <Button size="sm" variant="outline" onClick={() => setSelected(new Set(pending.map(p => p.id)))}>全選待核准</Button>}
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <DataTable
                isLoading={isLoading}
                data={sheets}
                emptyMessage="這段期間沒有工時紀錄"
                columns={[
                  ...(canApprove ? [{
                    header: "",
                    accessor: (s: Sheet) => s.status === "Submitted" ? <input type="checkbox" aria-label={`選取 ${s.employeeName} ${s.workDate}`} className="h-4 w-4 accent-primary" checked={selected.has(s.id)} onChange={() => toggle(s.id)} /> : null,
                    className: "w-10 px-2",
                  }] : []),
                  { header: "日期", accessor: "workDate" as const },
                  { header: "員工", accessor: (s: Sheet) => s.employeeName },
                  { header: "專案", accessor: (s: Sheet) => <div><span>{s.projectName || "—"}</span>{(s.taskTitle || s.workOrderNumber) && <span className="block text-xs text-muted-foreground">{[s.taskTitle, s.workOrderNumber && `工單 ${s.workOrderNumber}`].filter(Boolean).join("・")}</span>}</div> },
                  { header: "工時", accessor: (s: Sheet) => `${s.hours} 小時` },
                  ...(canApprove ? [{ header: "人工成本", accessor: (s: Sheet) => s.costAmount === null ? "—" : money(s.costAmount), className: "hidden md:table-cell" }] : []),
                  { header: "說明", accessor: (s: Sheet) => s.description || "—", className: "hidden lg:table-cell" },
                  { header: "狀態", accessor: (s: Sheet) => <span className="flex items-center gap-1.5"><Badge variant={s.status === "Approved" ? "default" : s.status === "Rejected" ? "outline" : "secondary"}>{STATUS[s.status] || s.status}</Badge>{s.costApplied && <span className="text-xs text-muted-foreground">已計入成品</span>}</span> },
                  {
                    header: "操作",
                    accessor: (s: Sheet) => s.costApplied ? null : (
                      <div className="flex gap-1">
                        {canApprove && s.status !== "Approved" && <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" aria-label="核准" onClick={() => review([s.id], "approve")}><Check className="h-4 w-4" /></Button>}
                        {canApprove && s.status !== "Rejected" && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="退回" onClick={() => review([s.id], "reject")}><X className="h-4 w-4" /></Button>}
                        {(canApprove || s.status !== "Approved") && <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" aria-label="刪除" onClick={() => remove(s)}><Trash2 className="h-4 w-4" /></Button>}
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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">已核准工時</div><div className="text-xl font-bold mt-1">{summary?.totals.approvedHours ?? 0} 小時</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">人工成本</div><div className="text-xl font-bold mt-1">{money(summary?.totals.approvedCost)}</div></CardContent></Card>
            <Card className="col-span-2 md:col-span-1"><CardContent className="p-4"><div className="text-xs text-muted-foreground">待核准工時</div><div className="text-xl font-bold mt-1">{summary?.totals.pendingHours ?? 0} 小時</div></CardContent></Card>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <DataTable
                isLoading={summaryLoading}
                data={summary?.projects.map(p => ({ ...p, id: p.projectId }))}
                defaultPageSize={0}
                emptyMessage="這段期間沒有工時紀錄"
                columns={[
                  { header: "專案", accessor: (p: any) => p.projectName },
                  { header: "投入人數", accessor: (p: any) => `${p.people} 人` },
                  { header: "已核准工時", accessor: (p: any) => `${p.approvedHours} 小時` },
                  { header: "人工成本", accessor: (p: any) => <span className="font-semibold">{money(p.approvedCost)}</span> },
                  { header: "待核准", accessor: (p: any) => p.pendingHours > 0 ? `${p.pendingHours} 小時` : "—" },
                ]}
              />
            </CardContent>
          </Card>
          <p className="text-sm text-muted-foreground">人工成本＝工時 × 填寫當時的時薪（月薪 ÷ 時薪除數）。薪資本身已經在發薪時記成費用，這裡是看每個專案用了多少人力，不會在損益表重複計算。</p>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-md max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>填工時</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {canApprove && (
              <div className="space-y-1.5">
                <Label htmlFor="tsf-emp">員工 {options?.ownEmployeeId ? "" : "*"}</Label>
                <select id="tsf-emp" className={selectClass} value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })}>
                  <option value="">{options?.ownEmployeeId ? "我自己" : "請選擇"}</option>
                  {options?.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            )}
            {!canApprove && !options?.ownEmployeeId && <p className="text-sm text-amber-600 dark:text-amber-400">你的帳號還沒綁定員工資料，請聯絡管理員（{user?.username}）。</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="tsf-date">日期 *</Label><Input id="tsf-date" type="date" max={todayText()} value={form.workDate} onChange={e => setForm({ ...form, workDate: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="tsf-hours">工時（小時）*</Label><Input id="tsf-hours" type="number" inputMode="decimal" step="0.25" min="0" max="24" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} placeholder="例如 3.5" /></div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tsf-project">專案 *</Label>
              <select id="tsf-project" className={selectClass} value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value, taskId: "" })}>
                <option value="">請選擇專案</option>
                {options?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tsf-task">任務（選填）</Label>
              <select id="tsf-task" className={selectClass} value={form.taskId} onChange={e => setForm({ ...form, taskId: e.target.value })}>
                <option value="">不指定</option>
                {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
            {(options?.workOrders.length || 0) > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="tsf-wo">工單（選填）</Label>
                <select id="tsf-wo" className={selectClass} value={form.workOrderId} onChange={e => setForm({ ...form, workOrderId: e.target.value })}>
                  <option value="">不指定</option>
                  {options?.workOrders.map(w => <option key={w.id} value={w.id}>{w.workOrderNumber}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">填到工單的工時，核准後會在完工入庫時計入成品成本。</p>
              </div>
            )}
            <div className="space-y-1.5"><Label htmlFor="tsf-desc">做了什麼</Label><Input id="tsf-desc" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={save} disabled={saving || !valid}>{saving ? "處理中…" : "登錄"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
