import React from 'react';
import { useGetErpDashboard, getGetErpDashboardQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, ShieldCheck, Building2, Activity } from 'lucide-react';
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

  return (
    <div className="space-y-8">
      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">總使用者數</CardTitle>
            <Users className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard?.userCount ?? 0}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">ERP 權限帳號</CardTitle>
            <ShieldCheck className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard?.erpUserCount ?? 0}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">組織部門數</CardTitle>
            <Building2 className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard?.departmentCount ?? 0}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">今日操作紀錄</CardTitle>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard?.auditLogCount ?? 0}</div>
          </CardContent>
        </Card>
      </div>

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
