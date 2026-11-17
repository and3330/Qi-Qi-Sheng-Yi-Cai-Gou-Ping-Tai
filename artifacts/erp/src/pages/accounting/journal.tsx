import { useState, useEffect, useCallback, useMemo } from "react";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Eye, ChevronLeft, ChevronRight, Search, Undo2, Copy } from "lucide-react";
import { BatchEntryDialog, type BatchMode } from "@/components/accounting/batch-entry-dialog";
import { useAutoReloadKey } from "@/lib/auto-refresh";

import { LookupSelect } from "@/components/shared/lookup-select";
import { OpeningBalanceButton, YearCloseButton } from "@/components/accounting/opening-and-close";
import { JournalEntryDialog } from "@/components/accounting/journal-entry-dialog";
import { DocWindow } from "@/components/shared/doc-window";
import { PeriodLockControl } from "@/components/accounting/period-lock-control";
const BASE_URL = import.meta.env.BASE_URL;
const BASE = BASE_URL.endsWith("/") ? BASE_URL : BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;

type JELine = { accountId: number; debit: number; credit: number; accountName?: string; party?: string; description?: string };
const blankLine = (): JELine => ({ accountId: 0, debit: 0, credit: 0, party: "", description: "" });

const KIND_TABS: [string, string][] = [["", "全部"], ["receipt", "收款"], ["payment", "付款"], ["receivable", "應收"], ["payable", "應付"], ["transfer", "轉帳"], ["general", "一般"], ["reversal", "沖銷"]];

function getMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}` };
}

export default function JournalEntriesPage() {
  const { toast } = useToast();
  const reloadKey = useAutoReloadKey();
  const [entries, setEntries] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const { from: defaultFrom, to: defaultTo } = useMemo(() => getMonthRange(), []);
  const [startDate, setStartDate] = useState(defaultFrom);
  const [endDate, setEndDate] = useState(defaultTo);
  const [search, setSearch] = useState("");
  // 跟 Ecount「查詢會計交易」一樣：上面用交易類型分頁，下面可以篩部門、專案
  const [kind, setKind] = useState("");
  const [kindCounts, setKindCounts] = useState<Record<string, number>>({});
  const [filterDept, setFilterDept] = useState("");
  const [filterProject, setFilterProject] = useState("");

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lockDate, setLockDate] = useState("");
  const [lockKey, setLockKey] = useState(0);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillSummary, setBackfillSummary] = useState<any>(null);
  const [backfillResult, setBackfillResult] = useState<any>(null);
  const [includeLocked, setIncludeLocked] = useState(false);

  const openBackfill = async () => {
    setBackfillLoading(true);
    setBackfillResult(null);
    setIncludeLocked(false);
    try {
      const r = await fetch(api("invoices/backfill-journal-entries"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error || "讀取失敗");
      setBackfillSummary(json);
      setBackfillOpen(true);
    } catch (e: any) {
      toast({ title: "無法讀取待補帳發票", description: e.message, variant: "destructive" });
    }
    setBackfillLoading(false);
  };

  const runBackfill = async () => {
    setBackfillRunning(true);
    try {
      const r = await fetch(api("invoices/backfill-journal-entries"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, includeLocked }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error || "補帳失敗");
      setBackfillResult(json);
      toast({ title: `已補建 ${json.created?.count ?? 0} 筆發票分錄`, description: `合計 NT$${Number(json.created?.amountTwd ?? 0).toLocaleString()}` });
      fetchEntries(1);
    } catch (e: any) {
      toast({ title: "補帳失敗", description: e.message, variant: "destructive" });
    }
    setBackfillRunning(false);
  };

  // 未開發票訂單的營收分錄補建
  const [soBackfillOpen, setSoBackfillOpen] = useState(false);
  const [soBackfillLoading, setSoBackfillLoading] = useState(false);
  const [soBackfillRunning, setSoBackfillRunning] = useState(false);
  const [soBackfillSummary, setSoBackfillSummary] = useState<any>(null);
  const [soBackfillResult, setSoBackfillResult] = useState<any>(null);
  const [soIncludeLocked, setSoIncludeLocked] = useState(false);

  const openSoBackfill = async () => {
    setSoBackfillLoading(true);
    setSoBackfillResult(null);
    setSoIncludeLocked(false);
    try {
      const r = await fetch(api("sales-orders/backfill-journal-entries"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error || "讀取失敗");
      setSoBackfillSummary(json);
      setSoBackfillOpen(true);
    } catch (e: any) {
      toast({ title: "無法讀取待補帳訂單", description: e.message, variant: "destructive" });
    }
    setSoBackfillLoading(false);
  };

  const runSoBackfill = async () => {
    setSoBackfillRunning(true);
    try {
      const r = await fetch(api("sales-orders/backfill-journal-entries"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, includeLocked: soIncludeLocked }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error || "補帳失敗");
      setSoBackfillResult(json);
      toast({ title: `已補建 ${json.created ?? 0} 筆訂單營收分錄` });
      fetchEntries(1);
    } catch (e: any) {
      toast({ title: "補帳失敗", description: e.message, variant: "destructive" });
    }
    setSoBackfillRunning(false);
  };

  const [viewOpen, setViewOpen] = useState(false);
  const [copiedFrom, setCopiedFrom] = useState("");
  // 修改既有分錄：草稿直接存；已入帳的送修改申請（要寫原因），核准後才改
  const [editing, setEditing] = useState<{ id: number; entryNumber: string; status: string } | null>(null);
  const [editReason, setEditReason] = useState("");
  const [batchMode, setBatchMode] = useState<BatchMode | null>(null);
  const [viewEntry, setViewEntry] = useState<any>(null);
  const [form, setForm] = useState({
    entryDate: new Date().toISOString().slice(0, 10),
    description: "",
    projectId: "",
    departmentId: "",
    isInternalTransfer: false,
    transferFromDepartmentId: "",
    transferToDepartmentId: "",
    lines: [{ accountId: 0, debit: 0, credit: 0 }, { accountId: 0, debit: 0, credit: 0 }] as JELine[],
  });

  const fetchEntries = useCallback(async (p: number = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: "50" });
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (search.trim()) params.set("search", search.trim());
      if (kind) params.set("kind", kind);
      if (filterDept) params.set("departmentId", filterDept);
      if (filterProject) params.set("projectId", filterProject);
      const res = await fetch(api(`journal-entries?${params}`));
      if (res.ok) {
        const data = await res.json();
        setEntries(data.data || []);
        setTotalPages(data.totalPages || 1);
        setTotalCount(data.total || 0);
        setKindCounts(data.kindCounts || {});
        setPage(data.page || 1);
      }
    } catch {}
    setLoading(false);
  }, [startDate, endDate, search, kind, filterDept, filterProject]);

  const fetchMeta = useCallback(async () => {
    const [aRes, pRes, dRes] = await Promise.all([
      fetch(api("accounts")), fetch(api("projects")), fetch(api("departments")),
    ]);
    setAccounts(await aRes.json());
    setProjects(await pRes.json());
    setDepartments(await dRes.json());
  }, []);

  useEffect(() => { fetchMeta(); }, [fetchMeta, reloadKey]);
  // 自動刷新時停留在目前頁碼，不跳回第一頁
  useEffect(() => { fetchEntries(page); }, [fetchEntries, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 客戶、廠商名稱：新增／複製分錄時「客戶／廠商」欄打字提示
  const [partyNames, setPartyNames] = useState<string[]>([]);
  useEffect(() => {
    if (!open || partyNames.length) return;
    Promise.all([fetch(api("customers")).then(r => r.ok ? r.json() : []), fetch(api("suppliers")).then(r => r.ok ? r.json() : [])])
      .then(([c, s]) => setPartyNames([...new Set([...(Array.isArray(c) ? c : []), ...(Array.isArray(s) ? s : [])].map((x: any) => x.name).filter(Boolean))] as string[]))
      .catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const leafAccounts = useMemo(() => (accounts || []).filter((a: any) => !a.isGroup), [accounts]);
  const totalDebit = form.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = form.lines.reduce((s, l) => s + l.credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  // 搜尋交給後端（會找全部頁數），這裡不再只篩目前這一頁
  const filtered = entries;

  const openCreate = () => {
    setCopiedFrom(""); setEditing(null);
    setForm({
      entryDate: new Date().toISOString().slice(0, 10), description: "", projectId: "", departmentId: "",
      isInternalTransfer: false, transferFromDepartmentId: "", transferToDepartmentId: "",
      lines: [blankLine(), blankLine()],
    });
    setOpen(true);
  };

  // 複製：把整張分錄帶進新增畫面，日期換成今天，改一改就能存（打每個月重複的分錄用）
  const openCopy = (entry: any) => {
    const lines: JELine[] = (entry.lines || []).map((l: any) => {
      const text = typeof l.description === "string" ? l.description : "";
      const [party, ...rest] = text.includes("｜") ? text.split("｜") : ["", text];
      return { accountId: Number(l.accountId) || 0, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, party: party.trim(), description: rest.join("｜").trim() };
    });
    setForm({
      entryDate: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }),
      description: entry.summary || entry.description || "",
      projectId: entry.projectId ? String(entry.projectId) : "", departmentId: entry.departmentId ? String(entry.departmentId) : "",
      isInternalTransfer: !!entry.isInternalTransfer,
      transferFromDepartmentId: entry.transferFromDepartmentId ? String(entry.transferFromDepartmentId) : "",
      transferToDepartmentId: entry.transferToDepartmentId ? String(entry.transferToDepartmentId) : "",
      lines: lines.length >= 2 ? lines : [...lines, blankLine(), blankLine()].slice(0, 2),
    });
    setCopiedFrom(entry.sourceNumber ? `EC ${entry.sourceNumber}` : entry.entryNumber);
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (entry: any) => {
    openCopy(entry);
    setCopiedFrom("");
    setForm(p => ({ ...p, entryDate: entry.entryDate, description: entry.description || entry.summary || "" }));
    setEditing({ id: entry.id, entryNumber: entry.entryNumber, status: entry.status });
    setEditReason("");
    setViewOpen(false);
  };

  const updateLine = (idx: number, field: string, value: any) => {
    const newLines = [...form.lines];
    (newLines[idx] as any)[field] = value;
    setForm(p => ({ ...p, lines: newLines }));
  };

  const addLine = () => setForm(p => ({ ...p, lines: [...p.lines, blankLine()] }));
  const removeLine = (idx: number) => {
    if (form.lines.length <= 2) return;
    setForm(p => ({ ...p, lines: p.lines.filter((_, i) => i !== idx) }));
  };

  const handleSave = async () => {
    if (!form.entryDate) { toast({ title: "請填寫日期", variant: "destructive" }); return; }
    if (!isBalanced) { toast({ title: "借貸不平衡", description: `借方 $${totalDebit.toFixed(2)} ≠ 貸方 $${totalCredit.toFixed(2)}`, variant: "destructive" }); return; }
    const validLines = form.lines.filter(l => l.accountId > 0 && (l.debit > 0 || l.credit > 0));
    if (validLines.length < 2) { toast({ title: "至少需要兩行有效分錄", variant: "destructive" }); return; }
    if (form.isInternalTransfer && (!form.transferFromDepartmentId || !form.transferToDepartmentId)) {
      toast({ title: "請選擇轉出部門與轉入部門", variant: "destructive" }); return;
    }
    if (form.isInternalTransfer && form.transferFromDepartmentId === form.transferToDepartmentId) {
      toast({ title: "轉出部門與轉入部門不可相同", variant: "destructive" }); return;
    }
    if (editing && editing.status !== "Draft" && !editReason.trim()) { toast({ title: "請寫修改原因", description: "已入帳的分錄要送審，審核的人要知道為什麼改", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(api(editing ? `journal-entries/${editing.id}` : "journal-entries"), {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryDate: form.entryDate, description: form.description,
          projectId: form.projectId ? Number(form.projectId) : undefined,
          departmentId: form.departmentId ? Number(form.departmentId) : undefined,
          isInternalTransfer: form.isInternalTransfer,
          transferFromDepartmentId: form.isInternalTransfer ? Number(form.transferFromDepartmentId) : undefined,
          transferToDepartmentId: form.isInternalTransfer ? Number(form.transferToDepartmentId) : undefined,
          lines: validLines,
          ...(editing ? { reason: editReason } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error);
      toast(json?.applied ? { title: `已直接修改（${json.requestNumber}）`, description: "公司裡沒有其他可以審核的人，系統已直接執行並留下紀錄" } : res.status === 202 ? { title: `修改申請 ${json.requestNumber} 已送出`, description: "財務或超級管理員核准後才會改，可以到審批中心看進度" } : { title: editing ? "分錄已修改" : "日記帳分錄已建立" });
      setEditing(null);
      setOpen(false);
      fetchEntries(page);
    } catch (err: any) {
      toast({ title: "建立失敗", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const openView = (entry: any) => { setViewEntry(entry); setViewOpen(true); };

  // 已入帳的分錄不能刪改，要更正就沖銷：另開一張借貸相反的分錄
  const canReverse = (entry: any) => entry.status === "Posted" && !/^(沖銷 |作廢)/.test(entry.description || "");
  const handleReverse = async (entry: any) => {
    const reason = window.prompt(`確定沖銷 ${entry.entryNumber}？\n系統會另開一張借貸相反的分錄，原分錄會保留。\n\n沖銷原因（選填）：`, "");
    if (reason === null) return;
    try {
      const res = await fetch(api(`journal-entries/${entry.id}/reverse`), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "沖銷失敗");
      toast({ title: "已沖銷", description: `${entry.entryNumber} 已開立沖銷分錄` });
      fetchEntries(page);
    } catch (err: any) {
      toast({ title: "沖銷失敗", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="日記帳" description="財務交易紀錄">
        <PeriodLockControl key={lockKey} onChanged={d => setLockDate(d || "")} />
        <OpeningBalanceButton onDone={() => fetchEntries(1)} />
        <YearCloseButton onDone={(date) => { setLockDate(date); setLockKey(k => k + 1); }} />
        <Button variant="outline" onClick={openBackfill} disabled={backfillLoading}>
          {backfillLoading ? "檢查中..." : "補建歷史發票分錄"}
        </Button>
        <Button variant="outline" onClick={openSoBackfill} disabled={soBackfillLoading}>
          {soBackfillLoading ? "檢查中..." : "補建訂單營收分錄"}
        </Button>
        <Button variant="outline" onClick={() => setBatchMode("receipt")}><Plus size={16} className="mr-1" />收款單</Button>
        <Button variant="outline" onClick={() => setBatchMode("payment")}><Plus size={16} className="mr-1" />付款單</Button>
        <Button onClick={openCreate}><Plus size={16} className="mr-1" />新增分錄</Button>
      </PageHeader>

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs text-muted-foreground">起始日期</Label>
              <Input type="date" className="w-40" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">結束日期</Label>
              <Input type="date" className="w-40" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">搜尋</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="傳票編號、說明..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">部門</Label>
              <select className="h-9 w-40 rounded-md border border-input bg-background px-2 text-sm" value={filterDept} onChange={e => { setPage(1); setFilterDept(e.target.value); }} aria-label="依部門篩選">
                <option value="">全部部門</option>
                {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">專案</Label>
              <select className="h-9 w-48 rounded-md border border-input bg-background px-2 text-sm" value={filterProject} onChange={e => { setPage(1); setFilterProject(e.target.value); }} aria-label="依專案篩選">
                <option value="">全部專案</option>
                {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="text-sm text-muted-foreground pb-2">共 {totalCount} 筆</div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="交易類型">
        {KIND_TABS.map(([value, label]) => {
          const n = value ? kindCounts[value] ?? 0 : Object.values(kindCounts).reduce((a, b) => a + b, 0);
          if (value && n === 0) return null;
          return (
            <button key={value || "all"} role="tab" aria-selected={kind === value} onClick={() => { setPage(1); setKind(value); }}
              className={`rounded-full px-3 py-1 text-sm font-medium ${kind === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
              {label}<span className="ml-1 text-xs opacity-75">{n.toLocaleString()}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={loading}
            data={filtered}
            columns={[
              {
                header: "日期／傳票編號",
                accessor: (r: any) => (
                  <button type="button" onClick={() => openView(r)} className="text-left text-primary hover:underline">
                    <div className="whitespace-nowrap">{r.entryDate}</div>
                    <div className="text-xs text-muted-foreground">{r.sourceNumber ? `EC ${r.sourceNumber}` : r.entryNumber}</div>
                  </button>
                ),
              },
              { header: "交易類型", accessor: (r: any) => <Badge variant="outline">{r.kindLabel || "一般"}</Badge>, className: "whitespace-nowrap" },
              {
                header: "金額",
                accessor: (r: any) => {
                  const balanced = Math.abs(Number(r.totalDebit) - Number(r.totalCredit)) < 0.01;
                  return <span className={balanced ? "" : "text-destructive"} title={balanced ? "借貸平衡" : "借貸不平衡"}>{Number(r.totalDebit).toLocaleString()}</span>;
                },
                className: "text-right tabular-nums",
              },
              { header: "客戶／廠商", accessor: (r: any) => r.party || "-", className: "hidden sm:table-cell max-w-[180px] truncate" },
              { header: "摘要", accessor: (r: any) => <span className="inline-flex items-center gap-2">{r.summary || r.description || "-"}{r.isInternalTransfer && <Badge variant="outline">內部轉撥</Badge>}</span>, className: "max-w-[280px] truncate" },
              { header: "部門", accessor: (r: any) => r.departmentName || "-", className: "hidden md:table-cell whitespace-nowrap" },
              { header: "專案", accessor: (r: any) => r.projectName || "-", className: "hidden md:table-cell max-w-[180px] truncate" },
              {
                header: "操作",
                accessor: (r: any) => (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openView(r)} aria-label="檢視" title="檢視"><Eye size={14} /></Button>
                    <Button variant="ghost" size="icon" onClick={() => openCopy(r)} aria-label="複製" title="複製成新分錄"><Copy size={14} /></Button>
                    {canReverse(r) && (
                      <Button variant="ghost" size="icon" onClick={() => handleReverse(r)} aria-label="沖銷" title="沖銷" data-testid={`button-reverse-entry-${r.id}`}><Undo2 size={14} /></Button>
                    )}
                    {r.status === "Reversed" && <span className="text-xs text-muted-foreground">已沖銷</span>}
                  </div>
                ),
                className: "w-28",
              },
            ]}
          />
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => fetchEntries(page - 1)}>
            <ChevronLeft className="h-4 w-4 mr-1" />上一頁
          </Button>
          <span className="text-sm text-muted-foreground">
            第 {page} / {totalPages} 頁
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => fetchEntries(page + 1)}>
            下一頁<ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      <datalist id="je-parties">{partyNames.map(n => <option key={n} value={n} />)}</datalist>
      <BatchEntryDialog open={batchMode !== null} mode={batchMode ?? "receipt"} onOpenChange={v => { if (!v) setBatchMode(null); }} onSaved={() => fetchEntries(1)}
        accounts={accounts || []} departments={departments || []} projects={projects || []} />
      {/* 新增／修改／複製分錄：外框用全系統共用的單據視窗 */}
      <DocWindow
        open={open}
        onClose={() => setOpen(false)}
        name={editing ? "修改分錄" : copiedFrom ? `複製分錄（來源 ${copiedFrom}）` : "新增日記帳分錄"}
        number={editing?.entryNumber}
        extraWide
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving || !isBalanced} data-testid="button-save-entry">
            {saving ? "處理中..." : editing ? (editing.status === "Draft" ? "儲存修改" : "送出修改申請") : "建立分錄"}
          </Button>
        </>}
      >
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>日期 *</Label><Input type="date" value={form.entryDate} onChange={e => setForm(p => ({ ...p, entryDate: e.target.value }))} /></div>
              <div><Label>說明</Label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>專案 <span className="text-xs font-normal text-muted-foreground">（分錄含收入或費用科目時必填）</span></Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.projectId} onChange={e => setForm(p => ({ ...p, projectId: e.target.value }))}>
                  <option value="">無</option>
                  {(projects || []).filter((p: any) => p.isActive !== false || String(p.id) === String(form.projectId)).map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.isActive === false ? "（已停用）" : ""}</option>)}
                </select>
              </div>
              <div><Label>部門</Label>
                <LookupSelect className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.departmentId} onChange={e => setForm(p => ({ ...p, departmentId: e.target.value }))}>
                  <option value="">無</option>
                  {(departments || []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </LookupSelect>
              </div>
            </div>
            <div className="rounded-md border p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={form.isInternalTransfer}
                  onChange={e => setForm(p => ({ ...p, isInternalTransfer: e.target.checked }))}
                />
                內部轉撥
              </label>
              {form.isInternalTransfer && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><Label>轉出部門 *</Label>
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.transferFromDepartmentId} onChange={e => setForm(p => ({ ...p, transferFromDepartmentId: e.target.value }))}>
                      <option value="">請選擇</option>
                      {departments.filter((d: any) => d.isActive !== false).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div><Label>轉入部門 *</Label>
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.transferToDepartmentId} onChange={e => setForm(p => ({ ...p, transferToDepartmentId: e.target.value }))}>
                      <option value="">請選擇</option>
                      {departments.filter((d: any) => d.isActive !== false).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>分錄明細</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLine}><Plus size={14} className="mr-1" />新增行</Button>
              </div>
              <div className="space-y-2">
                <div className="hidden md:grid grid-cols-[2fr_1.2fr_1.4fr_1fr_1fr_40px] gap-2 text-xs font-medium text-muted-foreground">
                  <div>會計科目</div><div>客戶／廠商</div><div>摘要</div>
                  <div className="text-right">借方</div><div className="text-right">貸方</div><div></div>
                </div>
                {form.lines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-2 md:grid-cols-[2fr_1.2fr_1.4fr_1fr_1fr_40px] gap-2 items-center border-b pb-2 md:border-0 md:pb-0">
                    <LookupSelect className="col-span-2 md:col-span-1 flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm" value={line.accountId} onChange={e => updateLine(idx, "accountId", Number(e.target.value))}>
                      <option value={0}>請選擇科目</option>
                      {leafAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.accountNumber} - {a.accountName}</option>)}
                    </LookupSelect>
                    <Input list="je-parties" value={line.party || ""} onChange={e => updateLine(idx, "party", e.target.value)} placeholder="客戶／廠商" aria-label={`第 ${idx + 1} 行客戶或廠商`} />
                    <Input value={line.description || ""} onChange={e => updateLine(idx, "description", e.target.value)} placeholder="摘要" aria-label={`第 ${idx + 1} 行摘要`} />
                    <Input type="number" min={0} step={0.01} value={line.debit || ""} onChange={e => updateLine(idx, "debit", Number(e.target.value) || 0)} placeholder="0.00" />
                    <Input type="number" min={0} step={0.01} value={line.credit || ""} onChange={e => updateLine(idx, "credit", Number(e.target.value) || 0)} placeholder="0.00" />
                    <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} disabled={form.lines.length <= 2}><Trash2 size={14} className="text-destructive" /></Button>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-6 mt-2 font-bold text-sm">
                <span>合計：</span>
                <span className={!isBalanced ? "text-destructive" : ""}>借方 ${totalDebit.toFixed(2)}</span>
                <span className={!isBalanced ? "text-destructive" : ""}>貸方 ${totalCredit.toFixed(2)}</span>
              </div>
              {!isBalanced && <p className="text-sm text-destructive mt-1">借貸不平衡，差額 ${Math.abs(totalDebit - totalCredit).toFixed(2)}</p>}
            </div>
          </div>
          {editing && editing.status !== "Draft" && (
            <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50/50 p-3 dark:bg-amber-950/20">
              <Label htmlFor="edit-reason">修改原因 *</Label>
              <p className="text-xs text-muted-foreground">這筆已經入帳，按「送出修改申請」後要財務或超級管理員其一核准才會改（財務提出的由超級管理員核准）；審核人也可以直接調整內容。</p>
              <Input id="edit-reason" value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="例如：科目選錯，應該是文具用品" />
            </div>
          )}
      </DocWindow>

      <Dialog open={soBackfillOpen} onOpenChange={setSoBackfillOpen}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader><DialogTitle>補建訂單營收分錄</DialogTitle></DialogHeader>
          {soBackfillSummary && !soBackfillResult && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                以下為「已成立（已確認/已完成）但尚未開立發票、且尚無會計分錄」的銷貨單。補帳後這些訂單的營收會列入試算表、損益表與 BU 報表。
              </p>
              <p>
                可補建：<b>{soBackfillSummary.created ?? 0}</b> 筆
                {(soBackfillSummary.skippedLocked ?? 0) > 0 && <>，另有 <b>{soBackfillSummary.skippedLocked}</b> 筆落在關帳期間，預設不補帳。</>}
              </p>
              {(soBackfillSummary.skippedLocked ?? 0) > 0 && (
                <label className="flex items-center gap-2 cursor-pointer font-medium">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={soIncludeLocked} onChange={e => setSoIncludeLocked(e.target.checked)} />
                  一併補建關帳期間的訂單分錄（會影響已關帳期間的報表）
                </label>
              )}
              {(soBackfillSummary.created ?? 0) === 0 && (soBackfillSummary.skippedLocked ?? 0) === 0 && (
                <p className="text-muted-foreground">目前沒有需要補帳的訂單。</p>
              )}
            </div>
          )}
          {soBackfillResult && (
            <div className="space-y-3 text-sm">
              <p>已補建 <b>{soBackfillResult.created ?? 0}</b> 筆訂單營收分錄{(soBackfillResult.failed ?? 0) > 0 && <>，失敗 {soBackfillResult.failed} 筆</>}。</p>
              {Array.isArray(soBackfillResult.errors) && soBackfillResult.errors.length > 0 && (
                <ul className="list-disc pl-5 text-destructive">{soBackfillResult.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
              )}
              <p className="text-muted-foreground">請至試算表 / 損益表核對補帳前後的金額。</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSoBackfillOpen(false)}>{soBackfillResult ? "關閉" : "取消"}</Button>
            {!soBackfillResult && (
              <Button onClick={runSoBackfill} disabled={soBackfillRunning || ((soBackfillSummary?.created ?? 0) === 0 && !soIncludeLocked)}>
                {soBackfillRunning ? "補帳中..." : "開始補帳"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={backfillOpen} onOpenChange={setBackfillOpen}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader><DialogTitle>補建歷史發票分錄</DialogTitle></DialogHeader>
          {backfillSummary && !backfillResult && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                以下為尚未產生會計分錄的歷史發票（不含已取消），補帳後試算表與損益表即可看到過去的營收與成本。
              </p>
              <table className="w-full border text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-2">類型</th>
                    <th className="text-right px-3 py-2">筆數</th>
                    <th className="text-right px-3 py-2">金額（TWD）</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="px-3 py-2">銷貨發票</td>
                    <td className="px-3 py-2 text-right">{backfillSummary.eligible?.sales?.count ?? 0}</td>
                    <td className="px-3 py-2 text-right">${Number(backfillSummary.eligible?.sales?.amountTwd ?? 0).toLocaleString()}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="px-3 py-2">採購發票</td>
                    <td className="px-3 py-2 text-right">{backfillSummary.eligible?.purchase?.count ?? 0}</td>
                    <td className="px-3 py-2 text-right">${Number(backfillSummary.eligible?.purchase?.amountTwd ?? 0).toLocaleString()}</td>
                  </tr>
                  <tr className="border-t font-bold">
                    <td className="px-3 py-2">合計</td>
                    <td className="px-3 py-2 text-right">{backfillSummary.eligible?.count ?? 0}</td>
                    <td className="px-3 py-2 text-right">${Number(backfillSummary.eligible?.amountTwd ?? 0).toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
              {backfillSummary.lockDate && (backfillSummary.skippedLocked?.count ?? 0) > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 space-y-2">
                  <p>
                    另有 <b>{backfillSummary.skippedLocked.count}</b> 筆（${Number(backfillSummary.skippedLocked.amountTwd).toLocaleString()}）
                    落在關帳日 {backfillSummary.lockDate}（含）以前，預設不補帳。
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer font-medium">
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={includeLocked} onChange={e => setIncludeLocked(e.target.checked)} />
                    一併補建關帳期間的發票分錄（會影響已關帳期間的報表）
                  </label>
                </div>
              )}
              {(backfillSummary.skippedZeroAmount ?? 0) > 0 && (
                <p className="text-muted-foreground">另有 {backfillSummary.skippedZeroAmount} 筆金額為 0 或無效的發票不會產生分錄。</p>
              )}
              {(backfillSummary.eligible?.count ?? 0) === 0 && !includeLocked && (
                <p className="text-muted-foreground">目前沒有需要補帳的發票。</p>
              )}
            </div>
          )}
          {backfillResult && (
            <div className="space-y-3 text-sm">
              <p>
                已補建 <b>{backfillResult.created?.count ?? 0}</b> 筆分錄，合計 <b>${Number(backfillResult.created?.amountTwd ?? 0).toLocaleString()}</b>
                （銷貨 {backfillResult.created?.sales?.count ?? 0} 筆 ${Number(backfillResult.created?.sales?.amountTwd ?? 0).toLocaleString()}、
                採購 {backfillResult.created?.purchase?.count ?? 0} 筆 ${Number(backfillResult.created?.purchase?.amountTwd ?? 0).toLocaleString()}）。
              </p>
              <p className="text-muted-foreground">請至試算表 / 損益表核對補帳前後的金額。</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBackfillOpen(false)}>{backfillResult ? "關閉" : "取消"}</Button>
            {!backfillResult && (
              <Button
                onClick={runBackfill}
                disabled={backfillRunning || ((backfillSummary?.eligible?.count ?? 0) === 0 && !(includeLocked && (backfillSummary?.skippedLocked?.count ?? 0) > 0))}
              >
                {backfillRunning ? "補帳中..." : "確認補帳"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <JournalEntryDialog entryId={viewOpen && viewEntry ? viewEntry.id : null} onClose={() => { setViewOpen(false); fetchEntries(page); }} onEdit={openEdit} />
    </div>
  );
}
