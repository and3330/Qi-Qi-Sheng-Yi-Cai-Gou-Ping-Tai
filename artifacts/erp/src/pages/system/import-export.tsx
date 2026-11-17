import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Download, Upload, FileSpreadsheet, AlertCircle, CheckCircle } from "lucide-react";
import { exportCSV, exportExcel } from "@/lib/export-utils";
import * as XLSX from "xlsx";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;

const columnLabels: Record<string, string> = {
  id: "ID", name: "名稱", contactPerson: "聯絡人", email: "Email", phone: "電話", address: "地址", taxId: "統編", status: "狀態",
  itemCode: "品項編碼", itemName: "品項名稱", itemGroup: "品項群組", unit: "單位", sellingPrice: "售價", buyingPrice: "進價",
  firstName: "名", lastName: "姓", department: "部門", designation: "職稱",
  company: "公司", source: "來源", accountNumber: "科目代碼", accountName: "科目名稱", accountType: "科目類型",
  parentNumber: "上級科目", isGroup: "群組", parentDepartment: "上級部門", manager: "主管", costCenter: "成本中心",
  location: "地點", code: "代碼", symbol: "符號", isBase: "基準", isActive: "啟用",
};

export default function ImportExport() {
  const { toast } = useToast();
  const [selectedModule, setSelectedModule] = useState("");
  const [importModule, setImportModule] = useState("");
  const [importData, setImportData] = useState("");
  const [importResult, setImportResult] = useState<any>(null);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [showMapping, setShowMapping] = useState(false);
  const [rawParsed, setRawParsed] = useState<any[]>([]);

  const { data: modules = [] } = useQuery({ queryKey: ["import-export-modules"], queryFn: () => fetch(api("import-export/modules")).then(r => r.json()) });

  const exportMutation = useMutation({
    mutationFn: (mod: string) => fetch(api(`import-export/export/${mod}`)).then(r => r.json()),
    onSuccess: (data) => {
      const mod = modules.find((m: any) => m.key === data.module);
      const headers = data.columns.map((c: string) => columnLabels[c] || c);
      const rows = data.data.map((row: any) => {
        const r: any = {};
        data.columns.forEach((c: string) => { r[c] = row[c] ?? ""; });
        return r;
      });
      toast({ title: `已匯出 ${rows.length} 筆 ${mod?.label || data.module} 資料` });
      return { headers, rows, columns: data.columns, label: mod?.label || data.module };
    },
  });

  const importMutation = useMutation({
    mutationFn: ({ mod, data }: { mod: string; data: string }) => fetch(api(`import-export/import/${mod}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) }).then(r => r.json()),
    onSuccess: (result) => { setImportResult(result); toast({ title: `匯入完成：${result.imported}/${result.total} 筆成功` }); },
    onError: (err: any) => { toast({ title: "匯入失敗", description: err.message, variant: "destructive" }); },
  });

  const handleExportCSV = async () => {
    if (!selectedModule) return;
    const data = await exportMutation.mutateAsync(selectedModule);
    if (data) {
      exportCSV({ title: data.label, fileName: data.label, headers: data.headers, rows: data.rows, columnKeys: data.columns });
    }
  };

  const handleExportExcel = async () => {
    if (!selectedModule) return;
    const data = await exportMutation.mutateAsync(selectedModule);
    if (data) {
      exportExcel({ title: data.label, fileName: data.label, headers: data.headers, rows: data.rows, columnKeys: data.columns });
    }
  };

  const applyMapping = (parsed: any[]): any[] => {
    if (!showMapping || Object.keys(fieldMapping).length === 0) return parsed;
    return parsed.map(row => {
      const mapped: any = {};
      for (const [sourceField, targetField] of Object.entries(fieldMapping)) {
        if (targetField && targetField !== "__skip__") {
          mapped[targetField] = row[sourceField];
        }
      }
      return mapped;
    });
  };

  const handleImport = () => {
    if (!importModule || !importData.trim()) return;
    try {
      const parsed = JSON.parse(importData);
      const mapped = applyMapping(Array.isArray(parsed) ? parsed : []);
      importMutation.mutate({ mod: importModule, data: JSON.stringify(mapped) });
    } catch {
      importMutation.mutate({ mod: importModule, data: importData });
    }
  };

  const initFieldMapping = (parsed: any[]) => {
    if (!parsed.length) return;
    setRawParsed(parsed);
    const sourceFields = Object.keys(parsed[0]);
    const mod = modules.find((m: any) => m.key === importModule);
    const targetFields: string[] = mod?.columns?.filter((c: string) => c !== "id") || [];
    const mapping: Record<string, string> = {};
    for (const sf of sourceFields) {
      const exact = targetFields.find(tf => tf === sf);
      if (exact) { mapping[sf] = exact; continue; }
      const labelMatch = targetFields.find(tf => (columnLabels[tf] || "").toLowerCase() === sf.toLowerCase());
      if (labelMatch) { mapping[sf] = labelMatch; continue; }
      mapping[sf] = "__skip__";
    }
    setFieldMapping(mapping);
    setShowMapping(true);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = new Uint8Array(ev.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws);
          setImportData(JSON.stringify(rows, null, 2));
          initFieldMapping(rows as any[]);
          toast({ title: `已解析 ${rows.length} 筆 Excel 資料` });
        } catch { toast({ title: "Excel 解析失敗", variant: "destructive" }); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const text = ev.target?.result as string;
          if (file.name.endsWith(".json")) {
            setImportData(text);
            try { const p = JSON.parse(text); if (Array.isArray(p)) initFieldMapping(p); } catch {}
          } else if (file.name.endsWith(".csv")) {
            const lines = text.split("\n").filter(l => l.trim());
            if (lines.length < 2) return;
            const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
            const rows = lines.slice(1).map(line => {
              const vals = line.split(",").map(v => v.trim().replace(/"/g, ""));
              const obj: any = {};
              headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
              return obj;
            });
            setImportData(JSON.stringify(rows, null, 2));
            initFieldMapping(rows);
          }
        } catch { toast({ title: "檔案解析失敗", variant: "destructive" }); }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">匯入 / 匯出</h1>

      <Tabs defaultValue="export">
        <TabsList>
          <TabsTrigger value="export"><Download className="mr-2 h-4 w-4" />匯出</TabsTrigger>
          <TabsTrigger value="import"><Upload className="mr-2 h-4 w-4" />匯入</TabsTrigger>
        </TabsList>

        <TabsContent value="export" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>資料匯出</CardTitle>
              <CardDescription>選擇模組，將資料匯出為 CSV 或 Excel 檔案</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div><Label>選擇模組</Label><Select value={selectedModule} onValueChange={setSelectedModule}><SelectTrigger className="w-[250px]"><SelectValue placeholder="選擇模組" /></SelectTrigger><SelectContent>{modules.map((m: any) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent></Select></div>
              {selectedModule && (
                <div className="flex gap-3">
                  <Button onClick={handleExportCSV} disabled={exportMutation.isPending}><FileSpreadsheet className="mr-2 h-4 w-4" />匯出 CSV</Button>
                  <Button onClick={handleExportExcel} disabled={exportMutation.isPending} variant="outline"><FileSpreadsheet className="mr-2 h-4 w-4" />匯出 Excel</Button>
                </div>
              )}
              {selectedModule && (
                <div className="text-sm text-muted-foreground">
                  欄位：{modules.find((m: any) => m.key === selectedModule)?.columns.map((c: string) => columnLabels[c] || c).join("、")}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>資料匯入</CardTitle>
              <CardDescription>上傳 CSV 或 JSON 檔案，或直接貼上 JSON 格式資料</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div><Label>選擇模組</Label><Select value={importModule} onValueChange={setImportModule}><SelectTrigger className="w-[250px]"><SelectValue placeholder="選擇模組" /></SelectTrigger><SelectContent>{modules.map((m: any) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent></Select></div>

              {importModule && (
                <>
                  <div>
                    <Label>上傳檔案 (CSV/JSON/Excel)</Label>
                    <input type="file" accept=".csv,.json,.xlsx" onChange={handleFileUpload} className="mt-2 block text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer" />
                  </div>
                  <div><Label>或直接貼上 JSON 資料</Label><Textarea value={importData} onChange={e => setImportData(e.target.value)} rows={6} className="font-mono text-sm" placeholder={`[{"name": "範例", "email": "test@example.com"}]`} /></div>

                  {showMapping && Object.keys(fieldMapping).length > 0 && (() => {
                    const mod = modules.find((m: any) => m.key === importModule);
                    const targetFields: string[] = mod?.columns?.filter((c: string) => c !== "id") || [];
                    return (
                      <Card className="border-blue-200 bg-blue-50/30">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <span className="font-medium text-sm">欄位對應</span>
                            <Badge variant="outline">來源欄位 → 目標欄位</Badge>
                          </div>
                          <div className="space-y-2">
                            {Object.keys(fieldMapping).map(sf => (
                              <div key={sf} className="flex items-center gap-3">
                                <span className="text-sm w-[160px] truncate font-mono bg-white px-2 py-1 rounded border">{sf}</span>
                                <span className="text-muted-foreground">→</span>
                                <Select value={fieldMapping[sf]} onValueChange={v => setFieldMapping(prev => ({ ...prev, [sf]: v }))}>
                                  <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__skip__">（跳過）</SelectItem>
                                    {targetFields.map(tf => <SelectItem key={tf} value={tf}>{columnLabels[tf] || tf}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                {fieldMapping[sf] === "__skip__" && <Badge variant="secondary" className="text-xs">略過</Badge>}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {importData.trim() && (() => {
                    try {
                      const parsed = JSON.parse(importData);
                      if (Array.isArray(parsed) && parsed.length > 0) {
                        const mod = modules.find((m: any) => m.key === importModule);
                        const cols = mod?.columns?.filter((c: string) => c !== "id") || Object.keys(parsed[0]);
                        return (
                          <Card className="bg-muted/30">
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-medium text-sm">預覽 ({parsed.length} 筆資料)</span>
                                <span className="text-xs text-muted-foreground">目標欄位：{cols.map((c: string) => columnLabels[c] || c).join("、")}</span>
                              </div>
                              <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
                                <Table>
                                  <TableHeader><TableRow>{cols.slice(0, 6).map((c: string) => <TableHead key={c} className="text-xs">{columnLabels[c] || c}</TableHead>)}</TableRow></TableHeader>
                                  <TableBody>{parsed.slice(0, 5).map((row: any, i: number) => <TableRow key={i}>{cols.slice(0, 6).map((c: string) => <TableCell key={c} className="text-xs py-1">{row[c] ?? <span className="text-destructive">缺少</span>}</TableCell>)}</TableRow>)}</TableBody>
                                </Table>
                              </div>
                              {parsed.length > 5 && <div className="text-xs text-muted-foreground mt-1">... 還有 {parsed.length - 5} 筆</div>}
                            </CardContent>
                          </Card>
                        );
                      }
                    } catch { return null; }
                    return null;
                  })()}

                  <Button onClick={handleImport} disabled={importMutation.isPending || !importData.trim()}><Upload className="mr-2 h-4 w-4" />開始匯入</Button>
                </>
              )}

              {importResult && (
                <Card className="bg-muted/50">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <span className="font-medium">匯入結果</span>
                    </div>
                    <div className="text-sm">成功：{importResult.imported} / {importResult.total} 筆</div>
                    {importResult.errors?.length > 0 && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-sm text-destructive"><AlertCircle className="h-4 w-4" />錯誤：</div>
                        {importResult.errors.map((e: string, i: number) => <div key={i} className="text-xs text-destructive ml-5">{e}</div>)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
