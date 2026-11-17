import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Bell, Check, CheckCheck, Trash2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;

const typeColors: Record<string, string> = { info: "default", approval: "outline", warning: "secondary", error: "destructive", success: "default" };
const typeLabels: Record<string, string> = { info: "資訊", approval: "審批", warning: "警告", error: "錯誤", success: "成功" };

export default function Notifications() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data = { notifications: [], unreadCount: 0 } } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const response = await fetch(api("notifications"), { credentials: "include" });
      if (!response.ok) throw new Error("無法取得通知");
      return response.json();
    },
  });
  const notifications = data.notifications;

  const markReadMutation = useMutation({
    mutationFn: (id: number) => fetch(api(`notifications/${id}/read`), { method: "PATCH" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => fetch(api("notifications/read-all"), { method: "PATCH" }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications"] }); toast({ title: "已全部標記為已讀" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetch(api(`notifications/${id}`), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unreadCount = data.unreadCount;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">通知中心</h1>
          {unreadCount > 0 && <Badge variant="destructive">{unreadCount} 未讀</Badge>}
        </div>
        {unreadCount > 0 && <Button variant="outline" onClick={() => markAllReadMutation.mutate()}><CheckCheck className="mr-2 h-4 w-4" />全部標為已讀</Button>}
      </div>

      <div className="space-y-3">
        {notifications.map((n: any) => (
          <Card key={n.id} className={n.isRead === "No" ? "border-primary/30 bg-primary/5" : ""}>
            <CardContent className="p-4 flex items-start gap-4">
              <div className={`mt-1 p-2 rounded-full ${n.isRead === "No" ? "bg-primary/10" : "bg-muted"}`}>
                <Bell className={`h-4 w-4 ${n.isRead === "No" ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{n.title}</span>
                  <Badge variant={typeColors[n.type] as any} className="text-xs">{typeLabels[n.type] || n.type}</Badge>
                  {n.module && <span className="text-xs text-muted-foreground">{n.module}</span>}
                </div>
                <p className="text-sm text-muted-foreground">{n.message}</p>
                <p className="text-xs text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString("zh-TW")}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                {n.isRead === "No" && <Button variant="ghost" size="icon" onClick={() => markReadMutation.mutate(n.id)}><Check className="h-4 w-4" /></Button>}
                <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(n.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {notifications.length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground"><Bell className="h-12 w-12 mx-auto mb-3 opacity-30" /><p>目前沒有通知</p></CardContent></Card>
        )}
      </div>
    </div>
  );
}
