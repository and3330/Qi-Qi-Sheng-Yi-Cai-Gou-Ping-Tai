import React, { useState } from 'react';
import { useListErpAuditLogs, getListErpAuditLogsQueryKey } from '@workspace/api-client-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

export default function AuditLogsPage() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data: logsPage, isLoading } = useListErpAuditLogs(
    { q: search, page },
    { query: { queryKey: getListErpAuditLogsQueryKey({ q: search, page }) } }
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(q);
    setPage(1);
  };

  const totalPages = logsPage ? Math.ceil(logsPage.total / pageSize) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          審計日誌
        </h2>
        
        <form onSubmit={handleSearch} className="flex flex-1 max-w-md items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜尋使用者、模組、描述..."
              className="pl-9 bg-card shadow-sm"
            />
          </div>
          <Button type="submit" variant="secondary">搜尋</Button>
        </form>
      </div>

      <Card className="shadow-sm border-t-2 border-t-primary">
        <div className="rounded-md border-0">
          <Table>
            <TableHeader className="bg-secondary/50">
              <TableRow>
                <TableHead className="w-[180px] font-semibold">時間</TableHead>
                <TableHead className="w-[150px] font-semibold">操作人</TableHead>
                <TableHead className="w-[120px] font-semibold">模組</TableHead>
                <TableHead className="w-[120px] font-semibold">動作</TableHead>
                <TableHead className="font-semibold">描述</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : logsPage?.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    查無操作紀錄
                  </TableCell>
                </TableRow>
              ) : (
                logsPage?.items.map(log => (
                  <TableRow key={log.id} className="hover:bg-muted/30">
                    <TableCell className="text-sm font-mono text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss')}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">
                      {log.userName || log.userId}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground border">
                        {log.module}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                        log.action.includes('CREATE') || log.action.includes('ADD') ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' :
                        log.action.includes('UPDATE') || log.action.includes('EDIT') ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                        log.action.includes('DELETE') || log.action.includes('REMOVE') ? 'bg-destructive/10 text-destructive' :
                        'bg-secondary text-secondary-foreground'
                      }`}>
                        {log.action}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-foreground/80">
                      {log.description}
                      {log.documentId && <span className="ml-2 text-xs text-muted-foreground font-mono">ID: {log.documentId}</span>}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {logsPage && logsPage.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <div className="text-sm text-muted-foreground">
              顯示 {(page - 1) * pageSize + 1} 至 {Math.min(page * pageSize, logsPage.total)} 筆，共 <span className="font-medium text-foreground">{logsPage.total}</span> 筆
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="w-4 h-4" />
                上一頁
              </Button>
              <div className="text-sm font-medium px-2 text-foreground">
                {page} / {totalPages}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                下一頁
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
