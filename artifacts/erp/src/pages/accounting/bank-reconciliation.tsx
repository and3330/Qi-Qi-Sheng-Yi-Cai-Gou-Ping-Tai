import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Link2, Unlink, Wand2, ChevronRight, Upload, Sparkles, Check, BookPlus, Undo2 } from "lucide-react";
import { MasterLookup } from "@/components/shared/master-lookup";
import { ProjectField } from "@/components/shared/project-field";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = <T,>(path: string, opts?: RequestInit) =>
  fetch(`/erp-api${path}`, { headers: { "Content-Type": "application/json" }, ...opts })
    .then(async r => {
      if (!r.ok) { const body = await r.json().catch(() => null); throw new Error(body?.error || "請求失敗"); }
      return r.status === 204 ? (undefined as T) : r.json() as Promise<T>;
    });

const uploadCsv = (path: string, file: File) => {
  const formData = new FormData();
  formData.append("file", file);
  return fetch(`/erp-api${path}`, { method: "POST", body: formData })
    .then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error || "上傳失敗"); }); return r.json(); });
};

interface BankStatement { id: number; bankName: string; accountNumber: string | null; statementDate: string; openingBalance: string; closingBalance: string; status: string; }
interface BankEntry { id: number; statementId: number; transactionDate: string; description: string | null; debit: string; credit: string; balance: string; reference: string | null; matchedVoucherId: number | null; matchStatus: string; voucherNumber: string | null; journalEntryNumber?: string | null; }
interface StatementDetail extends BankStatement { entries: BankEntry[]; }
interface AiSuggestion { entryId: number; entryDescription: string | null; entryDate: string; amount: number; voucherId: number; voucherNumber: string; confidence: string; reason: string; }

