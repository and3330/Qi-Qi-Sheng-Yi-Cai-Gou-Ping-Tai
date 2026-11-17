import { useState, useEffect, useCallback } from "react";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Zap } from "lucide-react";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface SalesOrder { id: number; orderNumber: string; customerName: string; status: string; items: { itemId: number; itemName: string; quantity: number }[] }

export default function ProductionPlanningPage() {
  const reloadKey = useAutoReloadKey();
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<number | null>(null);
  const { toast } = useToast();

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/erp-api/sales-orders`);
    const all = await res.json();
    const confirmed = all.filter((o: SalesOrder) => o.status === "Confirmed" || o.status === "Submitted");
    setOrders(confirmed);
    setLoading(false);
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders, reloadKey]);

  const generateWorkOrders = async (salesOrderId: number) => {
    setGenerating(salesOrderId);
    const res = await fetch(`/erp-api/production-planning/generate-from-so`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ salesOrderId }),
    });
    if (res.ok) {
      const data = await res.json();
      const count = data.created?.length || 0;
      const errCount = data.errors?.length || 0;
      let msg = `已產生 ${count} 張工單`;
      if (errCount > 0) msg += `，${errCount} 項無法產生`;
      toast({ title: msg });
      fetchOrders();
    } else {
      const err = await res.json();
      toast({ title: err.error || "產生失敗", variant: "destructive" });
    }
    setGenerating(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="生產計畫" description="從銷售訂單自動產生工單" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">已確認的銷售訂單</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50/50">
              <th className="text-left px-4 py-2.5 font-semibold">訂單號</th>
              <th className="text-left px-4 py-2.5 font-semibold">客戶</th>
              <th className="text-center px-4 py-2.5 font-semibold">狀態</th>
              <th className="text-center px-4 py-2.5 font-semibold">操作</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
              : orders.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">目前沒有可用的銷售訂單</td></tr>
              : orders.map(o => (
                <tr key={o.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono">{o.orderNumber}</td>
                  <td className="px-4 py-2">{o.customerName}</td>
                  <td className="px-4 py-2 text-center"><Badge variant="secondary">{o.status}</Badge></td>
                  <td className="px-4 py-2 text-center">
                    <Button size="sm" onClick={() => generateWorkOrders(o.id)} disabled={generating === o.id}>
                      <Zap className="h-3 w-3 mr-1" />{generating === o.id ? "產生中..." : "產生工單"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
