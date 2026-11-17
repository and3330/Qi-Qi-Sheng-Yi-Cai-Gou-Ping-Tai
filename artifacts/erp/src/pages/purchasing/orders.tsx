import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { PageHint } from "@/components/page-hint";
import { PrintButton } from "@/components/shared/print-button";
import { ExportMenu } from "@/components/shared/export-menu";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Search, Pencil } from "lucide-react";
import { PurchaseOrderFormDialog } from "@/components/purchasing/purchase-order-edit-dialog";
import type { ExportOptions } from "@/lib/export-utils";
import { useAutoReloadKey } from "@/lib/auto-refresh";

import { DateRangePresets } from "@/components/shared/date-range-presets";
const BASE_URL = import.meta.env.BASE_URL;
const BASE = BASE_URL.endsWith("/") ? BASE_URL : BASE_URL + "/";

const statusMap: Record<string, string> = { Draft: "草稿", "To Receive": "待收貨", Completed: "已完成", Cancelled: "已取消" };
const statusOptions = ["Draft", "To Receive", "Completed", "Cancelled"];
const purchaseStatusActions: Record<string, string[]> = {
  Draft: ["To Receive", "Cancelled"],
  "To Receive": ["Cancelled"],
  Completed: [],
  Cancelled: [],
};
const statusColor = (s: string) => s === "Completed" ? "default" as const : s === "Cancelled" ? "destructive" as const : "secondary" as const;

function getMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}` };
}

export default function PurchaseOrdersPage() {
  const reloadKey = useAutoReloadKey();
  const [, navigate] = useLocation();
  const searchParams = useSearch();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [initialSupplierId, setInitialSupplierId] = useState("");

  const { from: defaultFrom, to: defaultTo } = useMemo(() => getMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const ordRes = await fetch(`/erp-api/purchase-orders`);
    setOrders(await ordRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  // 網址帶著 supplierId 過來：直接打開新增視窗並帶入供應商
  useEffect(() => {
    const supplierId = new URLSearchParams(searchParams).get("supplierId");
    if (!supplierId) return;
    setEditing(null);
    setInitialSupplierId(supplierId);
    setOpen(true);
  }, [searchParams]);

  const filtered = useMemo(() => {
    return (orders || []).filter((o: any) => {
      if (dateFrom && o.orderDate < dateFrom) return false;
      if (dateTo && o.orderDate > dateTo) return false;
      if (statusFilter && o.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const match = (o.orderNumber || "").toLowerCase().includes(q)
          || (o.supplierName || "").toLowerCase().includes(q)
          || String(o.totalAmount || "").includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [orders, dateFrom, dateTo, search, statusFilter]);

  const statusEditableOrders = filtered.filter((order: any) => purchaseStatusActions[order.status]?.length > 0);
  const batch = useBatchSelection(statusEditableOrders);
  const selectedOrders = filtered.filter((order: any) => batch.selectedIds.has(order.id));
  const commonStatusActions = selectedOrders.length === 0
    ? []
    : purchaseStatusActions[selectedOrders[0].status].filter(status =>
        selectedOrders.every((order: any) => purchaseStatusActions[order.status].includes(status)),
      );
  const batchFields: BatchField[] = commonStatusActions.length > 0 ? [{
    key: "status",
    label: "推進狀態",
    type: "select",
    options: commonStatusActions.map(value => ({
      value,
      label: value === "Cancelled" ? "取消（須先取消進貨單與發票）" : statusMap[value],
    })),
  }] : [];
  const openEdit = (o: any) => {
    setEditing(o);
    setOpen(true);
  };

  const buildExport = (): ExportOptions => ({
    title: "採購訂單清單",
    subtitle: `期間：${dateFrom || "不限"} 至 ${dateTo || "不限"}`,
    fileName: `採購訂單清單_${dateFrom || "不限"}_${dateTo || "不限"}`,
    headers: ["訂單編號", "供應商", "日期", "狀態", "幣別", "總額"],
    columnKeys: ["orderNumber", "supplier", "date", "status", "currency", "total"],
    rows: filtered.map((order: any) => {
      const currency = order.currency || "TWD";
      const total = `${currency === "TWD" ? "NT$" : currency} ${Number(order.totalAmount).toLocaleString()}`;
      return {
        orderNumber: order.orderNumber || "-",
        supplier: order.supplierName || "-",
        date: order.orderDate || "-",
        status: statusMap[order.status] || order.status || "-",
        currency,
        total: currency !== "TWD"
          ? `${total}（折合 NT$${Number(order.totalAmountTWD).toLocaleString()}）`
          : total,
      };
    }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="採購訂單" description="管理採購流程" hint={<PageHint hintKey="purchasing-orders">這裡記錄向供應商下單的內容與進度。一般流程：建立採購單 → 確認 → 收到貨時建立進貨單 → 核對請款。小提醒：確認前先檢查供應商、交期與數量，避免後續庫存不符。</PageHint>} />
        <div className="flex gap-2">
          <PrintButton title="採購訂單清單" contentId="po-table" />
          <ExportMenu getExportOptions={buildExport} />
          <Button onClick={() => { setEditing(null); setInitialSupplierId(""); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />新增採購訂單</Button>
          {/* 新增和編輯開的都是同一個採購單視窗（和採購單明細頁的編輯是同一個） */}
          <PurchaseOrderFormDialog
            open={open}
            onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setInitialSupplierId(""); } }}
            order={editing}
            initialSupplierId={initialSupplierId}
            onSaved={fetchAll}
          />
        </div>
      </div>

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="採購訂單"
          entityEndpoint="purchase-orders"
          ids={batch.ids}
          batchFields={batchFields}
          allowDelete={false}
          onClear={batch.clearSelection}
          onComplete={fetchAll}
        />
      )}

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs text-muted-foreground">起始日期</Label>
              <Input type="date" className="w-40" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">結束日期</Label>
              <Input type="date" className="w-40" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <DateRangePresets from={dateFrom} to={dateTo} onChange={(r) => { setDateFrom(r.from); setDateTo(r.to); }} />
            <div>
              <Label className="text-xs text-muted-foreground">狀態</Label>
              <select className="flex h-10 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">全部</option>
                {statusOptions.map(s => <option key={s} value={s}>{statusMap[s]}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">搜尋</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="訂單編號、供應商名稱..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="text-sm text-muted-foreground pb-2">共 {filtered.length} 筆</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto" id="po-table">
          <DataTable
            isLoading={loading}
            data={filtered}
            onRowClick={(r: any) => navigate(`/purchasing/orders/${r.id}`)}
            columns={[
              {
                header: () => <CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} />,
                accessor: (r: any) => purchaseStatusActions[r.status]?.length > 0
                  ? <CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} />
                  : null,
                className: "w-10",
              },
              { header: "訂單編號", accessor: (r: any) => <span className="whitespace-nowrap">{r.orderNumber}{r.extraFields?.legacy === true && <span className="ml-1.5 inline-block rounded border px-1 text-[10px] font-normal text-muted-foreground align-middle" title="從舊系統 Ecount 搬過來的歷史單，只能查看">歷史</span>}</span> },
              { header: "供應商", accessor: "supplierName", className: "hidden sm:table-cell" },
              { header: "日期", accessor: "orderDate" },
              {
                header: "狀態",
                accessor: (r: any) => (
                  <Badge variant={statusColor(r.status)}>
                    {statusMap[r.status] || r.status}
                  </Badge>
                ),
              },
              { header: "幣別", accessor: (r: any) => r.currency || "TWD", className: "hidden sm:table-cell" },
              {
                header: "總額",
                accessor: (r: any) => (
                  <div>
                    <div>{r.currency === "TWD" || !r.currency ? "NT$" : r.currency} {Number(r.totalAmount).toLocaleString()}</div>
                    {r.currency && r.currency !== "TWD" && (
                      <div className="text-xs text-muted-foreground">折合 NT${Number(r.totalAmountTWD).toLocaleString()}</div>
                    )}
                    {r.status !== "Draft" && r.status !== "Cancelled" && Number(r.paidAmount) > 0 && (
                      <div className={`text-xs ${Number(r.outstandingAmount) > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {Number(r.outstandingAmount) > 0 ? `已付 NT$${Number(r.paidAmount).toLocaleString()}，未付 NT$${Number(r.outstandingAmount).toLocaleString()}` : "已付清"}
                      </div>
                    )}
                  </div>
                ),
                className: "text-right",
              },
              {
                header: "操作",
                // 每一張單都開同一個編輯視窗；能改哪些欄位由視窗依狀態決定
                accessor: (r: any) => (
                  <Button size="sm" variant="outline" title={r.extraFields?.legacy === true ? "編輯專案、部門、到貨日與備註" : r.status === "Draft" ? "編輯" : "編輯預計到貨日"} onClick={(e) => { e.stopPropagation(); openEdit(r); }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                ),
                className: "text-center w-16",
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
