import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ExternalLink } from "lucide-react";
import { call, money } from "@/lib/call";
import { DocSection, DocStatus, statusTone } from "@/components/shared/doc-window";
import { JournalEntryDialog } from "@/components/accounting/journal-entry-dialog";

/**
 * 關聯單據（全系統共用）：給單據種類和編號，自動列出整條單據鏈——
 *   來源單據：這張單從哪張來（一路往上追到報價單、詢價單）
 *   後續單據：這張單產生了哪些單（出貨、發票、退貨、收付款…）
 *   分錄　　：這張單開出的分錄和沖銷分錄（財務才看得到，點了直接開分錄視窗）
 * 每個單據視窗都放這一個，不用各頁自己湊（老闆 2026-11-17）。
 */
export type RelatedDocType =
  | "quotation" | "sales_order" | "delivery_note" | "sales_return"
  | "rfq" | "purchase_order" | "purchase_receipt" | "purchase_return"
  | "invoice" | "payment_request" | "voucher" | "advance" | "stock_count" | "work_order"
  | "material_request" | "subcontract_order" | "service_fee" | "asset" | "stock_entry" | "salary_slip"
  | "recurring_invoice" | "legacy_document";

interface RelatedDoc {
  group: "source" | "next" | "entry"; type: string; id: number; label: string; number: string;
  date: string | null; status: string | null; amount: number | null; href: string | null;
}

const STATUS: Record<string, string> = {
  Draft: "草稿", Open: "進行中", Pending: "待審核", Submitted: "已送出", Confirmed: "已確認", Approved: "已核准", Rejected: "已退回",
  "To Deliver": "待出貨", "To Receive": "待收貨", "To Bill": "待開票", Delivered: "已出貨", Received: "已收貨", Completed: "已完成",
  Posted: "已入帳", Paid: "已付款", Unpaid: "未付款", "Partially Paid": "部分付款", Overdue: "逾期", Settled: "已結清",
  Cancelled: "已取消", Voided: "已作廢", Reversed: "已沖銷", WrittenOff: "已沖呆帳", Awarded: "已選定", Accepted: "已接受", Expired: "已過期",
  Sent: "已送出", Ordered: "已轉訂單", "In Progress": "進行中", Returned: "已退回", open: "未還清", settled: "已還清", voided: "已作廢",
  InUse: "使用中", Disabled: "已停用",
};
const GROUPS: Array<{ key: RelatedDoc["group"]; title: string }> = [
  { key: "source", title: "來源單據" },
  { key: "next", title: "後續單據" },
  { key: "entry", title: "分錄" },
];

export function RelatedDocs({ type, id, onNavigate }: { type: RelatedDocType; id: number | null | undefined; /** 點單號跳到別頁之前，先把目前的視窗關掉 */ onNavigate?: () => void }) {
  const [entryId, setEntryId] = useState<number | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["/related-documents", type, id],
    queryFn: () => call<RelatedDoc[]>(`related-documents/${type}/${id}`),
    enabled: !!id,
    staleTime: 15_000,
  });
  if (!id) return null;
  const list = data ?? [];
  return (
    <DocSection title="關聯單據">
      <div data-testid="related-docs">
        {isLoading ? <p className="text-xs text-muted-foreground">讀取中…</p>
          : isError ? <p className="text-xs text-muted-foreground">關聯單據讀取失敗，請關掉視窗再開一次。</p>
          : list.length === 0 ? <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">這張單目前沒有關聯的單據。</p>
          : (
            <div className="space-y-3">
              {GROUPS.map(g => {
                const rows = list.filter(d => d.group === g.key);
                if (rows.length === 0) return null;
                return (
                  <div key={g.key}>
                    <p className="mb-1 text-xs text-muted-foreground">{g.title}（{rows.length}）</p>
                    <ul className="divide-y rounded-md border">
                      {rows.map(d => (
                        <li key={`${d.type}-${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid={`related-${d.type}-${d.id}`}>
                          <span className="w-20 shrink-0 text-muted-foreground">{d.label}</span>
                          <span className="min-w-0 flex-1">
                            {d.type === "journal_entry"
                              ? <button type="button" onClick={() => setEntryId(d.id)} className="inline-flex min-h-[32px] items-center break-all text-left font-medium text-primary hover:underline">{d.number}</button>
                              : d.href
                                ? <Link href={d.href} onClick={onNavigate} className="inline-flex min-h-[32px] items-center gap-1 break-all font-medium text-primary hover:underline">{d.number}<ExternalLink className="h-3.5 w-3.5 shrink-0" /></Link>
                                : <span className="break-all font-medium">{d.number}</span>}
                          </span>
                          {d.date && <span className="text-xs text-muted-foreground tabular-nums">{d.date}</span>}
                          {d.amount !== null && <span className="tabular-nums">{money(d.amount)}</span>}
                          {d.status && <DocStatus label={STATUS[d.status] ?? d.status} tone={statusTone(d.status)} />}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
      </div>
      {entryId !== null && <JournalEntryDialog entryId={entryId} onClose={() => setEntryId(null)} />}
    </DocSection>
  );
}

/**
 * 從關聯單據點過來時，網址會帶 ?open=編號：清單載入後自動打開那一張。
 * 每個清單頁放一行：useOpenFromUrl(rows, setDetail)
 */
export function useOpenFromUrl<Row extends { id: number }>(rows: Row[] | undefined, open: (row: Row) => void) {
  const [target, setTarget] = useState<number | null>(() => {
    const id = Number(new URLSearchParams(window.location.search).get("open"));
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  useEffect(() => {
    if (target === null || !rows || rows.length === 0) return;
    const row = rows.find(r => r.id === target);
    setTarget(null);
    if (row) open(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, target]);
}
