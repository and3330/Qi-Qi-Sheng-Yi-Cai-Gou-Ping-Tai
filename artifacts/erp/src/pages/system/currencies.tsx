import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Star, Pencil } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;

export default function Currencies() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [openCurrency, setOpenCurrency] = useState(false);
  const [openRate, setOpenRate] = useState(false);
  const [currForm, setCurrForm] = useState({ code: "", name: "", symbol: "", isBase: "No", isActive: "Yes", decimalPlaces: "2" });
  const [rateForm, setRateForm] = useState({ fromCurrency: "", toCurrency: "", rate: "", effectiveDate: new Date().toISOString().slice(0, 10), source: "Manual" });

  const { data: currencies = [] } = useQuery({ queryKey: ["currencies"], queryFn: () => fetch(api("currencies")).then(r => r.json()) });
  const { data: rates = [] } = useQuery({ queryKey: ["exchange-rates"], queryFn: () => fetch(api("exchange-rates")).then(r => r.json()) });
  const batch = useBatchSelection(currencies);

  // 正在編輯哪一個幣別；null 是新增
  const [editingCurrency, setEditingCurrency] = useState<any>(null);
  const saveCurrencyMutation = useMutation({
    mutationFn: async (data: any) => {
      const body = { ...data, decimalPlaces: String(Number(data.decimalPlaces) || 0) };
      const r = await fetch(api(editingCurrency ? `currencies/${editingCurrency.id}` : "currencies"), { method: editingCurrency ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error || "儲存失敗");
      return json;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["currencies"] }); setOpenCurrency(false); toast({ title: editingCurrency ? "已更新幣別" : "已新增幣別" }); setEditingCurrency(null); },
    onError: (e: any) => toast({ title: "沒有成功", description: e?.message, variant: "destructive" }),
  });
  const openEditCurrency = (c: any) => {
    setEditingCurrency(c);
    setCurrForm({ code: c.code || "", name: c.name || "", symbol: c.symbol || "", isBase: c.isBase === "Yes" ? "Yes" : "No", isActive: c.isActive === "No" ? "No" : "Yes", decimalPlaces: String(c.decimalPlaces ?? 2) });
    setOpenCurrency(true);
  };

  const deleteCurrencyMutation = useMutation({
    mutationFn: (id: number) => fetch(api(`currencies/${id}`), { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["currencies"] }); toast({ title: "已刪除" }); },
  });

  const saveRateMutation = useMutation({
    mutationFn: (data: any) => fetch(api("exchange-rates"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["exchange-rates"] }); setOpenRate(false); toast({ title: "已新增匯率" }); },
  });

  const deleteRateMutation = useMutation({
    mutationFn: (id: number) => fetch(api(`exchange-rates/${id}`), { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["exchange-rates"] }); toast({ title: "已刪除" }); },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">多幣別管理</h1>

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="幣別"
          entityEndpoint="currencies"
          ids={batch.ids}
          batchFields={[]}
          onClear={batch.clearSelection}
          onComplete={() => qc.invalidateQueries({ queryKey: ["currencies"] })}
        />
      )}

      <Tabs defaultValue="currencies">
        <TabsList>
          <TabsTrigger value="currencies">幣別</TabsTrigger>
          <TabsTrigger value="rates">匯率</TabsTrigger>
        </TabsList>

        <TabsContent value="currencies" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditingCurrency(null); setCurrForm({ code: "", name: "", symbol: "", isBase: "No", isActive: "Yes", decimalPlaces: "2" }); setOpenCurrency(true); }}><Plus className="mr-2 h-4 w-4" />新增幣別</Button>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></TableHead>
                    <TableHead>代碼</TableHead>
                    <TableHead>名稱</TableHead>
                    <TableHead>符號</TableHead>
                    <TableHead>小數位</TableHead>
                    <TableHead>基準幣別</TableHead>
                    <TableHead>狀態</TableHead>
                    <TableHead className="w-20">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currencies.map((c: any) => (
                    <TableRow key={c.id} className="cursor-pointer" title="點一下編輯這個幣別" onClick={(e) => { if ((e.target as HTMLElement).closest("button,input,label,a")) return; openEditCurrency(c); }}>
                      <TableCell><CheckboxCell checked={batch.selectedIds.has(c.id)} onChange={() => batch.toggle(c.id)} /></TableCell>
                      <TableCell className="font-mono font-medium">{c.code}</TableCell>
                      <TableCell>{c.name}</TableCell>
                      <TableCell>{c.symbol}</TableCell>
                      <TableCell>{c.decimalPlaces}</TableCell>
                      <TableCell>{c.isBase === "Yes" ? <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" /> : "-"}</TableCell>
                      <TableCell><Badge variant={c.isActive === "Yes" ? "default" : "secondary"}>{c.isActive === "Yes" ? "啟用" : "停用"}</Badge></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditCurrency(c)} aria-label="編輯" title="編輯（代碼、名稱、符號、小數位數）"><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => { if (confirm(`確定刪除幣別 ${c.code}？`)) deleteCurrencyMutation.mutate(c.id); }} aria-label="刪除"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {currencies.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">尚無幣別資料</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rates" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setRateForm({ fromCurrency: "", toCurrency: "", rate: "", effectiveDate: new Date().toISOString().slice(0, 10), source: "Manual" }); setOpenRate(true); }}><Plus className="mr-2 h-4 w-4" />新增匯率</Button>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>來源幣別</TableHead>
                    <TableHead>目標幣別</TableHead>
                    <TableHead className="text-right">匯率</TableHead>
                    <TableHead>生效日期</TableHead>
                    <TableHead>來源</TableHead>
                    <TableHead className="w-20">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rates.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">{r.fromCurrency}</TableCell>
                      <TableCell className="font-mono">{r.toCurrency}</TableCell>
                      <TableCell className="text-right font-mono">{Number(r.rate).toFixed(4)}</TableCell>
                      <TableCell>{r.effectiveDate}</TableCell>
                      <TableCell>{r.source || "Manual"}</TableCell>
                      <TableCell><Button variant="ghost" size="icon" onClick={() => deleteRateMutation.mutate(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                    </TableRow>
                  ))}
                  {rates.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">尚無匯率資料</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={openCurrency} onOpenChange={setOpenCurrency}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingCurrency ? `編輯幣別 ${editingCurrency.code}` : "新增幣別"}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><Label>代碼</Label><Input value={currForm.code} onChange={e => setCurrForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} maxLength={3} placeholder="TWD" /></div>
              <div><Label>名稱</Label><Input value={currForm.name} onChange={e => setCurrForm(f => ({ ...f, name: e.target.value }))} placeholder="新臺幣" /></div>
              <div><Label>符號</Label><Input value={currForm.symbol} onChange={e => setCurrForm(f => ({ ...f, symbol: e.target.value }))} placeholder="NT$" /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><Label>小數位</Label><Select value={currForm.decimalPlaces} onValueChange={v => setCurrForm(f => ({ ...f, decimalPlaces: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">0</SelectItem><SelectItem value="2">2</SelectItem><SelectItem value="4">4</SelectItem></SelectContent></Select></div>
              <div><Label>基準幣別</Label><Select value={currForm.isBase} onValueChange={v => setCurrForm(f => ({ ...f, isBase: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Yes">是</SelectItem><SelectItem value="No">否</SelectItem></SelectContent></Select></div>
              <div><Label>狀態</Label><Select value={currForm.isActive} onValueChange={v => setCurrForm(f => ({ ...f, isActive: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Yes">啟用</SelectItem><SelectItem value="No">停用</SelectItem></SelectContent></Select></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCurrency(false)}>取消</Button>
            <Button onClick={() => saveCurrencyMutation.mutate(currForm)} disabled={!currForm.code || !currForm.name || !currForm.symbol}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openRate} onOpenChange={setOpenRate}>
        <DialogContent>
          <DialogHeader><DialogTitle>新增匯率</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label>來源幣別</Label><LookupSelect value={rateForm.fromCurrency} onValueChange={v => setRateForm(f => ({ ...f, fromCurrency: v }))}><SelectTrigger><SelectValue placeholder="選擇" /></SelectTrigger><SelectContent>{currencies.map((c: any) => <SelectItem key={c.code} value={c.code}>{c.code} - {c.name}</SelectItem>)}</SelectContent></LookupSelect></div>
              <div><Label>目標幣別</Label><LookupSelect value={rateForm.toCurrency} onValueChange={v => setRateForm(f => ({ ...f, toCurrency: v }))}><SelectTrigger><SelectValue placeholder="選擇" /></SelectTrigger><SelectContent>{currencies.map((c: any) => <SelectItem key={c.code} value={c.code}>{c.code} - {c.name}</SelectItem>)}</SelectContent></LookupSelect></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label>匯率</Label><Input type="number" step="0.0001" value={rateForm.rate} onChange={e => setRateForm(f => ({ ...f, rate: e.target.value }))} /></div>
              <div><Label>生效日期</Label><Input type="date" value={rateForm.effectiveDate} onChange={e => setRateForm(f => ({ ...f, effectiveDate: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenRate(false)}>取消</Button>
            <Button onClick={() => saveRateMutation.mutate(rateForm)} disabled={!rateForm.fromCurrency || !rateForm.toCurrency || !rateForm.rate}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
