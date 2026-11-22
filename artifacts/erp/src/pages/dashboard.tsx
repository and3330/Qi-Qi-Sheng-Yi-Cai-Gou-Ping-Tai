import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  getGetRecentActivityQueryKey,
  useGetRecentActivity,
} from "@workspace/erp-api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHint } from "@/components/page-hint";
import { FoundationCheck } from "@/components/shared/foundation-check";
import { SetupReminders } from "@/components/shared/setup-reminders";
import { useAuth } from "@/contexts/auth-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMenuAllowed } from "@/hooks/use-menu-allowed";
import { defaultRolesForPath } from "@/components/layout/sidebar";
import {
  DollarSign, Users, ShoppingCart, Truck, CalendarOff,
  FolderKanban, UserPlus, TrendingUp, TrendingDown,
  Pause, Play, ClipboardCheck, AlertTriangle, PackageSearch, Landmark, FileClock,
  ChevronRight, FileText, Clock, HandCoins, Search, CheckCircle2, RefreshCw,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const moduleMap: Record<string, string> = {
  System: "系統",
  HR: "人力資源",
  Inventory: "庫存",
  Sales: "銷售",
  Purchasing: "採購",
  CRM: "客戶關係",
  Projects: "專案",
  Accounting: "會計",
};

/** 模組代碼大小寫不一定一致（Sales／sales），都要能對到中文 */
const moduleLabel = (code: string | null | undefined) => {
  if (!code) return "";
  const hit = Object.keys(moduleMap).find((key) => key.toLowerCase() === code.toLowerCase());
  return hit ? moduleMap[hit] : code;
};

interface DashboardTodos {
  pendingApprovals: { count: number };
  overdueReceivables: { count: number; total: number };
  lowStock: { count: number };
  vatEstimate: { outputTax: number; inputTax: number; payableTax: number; periodStart: string; periodEnd: string };
  draftDocsAging: { count: number; quotations: number; salesOrders: number };
}

/** 手機上常用的入口；沒有權限的不顯示 */
const QUICK_ACTIONS = [
  { label: "查庫存", path: "/inventory/lookup", icon: Search, tone: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { label: "報價單", path: "/sales/quotations", icon: FileText, tone: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  { label: "銷售訂單", path: "/sales/orders", icon: ShoppingCart, tone: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  { label: "請款", path: "/accounting/reimbursement", icon: HandCoins, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { label: "打卡", path: "/hr/clock-in", icon: Clock, tone: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  { label: "客戶", path: "/sales/customers", icon: UserPlus, tone: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300" },
];

/** 大數字在手機上縮成「萬／億」，小螢幕才放得下 */
function compactMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}$${(abs / 1e8).toFixed(abs >= 1e9 ? 0 : 1)}億`;
  if (abs >= 1e7) return `${sign}$${Math.round(abs / 1e4).toLocaleString()}萬`;
  return `${sign}$${abs.toLocaleString()}`;
}
const axisMoney = (n: number) => (Math.abs(n) >= 1e8 ? `${(n / 1e8).toFixed(1)}億` : Math.abs(n) >= 1e4 ? `${Math.round(n / 1e4)}萬` : String(n));

function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(iso).toLocaleDateString("zh-TW");
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { allowed } = useMenuAllowed();
  const [livePaused, setLivePaused] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const refetchInterval = livePaused ? false : 15000;

  const now = new Date();
  const thisYear = String(now.getFullYear());
  const thisMonth = String(now.getMonth() + 1);
  const [filterYear, setFilterYear] = useState<string>(thisYear);
  const [filterMonth, setFilterMonth] = useState<string>(thisMonth);
  const yearOptions = Array.from({ length: now.getFullYear() - 2021 + 1 }, (_, i) => String(2021 + i)).reverse();

  const { data: summary, isLoading: summaryLoading, isFetching: sFetch, dataUpdatedAt, isError: summaryFailed, refetch: refetchSummary } = useQuery<any>({
    queryKey: ["/erp-api/dashboard/summary", filterYear, filterMonth],
    queryFn: async () => {
      const response = await fetch(`/erp-api/dashboard/summary?year=${filterYear}&month=${filterMonth}`, { credentials: "include" });
      if (!response.ok) throw new Error("無法取得儀表板資料");
      return response.json();
    },
    refetchInterval,
  });
  const { data: activities, isLoading: activitiesLoading, isFetching: aFetch, isError: activitiesFailed, refetch: refetchActivities } = useGetRecentActivity({ limit: 8 }, { query: { queryKey: getGetRecentActivityQueryKey({ limit: 8 }), refetchInterval } });
  const chartYear = filterYear === "all" ? thisYear : filterYear;
  const { data: revenueData, isLoading: chartLoading, isError: chartFailed, refetch: refetchChart } = useQuery<any[]>({
    queryKey: ["/erp-api/dashboard/revenue-chart", chartYear],
    queryFn: async () => {
      const response = await fetch(`/erp-api/dashboard/revenue-chart?year=${chartYear}`, { credentials: "include" });
      if (!response.ok) throw new Error("無法取得營收圖表");
      return response.json();
    },
    refetchInterval: livePaused ? false : 60000,
  });
  const { data: todos, isLoading: todosLoading, isError: todosFailed, refetch: refetchTodos } = useQuery<DashboardTodos>({
    queryKey: ["/erp-api/dashboard/todos"],
    queryFn: async () => {
      const response = await fetch(`/erp-api/dashboard/todos`, { credentials: "include" });
      if (!response.ok) throw new Error("無法取得今日待辦");
      return response.json();
    },
    refetchInterval: livePaused ? false : 60000,
  });

  useEffect(() => { if (dataUpdatedAt) setLastUpdate(new Date(dataUpdatedAt)); }, [dataUpdatedAt]);
  const isLive = !livePaused && (sFetch || aFetch);
  // 資料抓不到時要講清楚，不能留一片空白讓人以為壞掉
  const summaryBroken = summaryFailed || !!summary?.error;
  const failedCount = [summaryBroken, todosFailed, chartFailed, activitiesFailed].filter(Boolean).length;
  const offline = failedCount > 0;
  const retryAll = () => { void refetchSummary(); void refetchTodos(); void refetchChart(); void refetchActivities(); };
  const chartRows = Array.isArray(revenueData) ? revenueData : [];
  const chartEmpty = chartRows.every((row) => !Number(row?.revenue) && !Number(row?.expenses));
  const sectionError = (text: string, retry: () => void, className = "") => (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-4 py-4 text-sm text-muted-foreground ${className}`} role="status">
      <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />{text}</span>
      <Button variant="outline" size="sm" onClick={retry}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />重新讀取</Button>
    </div>
  );

  const periodLabel = filterYear === "all" ? "歷年" : filterMonth === "all" ? `${filterYear} 全年` : `${filterYear}/${filterMonth} 月`;
  const money = (n: number) => (isMobile ? compactMoney(n) : `$${n.toLocaleString()}`);
  const profit = Number(summary?.netProfit ?? 0);
  const statCards = summary && !summary.error ? [
    { label: `營收（${periodLabel}）`, value: money(Number(summary.totalRevenue ?? 0)), icon: <DollarSign size={20} />, color: "text-emerald-600", path: "/reports/sales-analysis" },
    { label: `營收減採購（${periodLabel}）`, value: money(profit), icon: profit >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />, color: profit >= 0 ? "text-emerald-600" : "text-red-600", path: "/reports/gross-margin" },
    { label: "待處理銷售訂單", value: summary.openSalesOrders ?? 0, icon: <ShoppingCart size={20} />, color: "text-orange-600", path: "/sales/orders" },
    { label: "待處理採購訂單", value: summary.openPurchaseOrders ?? 0, icon: <Truck size={20} />, color: "text-cyan-600", path: "/purchasing/orders" },
    { label: "待審核假單", value: summary.pendingLeaves ?? 0, icon: <CalendarOff size={20} />, color: "text-amber-600", path: "/hr/leaves" },
    { label: "進行中專案", value: summary.activeProjects ?? 0, icon: <FolderKanban size={20} />, color: "text-indigo-600", path: "/projects" },
    { label: "員工數", value: summary.totalEmployees ?? 0, icon: <Users size={20} />, color: "text-blue-600", path: "/hr/employees" },
    { label: "客戶數", value: summary.totalCustomers ?? 0, icon: <UserPlus size={20} />, color: "text-violet-600", path: "/sales/customers" },
  ] : [];

  const todoItems = todos ? [
    { label: "待我審批", count: todos.pendingApprovals.count as number | null, detail: "等待您的決定", path: "/system/approval-requests", icon: ClipboardCheck, color: "text-amber-600", danger: false, attention: todos.pendingApprovals.count > 0 },
    { label: "逾期應收", count: todos.overdueReceivables.count, detail: `NT$ ${todos.overdueReceivables.total.toLocaleString()}`, path: "/reports/ar-aging", icon: AlertTriangle, color: "text-red-600", danger: todos.overdueReceivables.count > 0, attention: todos.overdueReceivables.count > 0 },
    { label: "低庫存品項", count: todos.lowStock.count, detail: "低於或等於補貨點", path: "/inventory/lookup?low=1", icon: PackageSearch, color: todos.lowStock.count > 0 ? "text-red-600" : "text-emerald-600", danger: todos.lowStock.count > 0, attention: todos.lowStock.count > 0 },
    { label: "草稿逾 14 天", count: todos.draftDocsAging.count, detail: `報價 ${todos.draftDocsAging.quotations} · 訂單 ${todos.draftDocsAging.salesOrders}`, path: "/sales/quotations", icon: FileClock, color: todos.draftDocsAging.count > 0 ? "text-red-600" : "text-muted-foreground", danger: todos.draftDocsAging.count > 0, attention: todos.draftDocsAging.count > 0 },
    { label: "本期營業稅估算", count: null, detail: `NT$ ${todos.vatEstimate.payableTax.toLocaleString()}`, path: "/accounting/vat-report", icon: Landmark, color: todos.vatEstimate.payableTax < 0 ? "text-red-600" : "text-blue-600", danger: todos.vatEstimate.payableTax < 0, attention: false },
  ] : [];
  const attentionCount = todoItems.filter((item) => item.attention).length;

  const hour = now.getHours();
  const greeting = hour < 5 ? "夜深了" : hour < 11 ? "早安" : hour < 14 ? "午安" : hour < 18 ? "下午好" : "晚安";
  const quickActions = QUICK_ACTIONS.filter((action) => allowed(action.path, defaultRolesForPath(action.path)));
  const setPeriod = (year: string, month: string) => { setFilterYear(year); setFilterMonth(month); };
  const periodChip = (active: boolean) =>
    `inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors touch-manipulation ${
      active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground active:bg-accent"
    }`;

  const liveStatus = (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        {!livePaused && !offline && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${offline ? "bg-red-500" : livePaused ? "bg-muted-foreground" : isLive ? "bg-emerald-500" : "bg-emerald-400"}`} />
      </span>
      <span className={offline ? "text-red-600" : ""}>{offline ? "資料讀取失敗" : livePaused ? "已暫停" : "即時更新"}</span>
      <span className="text-muted-foreground/70">· 最後 {lastUpdate.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</span>
    </div>
  );

  return (
    <div className="space-y-5 md:space-y-6">
      {/* 桌面：標題列與即時更新開關 */}
      <div className="hidden md:flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          <h1 className="whitespace-nowrap text-2xl font-bold text-foreground">儀表板</h1>
          <PageHint hintKey="dashboard">這裡快速整理公司目前的營運數字、待辦與近期動態。通常先查看待處理項目，再點進對應頁面完成工作。小提醒：數字會定時更新，但重要決策前仍建議確認單據明細。</PageHint>
        </div>
        <div className="flex items-center gap-3">
          {liveStatus}
          <Button variant="outline" size="sm" onClick={() => setLivePaused((v) => !v)} data-testid="button-toggle-live">
            {livePaused ? <><Play className="h-3.5 w-3.5 mr-1.5" />恢復即時</> : <><Pause className="h-3.5 w-3.5 mr-1.5" />暫停</>}
          </Button>
        </div>
      </div>

      {/* 手機：問候與今天的重點 */}
      <div className="md:hidden" data-testid="dashboard-mobile-greeting">
        <h1 className="text-[22px] font-bold leading-tight text-foreground">{greeting}，{user?.displayName || "您好"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {now.toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "long" })}
          {todos && (attentionCount > 0 ? `　·　有 ${attentionCount} 件事要處理` : "　·　目前沒有待處理的事")}
        </p>
      </div>

      {failedCount >= 3 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert" data-testid="dashboard-offline">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />目前連不到伺服器，下面的數字讀不出來。系統每隔幾秒會自己再試，也可以按右邊重試。</span>
          <Button variant="outline" size="sm" onClick={retryAll}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />重新讀取</Button>
        </div>
      )}

      <FoundationCheck />
      <SetupReminders />

      {/* 手機：常用功能一排，拇指一按就到 */}
      {quickActions.length > 0 && (
        <nav aria-label="常用功能" className="md:hidden -mx-4 flex gap-1 overflow-x-auto px-3 pb-1 [scrollbar-width:none]" data-testid="dashboard-quick-actions">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.path}
                type="button"
                onClick={() => navigate(action.path)}
                className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 rounded-xl py-1.5 active:bg-accent touch-manipulation"
              >
                <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${action.tone}`}><Icon size={22} aria-hidden /></span>
                <span className="text-xs font-medium leading-none text-foreground">{action.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-base md:text-lg font-semibold">今日待辦</h2>
          <p className="hidden md:block text-sm text-muted-foreground">即時彙整需要優先處理的項目</p>
        </div>

        {/* 手機：一張清單，要處理的排前面 */}
        <Card className="md:hidden overflow-hidden" data-testid="dashboard-todo-list">
          {todosLoading ? (
            <CardContent className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</CardContent>
          ) : todoItems.length === 0 ? (
            <CardContent className="p-3">{sectionError("待辦讀不出來", () => void refetchTodos(), "border-0 px-1 py-1")}</CardContent>
          ) : (
            <ul className="divide-y">
              {[...todoItems].sort((a, b) => Number(b.attention) - Number(a.attention)).map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.label}>
                    <button
                      type="button"
                      onClick={() => navigate(item.path)}
                      className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-muted/60 touch-manipulation"
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${item.attention ? "bg-red-50 dark:bg-red-950/40" : "bg-muted"}`}>
                        {item.count === 0 ? <CheckCircle2 size={18} className="text-emerald-600" aria-hidden /> : <Icon size={18} className={item.color} aria-hidden />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[15px] font-medium ${item.count === 0 ? "text-muted-foreground" : ""}`}>{item.label}</span>
                        <span className={`block truncate text-xs ${item.danger ? "text-red-600" : "text-muted-foreground"}`}>{item.count === 0 ? "沒有需要處理的" : item.detail}</span>
                      </span>
                      {item.count !== null && item.count > 0 && (
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums ${item.danger ? "bg-red-600 text-white" : "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"}`}>{item.count}</span>
                      )}
                      <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* 桌面：五張卡片 */}
        <div className="hidden md:grid grid-cols-2 xl:grid-cols-5 gap-3">
          {todosLoading ? Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
          )) : todoItems.length === 0 ? sectionError("待辦讀不出來", () => void refetchTodos(), "col-span-full") : todoItems.map((item) => {
            const Icon = item.icon;
            return (
              <Card
                key={item.label}
                role="button"
                tabIndex={0}
                onClick={() => navigate(item.path)}
                onKeyDown={(event) => { if (event.key === "Enter") navigate(item.path); }}
                className={`cursor-pointer transition-colors hover:bg-accent/40 ${item.danger ? "border-red-200 dark:border-red-900" : ""}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium">{item.label}</span>
                    <Icon className={`h-5 w-5 ${item.color}`} />
                  </div>
                  {item.count !== null && <p className={`text-2xl font-bold ${item.danger ? "text-red-600" : ""}`}>{item.count}</p>}
                  <p className={`text-sm ${item.danger ? "text-red-600" : "text-muted-foreground"} ${item.count === null ? "text-xl font-bold" : ""}`}>{item.detail}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold md:hidden">營運數字</h2>
        {/* 手機：三個最常看的期間直接按；桌面維持年、月下拉 */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:items-center md:overflow-visible md:px-0">
          <span className="hidden md:inline text-sm font-medium text-muted-foreground">統計期間</span>
          <button type="button" className={`md:hidden ${periodChip(filterYear === thisYear && filterMonth === thisMonth)}`} onClick={() => setPeriod(thisYear, thisMonth)}>本月</button>
          <button type="button" className={`md:hidden ${periodChip(filterYear === thisYear && filterMonth === "all")}`} onClick={() => setPeriod(thisYear, "all")}>今年</button>
          <button type="button" className={`md:hidden ${periodChip(filterYear === "all")}`} onClick={() => setPeriod("all", "all")}>歷年</button>
          <select
            className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm max-md:rounded-full max-md:px-3"
            value={filterYear}
            onChange={e => { setFilterYear(e.target.value); if (e.target.value === "all") setFilterMonth("all"); }}
            aria-label="統計年度"
            data-testid="select-dashboard-year"
          >
            <option value="all">歷年累計</option>
            {yearOptions.map(y => <option key={y} value={y}>{y} 年</option>)}
          </select>
          {filterYear !== "all" && (
            <select
              className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm max-md:rounded-full max-md:px-3"
              value={filterMonth}
              onChange={e => setFilterMonth(e.target.value)}
              aria-label="統計月份"
              data-testid="select-dashboard-month"
            >
              <option value="all">全年</option>
              {Array.from({ length: 12 }, (_, i) => String(i + 1)).map(m => <option key={m} value={m}>{m} 月</option>)}
            </select>
          )}
          <span className="hidden md:inline text-xs text-muted-foreground">（適用於營收與採購支出；已開發票的算發票，還沒開的算已成立的訂單，不含作廢）</span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-4" data-testid="dashboard-stats">
          {summaryLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <Card key={i}><CardContent className="p-3 md:p-4"><Skeleton className="h-14 md:h-16 w-full" /></CardContent></Card>
              ))
            : statCards.length === 0 ? sectionError("營運數字讀不出來", () => void refetchSummary(), "col-span-full")
            : statCards.map((card) => (
                <Card
                  key={card.label}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(card.path)}
                  onKeyDown={(event) => { if (event.key === "Enter") navigate(card.path); }}
                  className="cursor-pointer transition-colors hover:bg-accent/40 active:bg-accent/60"
                >
                  <CardContent className="p-3 md:p-4 flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
                    <div className={`flex h-9 w-9 md:h-auto md:w-auto md:p-2.5 items-center justify-center rounded-lg bg-accent/50 ${card.color}`}>{card.icon}</div>
                    <div className="min-w-0">
                      <p className="truncate text-xs text-muted-foreground font-medium">{card.label}</p>
                      <p className="truncate text-xl font-bold tabular-nums text-foreground">{card.value}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
        </div>
        <p className="md:hidden px-1 text-xs text-muted-foreground">營收與採購依所選期間計算；還沒開發票的算已成立的訂單。</p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="max-md:p-4 max-md:pb-2">
            <CardTitle className="text-base">營收與支出<span className="ml-1.5 text-xs font-normal text-muted-foreground">{chartYear} 年逐月，依發票與已成立的訂單</span></CardTitle>
            <div className="flex gap-4 pt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" />營收</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive" />支出</span>
            </div>
          </CardHeader>
          <CardContent className="max-md:px-2 max-md:pb-3">
            {chartLoading ? (
              <Skeleton className="h-52 md:h-64 w-full" />
            ) : chartFailed ? sectionError("營收圖表讀不出來", () => void refetchChart(), "mx-2")
            : chartEmpty ? (
              <p className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{chartYear} 年還沒有發票資料</p>
            ) : (
              <ResponsiveContainer width="100%" height={isMobile ? 210 : 280}>
                <AreaChart data={chartRows} margin={isMobile ? { top: 6, right: 10, left: 0, bottom: 0 } : undefined}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={!isMobile} />
                  <XAxis dataKey="month" className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))" }} interval={isMobile ? 1 : 0} tickLine={false} />
                  <YAxis className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))" }} tickFormatter={axisMoney} width={isMobile ? 44 : 60} tickLine={false} axisLine={!isMobile} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                    formatter={(value: number, name: string) => [
                      `$${value.toLocaleString()}`,
                      name === "revenue" ? "營收" : "支出"
                    ]}
                  />
                  <Area type="monotone" dataKey="revenue" name="revenue" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.1} strokeWidth={2} />
                  <Area type="monotone" dataKey="expenses" name="expenses" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive))" fillOpacity={0.05} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="max-md:p-4 max-md:pb-2"><CardTitle className="text-base">近期動態</CardTitle></CardHeader>
          <CardContent className="space-y-3 max-md:px-4 max-md:pb-4">
            {activitiesLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
            ) : activitiesFailed ? sectionError("近期動態讀不出來", () => void refetchActivities())
            : Array.isArray(activities) && activities.length > 0 ? (
              activities.slice(0, isMobile ? 5 : 8).map((activity) => (
                <div key={activity.id} className="flex items-start gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{activity.title}</p>
                    <p className="text-muted-foreground text-xs truncate">{activity.description}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{moduleLabel(activity.module)}</Badge>
                      <span className="text-xs text-muted-foreground">{relativeTime(activity.createdAt)}</span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">暫無動態</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 手機：更新狀態放最下面，不佔上方的位置 */}
      <div className="md:hidden flex items-center justify-between rounded-xl border bg-card px-4 py-2">
        {liveStatus}
        <Button variant="ghost" size="sm" onClick={() => setLivePaused((v) => !v)} data-testid="button-toggle-live-mobile">
          {livePaused ? <><Play className="h-3.5 w-3.5 mr-1.5" />恢復</> : <><Pause className="h-3.5 w-3.5 mr-1.5" />暫停</>}
        </Button>
      </div>
    </div>
  );
}
