import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;

const actionColors: Record<string, string> = { create: "default", update: "outline", delete: "destructive", login: "secondary" };
const actionLabels: Record<string, string> = { create: "新增", update: "修改", delete: "刪除", login: "登入", approve: "核准", reject: "駁回" };
const moduleLabels: Record<string, string> = {
  HR: "人事", "HR Contracts": "人事合約", Sales: "銷售", Purchasing: "採購", Accounting: "會計", Inventory: "庫存",
  Manufacturing: "製造", Quality: "品質", Projects: "專案", Assets: "資產", CRM: "客戶關係", Helpdesk: "客服",
  Contracts: "合約", Admin: "帳號與權限", System: "系統設定", AI: "AI 助理",
};

export default function AuditLogs() {
  const [module, setModule] = useState("");
  const [action, setAction] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const query = new URLSearchParams();
  if (module) query.set("module", module);
  if (action) query.set("action", action);
  if (startDate) query.set("startDate", startDate);
  if (endDate) query.set("endDate", endDate);

  const { data: logs = [] } = useQuery({ queryKey: ["audit-logs", module, action, startDate, endDate], queryFn: () => fetch(api(`audit-logs?${query}`)).then(r => r.json()) });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">稽核紀錄</h1>

      <div className="flex flex-wrap gap-3">
        <Select value={module} onValueChange={v => setModule(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="全部模組" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部模組</SelectItem>
            {Object.entries(moduleLabels).map(([m, label]) => <SelectItem key={m} value={m}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={v => setAction(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="全部動作" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部動作</SelectItem>
            {["create", "update", "delete", "login", "approve", "reject"].map(a => <SelectItem key={a} value={a}>{actionLabels[a] || a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-[160px]" placeholder="開始日期" />
        <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-[160px]" placeholder="結束日期" />
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>時間</TableHead>
                <TableHead>動作</TableHead>
                <TableHead>模組</TableHead>
                <TableHead>文件類型</TableHead>
                <TableHead>文件編號</TableHead>
                <TableHead>使用者</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>說明</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log: any) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(log.createdAt).toLocaleString("zh-TW")}</TableCell>
                  <TableCell><Badge variant={actionColors[log.action] as any}>{actionLabels[log.action] || log.action}</Badge></TableCell>
                  <TableCell>{moduleLabels[log.module] || log.module}</TableCell>
                  <TableCell>{log.documentType || "-"}</TableCell>
                  <TableCell className="font-mono text-sm">{log.documentNumber || "-"}</TableCell>
                  <TableCell>{log.userName || "-"}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{log.ipAddress || "-"}</TableCell>
                  <TableCell className="max-w-xs truncate">{log.description || "-"}</TableCell>
                </TableRow>
              ))}
              {logs.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">尚無稽核紀錄</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
