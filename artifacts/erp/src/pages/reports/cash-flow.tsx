import { useState, useEffect } from "react";
import { ReportHeader } from "@/components/shared/report-header";
import { fmtMoney } from "@/lib/report-format";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { ExportMenu } from "@/components/shared/export-menu";
import { MobileCard, MobileCardHeader, MobileCardGrid, MobileCardItem, MobileTotalCard } from "@/components/shared/mobile-card";
import type { ExportOptions, ExportRow } from "@/lib/export-utils";
import type { CashFlowData, CashFlowItem } from "./types";
import { AccountDrillDialog, DrillAmount, type DrillTarget } from "@/components/shared/account-drill";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

type ViewMode = "vertical" | "horizontal";
type PeriodMode = "month" | "year" | "custom";
const currentMonth = new Date().toISOString().slice(0, 7);
const currentYear = String(new Date().getFullYear());
const periodDates = (mode: Exclude<PeriodMode, "custom">, value: string): [string, string] => {
  if (mode === "year") return [`${value}-01-01`, `${value}-12-31`];
  const [year, month] = value.split("-").map(Number);
  return [`${value}-01`, new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)];
};

export default function CashFlowPage() {
  const reloadKey = useAutoReloadKey();
  const [startDate, setStartDate] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [periodMode, setPeriodMode] = useState<PeriodMode>("year");
  const [periodValue, setPeriodValue] = useState(currentYear);
  const [compareStartDate, setCompareStartDate] = useState(() => `${new Date().getFullYear() - 1}-01-01`);
  const [compareEndDate, setCompareEndDate] = useState(() => `${new Date().getFullYear() - 1}-12-31`);
  const [viewMode, setViewMode] = useState<ViewMode>("vertical");
  const [data, setData] = useState<CashFlowData | null>(null);
  const [compareData, setCompareData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  // 這次查詢實際用的期間（點數字看明細時要用同一組）
  const [queried, setQueried] = useState({ startDate, endDate, compareStartDate, compareEndDate });

  const fetchCashFlow = async (sd: string, ed: string): Promise<CashFlowData | null> => {
    const params = new URLSearchParams();
    if (sd) params.set("startDate", sd);
    if (ed) params.set("endDate", ed);
    const res = await fetch(`/erp-api/reports/cash-flow?${params}`);
    if (!res.ok) return null;
    return res.json();
  };

  const fetchReport = async () => {
    setLoading(true);
    try {
      const main = await fetchCashFlow(startDate, endDate);
      setData(main);
      setQueried({ startDate, endDate, compareStartDate, compareEndDate });
      if (viewMode === "horizontal") {
        const compare = await fetchCashFlow(compareStartDate, compareEndDate);
        setCompareData(compare);
      } else {
        setCompareData(null);
      }
    } catch {
      setData(null);
      setCompareData(null);
    }
    setLoading(false);
  };

  useEffect(() => { fetchReport(); }, [reloadKey]);

  const fmt = (n: number) => fmtMoney(n);

  // 點數字看明細：有科目編號（accountId）而且金額不是 0 才可以點
  const openDrill = (title: string, accountIds: number[], compare = false) => setDrill({
    title, accountIds,
    startDate: compare ? queried.compareStartDate : queried.startDate,
    endDate: compare ? queried.compareEndDate : queried.endDate,
  });
  const itemAmount = (item: CashFlowItem | undefined, text: string, compare = false) => {
    const id = item?.accountId;
    return item && id != null && item.amount !== 0
      ? <DrillAmount onClick={() => openDrill(`${item.accountNumber} ${item.accountName}`, [id], compare)}>{text}</DrillAmount>
      : text;
  };
  const totalAmount = (title: string, items: CashFlowItem[] | undefined, total: number, text: string, compare = false) => {
    const ids = (items ?? []).map(i => i.accountId).filter((id): id is number => id != null);
    // 要整段的每個科目都有編號才開，不然明細會少算
    return total !== 0 && ids.length > 0 && ids.length === (items ?? []).length
      ? <DrillAmount onClick={() => openDrill(title, ids, compare)}>{text}</DrillAmount>
      : text;
  };
  const applyPeriod = (mode: PeriodMode, value: string) => {
    setPeriodMode(mode);
    setPeriodValue(value);
    if (mode !== "custom") {
      const [start, end] = periodDates(mode, value);
      setStartDate(start);
      setEndDate(end);
    }
  };

  const buildExport = (): ExportOptions => {
    if (!data) return { title: "", subtitle: "", fileName: "", headers: [], columnKeys: [], rows: [] };
    const rows: ExportRow[] = [];
    const addSection = (title: string, items: CashFlowItem[], total: number, cItems?: CashFlowItem[], cTotal?: number) => {
      if (viewMode === "horizontal" && cTotal !== undefined) {
        rows.push({ code: "", name: title, amount: fmt(total), compareAmount: fmt(cTotal), variance: fmt(total - cTotal) });
        for (const i of items) {
          const ci = cItems?.find(c => c.accountNumber === i.accountNumber);
          rows.push({ code: i.accountNumber, name: `  ${i.accountName}`, amount: fmt(i.amount), compareAmount: fmt(ci?.amount || 0), variance: fmt(i.amount - (ci?.amount || 0)) });
        }
      } else {
        rows.push({ code: "", name: title, amount: fmt(total) });
        for (const i of items) rows.push({ code: i.accountNumber, name: `  ${i.accountName}`, amount: fmt(i.amount) });
      }
    };
    addSection("壹、營業活動現金流量", data.operating, data.totalOperating, compareData?.operating, compareData?.totalOperating);
    addSection("貳、投資活動現金流量", data.investing, data.totalInvesting, compareData?.investing, compareData?.totalInvesting);
    addSection("參、籌資活動現金流量", data.financing, data.totalFinancing, compareData?.financing, compareData?.totalFinancing);
    if (viewMode === "horizontal" && compareData) {
      rows.push({ code: "", name: "本期現金淨增減", amount: fmt(data.netCashChange), compareAmount: fmt(compareData.netCashChange), variance: fmt(data.netCashChange - compareData.netCashChange) });
    } else {
      rows.push({ code: "", name: "本期現金淨增減", amount: fmt(data.netCashChange) });
    }
    const headers = viewMode === "horizontal" ? ["科目代碼", "科目名稱", "本期金額", "比較期金額", "差異"] : ["科目代碼", "科目名稱", "金額"];
    const columnKeys = viewMode === "horizontal" ? ["code", "name", "amount", "compareAmount", "variance"] : ["code", "name", "amount"];
    return { title: "現金流量表", subtitle: `期間：${startDate} 至 ${endDate}`, fileName: `現金流量表_${startDate}_${endDate}`, headers, columnKeys, rows, columnWidths: viewMode === "horizontal" ? [12, 30, 15, 15, 15] : [12, 30, 15] };
  };

  const sectionStyles: Record<string, { bg: string; text: string }> = {
    green: { bg: "bg-green-50/50", text: "text-green-800" },
    orange: { bg: "bg-orange-50/50", text: "text-orange-800" },
    purple: { bg: "bg-purple-50/50", text: "text-purple-800" },
  };

  const Section = ({ title, items, total, color, cItems, cTotal }: { title: string; items: CashFlowItem[]; total: number; color: string; cItems?: CashFlowItem[]; cTotal?: number }) => {
    const style = sectionStyles[color] || sectionStyles.green;
    const isHoriz = viewMode === "horizontal" && cTotal !== undefined;
    return (
    <>
      <tr className={`${style.bg} border-b`}>
        <td colSpan={2} className={`px-4 py-2.5 font-bold ${style.text}`}>{title}</td>
        <td className={`px-4 py-2.5 text-right font-bold ${style.text}`}>{totalAmount(title, items, total, fmt(total))}</td>
        {isHoriz && <td className={`px-4 py-2.5 text-right font-bold ${style.text}`}>{totalAmount(title, cItems, cTotal!, fmt(cTotal!), true)}</td>}
        {isHoriz && <td className={`px-4 py-2.5 text-right font-bold ${total - cTotal! >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(total - cTotal!)}</td>}
      </tr>
      {items.map((i, idx) => {
        const ci = cItems?.find(c => c.accountNumber === i.accountNumber);
        return (
        <tr key={idx} className="border-b hover:bg-gray-50">
          <td className="px-4 py-1.5 pl-8 font-mono text-xs text-gray-400">{i.accountNumber}</td>
          <td className="px-4 py-1.5 pl-10 text-gray-600">{i.accountName}</td>
          <td className={`px-4 py-1.5 text-right font-mono ${i.amount >= 0 ? "text-green-600" : "text-red-600"}`}>{itemAmount(i, fmt(i.amount))}</td>
          {isHoriz && <td className="px-4 py-1.5 text-right font-mono text-gray-500">{itemAmount(ci, fmt(ci?.amount || 0), true)}</td>}
          {isHoriz && <td className={`px-4 py-1.5 text-right font-mono ${i.amount - (ci?.amount || 0) >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(i.amount - (ci?.amount || 0))}</td>}
        </tr>
        );
      })}
      {items.length === 0 && <tr><td colSpan={isHoriz ? 5 : 3} className="px-8 py-2 text-gray-400">無資料</td></tr>}
    </>
    );
  };

  const MobileSection = ({ title, items, total, color, cItems, cTotal }: { title: string; items: CashFlowItem[]; total: number; color: string; cItems?: CashFlowItem[]; cTotal?: number }) => {
    const isHoriz = viewMode === "horizontal" && cTotal !== undefined;
    return (
      <div className="mb-4">
        <MobileCardHeader 
          title={title} 
          value={totalAmount(title, items, total, fmt(total))} 
          titleClass={color === "green" ? "text-green-800" : color === "orange" ? "text-orange-800" : "text-purple-800"} 
          valueClass={color === "green" ? "text-green-800" : color === "orange" ? "text-orange-800" : "text-purple-800"} 
        />
        {isHoriz && (
          <div className="flex justify-between text-sm mb-3 pb-2 border-b">
            <span className="text-gray-500">比較期: <span className="font-bold text-gray-700">{totalAmount(title, cItems, cTotal!, fmt(cTotal!), true)}</span></span>
            <span className="text-gray-500">差異: <span className={`font-bold ${total - cTotal! >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(total - cTotal!)}</span></span>
          </div>
        )}
        <div className="space-y-2">
          {items.map((i, idx) => {
            const ci = cItems?.find(c => c.accountNumber === i.accountNumber);
            return (
              <div key={idx} className="bg-white p-3 rounded border text-sm">
                <div className="flex justify-between mb-1">
                  <span className="text-gray-700">{i.accountName} <span className="text-gray-400 text-xs ml-1">({i.accountNumber})</span></span>
                  <span className={`font-mono font-bold ${i.amount >= 0 ? "text-green-600" : "text-red-600"}`}>{itemAmount(i, fmt(i.amount))}</span>
                </div>
                {isHoriz && (
                  <div className="flex justify-between text-xs text-gray-500 mt-2 pt-2 border-t">
                    <span>比較期: {itemAmount(ci, fmt(ci?.amount || 0), true)}</span>
                    <span>差異: <span className={i.amount - (ci?.amount || 0) >= 0 ? "text-green-600" : "text-red-600"}>{fmt(i.amount - (ci?.amount || 0))}</span></span>
                  </div>
                )}
              </div>
            );
          })}
          {items.length === 0 && <div className="text-center text-gray-400 text-sm py-2">無資料</div>}
        </div>
      </div>
    );
  };

  const isHoriz = viewMode === "horizontal" && compareData;

  return (
    <div className="space-y-6" data-report>
      <ReportHeader />
      <PageHeader title="現金流量表" description="查詢期間現金流入與流出狀況，支援直向與橫向期間比較" />
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Button variant={viewMode === "vertical" ? "default" : "outline"} size="sm" onClick={() => setViewMode("vertical")}>直向檢視</Button>
              <Button variant={viewMode === "horizontal" ? "default" : "outline"} size="sm" onClick={() => setViewMode("horizontal")}>橫向比較</Button>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <Button size="sm" variant={periodMode === "month" ? "default" : "outline"} onClick={() => applyPeriod("month", currentMonth)}>月</Button>
              <Button size="sm" variant={periodMode === "year" ? "default" : "outline"} onClick={() => applyPeriod("year", currentYear)}>年</Button>
              <Button size="sm" variant={periodMode === "custom" ? "default" : "outline"} onClick={() => setPeriodMode("custom")}>自訂</Button>
              {periodMode === "month" && <Input className="w-44" type="month" value={periodValue} onChange={e => applyPeriod("month", e.target.value)} />}
              {periodMode === "year" && <Input className="w-32" type="number" min="2000" max="2100" value={periodValue} onChange={e => applyPeriod("year", e.target.value)} />}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end w-full mt-3">
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium text-gray-600 mb-1 block">本期起始</label>
                <Input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPeriodMode("custom"); }} />
              </div>
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium text-gray-600 mb-1 block">本期結束</label>
                <Input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPeriodMode("custom"); }} />
              </div>
              {viewMode === "horizontal" && (
                <>
                  <div className="flex-1 min-w-0">
                    <label className="text-sm font-medium text-gray-600 mb-1 block">比較期起始</label>
                    <Input type="date" value={compareStartDate} onChange={e => setCompareStartDate(e.target.value)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="text-sm font-medium text-gray-600 mb-1 block">比較期結束</label>
                    <Input type="date" value={compareEndDate} onChange={e => setCompareEndDate(e.target.value)} />
                  </div>
                </>
              )}
              <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                <Button onClick={fetchReport} disabled={loading} className="flex-1 sm:flex-none">{loading ? "查詢中..." : "查詢"}</Button>
                {data && <Button variant="outline" onClick={() => window.print()} className="flex-1 sm:flex-none"><Printer className="h-4 w-4 mr-1" />列印</Button>}
                {data && <ExportMenu getExportOptions={buildExport} />}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center"><TrendingUp className="h-5 w-5 text-green-600" /></div>
                <div><div className="text-sm text-gray-500">營業活動</div><div className={`text-xl font-bold ${data.totalOperating >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(data.totalOperating)}</div></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center"><TrendingDown className="h-5 w-5 text-orange-600" /></div>
                <div><div className="text-sm text-gray-500">投資活動</div><div className={`text-xl font-bold ${data.totalInvesting >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(data.totalInvesting)}</div></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center"><DollarSign className="h-5 w-5 text-purple-600" /></div>
                <div><div className="text-sm text-gray-500">籌資活動</div><div className={`text-xl font-bold ${data.totalFinancing >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(data.totalFinancing)}</div></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center"><DollarSign className="h-5 w-5 text-blue-600" /></div>
                <div><div className="text-sm text-gray-500">現金淨增減</div><div className={`text-xl font-bold ${data.netCashChange >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(data.netCashChange)}</div></div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="py-3 border-b">
              <CardTitle className="text-center text-lg">
                現金流量表{isHoriz ? "（橫向比較）" : ""}
                <div className="text-sm font-normal text-gray-500 mt-1">
                  本期：{startDate} 至 {endDate}
                  {isHoriz && <span className="ml-3">比較期：{compareStartDate} 至 {compareEndDate}</span>}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 sm:p-0">
              {/* Mobile View */}
              <div className="block md:hidden p-4 bg-gray-50/50">
                <MobileSection title="壹、營業活動現金流量" items={data.operating} total={data.totalOperating} color="green" cItems={compareData?.operating} cTotal={compareData?.totalOperating} />
                <MobileSection title="貳、投資活動現金流量" items={data.investing} total={data.totalInvesting} color="orange" cItems={compareData?.investing} cTotal={compareData?.totalInvesting} />
                <MobileSection title="參、籌資活動現金流量" items={data.financing} total={data.totalFinancing} color="purple" cItems={compareData?.financing} cTotal={compareData?.totalFinancing} />
                
                <MobileTotalCard>
                  <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-200">
                    <span className="text-gray-700 font-semibold">期初現金及約當現金</span>
                    <span className="font-mono">{fmt(data.openingCash)}</span>
                  </div>
                  {isHoriz && (
                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-200 text-sm">
                      <span className="text-gray-500">比較期: <span className="font-mono text-gray-600">{fmt(compareData!.openingCash)}</span></span>
                      <span className="text-gray-500">差異: <span className={`font-mono font-bold ${data.openingCash - compareData!.openingCash >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(data.openingCash - compareData!.openingCash)}</span></span>
                    </div>
                  )}
                  
                  <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-200 text-blue-900">
                    <span className="font-bold">本期現金淨增(減)</span>
                    <span className={`font-mono font-bold text-lg ${data.netCashChange >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(data.netCashChange)}</span>
                  </div>
                  {isHoriz && (
                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-200 text-sm">
                      <span className="text-gray-500">比較期: <span className="font-mono text-gray-600">{fmt(compareData!.netCashChange)}</span></span>
                      <span className="text-gray-500">差異: <span className={`font-mono font-bold ${data.netCashChange - compareData!.netCashChange >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(data.netCashChange - compareData!.netCashChange)}</span></span>
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-2 text-blue-900">
                    <span className="font-bold">期末現金及約當現金</span>
                    <span className="font-mono font-bold text-xl">{fmt(data.closingCash)}</span>
                  </div>
                  {isHoriz && (
                    <div className="flex justify-between items-center mt-2 text-sm text-gray-500">
                      <span>比較期: <span className="font-mono text-gray-600">{fmt(compareData!.closingCash)}</span></span>
                      <span>差異: <span className={`font-mono font-bold ${data.closingCash - compareData!.closingCash >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(data.closingCash - compareData!.closingCash)}</span></span>
                    </div>
                  )}
                </MobileTotalCard>
              </div>

              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50">
                      <th className="text-left px-4 py-2.5 font-semibold w-24">科目代碼</th>
                      <th className="text-left px-4 py-2.5 font-semibold">科目名稱</th>
                      <th className="text-right px-4 py-2.5 font-semibold w-36">{isHoriz ? "本期金額" : "金額"}</th>
                      {isHoriz && <th className="text-right px-4 py-2.5 font-semibold w-36">比較期金額</th>}
                      {isHoriz && <th className="text-right px-4 py-2.5 font-semibold w-36">差異</th>}
                    </tr>
                  </thead>
                  <tbody>
                    <Section title="壹、營業活動現金流量" items={data.operating} total={data.totalOperating} color="green" cItems={compareData?.operating} cTotal={compareData?.totalOperating} />
                    <Section title="貳、投資活動現金流量" items={data.investing} total={data.totalInvesting} color="orange" cItems={compareData?.investing} cTotal={compareData?.totalInvesting} />
                    <Section title="參、籌資活動現金流量" items={data.financing} total={data.totalFinancing} color="purple" cItems={compareData?.financing} cTotal={compareData?.totalFinancing} />
                    <tr className="border-t bg-gray-50">
                      <td colSpan={2} className="px-4 py-2.5 font-semibold">期初現金及約當現金</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{fmt(data.openingCash)}</td>
                      {isHoriz && <td className="px-4 py-2.5 text-right">{fmt(compareData!.openingCash)}</td>}
                      {isHoriz && <td className="px-4 py-2.5 text-right">{fmt(data.openingCash - compareData!.openingCash)}</td>}
                    </tr>
                    <tr className="border-t-2 bg-blue-50/50">
                      <td colSpan={2} className="px-4 py-3 font-bold text-blue-900 text-base">本期現金及約當現金淨增(減)</td>
                      <td className={`px-4 py-3 text-right font-bold text-base ${data.netCashChange >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(data.netCashChange)}</td>
                      {isHoriz && <td className="px-4 py-3 text-right font-bold text-base text-gray-500">{fmt(compareData!.netCashChange)}</td>}
                      {isHoriz && <td className={`px-4 py-3 text-right font-bold text-base ${data.netCashChange - compareData!.netCashChange >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(data.netCashChange - compareData!.netCashChange)}</td>}
                    </tr>
                    <tr className="border-t-2 bg-blue-100/60">
                      <td colSpan={2} className="px-4 py-3 font-bold text-blue-900 text-base">期末現金及約當現金</td>
                      <td className="px-4 py-3 text-right font-bold text-base">{fmt(data.closingCash)}</td>
                      {isHoriz && <td className="px-4 py-3 text-right font-bold">{fmt(compareData!.closingCash)}</td>}
                      {isHoriz && <td className="px-4 py-3 text-right font-bold">{fmt(data.closingCash - compareData!.closingCash)}</td>}
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!data && !loading && (
        <Card><CardContent className="py-12 text-center text-gray-400">選擇日期區間後點擊查詢以產生現金流量表</CardContent></Card>
      )}

      <AccountDrillDialog target={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
