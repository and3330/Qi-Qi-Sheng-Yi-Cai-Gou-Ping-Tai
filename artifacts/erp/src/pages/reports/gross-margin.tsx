import { Fragment, useEffect, useState } from "react";
import { projectLabel } from "@/lib/select-options";
import { Link } from "wouter";
import { ReportHeader } from "@/components/shared/report-header";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { PageHint } from "@/components/page-hint";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MobileCard, MobileCardHeader, MobileCardGrid, MobileCardItem } from "@/components/shared/mobile-card";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface MarginItem {
  itemId: number | null;
  itemName: string;
  quantity: number;
  revenue: number;
  unitCost: number;
  cost: number;
  grossProfit: number;
  marginPct: number;
  /** snapshot=出貨當下成本快照; current=現行成本估算（未出貨或舊資料） */
  costSource?: "snapshot" | "current";
}

interface MarginOrder {
  id: number;
  orderNumber: string;
  orderDate: string;
  customerName: string;
  revenue: number;
  cost: number;
  grossProfit: number;
  marginPct: number;
  items: MarginItem[];
}

interface MarginReport {
  rows: MarginOrder[];
  totals: { revenue: number; cost: number; grossProfit: number; marginPct: number };
}

export default function GrossMarginPage() {
  const reloadKey = useAutoReloadKey();
  const [startDate, setStartDate] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [data, setData] = useState<MarginReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchReport = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (projectId) params.set("projectId", projectId);
      const res = await fetch(`/erp-api/reports/gross-margin?${params}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "毛利報表載入失敗");
      setData(body);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "毛利報表載入失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch(`/erp-api/projects`).then(res => res.ok ? res.json() : []).then(setProjects).catch(() => setProjects([]));
    fetchReport();
  }, [reloadKey]);

  const money = (value: number) => `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6" data-report>
      <ReportHeader />
      <PageHeader title="毛利分析" description="依出貨當下的成本快照分析已確認及已完成銷售訂單" hint={<PageHint hintKey="gross-margin">這裡比較銷售收入與商品成本，了解哪些訂單、客戶或品項較有利潤。選好日期後先看整體毛利，再展開明細找出異常。成本以出貨當下的成本快照計算，不受日後成本變動影響；標示「估算」的品項尚未出貨或為舊資料，暫以目前移動平均成本估算。</PageHint>} />
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end w-full">
            <div className="flex-1 w-full sm:w-auto">
              <label className="text-sm font-medium mb-1 block">起始日期</label>
              <Input type="date" className="w-full" value={startDate} onChange={event => setStartDate(event.target.value)} />
            </div>
            <div className="flex-1 w-full sm:w-auto">
              <label className="text-sm font-medium mb-1 block">結束日期</label>
              <Input type="date" className="w-full" value={endDate} onChange={event => setEndDate(event.target.value)} />
            </div>
            <div className="flex-1 w-full sm:w-auto">
              <label className="text-sm font-medium mb-1 block">專案</label>
              <LookupSelect className="w-full h-10 border rounded-md px-3 bg-background text-sm" value={projectId} onChange={event => setProjectId(event.target.value)}>
                <option value="">全部專案</option>
                {projects.map(project => <option key={project.id} value={project.id}>{projectLabel(project)}</option>)}
              </LookupSelect>
            </div>
            <Button className="w-full sm:w-auto" onClick={fetchReport} disabled={loading}>{loading ? "查詢中..." : "查詢"}</Button>
          </div>
        </CardContent>
      </Card>

      {error && <Card><CardContent className="py-6 text-center text-red-600">{error}</CardContent></Card>}
      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              ["營收", money(data.totals.revenue)],
              ["成本", money(data.totals.cost)],
              ["毛利", money(data.totals.grossProfit)],
              ["毛利率", `${data.totals.marginPct.toFixed(1)}%`],
            ].map(([label, value]) => (
              <Card key={label}><CardContent className="py-4"><div className="text-sm text-muted-foreground">{label}</div><div className="text-2xl font-bold">{value}</div></CardContent></Card>
            ))}
          </div>
          <Card>
            <CardContent className="p-0 sm:p-0">
              {/* Mobile View */}
              <div className="block md:hidden p-4 bg-gray-50/50">
                {data.rows.map(order => (
                  <MobileCard key={order.id}>
                    <MobileCardHeader 
                      title={<><Link href={`/sales/orders/${order.id}`} className="text-primary hover:underline">{order.orderNumber}</Link>・{order.customerName}</>}
                      value={order.marginPct.toFixed(1) + "%"}
                      titleClass="text-gray-900"
                      valueClass="text-blue-700 font-mono"
                    />
                    <div className="text-xs text-gray-500 mb-3">{order.orderDate}</div>
                    <MobileCardGrid>
                      <MobileCardItem label="營收" value={money(order.revenue)} />
                      <MobileCardItem label="成本" value={money(order.cost)} />
                      <MobileCardItem label="毛利" value={money(order.grossProfit)} valueClass="text-green-600" />
                    </MobileCardGrid>
                    {order.items.length > 0 && (
                      <div className="mt-4 pt-3 border-t">
                        <div className="text-xs font-semibold text-gray-500 mb-2">品項明細</div>
                        <div className="space-y-3">
                          {order.items.map((item, index) => (
                            <div key={`${order.id}-${item.itemId ?? index}`} className="bg-gray-50 p-2 rounded text-sm">
                              <div className="font-medium mb-1 flex justify-between">
                                <span>{item.itemName} <span className="text-gray-400 text-xs ml-1">x{item.quantity.toLocaleString()}</span></span>
                                <span className="text-blue-700">{item.marginPct.toFixed(1)}%</span>
                              </div>
                              <div className="flex justify-between text-xs text-gray-500">
                                <span>營收: {money(item.revenue)}</span>
                                <span>成本: {money(item.cost)}{item.costSource === "current" && <span className="ml-1 px-1 rounded bg-amber-100 text-amber-700">估算</span>}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </MobileCard>
                ))}
                {data.rows.length === 0 && <div className="py-8 text-center text-gray-400">查無符合條件的銷售訂單</div>}
              </div>

              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>訂單／品項</TableHead><TableHead>日期／客戶</TableHead>
                    <TableHead className="text-right">數量</TableHead><TableHead className="text-right">營收</TableHead>
                    <TableHead className="text-right">成本</TableHead><TableHead className="text-right">毛利</TableHead>
                    <TableHead className="text-right">毛利率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map(order => (
                    <Fragment key={order.id}>
                      <TableRow className="bg-muted/40 font-semibold">
                        <TableCell><Link href={`/sales/orders/${order.id}`} className="text-primary hover:underline">{order.orderNumber}</Link></TableCell><TableCell>{order.orderDate}・{order.customerName}</TableCell>
                        <TableCell />
                        <TableCell className="text-right">{money(order.revenue)}</TableCell>
                        <TableCell className="text-right">{money(order.cost)}</TableCell>
                        <TableCell className="text-right">{money(order.grossProfit)}</TableCell>
                        <TableCell className="text-right">{order.marginPct.toFixed(1)}%</TableCell>
                      </TableRow>
                      {order.items.map((item, index) => (
                        <TableRow key={`${order.id}-${item.itemId ?? index}`}>
                          <TableCell className="pl-8">{item.itemName}</TableCell><TableCell />
                          <TableCell className="text-right">{item.quantity.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{money(item.revenue)}</TableCell>
                          <TableCell className="text-right">{money(item.cost)}{item.costSource === "current" && <span className="ml-1 px-1 py-0.5 text-xs rounded bg-amber-100 text-amber-700" title="尚未出貨或舊資料無成本快照，以目前移動平均成本估算">估算</span>}</TableCell>
                          <TableCell className="text-right">{money(item.grossProfit)}</TableCell>
                          <TableCell className="text-right">{item.marginPct.toFixed(1)}%</TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                  {data.rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">查無符合條件的銷售訂單</TableCell></TableRow>}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}