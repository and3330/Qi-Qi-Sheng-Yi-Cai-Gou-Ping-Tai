import { useState, useEffect, useCallback } from "react";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DocWindow } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";
import { Play, Calculator } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface Asset {
  id: number; assetNumber: string; name: string; categoryName: string; status: string;
  purchaseCost: number; currentValue: number; salvageValue: number;
  accumulatedDepreciation: number; usefulLifeYears: number; depreciationMethod: string;
}

interface DepEntry {
  id: number; assetId: number; period: string; depreciationAmount: number;
  accumulatedAmount: number; bookValue: number; depreciationDate: string;
  journalEntryId: number | null;
}

const methodMap: Record<string, string> = { "straight-line": "直線法", "declining": "定率遞減法" };

export default function DepreciationPage() {
  const reloadKey = useAutoReloadKey();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState<number | null>(null);
  const [entries, setEntries] = useState<DepEntry[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchPeriod, setBatchPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [batchResults, setBatchResults] = useState<{ assetNumber: string; amount: number; error?: string }[] | null>(null);
  const { toast } = useToast();
  const batch = useBatchSelection(assets);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/erp-api/assets`);
    const all: Asset[] = await res.json();
    setAssets(all.filter(a => a.status === "In Use" || a.accumulatedDepreciation > 0));
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const viewSchedule = async (assetId: number) => {
    setSelectedAsset(assetId);
    const res = await fetch(`/erp-api/assets/${assetId}`);
    if (res.ok) {
      const data = await res.json();
      setEntries(data.depreciationEntries || []);
    }
  };

  const runSingle = async (assetId: number, period: string) => {
    const res = await fetch(`/erp-api/assets/${assetId}/depreciate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period }),
    });
    if (res.ok) {
      toast({ title: "折舊已計提" }); viewSchedule(assetId); fetchAll();
    } else {
      const err = await res.json();
      toast({ title: err.error || "操作失敗", variant: "destructive" });
    }
  };

  const runBatch = async () => {
    const res = await fetch(`/erp-api/assets/batch-depreciate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: batchPeriod }),
    });
    if (res.ok) {
      const data = await res.json();
      setBatchResults(data.results);
      toast({ title: `批次折舊完成 (${batchPeriod})` }); fetchAll();
    } else {
      const err = await res.json();
      toast({ title: err.error || "操作失敗", variant: "destructive" });
    }
  };

  const selAsset = assets.find(a => a.id === selectedAsset);

  return (
    <div className="space-y-6">
      <PageHeader title="折舊排程" description="檢視資產折舊紀錄，執行單一或批次折舊計提，每筆折舊自動產生日記帳分錄" />

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="折舊資產"
          entityEndpoint="asset-depreciation"
          ids={batch.ids}
          batchFields={[]}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}

      <div className="flex justify-end">
        <Button onClick={() => { setBatchResults(null); setBatchOpen(true); }}><Calculator className="h-4 w-4 mr-1" />批次計提折舊</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="py-3 border-b"><CardTitle>使用中資產</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-gray-50/50">
                  <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                  <th className="text-left px-3 py-2 font-semibold">資產</th>
                  <th className="text-right px-3 py-2 font-semibold">購入成本</th>
                  <th className="text-right px-3 py-2 font-semibold">帳面價值</th>
                  <th className="text-center px-3 py-2 font-semibold">操作</th>
                </tr></thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">載入中...</td></tr>
                  ) : assets.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">無使用中資產</td></tr>
                  ) : assets.map(a => (
                    <tr key={a.id} className={`border-b hover:bg-gray-50 cursor-pointer ${selectedAsset === a.id ? "bg-blue-50" : ""}`} onClick={() => viewSchedule(a.id)}>
                      <td className="px-2" onClick={e => e.stopPropagation()}><CheckboxCell checked={batch.selectedIds.has(a.id)} onChange={() => batch.toggle(a.id)} /></td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{a.name}</div>
                        <div className="text-xs text-gray-400">{a.assetNumber} · {methodMap[a.depreciationMethod]}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">${a.purchaseCost.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">${a.currentValue.toLocaleString()}</td>
                      <td className="px-3 py-2 text-center">
                        {a.status === "In Use" && a.currentValue > a.salvageValue && (
                          <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); runSingle(a.id, new Date().toISOString().slice(0, 7)); }} title="計提本月折舊">
                            <Play className="h-3 w-3" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 border-b">
            <CardTitle>{selAsset ? `折舊紀錄 - ${selAsset.name}` : "折舊紀錄"}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {!selAsset ? (
              <div className="px-4 py-8 text-center text-gray-400">選擇資產檢視折舊紀錄</div>
            ) : entries.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-400">尚無折舊紀錄</div>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-gray-50/50">
                  <th className="text-left px-3 py-2 font-semibold">期間</th>
                  <th className="text-right px-3 py-2 font-semibold">折舊額</th>
                  <th className="text-right px-3 py-2 font-semibold">累計折舊</th>
                  <th className="text-right px-3 py-2 font-semibold">帳面價值</th>
                  <th className="text-left px-3 py-2 font-semibold">日記帳</th>
                </tr></thead>
                <tbody>
                  {entries.map(e => (
                    <tr key={e.id} className="border-b">
                      <td className="px-3 py-2">{e.period}</td>
                      <td className="px-3 py-2 text-right font-mono">${e.depreciationAmount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">${e.accumulatedAmount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">${e.bookValue.toLocaleString()}</td>
                      <td className="px-3 py-2">{e.journalEntryId ? <Badge variant="secondary">JE#{e.journalEntryId}</Badge> : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {selAsset && (
              <div className="p-3 border-t bg-gray-50 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>購入成本：<span className="font-mono">${selAsset.purchaseCost.toLocaleString()}</span></div>
                  <div>殘值：<span className="font-mono">${selAsset.salvageValue.toLocaleString()}</span></div>
                  <div>累計折舊：<span className="font-mono">${selAsset.accumulatedDepreciation.toLocaleString()}</span></div>
                  <div>帳面價值：<span className="font-mono font-bold">${selAsset.currentValue.toLocaleString()}</span></div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <DocWindow
        open={batchOpen} onClose={() => setBatchOpen(false)} name="批次計提折舊"
        footer={<>
          <Button variant="outline" onClick={() => setBatchOpen(false)}>關閉</Button>
          <Button onClick={runBatch}>執行批次折舊</Button>
        </>}
      >
          <div className="space-y-4">
            <div><label className="text-sm font-medium">折舊期間</label><Input type="month" value={batchPeriod} onChange={e => setBatchPeriod(e.target.value)} /></div>
            {batchResults && (
              <div>
                <table className="w-full text-xs">
                  <thead><tr className="border-b bg-gray-50">
                    <th className="text-left px-2 py-1">資產</th>
                    <th className="text-right px-2 py-1">折舊額</th>
                    <th className="text-left px-2 py-1">狀態</th>
                  </tr></thead>
                  <tbody>
                    {batchResults.map((r, i) => (
                      <tr key={i} className="border-b">
                        <td className="px-2 py-1">{r.assetNumber}</td>
                        <td className="px-2 py-1 text-right font-mono">${r.amount.toLocaleString()}</td>
                        <td className="px-2 py-1">{r.error ? <span className="text-red-500">{r.error}</span> : <Badge variant="default">完成</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
      </DocWindow>
    </div>
  );
}
