import { useState, useMemo } from "react";
import { 
  useGetAdminCommissionReport,
  type CommissionRecord,
} from "@workspace/api-client-react";
import { HandCoins, Search, Calendar as CalendarIcon, Download, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AdminLayout } from "./AdminLayout";
import { formatPrice } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Dimension = "city" | "institution" | "department";

export default function AdminCommissionsPage() {
  const [dimension, setDimension] = useState<Dimension>("city");
  
  const d = new Date();
  const defaultFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [institutionId, setInstitutionId] = useState<string>("");

  const { data: report, isLoading } = useGetAdminCommissionReport({
    from: from || undefined,
    to: to || undefined,
    institutionId: institutionId ? Number(institutionId) : undefined,
  });

  const aggregatedGroups = useMemo(() => {
    if (!report?.groups) return [];
    
    if (dimension === "department") {
      return report.groups;
    }
    
    const map = new Map<string, { label: string, orderCount: number, amount: number }>();
    
    report.groups.forEach(g => {
      const key = dimension === "city" ? g.city : g.institutionId.toString();
      const label = dimension === "city" ? g.city : g.institutionName;
      
      const existing = map.get(key) || { label, orderCount: 0, amount: 0 };
      existing.orderCount += g.orderCount;
      existing.amount += g.amount;
      map.set(key, existing);
    });
    
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [report, dimension]);

  return (
    <AdminLayout title="佣金報表">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border bg-white p-1 shadow-sm">
            <input
              type="date"
              className="h-8 rounded-lg bg-transparent px-2 text-sm outline-none"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-muted-foreground">-</span>
            <input
              type="date"
              className="h-8 rounded-lg bg-transparent px-2 text-sm outline-none"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Input
              placeholder="機構 ID (選填)"
              className="w-32 h-10 bg-white"
              value={institutionId}
              onChange={e => setInstitutionId(e.target.value)}
            />
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600 mr-2">檢視維度：</span>
          <Select value={dimension} onValueChange={(v) => setDimension(v as Dimension)}>
            <SelectTrigger className="w-32 bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="city">縣市</SelectItem>
              <SelectItem value="institution">醫療機構</SelectItem>
              <SelectItem value="department">科室</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-10 w-10 bg-white">
            <Download size={16} />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1.5">
                <HandCoins size={14} className="text-emerald-500" />
                總佣金金額
              </p>
              <p className="text-2xl font-bold text-gray-900">{formatPrice(report?.totalAmount || 0)}</p>
            </div>
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1.5">
                <Filter size={14} className="text-blue-500" />
                總筆數
              </p>
              <p className="text-2xl font-bold text-gray-900">{report?.recordCount || 0}</p>
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-6 mb-6">
            {/* Aggregate Table */}
            <div className="lg:col-span-1 border rounded-2xl bg-white shadow-sm overflow-hidden flex flex-col max-h-[500px]">
              <div className="p-4 border-b bg-muted/30 font-bold text-sm">
                依{dimension === "city" ? "縣市" : dimension === "institution" ? "機構" : "科室"}統計
              </div>
              <div className="overflow-y-auto p-0">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white border-b shadow-sm z-10">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">名稱</th>
                      <th className="px-4 py-2 text-right font-medium">筆數</th>
                      <th className="px-4 py-2 text-right font-medium">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregatedGroups.map((g: any, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {dimension === "department" ? (
                            <div>
                              <div>{g.institutionName}</div>
                              <div className="text-xs text-muted-foreground">{g.department || '未分科'}</div>
                            </div>
                          ) : (
                            g.label
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">{g.orderCount}</td>
                        <td className="px-4 py-3 text-right font-bold text-primary">{formatPrice(g.amount)}</td>
                      </tr>
                    ))}
                    {!aggregatedGroups.length && (
                      <tr><td colSpan={3} className="py-8 text-center text-muted-foreground">無資料</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Detail Table */}
            <div className="lg:col-span-2 border rounded-2xl bg-white shadow-sm overflow-hidden flex flex-col max-h-[500px]">
              <div className="p-4 border-b bg-muted/30 font-bold text-sm flex justify-between items-center">
                <span>詳細紀錄</span>
                {report?.recordsTruncated && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-normal">僅顯示前 100 筆，請匯出查看全部</span>
                )}
              </div>
              <div className="overflow-x-auto overflow-y-auto p-0">
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="sticky top-0 bg-white border-b shadow-sm z-10">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">機構/科室</th>
                      <th className="px-4 py-2 font-medium">訂單/成員</th>
                      <th className="px-4 py-2 font-medium">套用規則</th>
                      <th className="px-4 py-2 text-right font-medium">佣金金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report?.records.map((r: CommissionRecord) => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="font-bold text-gray-900">{r.institutionName}</div>
                          <div className="text-xs text-muted-foreground flex gap-1">
                            <span className="bg-gray-100 px-1 rounded">{r.city}</span>
                            <span>{r.department || '未分科'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{r.orderNo}</div>
                          <div className="text-xs text-muted-foreground">{r.memberName}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 font-normal">
                            {r.ruleName}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="font-bold text-emerald-600">+{formatPrice(r.amount)}</div>
                        </td>
                      </tr>
                    ))}
                    {!report?.records.length && (
                      <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">無紀錄</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </AdminLayout>
  );
}