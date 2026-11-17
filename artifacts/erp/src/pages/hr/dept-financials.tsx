import { useState } from "react";
import { getGetDepartmentFinancialsQueryKey, useListDepartments, useGetDepartmentFinancials } from "@workspace/erp-api-client-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, DollarSign, Users, FileText } from "lucide-react";

export default function DeptFinancialsPage() {
  const { data: departments, isLoading: loadingDepts } = useListDepartments();
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    // 支援從部門／專案列表帶 ?id= 直接開啟
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  const { data: financials, isLoading: loadingFinancials } = useGetDepartmentFinancials(
    selectedId ?? 0,
    { query: { queryKey: getGetDepartmentFinancialsQueryKey(selectedId ?? 0), enabled: !!selectedId } }
  );

  return (
    <div className="space-y-6">
      <PageHeader title="部門損益查詢" description="依部門查詢損益及相關資料" />

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">選擇部門</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingDepts ? (
            <div className="text-gray-400">載入中...</div>
          ) : !departments?.length ? (
            <div className="text-gray-400">尚無部門</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {departments.map(d => (
                <button
                  key={d.id}
                  onClick={() => setSelectedId(d.id)}
                  className={`text-left p-3 rounded-lg border transition-all ${selectedId === d.id ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200" : "hover:bg-gray-50"}`}
                >
                  <div className="font-medium">{d.name}{(d as any).isActive === false ? "（已停用）" : ""}</div>
                  <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                    <Users className="h-3 w-3" /> {d.employeeCount} 人
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedId && (
        <>
          {loadingFinancials ? (
            <div className="animate-pulse space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="h-24 bg-gray-200 rounded" />
                <div className="h-24 bg-gray-200 rounded" />
                <div className="h-24 bg-gray-200 rounded" />
              </div>
            </div>
          ) : financials && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="flex items-center gap-4 py-4">
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                      <TrendingUp className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">部門收入</div>
                      <div className="text-xl font-bold text-green-600">${financials.totalIncome.toLocaleString()}</div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex items-center gap-4 py-4">
                    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                      <TrendingDown className="h-5 w-5 text-red-600" />
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">部門支出</div>
                      <div className="text-xl font-bold text-red-600">${financials.totalExpense.toLocaleString()}</div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex items-center gap-4 py-4">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                      <DollarSign className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">淨損益</div>
                      <div className={`text-xl font-bold ${financials.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        ${financials.netProfit.toLocaleString()}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {(financials.employees as any[])?.length > 0 && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />部門人員（{(financials.employees as any[]).length} 人）</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-gray-50/50">
                            <th className="text-left px-4 py-2 font-medium">姓名</th>
                            <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">職稱</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(financials.employees as any[]).map((e: any) => (
                            <tr key={e.id} className="border-b hover:bg-gray-50">
                              <td className="px-4 py-2 font-medium">{e.firstName} {e.lastName}</td>
                              <td className="px-4 py-2 hidden sm:table-cell">{e.designation || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {(financials.vouchers as any[])?.length > 0 && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" />部門單據</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-gray-50/50">
                            <th className="text-left px-4 py-2 font-medium">單號</th>
                            <th className="text-left px-4 py-2 font-medium">類型</th>
                            <th className="text-left px-4 py-2 font-medium">日期</th>
                            <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">說明</th>
                            <th className="text-right px-4 py-2 font-medium">金額</th>
                            <th className="text-center px-4 py-2 font-medium">狀態</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(financials.vouchers as any[]).map((v: any) => (
                            <tr key={v.id} className="border-b hover:bg-gray-50">
                              <td className="px-4 py-2 font-mono text-xs">{v.voucherNumber}</td>
                              <td className="px-4 py-2">{v.voucherType}</td>
                              <td className="px-4 py-2">{v.voucherDate}</td>
                              <td className="px-4 py-2 hidden sm:table-cell">{v.description || "-"}</td>
                              <td className="px-4 py-2 text-right font-mono">${Number(v.totalAmount).toLocaleString()}</td>
                              <td className="px-4 py-2 text-center"><Badge variant="outline">{v.status}</Badge></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {(financials.entries as any[])?.length > 0 && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" />部門日記帳分錄</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-gray-50/50">
                            <th className="text-left px-4 py-2 font-medium">分錄編號</th>
                            <th className="text-left px-4 py-2 font-medium">日期</th>
                            <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">說明</th>
                            <th className="text-right px-4 py-2 font-medium">借方</th>
                            <th className="text-right px-4 py-2 font-medium">貸方</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(financials.entries as any[]).map((e: any) => (
                            <tr key={e.id} className="border-b hover:bg-gray-50">
                              <td className="px-4 py-2 font-mono text-xs">{e.entryNumber}</td>
                              <td className="px-4 py-2">{e.entryDate}</td>
                              <td className="px-4 py-2 hidden sm:table-cell">{e.description || "-"}</td>
                              <td className="px-4 py-2 text-right font-mono">${Number(e.totalDebit).toLocaleString()}</td>
                              <td className="px-4 py-2 text-right font-mono">${Number(e.totalCredit).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {!(financials.vouchers as any[])?.length && !(financials.entries as any[])?.length && !(financials.employees as any[])?.length && (
                <Card>
                  <CardContent className="py-8 text-center text-gray-400">
                    此部門尚無財務及人員資料
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