export default function BankReconciliationPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [matchingEntry, setMatchingEntry] = useState<BankEntry | null>(null);
  const [matchVoucherId, setMatchVoucherId] = useState("");
  const [stmtForm, setStmtForm] = useState({ bankName: "", accountNumber: "", statementDate: "", openingBalance: "", closingBalance: "" });
  const [entryRows, setEntryRows] = useState([{ transactionDate: "", description: "", debit: "", credit: "", reference: "" }]);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [postingEntry, setPostingEntry] = useState<BankEntry | null>(null);
  const [postForm, setPostForm] = useState({ accountId: "", bankAccountId: "", description: "", projectId: "" });

  const { data: statements = [] } = useQuery<BankStatement[]>({ queryKey: ["bank-statements"], queryFn: () => api("/bank-statements") });
  const { data: detail } = useQuery<StatementDetail>({ queryKey: ["bank-statement", selectedId], queryFn: () => api(`/bank-statements/${selectedId}`), enabled: !!selectedId });
  const { data: vouchers = [] } = useQuery<any[]>({ queryKey: ["vouchers"], queryFn: () => api("/vouchers") });

  const createStmt = useMutation({
    mutationFn: (data: any) => api("/bank-statements", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bank-statements"] }); setCreateOpen(false); toast({ title: "已建立銀行對帳單" }); },
  });
  const deleteStmt = useMutation({
    mutationFn: (id: number) => api(`/bank-statements/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bank-statements"] }); if (selectedId === deleteStmt.variables) setSelectedId(null); toast({ title: "已刪除" }); },
  });
  const addEntries = useMutation({
    mutationFn: ({ id, entries }: { id: number; entries: any[] }) => api(`/bank-statements/${id}/entries`, { method: "POST", body: JSON.stringify({ entries }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bank-statement", selectedId] }); setEntryOpen(false); toast({ title: "已新增明細" }); },
  });
  const uploadCsvMut = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => uploadCsv(`/bank-statements/${id}/upload-csv`, file),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["bank-statement", selectedId] });
      const msg = `已匯入 ${data.imported} 筆資料`;
      const errMsg = data.errors?.length > 0 ? `\n${data.errors.join("\n")}` : "";
      toast({ title: msg, description: errMsg || undefined });
    },
    onError: (err: any) => toast({ title: "上傳失敗", description: err.message, variant: "destructive" }),
  });
  const autoMatch = useMutation({
    mutationFn: (id: number) => api<{ matched: number; total: number }>(`/bank-reconciliation/auto-match/${id}`, { method: "POST" }),
    onSuccess: (data: any) => { qc.invalidateQueries({ queryKey: ["bank-statement", selectedId] }); toast({ title: `自動比對完成: ${data.matched}/${data.total} 筆配對成功` }); },
  });
  const aiSuggest = useMutation({
    mutationFn: (id: number) => api<{ suggestions: AiSuggestion[]; unmatchedCount?: number }>(`/ai/bank-match/${id}`, { method: "POST" }),
    onSuccess: (data) => {
      setAiSuggestions(data.suggestions);
      toast({ title: data.suggestions.length > 0 ? `AI 找到 ${data.suggestions.length} 筆建議配對` : "AI 未找到可建議的配對" });
    },
    onError: (err: any) => toast({ title: "AI 對帳建議失敗", description: err.message, variant: "destructive" }),
  });
  const applySuggestion = useMutation({
    mutationFn: (s: AiSuggestion) => api(`/bank-reconciliation/entries/${s.entryId}/match`, { method: "PATCH", body: JSON.stringify({ matchedVoucherId: s.voucherId }) }),
    onSuccess: (_d, s) => {
      qc.invalidateQueries({ queryKey: ["bank-statement", selectedId] });
      setAiSuggestions(prev => prev.filter(x => x.entryId !== s.entryId));
      toast({ title: `已配對 ${s.voucherNumber}` });
    },
  });
  const manualMatch = useMutation({
    mutationFn: ({ entryId, matchedVoucherId }: { entryId: number; matchedVoucherId: number | null }) =>
      api(`/bank-reconciliation/entries/${entryId}/match`, { method: "PATCH", body: JSON.stringify({ matchedVoucherId }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bank-statement", selectedId] }); setMatchOpen(false); toast({ title: "已更新配對" }); },
  });

  const postJournal = useMutation({
    mutationFn: ({ entryId, body }: { entryId: number; body: Record<string, unknown> }) =>
      api<{ journalEntryNumber: string }>(`/bank-reconciliation/entries/${entryId}/journal`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ["bank-statement", selectedId] }); setPostingEntry(null); toast({ title: "已入帳", description: `分錄 ${data.journalEntryNumber}` }); },
    onError: (err: any) => toast({ title: "入帳失敗", description: err.message, variant: "destructive" }),
  });
  const undoJournal = useMutation({
    mutationFn: (entryId: number) => api(`/bank-reconciliation/entries/${entryId}/journal`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bank-statement", selectedId] }); toast({ title: "已取消入帳" }); },
    onError: (err: any) => toast({ title: "取消入帳失敗", description: err.message, variant: "destructive" }),
  });
  const isLeafAccount = (row: Record<string, any>) => !row.isGroup;

  const addEntryRow = () => setEntryRows([...entryRows, { transactionDate: "", description: "", debit: "", credit: "", reference: "" }]);
  const updateEntryRow = (idx: number, field: string, value: string) => {
    const rows = [...entryRows];
    (rows[idx] as any)[field] = value;
    setEntryRows(rows);
  };
  const removeEntryRow = (idx: number) => setEntryRows(entryRows.filter((_, i) => i !== idx));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">銀行對帳</h1>
        <Button onClick={() => { setStmtForm({ bankName: "", accountNumber: "", statementDate: "", openingBalance: "", closingBalance: "" }); setCreateOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" />新增對帳單
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">對帳單列表</h2>
          {statements.length === 0 && <Card><CardContent className="text-center text-muted-foreground py-8">尚無對帳單</CardContent></Card>}
          {statements.map(s => (
            <Card key={s.id} className={`cursor-pointer transition-colors ${selectedId === s.id ? "border-primary" : "hover:border-primary/50"}`} onClick={() => setSelectedId(s.id)}>
              <CardHeader className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">{s.bankName}</CardTitle>
                    <CardDescription className="text-xs">{s.statementDate} · {s.accountNumber || "N/A"}</CardDescription>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary" className={s.status === "Reconciled" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}>
                      {s.status === "Reconciled" ? "已對帳" : "待處理"}
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => { e.stopPropagation(); if (confirm("確定刪除？")) deleteStmt.mutate(s.id); }}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>

        <div className="lg:col-span-2 space-y-4">
          {!selectedId ? (
            <Card><CardContent className="text-center text-muted-foreground py-16">請選擇對帳單以檢視明細</CardContent></Card>
          ) : detail ? (
            <>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{detail.bankName} - {detail.statementDate}</h2>
                <Badge variant="secondary">期初: ${Number(detail.openingBalance).toLocaleString()}</Badge>
                <Badge variant="secondary">期末: ${Number(detail.closingBalance).toLocaleString()}</Badge>
                <div className="flex-1" />
                <Button variant="outline" size="sm" onClick={() => { setEntryRows([{ transactionDate: "", description: "", debit: "", credit: "", reference: "" }]); setEntryOpen(true); }}>
                  <Plus className="w-4 h-4 mr-1" />新增明細
                </Button>
                <Button variant="outline" size="sm" onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file"; input.accept = ".csv";
                  input.onchange = (e: any) => { const file = e.target.files?.[0]; if (file && selectedId) uploadCsvMut.mutate({ id: selectedId, file }); };
                  input.click();
                }}>
                  <Upload className="w-4 h-4 mr-1" />匯入 CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => autoMatch.mutate(selectedId!)}>
                  <Wand2 className="w-4 h-4 mr-1" />自動比對
                </Button>
                <Button variant="outline" size="sm" disabled={aiSuggest.isPending} onClick={() => aiSuggest.mutate(selectedId!)}>
                  <Sparkles className="w-4 h-4 mr-1" />{aiSuggest.isPending ? "AI 分析中…" : "AI 對帳建議"}
                </Button>
              </div>
              {aiSuggestions.length > 0 && (
                <Card className="border-primary/40">
                  <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-1"><Sparkles className="w-4 h-4" />AI 建議配對（{aiSuggestions.length}）</CardTitle></CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>交易日期</TableHead><TableHead>說明</TableHead><TableHead className="text-right">金額</TableHead>
                        <TableHead>建議傳票</TableHead><TableHead>信心</TableHead><TableHead>理由</TableHead><TableHead className="w-16">套用</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {aiSuggestions.map(s => (
                          <TableRow key={s.entryId}>
                            <TableCell className="text-sm">{s.entryDate}</TableCell>
                            <TableCell className="text-sm">{s.entryDescription || "-"}</TableCell>
                            <TableCell className="text-right">${s.amount.toLocaleString()}</TableCell>
                            <TableCell className="text-sm font-medium">{s.voucherNumber}</TableCell>
                            <TableCell>
                              <Badge variant="secondary" className={s.confidence === "high" ? "bg-green-100 text-green-800" : s.confidence === "medium" ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-800"}>
                                {s.confidence === "high" ? "高" : s.confidence === "medium" ? "中" : "低"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{s.reason}</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => applySuggestion.mutate(s)}>
                                <Check className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
              <Card><CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>日期</TableHead><TableHead>說明</TableHead><TableHead className="text-right">支出</TableHead>
                    <TableHead className="text-right">存入</TableHead><TableHead>參考</TableHead>
                    <TableHead>狀態</TableHead><TableHead>配對單據</TableHead><TableHead className="w-24">操作</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(!detail.entries || detail.entries.length === 0) && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">尚無明細</TableCell></TableRow>}
                    {detail.entries?.map(e => (
                      <TableRow key={e.id}>
                        <TableCell className="text-sm">{e.transactionDate}</TableCell>
                        <TableCell>{e.description || "-"}</TableCell>
                        <TableCell className="text-right">{Number(e.debit) > 0 ? `$${Number(e.debit).toLocaleString()}` : "-"}</TableCell>
                        <TableCell className="text-right">{Number(e.credit) > 0 ? `$${Number(e.credit).toLocaleString()}` : "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{e.reference || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={e.matchStatus === "Matched" ? "bg-green-100 text-green-800" : e.matchStatus === "Posted" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-800"}>
                            {e.matchStatus === "Matched" ? "已配對" : e.matchStatus === "Posted" ? "已入帳" : "未配對"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{e.voucherNumber || e.journalEntryNumber || "-"}</TableCell>
                        <TableCell>
                          {e.matchStatus === "Matched" ? (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => manualMatch.mutate({ entryId: e.id, matchedVoucherId: null })}>
                              <Unlink className="w-4 h-4" />
                            </Button>
                          ) : e.matchStatus === "Posted" ? (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="取消入帳" onClick={() => { if (confirm("取消入帳會刪除這筆明細的分錄，確定嗎？")) undoJournal.mutate(e.id); }}>
                              <Undo2 className="w-4 h-4" />
                            </Button>
                          ) : (
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="配對傳票" onClick={() => { setMatchingEntry(e); setMatchVoucherId(""); setMatchOpen(true); }}>
                                <Link2 className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="沒有傳票，直接入帳" onClick={() => { setPostingEntry(e); setPostForm(f => ({ accountId: "", projectId: f.projectId, bankAccountId: f.bankAccountId, description: e.description || "" })); }}>
                                <BookPlus className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </>
          ) : null}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新增銀行對帳單</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div><label className="text-sm font-medium">銀行名稱 *</label><Input value={stmtForm.bankName} onChange={e => setStmtForm({ ...stmtForm, bankName: e.target.value })} /></div>
            <div><label className="text-sm font-medium">帳號</label><Input value={stmtForm.accountNumber} onChange={e => setStmtForm({ ...stmtForm, accountNumber: e.target.value })} /></div>
            <div><label className="text-sm font-medium">對帳日期 *</label><Input type="date" value={stmtForm.statementDate} onChange={e => setStmtForm({ ...stmtForm, statementDate: e.target.value })} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="text-sm font-medium">期初餘額</label><Input type="number" value={stmtForm.openingBalance} onChange={e => setStmtForm({ ...stmtForm, openingBalance: e.target.value })} /></div>
              <div><label className="text-sm font-medium">期末餘額</label><Input type="number" value={stmtForm.closingBalance} onChange={e => setStmtForm({ ...stmtForm, closingBalance: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={() => createStmt.mutate(stmtForm)} disabled={!stmtForm.bankName || !stmtForm.statementDate}>建立</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
        <DialogContent className="md:max-w-3xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>新增對帳明細</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {entryRows.map((row, idx) => (
              <div key={idx} className="grid grid-cols-6 gap-2 items-end">
                <div><label className="text-xs">日期</label><Input type="date" value={row.transactionDate} onChange={e => updateEntryRow(idx, "transactionDate", e.target.value)} /></div>
                <div className="col-span-2"><label className="text-xs">說明</label><Input value={row.description} onChange={e => updateEntryRow(idx, "description", e.target.value)} /></div>
                <div><label className="text-xs">支出</label><Input type="number" value={row.debit} onChange={e => updateEntryRow(idx, "debit", e.target.value)} /></div>
                <div><label className="text-xs">存入</label><Input type="number" value={row.credit} onChange={e => updateEntryRow(idx, "credit", e.target.value)} /></div>
                <Button variant="ghost" size="icon" onClick={() => removeEntryRow(idx)} disabled={entryRows.length === 1}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addEntryRow}><Plus className="w-4 h-4 mr-1" />增加一列</Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntryOpen(false)}>取消</Button>
            <Button onClick={() => addEntries.mutate({ id: selectedId!, entries: entryRows.filter(r => r.transactionDate) })} disabled={!entryRows.some(r => r.transactionDate)}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={matchOpen} onOpenChange={setMatchOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>手動配對單據</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {matchingEntry && (
              <div className="text-sm p-3 bg-muted rounded">
                <p>日期: {matchingEntry.transactionDate}</p>
                <p>說明: {matchingEntry.description}</p>
                <p>金額: 支出 ${Number(matchingEntry.debit).toLocaleString()} / 存入 ${Number(matchingEntry.credit).toLocaleString()}</p>
              </div>
            )}
            <div>
              <label className="text-sm font-medium">選擇配對的單據</label>
              <LookupSelect value={matchVoucherId} onValueChange={setMatchVoucherId}>
                <SelectTrigger><SelectValue placeholder="選擇單據" /></SelectTrigger>
                <SelectContent>
                  {vouchers.map((v: any) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {v.voucherNumber} - {v.voucherType} - ${Number(v.totalAmount).toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </LookupSelect>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatchOpen(false)}>取消</Button>
            <Button onClick={() => manualMatch.mutate({ entryId: matchingEntry!.id, matchedVoucherId: Number(matchVoucherId) })} disabled={!matchVoucherId}>確認配對</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!postingEntry} onOpenChange={(o) => { if (!o) setPostingEntry(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>直接入帳</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {postingEntry && (
              <div className="text-sm p-3 bg-muted rounded">
                <p>日期: {postingEntry.transactionDate}</p>
                <p>說明: {postingEntry.description || "-"}</p>
                <p>{Number(postingEntry.credit) > 0 ? `存入 $${Number(postingEntry.credit).toLocaleString()}` : `支出 $${Number(postingEntry.debit).toLocaleString()}`}</p>
              </div>
            )}
            <p className="text-sm text-muted-foreground">給沒有對應傳票的交易用，例如手續費、利息。選好對方科目後會產生一筆已過帳的分錄。</p>
            <div>
              <label className="text-sm font-medium">對方科目 *</label>
              <MasterLookup source="accounts" value={postForm.accountId} onValueChange={v => setPostForm(f => ({ ...f, accountId: v }))} filter={isLeafAccount} clearable={false} placeholder="例如：手續費、利息收入" data-testid="select-bank-post-account" />
            </div>
            <div>
              <label className="text-sm font-medium">銀行科目</label>
              <MasterLookup source="accounts" value={postForm.bankAccountId} onValueChange={v => setPostForm(f => ({ ...f, bankAccountId: v }))} filter={isLeafAccount} placeholder="不指定則使用預設的現金/銀行科目" />
            </div>
            <ProjectField required={false} value={postForm.projectId} onChange={v => setPostForm(f => ({ ...f, projectId: v }))} />
            <p className="text-xs text-muted-foreground -mt-2">對方科目是收入或費用（手續費、利息）時一定要選；單純帳戶之間的轉帳可以不選。</p>
            <div><label className="text-sm font-medium">摘要</label><Input value={postForm.description} onChange={e => setPostForm(f => ({ ...f, description: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostingEntry(null)}>取消</Button>
            <Button
              disabled={!postForm.accountId || postJournal.isPending}
              onClick={() => postJournal.mutate({ entryId: postingEntry!.id, body: { accountId: Number(postForm.accountId), bankAccountId: postForm.bankAccountId ? Number(postForm.bankAccountId) : null, description: postForm.description, projectId: postForm.projectId ? Number(postForm.projectId) : null } })}
            >確認入帳</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
