import { useState } from "react";
import { selectableDepartments, departmentLabel } from "@/lib/select-options";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { MasterLookup } from "@/components/shared/master-lookup";
import { ProjectField } from "@/components/shared/project-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocWindow, DocStatus } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { call, money, post, selectClass } from "@/lib/call";
import { ChannelsTab } from "./integration-channels";

interface Source {
  id: number; code: string; name: string; apiKeyId: number | null; apiKeyName: string | null; isActive: boolean; note: string | null;
  defaultProjectId: number | null; defaultProjectName: string | null; defaultDepartmentId: number | null; defaultDepartmentName: string | null;
  defaultCashAccountId: number | null; defaultCashAccountName: string | null; counts: Record<string, number>;
  canPull: boolean; configured: boolean; envKey?: string;
}
interface Mapping { id: number; sourceId: number; externalType: string; label: string | null; projectId: number | null; projectName: string | null; departmentId: number | null; departmentName: string | null; revenueAccountId: number | null; revenueAccountName: string | null; expenseAccountId: number | null; expenseAccountName: string | null; defaultItemId: number | null; defaultItemName: string | null; templateId: number | null; templateName: string | null }
interface ItemMap { id: number; sourceId: number; externalSku: string; externalName: string | null; itemId: number; itemName: string | null; itemCode: string | null }
interface EventRow {
  id: number; sourceId: number; sourceName: string | null; kind: string; kindLabel: string; externalId: string; occurredAt: string; status: string;
  error: string | null; amount: number; summary: string | null; attempts: number; payload: unknown;
  result: { salesOrderNumber?: string; journalEntryNumbers?: string[]; storedValueBalance?: number; summary?: string } | null;
}
interface StoredValue { members: Array<{ sourceId: number; sourceName: string | null; customerId: number; customerName: string | null; email: string | null; balance: number; toppedUp: number; lastDate: string }>; totalBalance: number }
interface FormatInfo { endpoint: string; auth: string; notes: string[]; kinds: Array<{ kind: string; label: string; autoPosted: boolean }>; examples: Record<string, unknown> }

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  processed: { label: "已入帳", variant: "default" }, pending: { label: "待處理", variant: "secondary" },
  failed: { label: "失敗", variant: "destructive" }, ignored: { label: "已略過", variant: "outline" },
};
const emptySource = { id: 0, code: "", name: "", apiKeyId: "", defaultProjectId: "", defaultDepartmentId: "", defaultCashAccountId: "", isActive: true, note: "" };
const emptyMapping = { sourceId: "", externalType: "", label: "", projectId: "", departmentId: "", revenueAccountId: "", expenseAccountId: "", defaultItemId: "", templateId: "" };
const emptyItemMap = { sourceId: "", externalSku: "", externalName: "", itemId: "" };
const isCashAccount = (row: Record<string, unknown>) => !row.isGroup && row.accountType === "Asset" && /現金|銀行存款|零用金/.test(String(row.accountName || ""));
const isIncomeAccount = (row: Record<string, unknown>) => !row.isGroup && row.accountType === "Income";
const isExpenseAccount = (row: Record<string, unknown>) => !row.isGroup && row.accountType === "Expense";
const numberOrNull = (value: string) => (value ? Number(value) : null);

