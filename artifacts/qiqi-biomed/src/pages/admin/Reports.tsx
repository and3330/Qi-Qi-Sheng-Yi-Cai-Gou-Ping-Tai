import { useMemo, useState } from "react";
import {
  useGetAdminInventoryReport,
  getGetAdminInventoryReportQueryKey,
  type GetAdminInventoryReportParams,
} from "@workspace/api-client-react";
import { PackagePlus, PackageMinus, SlidersHorizontal, Banknote } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminLayout } from "./AdminLayout";

function firstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export default function AdminReportsPage() {
  const [fromInput, setFromInput] = useState(firstDayOfMonth());
  const [toInput, setToInput] = useState(today());
  const [range, setRange] = useState({ from: firstDayOfMonth(), to: today() });

  const params = useMemo(() => {
    const p: GetAdminInventoryReportParams = {};
    if (range.from) p.from = range.from;
    if (range.to) p.to = range.to;
    return p;
  }, [range]);

  const { data: report, isLoading } = useGetAdminInventoryReport(params, {
    query: { queryKey: getGetAdminInventoryReportQueryKey(params) },
  });

  const cards = report
    ? [
        {
          label: "進貨數量",
          value: report.purchaseTotalQty.toLocaleString(),
          sub: `金額 NT$${report.purchaseTotalAmount.toLocaleString()}`,
          icon: PackagePlus,
          color: "text-green-600 bg-green-50",
        },
        {
          label: "銷貨數量",
          value: report.saleTotalQty.toLocaleString(),
          sub: `金額 NT$${report.saleTotalAmount.toLocaleString()}`,
          icon: PackageMinus,
          color: "text-blue-600 bg-blue-50",
        },
        {
          label: "庫存調整",
          value:
            report.adjustTotalQty > 0
              ? `+${report.adjustTotalQty.toLocaleString()}`
              : report.adjustTotalQty.toLocaleString(),
          sub: "含盤點 / 報廢等",
          icon: SlidersHorizontal,
          color: "text-amber-600 bg-amber-50",
        },
        {
          label: "銷貨毛額",
          value: `NT$${report.saleTotalAmount.toLocaleString()}`,
          sub: `進貨成本 NT$${report.purchaseTotalAmount.toLocaleString()}`,
          icon: Banknote,
          color: "text-primary bg-primary/10",
        },
      ]
    : [];

  return (
    <AdminLayout title="進銷存報表">
      <form
        className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setRange({ from: fromInput, to: toInput });
        }}
      >
        <div className="space-y-1.5">
          <Label>開始日期</Label>
          <Input
            type="date"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            className="bg-white sm:w-44"
            data-testid="input-report-from"
          />
        </div>
        <div className="space-y-1.5">
          <Label>結束日期</Label>
          <Input
            type="date"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            className="bg-white sm:w-44"
            data-testid="input-report-to"
          />
        </div>
        <Button type="submit" data-testid="button-report-query">
          查詢
        </Button>
      </form>

      {isLoading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map((c) => {
              const Icon = c.icon;
              return (
                <div
                  key={c.label}
                  className="rounded-2xl border bg-white p-4 shadow-sm"
                  data-testid={`card-report-${c.label}`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`rounded-xl p-2 ${c.color}`}>
                      <Icon size={18} />
                    </div>
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                  </div>
                  <p className="mt-2 text-xl font-bold">{c.value}</p>
                  <p className="text-xs text-muted-foreground">{c.sub}</p>
                </div>
              );
            })}
          </div>

          {!report?.rows.length ? (
            <div className="rounded-2xl border border-dashed bg-white py-16 text-center text-muted-foreground">
              期間內沒有進銷存異動
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-medium">商品</th>
                      <th className="px-4 py-3 text-right font-medium">進貨量</th>
                      <th className="px-4 py-3 text-right font-medium">進貨金額</th>
                      <th className="px-4 py-3 text-right font-medium">銷貨量</th>
                      <th className="px-4 py-3 text-right font-medium">銷貨金額</th>
                      <th className="px-4 py-3 text-right font-medium">調整量</th>
                      <th className="px-4 py-3 text-right font-medium">目前庫存</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r) => (
                      <tr
                        key={r.productId}
                        className="border-b last:border-0 hover:bg-muted/30"
                        data-testid={`row-report-${r.productId}`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium">{r.productName}</p>
                          <p className="text-xs text-muted-foreground">{r.productCode}</p>
                        </td>
                        <td className="px-4 py-3 text-right">{r.purchasedQty}</td>
                        <td className="px-4 py-3 text-right">
                          NT${r.purchasedAmount.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">{r.soldQty}</td>
                        <td className="px-4 py-3 text-right">
                          NT${r.soldAmount.toLocaleString()}
                        </td>
                        <td
                          className={`px-4 py-3 text-right ${
                            r.adjustedQty < 0 ? "text-red-600" : ""
                          }`}
                        >
                          {r.adjustedQty > 0 ? `+${r.adjustedQty}` : r.adjustedQty}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">
                          {r.currentStock}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </AdminLayout>
  );
}
