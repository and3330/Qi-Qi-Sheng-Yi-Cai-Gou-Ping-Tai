import React, { useEffect, useMemo, useState } from "react";
import { ReportHeader } from "@/components/shared/report-header";
import { fmtMoney } from "@/lib/report-format";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Printer, Package, AlertTriangle, DollarSign } from "lucide-react";
import { ExportMenu } from "@/components/shared/export-menu";
import { MobileCard, MobileCardHeader, MobileCardGrid, MobileCardItem } from "@/components/shared/mobile-card";
import type { ExportOptions } from "@/lib/export-utils";
import type {
  InventoryStatusData,
  InventoryRow,
  WarehouseBreakdown,
  WarehouseInventorySummary,
} from "./types";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
const PAGE_SIZE = 50;

export default function InventoryStatusPage() {
  const reloadKey = useAutoReloadKey();
  const [data, setData] = useState<InventoryStatusData | null>(null);
  const [warehouseSummary, setWarehouseSummary] = useState<WarehouseInventorySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [group, setGroup] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [showLow, setShowLow] = useState(false);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, group, warehouseId, showLow]);

  const filterParams = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (group) params.set("group", group);
    if (warehouseId) params.set("warehouseId", warehouseId);
    if (showLow) params.set("lowStockOnly", "true");
    return params;
  }, [debouncedSearch, group, warehouseId, showLow]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(filterParams);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    setLoading(true);
    setError("");

    Promise.all([
      fetch(`/erp-api/reports/inventory?${params}`, { signal: controller.signal }),
      fetch(`/erp-api/reports/inventory/warehouse-summary?${filterParams}`, { signal: controller.signal }),
    ])
      .then(async ([reportResponse, warehouseResponse]) => {
        if (!reportResponse.ok || !warehouseResponse.ok) throw new Error("庫存報表載入失敗");
        const [report, warehouse] = await Promise.all([
          reportResponse.json() as Promise<InventoryStatusData>,
          warehouseResponse.json() as Promise<{ rows: WarehouseInventorySummary[] }>,
        ]);
        setData(report);
        setWarehouseSummary(warehouse.rows);
      })
      .catch(err => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "庫存報表載入失敗");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [filterParams, page, refreshKey, reloadKey]);

  const fmt = (n: number) => fmtMoney(n);
  const fmtQty = (n: number) => n.toLocaleString("zh-TW", { maximumFractionDigits: 2 });

  const exportRows = async (): Promise<InventoryRow[]> => {
    const params = new URLSearchParams(filterParams);
    params.set("page", "1");
    params.set("pageSize", "5000");
    const response = await fetch(`/erp-api/reports/inventory?${params}`);
    if (!response.ok) throw new Error("匯出資料載入失敗");
    const result = await response.json() as InventoryStatusData;
    return result.rows;
  };

  const buildExport = async (): Promise<ExportOptions> => {
    const rows = await exportRows();
    return {
      title: "庫存狀況表（依移動平均成本）",
      fileName: `庫存狀況_${new Date().toISOString().slice(0, 10)}`,
      headers: ["品項代碼", "品項名稱", "群組", "單位", "現有庫存", "安全庫存", "移動平均成本", "庫存價值", "低庫存"],
      columnKeys: ["itemCode", "itemName", "itemGroup", "unit", "currentStock", "reorderLevel", "movingAvgCost", "stockValue", "belowReorder"],
      rows: rows.map(row => ({
        itemCode: row.itemCode,
        itemName: row.itemName,
        itemGroup: row.itemGroup || "",
        unit: row.unit,
        currentStock: row.currentStock,
        reorderLevel: row.reorderLevel,
        movingAvgCost: row.movingAvgCost,
        stockValue: row.stockValue,
        belowReorder: row.belowReorder ? "是" : "否",
      })),
    };
  };

  return (
    <div className="space-y-6" data-report>
      <ReportHeader />
      <PageHeader title="庫存狀況表" description="即時查詢品項庫存；庫存價值依移動平均成本計算" />
      <Card className="print:hidden">
        <CardContent className="py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
            <div className="w-full">
              <label className="text-sm font-medium text-gray-600 mb-1 block">搜尋品項</label>
              <Input placeholder="輸入品項代碼或名稱..." className="w-full" value={search} onChange={event => setSearch(event.target.value)} />
            </div>
            <div className="w-full">
              <label className="text-sm font-medium text-gray-600 mb-1 block">品項群組</label>
              <LookupSelect className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={group} onChange={event => setGroup(event.target.value)}>
                <option value="">全部群組</option>
                {(data?.groups || []).map(value => <option key={value} value={value}>{value}</option>)}
              </LookupSelect>
            </div>
            <div className="w-full">
              <label className="text-sm font-medium text-gray-600 mb-1 block">倉庫</label>
              <LookupSelect className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={warehouseId} onChange={event => setWarehouseId(event.target.value)}>
                <option value="">全部倉庫</option>
                {(data?.warehouses || []).map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </LookupSelect>
            </div>
            <Button variant={showLow ? "default" : "outline"} onClick={() => setShowLow(value => !value)} className="gap-1 w-full sm:w-auto">
              <AlertTriangle className="h-4 w-4" />{showLow ? "顯示全部" : "僅低庫存"}
            </Button>
            <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
              <Button className="flex-1 sm:flex-none" onClick={() => setRefreshKey(value => value + 1)} disabled={loading}>{loading ? "載入中..." : "重新整理"}</Button>
              {data && <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />列印</Button>}
              {data && <ExportMenu getExportOptions={buildExport} disabled={loading} />}
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <Card><CardContent className="py-6 text-center text-red-600">{error}</CardContent></Card>}

      {data && (
        <>
          <div className="grid sm:grid-cols-3 gap-4">
            <Card><CardContent className="flex items-center gap-4 py-4">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center"><Package className="h-5 w-5 text-blue-600" /></div>
              <div><div className="text-sm text-gray-500">品項數</div><div className="text-2xl font-bold">{data.summary.totalItems}</div></div>
            </CardContent></Card>
            <Card><CardContent className="flex items-center gap-4 py-4">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center"><DollarSign className="h-5 w-5 text-green-600" /></div>
              <div><div className="text-sm text-gray-500">庫存總值（依移動平均成本）</div><div className="text-2xl font-bold text-green-600">{fmt(data.summary.totalStockValue)}</div></div>
            </CardContent></Card>
            <Card className={data.summary.lowStockCount > 0 ? "bg-red-50 border-red-200" : ""}><CardContent className="flex items-center gap-4 py-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center"><AlertTriangle className="h-5 w-5 text-red-600" /></div>
              <div><div className="text-sm text-gray-500">低庫存品項</div><div className="text-2xl font-bold text-red-600">{data.summary.lowStockCount}</div></div>
            </CardContent></Card>
          </div>

          <Card>
            <CardHeader className="py-3 border-b"><CardTitle className="text-lg">品項明細（共 {data.summary.totalItems} 筆）</CardTitle></CardHeader>
            <CardContent className="p-0 sm:p-0">
              {/* Mobile View */}
              <div className="block md:hidden p-4 bg-gray-50/50">
                {data.rows.map(row => (
                  <MobileCard key={row.itemId} className={row.belowReorder ? "border-red-300 bg-red-50/30" : ""}>
                    <MobileCardHeader 
                      title={row.itemName}
                      value={<>{fmtQty(row.currentStock)} <span className="text-xs text-gray-400 font-normal">{row.unit}</span></>}
                      titleClass="text-gray-900"
                      valueClass="text-blue-700 font-mono"
                    />
                    <div className="text-xs text-gray-500 mb-3 flex items-center justify-between">
                      <span className="font-mono">{row.itemCode}</span>
                      {row.belowReorder ? <Badge variant="destructive" className="h-5">低庫存</Badge> : <Badge variant="outline" className="text-green-600 border-green-300 h-5">正常</Badge>}
                    </div>
                    <MobileCardGrid>
                      <MobileCardItem label="安全庫存" value={fmtQty(row.reorderLevel)} valueClass="font-mono" />
                      <MobileCardItem label="庫存價值" value={fmt(row.stockValue)} valueClass="font-mono" />
                      <MobileCardItem label="移動平均成本" value={fmt(row.movingAvgCost)} valueClass="font-mono text-gray-500" />
                    </MobileCardGrid>
                    {row.warehouseBreakdown.length > 0 && (
                      <div className="mt-4 pt-3 border-t">
                        <div className="text-xs font-semibold text-gray-500 mb-2">倉庫明細</div>
                        <div className="space-y-2">
                          {row.warehouseBreakdown.map((entry: WarehouseBreakdown) => (
                            <div key={`${row.itemId}-${entry.warehouseId}`} className="bg-gray-50 p-2 rounded text-sm flex justify-between items-center">
                              <span className="text-gray-700">{entry.warehouseName}</span>
                              <span className="font-mono text-gray-600">{fmtQty(entry.qty)} <span className="text-xs text-gray-400 font-normal ml-1">{row.unit}</span></span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </MobileCard>
                ))}
                {data.rows.length === 0 && <div className="py-8 text-center text-gray-400">無品項資料</div>}
              </div>

              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-gray-50/50">
                    <th className="text-left px-4 py-2.5">品項代碼</th><th className="text-left px-4 py-2.5">品項名稱</th>
                    <th className="text-left px-4 py-2.5 hidden lg:table-cell">群組</th><th className="text-center px-3 py-2.5">單位</th>
                    <th className="text-right px-3 py-2.5">現有庫存</th><th className="text-right px-3 py-2.5">安全庫存</th>
                    <th className="text-right px-3 py-2.5">移動平均成本</th><th className="text-right px-4 py-2.5">庫存價值</th>
                    <th className="text-center px-3 py-2.5">狀態</th>
                  </tr></thead>
                  <tbody>
                    {data.rows.map(row => (
                      <React.Fragment key={row.itemId}>
                        <tr className={`border-b hover:bg-gray-50 ${row.belowReorder ? "bg-red-50/30" : ""}`}>
                          <td className="px-4 py-1.5 font-mono text-xs">{row.itemCode}</td><td className="px-4 py-1.5 font-medium">{row.itemName}</td>
                          <td className="px-4 py-1.5 text-gray-500 hidden lg:table-cell">{row.itemGroup || "-"}</td><td className="px-3 py-1.5 text-center">{row.unit}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmtQty(row.currentStock)}</td><td className="px-3 py-1.5 text-right font-mono text-gray-400">{fmtQty(row.reorderLevel)}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmt(row.movingAvgCost)}</td><td className="px-4 py-1.5 text-right font-mono">{fmt(row.stockValue)}</td>
                          <td className="px-3 py-1.5 text-center">{row.belowReorder ? <Badge variant="destructive">低庫存</Badge> : <Badge variant="outline" className="text-green-600 border-green-300">正常</Badge>}</td>
                        </tr>
                        {row.warehouseBreakdown.map((entry: WarehouseBreakdown) => (
                          <tr key={`${row.itemId}-${entry.warehouseId}`} className="border-b bg-gray-50/30">
                            <td className="px-4 py-1 pl-10 text-xs text-gray-400" colSpan={3}>└ {entry.warehouseName}</td>
                            <td className="px-3 py-1 text-center text-xs text-gray-400">{row.unit}</td>
                            <td className="px-3 py-1 text-right font-mono text-xs text-gray-500">{fmtQty(entry.qty)}</td><td colSpan={4} />
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                    {data.rows.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">無品項資料</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t px-4 py-3 print:hidden w-full">
                <span className="text-sm text-gray-500">第 {data.pagination.page} / {data.pagination.totalPages} 頁</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>上一頁</Button>
                  <Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages || loading} onClick={() => setPage(value => value + 1)}>下一頁</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3 border-b"><CardTitle className="text-lg">各倉庫庫存摘要（依移動平均成本）</CardTitle></CardHeader>
            <CardContent className="p-0 sm:p-0">
              {/* Mobile View */}
              <div className="block md:hidden p-4 bg-gray-50/50">
                {warehouseSummary.map(row => (
                  <MobileCard key={row.warehouseId}>
                    <MobileCardHeader 
                      title={row.warehouseName}
                      value={fmt(row.totalValue)}
                      titleClass="text-gray-900"
                      valueClass="text-green-700 font-mono"
                    />
                    <MobileCardGrid>
                      <MobileCardItem label="庫存數量" value={fmtQty(row.totalQuantity)} valueClass="font-mono text-gray-600" />
                    </MobileCardGrid>
                  </MobileCard>
                ))}
              </div>

              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50/50"><th className="text-left px-4 py-2.5">倉庫</th><th className="text-right px-4 py-2.5">庫存數量</th><th className="text-right px-4 py-2.5">庫存價值</th></tr></thead>
              <tbody>{warehouseSummary.map(row => <tr key={row.warehouseId} className="border-b"><td className="px-4 py-2">{row.warehouseName}</td><td className="px-4 py-2 text-right font-mono">{fmtQty(row.totalQuantity)}</td><td className="px-4 py-2 text-right font-mono">{fmt(row.totalValue)}</td></tr>)}</tbody>
            </table></div></CardContent>
          </Card>
        </>
      )}

      {!data && loading && <Card><CardContent className="py-12 text-center text-gray-400">載入中...</CardContent></Card>}
    </div>
  );
}