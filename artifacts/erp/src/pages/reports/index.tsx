import { useMemo, useState } from "react";
import { Link } from "wouter";
import { BarChart3, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { navGroups } from "@/components/layout/sidebar";
import { useMenuAllowed } from "@/hooks/use-menu-allowed";

/**
 * 報表中心（老闆 2026-11-16）：所有報表集中在這一頁，依類別排好，點了才進去那張報表。
 * 能不能看沿用選單的權限設定：選單上看不到的報表，這裡也不會出現。
 * 「會計帳簿」「經營資料」兩頁裡面各有很多張報表，這裡直接攤開列出來，不用先進去再找。
 */
interface Entry { label: string; path: string; desc: string; /** 權限看哪一個選單項目（攤開的子報表用上層那一頁的權限） */ gate?: string }
interface Section { title: string; entries: Entry[] }

const books = (kind: string, label: string, desc: string): Entry => ({ label, path: `/reports/books/${kind}`, desc, gate: "/reports/books" });
const biz = (kind: string, label: string, desc: string): Entry => ({ label, path: `/reports/business/${kind}`, desc, gate: "/reports/business" });

const SECTIONS: Section[] = [
  {
    title: "財務報表",
    entries: [
      { label: "損益表", path: "/accounting/income-statement", desc: "一段期間的收入、成本、費用和損益" },
      { label: "資產負債表", path: "/accounting/balance-sheet", desc: "某一天的資產、負債和權益" },
      { label: "現金流量表", path: "/reports/cash-flow", desc: "現金從哪裡來、花到哪裡去" },
      { label: "試算表", path: "/reports/trial-balance", desc: "各科目的借貸合計與餘額" },
      { label: "月損益報表", ...pick(biz("monthly-pl", "", "損益科目每個月一欄，最後一欄合計")) },
      { label: "科目明細表", ...pick(biz("account-detail", "", "每個科目的餘額，往來科目拆到客戶、供應商")) },
      { label: "部門損益", path: "/hr/dept-financials", desc: "每個部門的收入、費用和損益" },
      { label: "BU 報表", path: "/reports/bu", desc: "各事業單位的營收與損益" },
      { label: "月結摘要", path: "/reports/monthly-digest", desc: "當月營運與財務的重點整理" },
    ],
  },
  {
    title: "會計帳簿",
    entries: [
      books("journal", "日記簿", "依日期列出每張傳票的每一行"),
      { label: "總分類帳", path: "/reports/general-ledger", desc: "單一科目的每一筆分錄與餘額" },
      books("period", "日/月合計表", "每天或每月各科目的借貸合計"),
      books("trial", "餘額試算表", "結轉金額加本期發生額等於期末金額"),
      books("cash", "現金出納帳", "現金科目的收支與餘額"),
      books("account-party", "科目/客戶/供應商明細帳", "先依科目、再依客戶或供應商分段"),
      books("party-account", "客戶/供應商/科目明細帳", "先依客戶或供應商、再依科目分段"),
      books("account-summary", "科目摘要明細帳", "先依科目、再依摘要分段"),
      biz("account-changes", "科目增減紀錄", "所選科目每一天的增加、減少與餘額"),
      biz("vat", "進項/銷項帳簿", "有營業稅的傳票：發票號碼、稅前金額、營業稅"),
    ],
  },
  {
    title: "資金與收付款",
    entries: [
      biz("fund-daily", "資金日報表", "各帳戶今天的結轉、增加、減少和餘額"),
      biz("fund-status", "資金情況表", "各科目、各客戶或供應商的結轉、增減、餘額"),
      biz("cash-movement", "現金流動", "期初資金、增加、減少、期末資金，可和前期比較"),
      biz("fund-detail", "資金收支明細", "資金的增加和減少逐筆列出"),
      biz("receipts", "收款單合計", "每一筆收款：帳戶、客戶、金額、手續費"),
      biz("payments", "付款單合計", "每一筆付款：帳戶、供應商、金額、手續費"),
      biz("advances", "暫付款單合計", "預付、代墊款科目的每一筆"),
    ],
  },
  {
    title: "應收與應付",
    entries: [
      { label: "應收帳齡", path: "/reports/ar-aging", desc: "客戶欠款依逾期天數分段" },
      { label: "應付帳齡", path: "/reports/ap-aging", desc: "欠供應商的款依逾期天數分段" },
      biz("ar-aging", "應收餘額分析表", "每個客戶的應收餘額，按發生月份拆"),
      biz("ap-aging", "應付餘額分析表", "每個供應商的應付餘額，按發生月份拆"),
      biz("ledger-1", "客戶/供應商管理帳簿 I", "應收或應付依對象分段的明細"),
      biz("ledger-2", "客戶/供應商管理帳簿 II", "每個對象一列：結轉、借方、貸方、餘額"),
      biz("party-tx", "客戶/供應商交易明細", "每個對象期間內的所有分錄"),
    ],
  },
  {
    title: "銷售、採購與庫存",
    entries: [
      { label: "銷售分析", path: "/reports/sales-analysis", desc: "各客戶、各品項的銷售金額與趨勢" },
      { label: "毛利分析", path: "/reports/gross-margin", desc: "各品項、各訂單的毛利" },
      biz("monthly-sales", "月銷項合計表", "每個客戶每月的含稅銷售額"),
      { label: "採購分析", path: "/reports/purchase-analysis", desc: "各供應商、各品項的採購金額" },
      biz("monthly-purchase", "月進項合計表", "每個供應商每月新增的應付帳款"),
      { label: "庫存狀況", path: "/reports/inventory-status", desc: "各品項的庫存數量與金額" },
    ],
  },
  {
    title: "預算與合計",
    entries: [
      { label: "預算vs實際", path: "/reports/budget-vs-actual", desc: "各科目的預算和實際花費比較" },
      biz("summary", "會計合計表", "依科目、對象、部門、專案或月份合計借貸"),
    ],
  },
  {
    title: "人事",
    entries: [
      { label: "出勤彙總", path: "/reports/attendance-summary", desc: "每位員工的出勤、遲到、請假天數" },
      { label: "薪資彙總", path: "/reports/salary-summary", desc: "各月薪資、保費與扣款合計" },
    ],
  },
];

/** 攤開的子報表放在別的分類時用：只取網址、說明和權限 */
function pick(e: Entry): Omit<Entry, "label"> { return { path: e.path, desc: e.desc, gate: e.gate }; }

export default function ReportCenter() {
  const { allowed } = useMenuAllowed();
  const [q, setQ] = useState("");
  // 每張報表的預設角色沿用選單定義
  const rolesOf = useMemo(() => {
    const m = new Map<string, readonly string[] | undefined>();
    navGroups.forEach(g => g.items.forEach(n => n.children?.forEach(c => m.set(c.path, c.roles))));
    return m;
  }, []);
  const word = q.trim().toLowerCase();
  const sections = SECTIONS.map(s => ({
    ...s,
    entries: s.entries.filter(e => {
      const gate = e.gate ?? e.path;
      return allowed(gate, rolesOf.get(gate)) && (!word || e.label.toLowerCase().includes(word) || e.desc.toLowerCase().includes(word));
    }),
  })).filter(s => s.entries.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <BarChart3 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">報表中心</h1>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" value={q} onChange={e => setQ(e.target.value)} placeholder="找報表，例如：應收、損益" aria-label="找報表" data-testid="input-report-search" />
        </div>
      </div>
      {sections.length === 0 && <p className="text-muted-foreground">{word ? "找不到符合的報表，換個字試試。" : "你目前沒有可以看的報表。需要的話請管理員開權限。"}</p>}
      {sections.map(s => (
        <section key={s.title} className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{s.title}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {s.entries.map(e => (
              <Link key={e.path} href={e.path} data-testid={`report-${e.path.split("/").slice(-2).join("-")}`}
                className="block min-h-[44px] rounded-lg border bg-card p-3 transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="font-medium">{e.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{e.desc}</div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
