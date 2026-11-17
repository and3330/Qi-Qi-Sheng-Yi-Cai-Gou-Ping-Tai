import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScanLine, Upload, Loader2, FileImage, AlertTriangle, Copy, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

type DocType = "purchase_order" | "contract" | "quotation";

const TYPES: { value: DocType; label: string; desc: string }[] = [
  { value: "purchase_order", label: "採購單", desc: "供應商、明細、總額、付款條件" },
  { value: "contract", label: "合約", desc: "甲乙方、合約期、金額、關鍵義務" },
  { value: "quotation", label: "報價單", desc: "報價方、明細、有效期、交期" },
];

interface OcrResp { docType: string; file: { name: string; mime: string; size: number }; data: any }

const fmt = (n: any) => typeof n === "number" ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(n ?? "");

function renderField(label: string, value: any) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm py-1 border-b last:border-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="col-span-2 break-words">{typeof value === "object" ? JSON.stringify(value) : String(value)}</div>
    </div>
  );
}

export default function AiDocumentOcrPage() {
  const { toast } = useToast();
  const [docType, setDocType] = useState<DocType>("purchase_order");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [result, setResult] = useState<OcrResp | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ocr = useMutation({
    mutationFn: async (): Promise<OcrResp> => {
      if (!file) throw new Error("請先選擇檔案");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("docType", docType);
      const res = await fetch(`/erp-api/ai/document-ocr`, { method: "POST", credentials: "include", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    },
    onSuccess: (r) => {
      setResult(r);
      toast({ title: "辨識完成", description: `信心度：${r.data?.confidence || "未知"}` });
    },
    onError: (e: Error) => toast({ title: "辨識失敗", description: e.message, variant: "destructive" }),
  });

  const handleFile = (f: File | null) => {
    setFile(f);
    setResult(null);
    if (f) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview("");
    }
  };

  const copyJson = () => {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result.data, null, 2));
    toast({ title: "已複製 JSON 到剪貼簿" });
  };

  return (
    <div className="space-y-4 max-w-6xl" data-testid="page-ai-document-ocr">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ScanLine className="h-6 w-6 text-primary" /> AI 文件 OCR
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          上傳採購單、合約、或報價單照片，AI 會用視覺模型 (gpt-5.4-mini) 萃取結構化資料。
        </p>
      </div>

      {/* Doc type selector */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">1. 選擇文件類型</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => { setDocType(t.value); setResult(null); }}
                className={`text-left p-3 rounded border-2 transition-colors ${docType === t.value ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/30"}`}
                data-testid={`doctype-${t.value}`}
              >
                <div className="font-medium">{t.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{t.desc}</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Upload */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">2. 上傳照片</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
            data-testid="input-file"
          />
          <div className="flex gap-2 items-center">
            <Button variant="outline" onClick={() => fileRef.current?.click()} data-testid="button-pick">
              <Upload className="h-4 w-4 mr-2" /> 選擇圖片
            </Button>
            {file && <span className="text-sm text-muted-foreground"><FileImage className="h-3 w-3 inline mr-1" />{file.name} ({(file.size / 1024).toFixed(0)} KB)</span>}
            <div className="flex-1" />
            <Button onClick={() => ocr.mutate()} disabled={!file || ocr.isPending} data-testid="button-scan">
              {ocr.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ScanLine className="h-4 w-4 mr-2" />}
              開始辨識
            </Button>
          </div>
          {preview && (
            <div className="flex justify-center bg-muted/30 rounded p-2">
              <img src={preview} alt="preview" className="max-h-72 object-contain rounded" data-testid="img-preview" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Result */}
      {ocr.isPending && (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> AI 正在辨識（10-20 秒）...
        </CardContent></Card>
      )}

      {result && (
        <Card data-testid="card-result">
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> 辨識結果
              {result.data?.confidence && (
                <Badge variant={result.data.confidence === "high" ? "default" : result.data.confidence === "medium" ? "secondary" : "destructive"}>
                  信心：{result.data.confidence}
                </Badge>
              )}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={copyJson} data-testid="button-copy">
              <Copy className="h-3 w-3 mr-2" />複製 JSON
            </Button>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            {result.data?.confidence === "low" && (
              <div className="text-sm flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded p-3 text-yellow-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>AI 對辨識結果信心較低，請仔細核對欄位。可能原因：照片模糊、角度不正、或文件類型不符。</div>
              </div>
            )}

            {/* Top-level fields */}
            <div className="bg-muted/20 rounded p-3">
              {Object.entries(result.data || {}).map(([k, v]) => {
                if (Array.isArray(v) || (typeof v === "object" && v !== null)) return null;
                if (k === "confidence") return null;
                return renderField(k, v);
              })}
            </div>

            {/* items array */}
            {Array.isArray(result.data?.items) && result.data.items.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">明細</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border">
                    <thead className="bg-muted/40 text-xs">
                      <tr>
                        {Object.keys(result.data.items[0]).map((k) => (
                          <th key={k} className="text-left px-2 py-1.5 border-b">{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.data.items.map((row: any, i: number) => (
                        <tr key={i} className="border-b">
                          {Object.keys(result.data.items[0]).map((k) => (
                            <td key={k} className="px-2 py-1.5 whitespace-nowrap">{fmt(row[k])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* key_obligations array (contract) */}
            {Array.isArray(result.data?.key_obligations) && result.data.key_obligations.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">關鍵義務</div>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {result.data.key_obligations.map((o: string, i: number) => <li key={i}>{o}</li>)}
                </ul>
              </div>
            )}

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">原始 JSON</summary>
              <pre className="mt-2 p-2 bg-muted rounded text-[11px] overflow-x-auto">{JSON.stringify(result.data, null, 2)}</pre>
            </details>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
