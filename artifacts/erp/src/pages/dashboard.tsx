import React from 'react';
import { useGetErpDashboard, getGetErpDashboardQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, BriefcaseBusiness, CircleDollarSign, Clock3, FileWarning, FolderKanban, Headphones, PackageSearch, ShoppingCart, UserPlus, Users } from 'lucide-react';
import { format } from 'date-fns';

export default function DashboardPage() {
  const { data: dashboard, isLoading } = useGetErpDashboard({
    query: {
      queryKey: getGetErpDashboardQueryKey()
    }
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-16" />
              <CardContent className="h-16" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const summary = dashboard as typeof dashboard & {
    monthlySalesAmount?: number;
    monthlySalesOrderCount?: number;
    pendingPurchaseOrderCount?: number;
    lowStockItemCount?: number;
    pendingLeaveRequestCount?: number;
    openWorkOrderCount?: number;
    openComplaintCount?: number;
    activeProjectCount?: number;
    expiringContractCount?: number;
    monthlyNewLeadCount?: number;
  };

  const sections = [
    {
      title: '銷售 / 採購',
      cards: [
        { label: '本月銷貨金額', value: `$${(summary?.monthlySalesAmount ?? 0).toLocaleString('zh-TW')}`, hint: `${summary?.monthlySalesOrderCount ?? 0} 筆銷貨單`, icon: CircleDollarSign },
        { label: '待收貨採購單', value: summary?.pendingPurchaseOrderCount ?? 0, hint: '尚待完成收貨', icon: ShoppingCart },
        ...(summary?.lowStockItemCount === undefined ? [] : [{ label: '低庫存品項', value: summary.lowStockItemCount, hint: '低於安全庫存', icon: PackageSearch }]),
      ],
    },
    {
      title: '人資',
      cards: [
        { label: '待簽核請假', value: summary?.pendingLeaveRequestCount ?? 0, hint: '等待主管或人資處理', icon: Clock3 },
        { label: 'ERP 使用者', value: summary?.erpUserCount ?? 0, hint: `共 ${summary?.departmentCount ?? 0} 個部門`, icon: Users },
      ],
    },
    {
      title: '客服',
      cards: [
        { label: '開放工單', value: summary?.openWorkOrderCount ?? 0, hint: '尚未結案', icon: Headphones },
        { label: '開放客訴', value: summary?.openComplaintCount ?? 0, hint: '尚未結案', icon: FileWarning },
        { label: '本月新潛客', value: summary?.monthlyNewLeadCount ?? 0, hint: '本月建立', icon: UserPlus },
      ],
    },
    {
      title: '專案 / 合約',
      cards: [
        { label: '進行中專案', value: summary?.activeProjectCount ?? 0, hint: '目前執行中', icon: FolderKanban },
        { label: '30 天內到期合約', value: summary?.expiringContractCount ?? 0, hint: '請留意續約時程', icon: BriefcaseBusiness },
      ],
    },
  ];

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <section key={section.title} className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground">{section.title}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {section.cards.map(({ label, value, hint, icon: Icon }) => (
              <Card key={label} className="shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                  <Icon className="size-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{value}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}

      {/* Recent Activity */}
      <Card className="shadow-sm border-t-4 border-t-primary">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center">
            <Activity className="w-4 h-4 mr-2" />
            最近系統操作紀錄
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dashboard?.recentAuditLogs && dashboard.recentAuditLogs.length > 0 ? (
            <div className="space-y-4">
              {dashboard.recentAuditLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-4 pb-4 border-b last:border-0 last:pb-0">
                  <div className="w-2 h-2 mt-2 rounded-full bg-primary shrink-0" />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm text-foreground">
                      <span className="font-semibold">{log.userName || log.userId}</span> 
                      {' '}{log.description}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss')} • {log.module} • {log.action}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">
              尚無操作紀錄
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
