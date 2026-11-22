import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocWindow } from "@/components/shared/doc-window";
import { RelatedDocs } from "@/components/shared/related-docs";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { call, money, selectClass } from "@/lib/call";

/**
 * 歷史單據：從舊系統（Ecount）搬過來的單據，只能查、不能改。
 * 這些單據不會影響現在的庫存與帳（帳的部分已經用會計傳票搬進來）。
 */
interface TypeRow { docType: string; count: number; firstDate: string | null; lastDate: string | null; total: number }
interface DocRow { id: number; docType: string; docNumber: string; docDate: string | null; partyName: string | null; projectName: string | null; staffName: string | null; total: number | null; lineCount: number }
interface DocDetail extends DocRow { lines: Array<Record<string, string>> }
interface ListResult { data: DocRow[]; count: number; total: number; page: number; limit: number }

const PAGE_SIZE = 50;

export default function LegacyDocumentsPage() {
  const initial = new URLSearchParams(window.location.search);
  const [type, setType] = useState(initial.get("type") ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [keyword, setKeyword] = useState(initial.get("q") ?? "");
  const [q, setQ] = useState(initial.get("q") ?? "");
  const [page, setPage] = useState(1);
  // 從別張單的關聯單據點過來（?open=編號）：清單有分頁，所以直接照編號打開，不從清單裡找
  const [viewingId, setViewingId] = useState<number | null>(() => {
    const id = Number(initial.get("open"));
    return Number.isInteger(id) && id > 0 ? id : null;
  });

  const { data: types = [] } = useQuery({ queryKey: ["/legacy-documents/types"], queryFn: () => call<TypeRow[]>("legacy-documents/types") });
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (type) params.set("type", type);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (q) params.set("q", q);
  const { data: result, isLoading } = useQuery({ queryKey: ["/legacy-documents", type, from, to, q, page], queryFn: () => call<ListResult>(`legacy-documents?${params.toString()}`) });
  const { data: detail, isLoading: loadingDetail } = useQuery({ queryKey: ["/legacy-documents", viewingId], queryFn: () => call<DocDetail>(`legacy-documents/${viewingId}`), enabled: viewingId !== null });

  const totalDocs = types.reduce((sum, t) => sum + t.count, 0);
  const pages = Math.max(1, Math.ceil((result?.count ?? 0) / PAGE_SIZE));
  const reset = (change: () => void) => { change(); setPage(1); };
  const search = () => reset(() => setQ(keyword.trim()));
  const columns = detail ? [...new Set(detail.lines.flatMap(line => Object.keys(line)))].filter(key => detail.lines.some(line => (line[key] ?? "") !== "")) : [];

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="歷史單據" description={`從 Ecount 搬過來的舊單據，共 ${totalDocs.toLocaleString()} 張。只能查詢，不會影響現在的庫存與帳`} />

      <Card><CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="legacy-type">種類</Label>
            <select id="legacy-type" className={selectClass} value={type} onChange={e => reset(() => setType(e.target.value))} data-testid="select-legacy-type">
              <option value="">全部（{totalDocs.toLocaleString()}）</option>
              {types.map(t => <option key={t.docType} value={t.docType}>{t.docType}（{t.count.toLocaleString()}）</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="legacy-from">從</Label><Input id="legacy-from" type="date" value={from} onChange={e => reset(() => setFrom(e.target.value))} /></div>
          <div className="space-y-1.5"><Label htmlFor="legacy-to">到</Label><Input id="legacy-to" type="date" value={to} onChange={e => reset(() => setTo(e.target.value))} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="legacy-q">關鍵字</Label>
            <div className="flex gap-2">
              <Input id="legacy-q" value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => { if (e.key === "Enter") search(); }} placeholder="客戶、品項、號碼、專案" data-testid="input-legacy-search" />
              <Button variant="outline" size="icon" className="shrink-0 h-10 w-10" onClick={search} aria-label="搜尋"><Search className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">符合條件：<span className="font-medium text-foreground tabular-nums">{(result?.count ?? 0).toLocaleString()}</span> 張{type && (result?.total ?? 0) !== 0 && <>，金額合計 <span className="font-medium text-foreground tabular-nums">{money(result?.total)}</span></>}</p>
      </CardContent></Card>

      <Card><CardContent className="p-0 overflow-x-auto">
        <DataTable
          isLoading={isLoading} data={result?.data} onRowClick={(d: DocRow) => setViewingId(d.id)} defaultPageSize={PAGE_SIZE}
          emptyMessage={totalDocs === 0 ? "還沒有歷史單據" : "沒有符合條件的單據"}
          columns={[
            { header: "單據", accessor: (d: DocRow) => <div><span className="font-medium">{d.docType}　{d.docNumber}</span><span className="block text-xs text-muted-foreground">{d.docDate || "—"}・{d.lineCount} 筆明細{d.staffName ? `・${d.staffName}` : ""}</span></div> },
            { header: "對象", accessor: (d: DocRow) => <div className="max-w-[16rem] whitespace-normal break-words">{d.partyName || "—"}{d.projectName && <span className="block text-xs text-muted-foreground">{d.projectName}</span>}</div> },
            { header: "金額", accessor: (d: DocRow) => (d.total === null ? "—" : <span className="tabular-nums">{money(d.total)}</span>), className: "text-right" },
          ]}
        />
      </CardContent></Card>

      <div className="flex items-center justify-center gap-3">
        <Button variant="outline" size="sm" className="h-9" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4 mr-1" />上一頁</Button>
        <span className="text-sm text-muted-foreground tabular-nums">第 {page}／{pages} 頁</span>
        <Button variant="outline" size="sm" className="h-9" disabled={page >= pages} onClick={() => setPage(page + 1)}>下一頁<ChevronRight className="h-4 w-4 ml-1" /></Button>
      </div>

      <DocWindow
        open={viewingId !== null}
        onClose={() => setViewingId(null)}
        name={detail ? detail.docType : "歷史單據"}
        number={detail?.docNumber}
        description={detail ? [detail.docDate, detail.partyName, detail.projectName, detail.staffName].filter(Boolean).join("・") || "Ecount 歷史單據" : "讀取中…"}
        wide
        footer={<Button variant="outline" onClick={() => setViewingId(null)}>關閉</Button>}
      >
          {loadingDetail || !detail ? <p className="py-8 text-center text-sm text-muted-foreground">讀取中…</p> : (
            <div className="space-y-3 min-w-0">
              {detail.total !== null && <p className="text-sm">金額合計：<span className="font-semibold tabular-nums">{money(detail.total)}</span></p>}
              <div className="max-w-full overflow-x-auto rounded-md border">
                <table className="w-max min-w-full text-sm">
                  <thead className="bg-muted/50"><tr>{columns.map(c => <th key={c} className="px-3 py-2 text-left font-medium whitespace-nowrap">{c}</th>)}</tr></thead>
                  <tbody>{detail.lines.map((line, i) => <tr key={i} className="border-t">{columns.map(c => <td key={c} className="px-3 py-2 align-top max-w-[18rem] whitespace-normal break-words">{line[c] || ""}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">這是從 Ecount 搬過來的原始內容，欄位名稱照舊系統。</p>
              <RelatedDocs type="legacy_document" id={detail.id} onNavigate={() => setViewingId(null)} />
            </div>
          )}
      </DocWindow>
    </div>
  );
}