export default function IntegrationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("failed");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sourceForm, setSourceForm] = useState<typeof emptySource | null>(null);
  const [mappingForm, setMappingForm] = useState<typeof emptyMapping | null>(null);
  const [itemMapForm, setItemMapForm] = useState<typeof emptyItemMap | null>(null);
  const [viewing, setViewing] = useState<EventRow | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: sources = [], isLoading: loadingSources } = useQuery({ queryKey: ["/integrations/sources"], queryFn: () => call<Source[]>("integrations/sources") });
  const { data: events, isLoading: loadingEvents } = useQuery({
    queryKey: ["/integrations/events", statusFilter, sourceFilter],
    queryFn: () => call<EventRow[]>(`integrations/events?status=${statusFilter}${sourceFilter ? `&sourceId=${sourceFilter}` : ""}`),
  });
  const { data: mappings = [] } = useQuery({ queryKey: ["/integrations/mappings"], queryFn: () => call<Mapping[]>("integrations/mappings") });
  const { data: itemMaps = [] } = useQuery({ queryKey: ["/integrations/item-maps"], queryFn: () => call<ItemMap[]>("integrations/item-maps") });
  const { data: storedValue } = useQuery({ queryKey: ["/integrations/stored-value"], queryFn: () => call<StoredValue>("integrations/stored-value") });
  const { data: format } = useQuery({ queryKey: ["/integrations/format"], queryFn: () => call<FormatInfo>("integrations/format") });
  const { data: apiKeys = [] } = useQuery({ queryKey: ["/api-keys", "for-integrations"], queryFn: () => call<Array<{ id: number; keyName: string; permissions: string; isActive: boolean }>>("api-keys"), enabled: sourceForm !== null });
  const { data: departments = [] } = useQuery({ queryKey: ["/departments", "for-integrations"], queryFn: () => call<Array<{ id: number; name: string; isActive?: boolean }>>("departments"), enabled: sourceForm !== null || mappingForm !== null });

  // 銷貨訂單模組（居家、活動、課程…）：訂單對應可以指定進來的訂單要套哪一個
  const { data: templates = [] } = useQuery({ queryKey: ["/order-templates", "for-integrations"], queryFn: () => call<Array<{ id: number; name: string; businessType: string; isActive: boolean }>>("order-templates"), enabled: mappingForm !== null });

  const refresh = () => queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith("/integrations") });
  const fail = (error: unknown) => toast({ title: "沒有成功", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
  const run = async (work: () => Promise<void>) => { setBusy(true); try { await work(); refresh(); } catch (error) { fail(error); } finally { setBusy(false); } };
  const sourceName = (id: number) => sources.find(s => s.id === id)?.name || "—";
  const totalFailed = sources.reduce((sum, s) => sum + (s.counts.failed || 0), 0);
  const totalPending = sources.reduce((sum, s) => sum + (s.counts.pending || 0), 0);

  const saveSource = () => run(async () => {
    if (!sourceForm) return;
    const body = {
      code: sourceForm.code, name: sourceForm.name, isActive: sourceForm.isActive, note: sourceForm.note,
      apiKeyId: numberOrNull(sourceForm.apiKeyId), defaultProjectId: numberOrNull(sourceForm.defaultProjectId),
      defaultDepartmentId: numberOrNull(sourceForm.defaultDepartmentId), defaultCashAccountId: numberOrNull(sourceForm.defaultCashAccountId),
    };
    await post(sourceForm.id ? `integrations/sources/${sourceForm.id}` : "integrations/sources", body, sourceForm.id ? "PUT" : "POST");
    toast({ title: "已儲存來源" });
    setSourceForm(null);
  });
  const saveMapping = () => run(async () => {
    if (!mappingForm) return;
    await post("integrations/mappings", {
      sourceId: Number(mappingForm.sourceId), externalType: mappingForm.externalType, label: mappingForm.label,
      projectId: numberOrNull(mappingForm.projectId), departmentId: numberOrNull(mappingForm.departmentId),
      revenueAccountId: numberOrNull(mappingForm.revenueAccountId), expenseAccountId: numberOrNull(mappingForm.expenseAccountId), defaultItemId: numberOrNull(mappingForm.defaultItemId), templateId: numberOrNull(mappingForm.templateId),
    }, "PUT");
    toast({ title: "已儲存對應", description: "之前因為沒設定而失敗的單據，可以到收件匣按「重試」。" });
    setMappingForm(null);
  });
  const saveItemMap = () => run(async () => {
    if (!itemMapForm) return;
    await post("integrations/item-maps", { sourceId: Number(itemMapForm.sourceId), externalSku: itemMapForm.externalSku, externalName: itemMapForm.externalName, itemId: Number(itemMapForm.itemId) }, "PUT");
    toast({ title: "已儲存品項對應" });
    setItemMapForm(null);
  });
  const retry = (event: EventRow) => run(async () => {
    const result = await post<EventRow>(`integrations/events/${event.id}/retry`);
    if (result.status === "processed") toast({ title: "已入帳", description: result.result?.summary });
    else toast({ title: "還是沒有成功", description: result.error || "", variant: "destructive" });
    setViewing(null);
  });
  const ignore = (event: EventRow, restore = false) => {
    const reason = restore ? "" : prompt("略過的原因（例如：測試單、重複）：");
    if (!restore && reason === null) return;
    run(async () => { await post(`integrations/events/${event.id}/ignore`, restore ? { restore: true } : { reason }); toast({ title: restore ? "已取消略過" : "已略過" }); setViewing(null); });
  };
  const retryAll = () => run(async () => {
    let done = 0;
    for (const event of events || []) { const result = await post<EventRow>(`integrations/events/${event.id}/retry`); if (result.status === "processed") done++; }
    toast({ title: `重試完成：${done} 筆入帳`, description: done < (events?.length || 0) ? "其餘仍有問題，請看各筆的原因。" : undefined });
  });
  const pull = (source: Source) => run(async () => {
    const result = await post<{ fetched: number; processed: number; failed: number; alreadyDone: number; errors: string[] }>(`integrations/sources/${source.id}/pull`, {});
    toast({
      title: `${source.name}：抓到 ${result.fetched} 筆，新入帳 ${result.processed} 筆`,
      description: `之前已入帳 ${result.alreadyDone} 筆${result.failed > 0 ? `，失敗 ${result.failed} 筆（到收件匣看原因）` : ""}`,
      variant: result.failed > 0 ? "destructive" : undefined,
    });
  });
  const remove = (path: string, label: string) => { if (confirm(`確定刪除${label}？`)) run(async () => { await post(path, undefined, "DELETE"); toast({ title: "已刪除" }); }); };

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="外部串接" description="七期商城的訂單會自動進到 ERP 並歸到專案；其他系統也可以從這裡送資料進來" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">失敗待處理</p><p className={`text-2xl font-semibold tabular-nums ${totalFailed > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{totalFailed}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">待處理</p><p className="text-2xl font-semibold tabular-nums">{totalPending}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">已入帳</p><p className="text-2xl font-semibold tabular-nums">{sources.reduce((sum, s) => sum + (s.counts.processed || 0), 0)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">會員儲值餘額合計</p><p className="text-2xl font-semibold tabular-nums">{money(storedValue?.totalBalance)}</p></CardContent></Card>
      </div>

      <Tabs defaultValue="inbox">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="inbox">收件匣</TabsTrigger>
          <TabsTrigger value="sources">來源</TabsTrigger>
          <TabsTrigger value="mappings">訂單對應</TabsTrigger>
          <TabsTrigger value="items">品項對應</TabsTrigger>
          <TabsTrigger value="stored">儲值餘額</TabsTrigger>
          <TabsTrigger value="channels">金流通路</TabsTrigger>
          <TabsTrigger value="format">串接說明</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-36">
              <Label htmlFor="int-status" className="text-xs">狀態</Label>
              <select id="int-status" className={selectClass} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                {Object.entries(STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
              </select>
            </div>
            <div className="w-44">
              <Label htmlFor="int-source" className="text-xs">來源</Label>
              <select id="int-source" className={selectClass} value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
                <option value="">全部</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {statusFilter === "failed" && (events?.length || 0) > 0 && <Button variant="outline" onClick={retryAll} disabled={busy}><RefreshCw className="h-4 w-4 mr-1" />全部重試</Button>}
          </div>
          <Card><CardContent className="p-0 overflow-x-auto">
            <DataTable layoutId="integrations-events"
              isLoading={loadingEvents} data={events} onRowClick={(e: EventRow) => setViewing(e)}
              emptyMessage={statusFilter === "failed" ? "沒有失敗的單據" : "沒有單據"}
              columns={[
                { header: "單據", accessor: (e: EventRow) => <div><span className="font-medium">{e.kindLabel}　{e.externalId}</span><span className="block text-xs text-muted-foreground">{e.occurredAt}・{e.sourceName || "—"}・{money(e.amount)}</span></div> },
                { header: "內容", accessor: (e: EventRow) => <div className="text-sm max-w-[16rem] xl:max-w-md whitespace-normal break-words">{e.summary || "—"}{e.error && <span className={`block text-xs mt-0.5 ${e.status === "failed" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{e.error}</span>}{e.result?.summary && <span className="block text-xs text-muted-foreground mt-0.5">{e.result.summary}</span>}</div> },
                { header: "金額", accessor: (e: EventRow) => money(e.amount), className: "text-right hidden lg:table-cell" },
                { header: "狀態", accessor: (e: EventRow) => <Badge variant={STATUS[e.status]?.variant || "outline"}>{STATUS[e.status]?.label || e.status}</Badge> },
              ]}
            />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="sources" className="space-y-3">
          <div className="flex justify-end"><Button onClick={() => setSourceForm({ ...emptySource })}><Plus className="h-4 w-4 mr-1" />新增來源</Button></div>
          <Card><CardContent className="p-0 overflow-x-auto">
            <DataTable layoutId="integrations-sources"
              isLoading={loadingSources} data={sources} emptyMessage="還沒有來源。七期商城會自動建立，重新整理即可"
              onRowClick={(s: Source) => setSourceForm({ id: s.id, code: s.code, name: s.name, apiKeyId: s.apiKeyId ? String(s.apiKeyId) : "", defaultProjectId: s.defaultProjectId ? String(s.defaultProjectId) : "", defaultDepartmentId: s.defaultDepartmentId ? String(s.defaultDepartmentId) : "", defaultCashAccountId: s.defaultCashAccountId ? String(s.defaultCashAccountId) : "", isActive: s.isActive, note: s.note || "" })}
              columns={[
                { header: "來源", accessor: (s: Source) => <div><span className="font-medium">{s.name}</span><span className="block text-xs text-muted-foreground">{s.code}{s.isActive ? "" : "・已停用"}</span></div> },
                { header: "預設專案", accessor: (s: Source) => s.defaultProjectName || "—" },
                { header: "收款帳戶", accessor: (s: Source) => s.defaultCashAccountName || "預設", className: "hidden md:table-cell" },
                { header: "金鑰", accessor: (s: Source) => s.apiKeyName || "未綁定", className: "hidden md:table-cell" },
                { header: "單據", accessor: (s: Source) => <span className="text-sm">入帳 {s.counts.processed || 0}{(s.counts.failed || 0) > 0 && <span className="text-red-600 dark:text-red-400">・失敗 {s.counts.failed}</span>}</span> },
                { header: "同步", accessor: (s: Source) => !s.canPull ? <span className="text-xs text-muted-foreground">由對方送</span> : s.configured ? <Button size="sm" variant="outline" className="h-8" disabled={busy || !s.isActive} onClick={(e) => { e.stopPropagation(); pull(s); }}><RefreshCw className="h-3.5 w-3.5 mr-1" />立即同步</Button> : <span className="text-xs text-amber-700 dark:text-amber-400">未設定金鑰 {s.envKey}</span> },
              ]}
            />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="mappings" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">每一種訂單、費用、報酬要歸到哪個專案。沒設定的類型會用來源的預設專案；都沒有就會留在收件匣。費用一定要設費用科目。</p>
            <Button onClick={() => setMappingForm({ ...emptyMapping, sourceId: sources[0] ? String(sources[0].id) : "" })} disabled={sources.length === 0}><Plus className="h-4 w-4 mr-1" />新增對應</Button>
          </div>
          <Card><CardContent className="p-0 overflow-x-auto">
            <DataTable layoutId="integrations-mappings"
              isLoading={false} data={mappings} emptyMessage="還沒有對應設定"
              onRowClick={(m: Mapping) => setMappingForm({ sourceId: String(m.sourceId), externalType: m.externalType, label: m.label || "", projectId: m.projectId ? String(m.projectId) : "", departmentId: m.departmentId ? String(m.departmentId) : "", revenueAccountId: m.revenueAccountId ? String(m.revenueAccountId) : "", expenseAccountId: m.expenseAccountId ? String(m.expenseAccountId) : "", defaultItemId: m.defaultItemId ? String(m.defaultItemId) : "", templateId: m.templateId ? String(m.templateId) : "" })}
              columns={[
                { header: "來源", accessor: (m: Mapping) => sourceName(m.sourceId) },
                { header: "訂單類型", accessor: (m: Mapping) => <div><span className="font-medium">{m.label || m.externalType}</span><span className="block text-xs text-muted-foreground">{m.externalType === "*" ? "其他全部" : m.externalType}</span></div> },
                { header: "銷貨訂單模組", accessor: (m: Mapping) => m.templateName || "不套模組" },
                { header: "專案", accessor: (m: Mapping) => m.projectName || (m.templateName ? "跟模組" : "用來源預設") },
                { header: "部門", accessor: (m: Mapping) => m.departmentName || "—", className: "hidden xl:table-cell" },
                { header: "收入／費用科目", accessor: (m: Mapping) => m.expenseAccountName ? `費用：${m.expenseAccountName}` : m.revenueAccountName || "自動", className: "hidden xl:table-cell" },
                { header: "預設品項", accessor: (m: Mapping) => m.defaultItemName || "—", className: "hidden xl:table-cell" },
                { header: "", accessor: (m: Mapping) => <Button variant="ghost" size="icon" aria-label="刪除對應" onClick={(e) => { e.stopPropagation(); remove(`integrations/mappings/${m.id}`, "這筆對應"); }}><Trash2 className="h-4 w-4" /></Button> },
              ]}
            />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="items" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">對方網站的商品編號對到 ERP 的哪個品項。對得到的實體商品才會扣庫存、算成本。</p>
            <Button onClick={() => setItemMapForm({ ...emptyItemMap, sourceId: sources[0] ? String(sources[0].id) : "" })} disabled={sources.length === 0}><Plus className="h-4 w-4 mr-1" />新增品項對應</Button>
          </div>
          <Card><CardContent className="p-0 overflow-x-auto">
            <DataTable layoutId="integrations-item-maps"
              isLoading={false} data={itemMaps} emptyMessage="還沒有品項對應"
              columns={[
                { header: "來源", accessor: (m: ItemMap) => sourceName(m.sourceId) },
                { header: "對方的商品", accessor: (m: ItemMap) => <div><span className="font-medium">{m.externalSku}</span>{m.externalName && <span className="block text-xs text-muted-foreground">{m.externalName}</span>}</div> },
                { header: "ERP 品項", accessor: (m: ItemMap) => m.itemName ? `${m.itemName}（${m.itemCode}）` : "品項已刪除" },
                { header: "", accessor: (m: ItemMap) => <Button variant="ghost" size="icon" aria-label="刪除品項對應" onClick={() => remove(`integrations/item-maps/${m.id}`, "這筆品項對應")}><Trash2 className="h-4 w-4" /></Button> },
              ]}
            />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="stored" className="space-y-3">
          <p className="text-sm text-muted-foreground">會員先存進來、還沒用掉的錢。這是公司欠會員的（帳上記在「預收款項」），會員拿餘額買東西時才變成收入。</p>
          <Card><CardContent className="p-0 overflow-x-auto">
            <DataTable layoutId="integrations-stored-value"
              isLoading={!storedValue} data={storedValue?.members} emptyMessage="還沒有儲值紀錄"
              columns={[
                { header: "會員", accessor: (m: any) => <div><span className="font-medium">{m.customerName || "—"}</span><span className="block text-xs text-muted-foreground">{m.email || ""}</span></div> },
                { header: "來源", accessor: (m: any) => m.sourceName || "—", className: "hidden md:table-cell" },
                { header: "累計儲值", accessor: (m: any) => money(m.toppedUp), className: "text-right hidden md:table-cell" },
                { header: "目前餘額", accessor: (m: any) => <span className="font-medium">{money(m.balance)}</span>, className: "text-right" },
                { header: "最近異動", accessor: (m: any) => m.lastDate, className: "hidden md:table-cell" },
              ]}
            />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="channels"><ChannelsTab /></TabsContent>

        <TabsContent value="format">
          <Card><CardContent className="p-4 space-y-4 text-sm">
            <p>把這一頁給對方網站的工程師（或 AI）。所有網站都用同一種格式送資料，不用為每個網站另外開發。</p>
            <div><p className="text-xs text-muted-foreground">送資料的位址</p><p className="font-mono break-all">{format?.endpoint}</p></div>
            <div><p className="text-xs text-muted-foreground">身分驗證</p><p className="break-all">{format?.auth}　金鑰到「系統管理 → API 金鑰」建立，再到「來源」綁定。</p></div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">可以送的單據</p>
              <div className="flex flex-wrap gap-2">{format?.kinds.map(k => <Badge key={k.kind} variant={k.autoPosted ? "default" : "outline"}>{k.label}（{k.kind}）{k.autoPosted ? "" : "・先收下"}</Badge>)}</div>
            </div>
            <ul className="list-disc pl-5 space-y-1">{format?.notes.map(note => <li key={note}>{note}</li>)}</ul>
            {format && Object.entries(format.examples).map(([kind, example]) => (
              <div key={kind}>
                <p className="text-xs text-muted-foreground mb-1">範例：{kind}</p>
                <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">{JSON.stringify(example, null, 2)}</pre>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={sourceForm !== null} onOpenChange={(o) => { if (!o) setSourceForm(null); }}>
        <DialogContent className="md:max-w-lg max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{sourceForm?.id ? "編輯來源" : "新增來源"}</DialogTitle><DialogDescription>一個外部網站或系統。代號是對方送資料時用的名字，定了就不要改。七期商城的代號是 qiqi-shop（系統自動建立），ERP 每小時自動把已付款的商城訂單入帳。</DialogDescription></DialogHeader>
          {sourceForm && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label htmlFor="src-name">名稱 *</Label><Input id="src-name" value={sourceForm.name} onChange={e => setSourceForm({ ...sourceForm, name: e.target.value })} placeholder="CM生活+" /></div>
                <div className="space-y-1.5"><Label htmlFor="src-code">代號 *</Label><Input id="src-code" value={sourceForm.code} onChange={e => setSourceForm({ ...sourceForm, code: e.target.value.toLowerCase() })} placeholder="cm-life" /></div>
              </div>
              <ProjectField label="預設專案" required={false} value={sourceForm.defaultProjectId} onChange={v => setSourceForm({ ...sourceForm, defaultProjectId: v })} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="src-dept">預設部門</Label>
                  <select id="src-dept" className={selectClass} value={sourceForm.defaultDepartmentId} onChange={e => setSourceForm({ ...sourceForm, defaultDepartmentId: e.target.value })}>
                    <option value="">不指定</option>
                    {selectableDepartments(departments, sourceForm.defaultDepartmentId).map(d => <option key={d.id} value={d.id}>{departmentLabel(d)}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="src-key">API 金鑰</Label>
                  <select id="src-key" className={selectClass} value={sourceForm.apiKeyId} onChange={e => setSourceForm({ ...sourceForm, apiKeyId: e.target.value })}>
                    <option value="">不綁定（任何可寫入的金鑰都能送）</option>
                    {apiKeys.filter(k => k.permissions !== "read").map(k => <option key={k.id} value={k.id}>{k.keyName}{k.isActive ? "" : "（已停用）"}</option>)}
                  </select>
                </div>
              </div>
              <div><Label>錢進到哪個帳戶</Label><MasterLookup source="accounts" value={sourceForm.defaultCashAccountId} onValueChange={v => setSourceForm({ ...sourceForm, defaultCashAccountId: v })} filter={isCashAccount} placeholder="金流撥款進的銀行帳戶" /></div>
              <div className="space-y-1.5"><Label htmlFor="src-note">備註</Label><Input id="src-note" value={sourceForm.note} onChange={e => setSourceForm({ ...sourceForm, note: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm min-h-11"><input type="checkbox" className="h-4 w-4" checked={sourceForm.isActive} onChange={e => setSourceForm({ ...sourceForm, isActive: e.target.checked })} />啟用（停用後對方送來的資料會被退回）</label>
            </div>
          )}
          <DialogFooter className="gap-2">
            {sourceForm?.id ? <Button variant="ghost" className="text-red-600 dark:text-red-400 md:mr-auto" disabled={busy} onClick={() => { if (confirm("確定刪除這個來源？已經收過單據的來源不能刪除。")) run(async () => { await post(`integrations/sources/${sourceForm.id}`, undefined, "DELETE"); toast({ title: "已刪除" }); setSourceForm(null); }); }}>刪除</Button> : null}
            <Button variant="outline" onClick={() => setSourceForm(null)}>取消</Button>
            <Button onClick={saveSource} disabled={busy || !sourceForm?.name || !sourceForm?.code}>{busy ? "處理中…" : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mappingForm !== null} onOpenChange={(o) => { if (!o) setMappingForm(null); }}>
        <DialogContent className="md:max-w-lg max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>訂單對應</DialogTitle><DialogDescription>這個來源的這一種訂單、費用或報酬，進到 ERP 後歸到哪裡。</DialogDescription></DialogHeader>
          {mappingForm && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="map-source">來源 *</Label>
                  <select id="map-source" className={selectClass} value={mappingForm.sourceId} onChange={e => setMappingForm({ ...mappingForm, sourceId: e.target.value })}>
                    {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5"><Label htmlFor="map-type">訂單類型 *</Label><Input id="map-type" value={mappingForm.externalType} onChange={e => setMappingForm({ ...mappingForm, externalType: e.target.value })} placeholder="product、course、廣告、teaching" /><p className="text-xs text-muted-foreground">對方送來的 type（訂單類型、費用類別、報酬類別）；填 * 代表其他全部</p></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="map-label">顯示名稱</Label><Input id="map-label" value={mappingForm.label} onChange={e => setMappingForm({ ...mappingForm, label: e.target.value })} placeholder="商品訂單" /></div>
              <div className="space-y-1.5">
                <Label htmlFor="map-template">銷貨訂單模組</Label>
                <select id="map-template" className={selectClass} value={mappingForm.templateId} onChange={e => setMappingForm({ ...mappingForm, templateId: e.target.value })} data-testid="select-mapping-template">
                  <option value="">不套模組</option>
                  {templates.filter(t => t.isActive || String(t.id) === mappingForm.templateId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">這一類訂單進來時，會建成這個模組的銷貨單（例如居家、活動、課程）。下面沒選專案時，用模組綁定的專案。</p>
              </div>
              <ProjectField label="歸到哪個專案" required={false} value={mappingForm.projectId} onChange={v => setMappingForm({ ...mappingForm, projectId: v })} />
              <div className="space-y-1.5">
                <Label htmlFor="map-dept">部門</Label>
                <select id="map-dept" className={selectClass} value={mappingForm.departmentId} onChange={e => setMappingForm({ ...mappingForm, departmentId: e.target.value })}>
                  <option value="">不指定</option>
                  {selectableDepartments(departments, mappingForm.departmentId).map(d => <option key={d.id} value={d.id}>{departmentLabel(d)}</option>)}
                </select>
              </div>
              <div><Label>收入科目</Label><MasterLookup source="accounts" value={mappingForm.revenueAccountId} onValueChange={v => setMappingForm({ ...mappingForm, revenueAccountId: v })} filter={isIncomeAccount} placeholder="不選：實體商品記商品收入，其他記勞務收入" /></div>
              <div><Label>費用科目</Label><MasterLookup source="accounts" value={mappingForm.expenseAccountId} onValueChange={v => setMappingForm({ ...mappingForm, expenseAccountId: v })} filter={isExpenseAccount} placeholder="這個類型是費用時才要選（例如廣告費）" /></div>
              <div><Label>預設品項</Label><MasterLookup source="items" value={mappingForm.defaultItemId} onValueChange={v => setMappingForm({ ...mappingForm, defaultItemId: v })} placeholder="沒有商品編號的明細用這個（例如「課程服務」）" /><p className="mt-1 text-xs text-muted-foreground">課程、服務、票券通常選一個服務品項。預設品項不會扣庫存。</p></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMappingForm(null)}>取消</Button>
            <Button onClick={saveMapping} disabled={busy || !mappingForm?.sourceId || !mappingForm?.externalType}>{busy ? "處理中…" : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={itemMapForm !== null} onOpenChange={(o) => { if (!o) setItemMapForm(null); }}>
        <DialogContent className="md:max-w-md max-h-[92dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>品項對應</DialogTitle><DialogDescription>對方的商品編號 → ERP 品項。</DialogDescription></DialogHeader>
          {itemMapForm && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="im-source">來源 *</Label>
                <select id="im-source" className={selectClass} value={itemMapForm.sourceId} onChange={e => setItemMapForm({ ...itemMapForm, sourceId: e.target.value })}>
                  {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="im-sku">對方的商品編號 *</Label><Input id="im-sku" value={itemMapForm.externalSku} onChange={e => setItemMapForm({ ...itemMapForm, externalSku: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="im-name">對方的商品名稱</Label><Input id="im-name" value={itemMapForm.externalName} onChange={e => setItemMapForm({ ...itemMapForm, externalName: e.target.value })} /></div>
              <div><Label>ERP 品項 *</Label><MasterLookup source="items" value={itemMapForm.itemId} onValueChange={v => setItemMapForm({ ...itemMapForm, itemId: v })} clearable={false} placeholder="選擇品項" /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemMapForm(null)}>取消</Button>
            <Button onClick={saveItemMap} disabled={busy || !itemMapForm?.sourceId || !itemMapForm?.externalSku || !itemMapForm?.itemId}>{busy ? "處理中…" : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 一筆收到的串接紀錄：標題是對方送來的種類，所以版面固定存在「串接紀錄」底下 */}
      <DocWindow
        open={viewing !== null} onClose={() => setViewing(null)}
        name={viewing?.kindLabel || "串接紀錄"} layoutKey="串接紀錄" number={viewing?.externalId}
        status={viewing ? <DocStatus label={STATUS[viewing.status]?.label || viewing.status} tone={STATUS[viewing.status]?.variant} /> : undefined}
        description={viewing ? `${viewing.sourceName || ""}・${viewing.occurredAt}・${money(viewing.amount)}` : undefined}
        footer={<>
            {viewing?.status === "ignored" && <Button variant="outline" onClick={() => ignore(viewing, true)} disabled={busy}>取消略過</Button>}
            {(viewing?.status === "failed" || viewing?.status === "pending") && <Button variant="outline" onClick={() => ignore(viewing)} disabled={busy}>略過不入帳</Button>}
            {(viewing?.status === "failed" || viewing?.status === "pending") && <Button onClick={() => retry(viewing)} disabled={busy}><RefreshCw className="h-4 w-4 mr-1" />{busy ? "處理中…" : "重試"}</Button>}
            <Button variant="outline" onClick={() => setViewing(null)}>關閉</Button>
        </>}
      >
          {viewing && (
            <div className="space-y-3 text-sm">
              {viewing.error && <p className={viewing.status === "failed" ? "rounded-md bg-red-50 p-3 text-red-700 dark:bg-red-950/40 dark:text-red-300" : "text-muted-foreground"}>{viewing.error}</p>}
              {viewing.result && (
                <div className="rounded-md border p-3 space-y-1">
                  {viewing.result.summary && <p>{viewing.result.summary}</p>}
                  {viewing.result.journalEntryNumbers && viewing.result.journalEntryNumbers.length > 0 && <p className="text-muted-foreground">分錄：{viewing.result.journalEntryNumbers.join("、")}</p>}
                  {viewing.result.storedValueBalance !== undefined && <p className="text-muted-foreground">會員儲值餘額：{money(viewing.result.storedValueBalance)}</p>}
                </div>
              )}
              <div><p className="text-xs text-muted-foreground mb-1">對方送來的內容</p><pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto max-h-72">{JSON.stringify(viewing.payload, null, 2)}</pre></div>
            </div>
          )}
      </DocWindow>
    </div>
  );
}
