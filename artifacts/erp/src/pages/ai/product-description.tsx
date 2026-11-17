import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Package, Sparkles, Loader2, Copy, Save, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface Item { id: number; item_code: string; item_name: string; item_group: string | null; selling_price: string }
interface Generated {
  short_description: string;
  long_description: string;
  marketing_copy: string;
  social_post: string;
  seo_keywords: string[];
  feature_bullets: string[];
}

const TONES = [
  { value: "professional", label: "專業" },
  { value: "friendly", label: "親切" },
  { value: "playful", label: "活潑" },
  { value: "luxury", label: "高端" },
];

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast({ title: "已複製" });
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-medium">{label}</div>
        <Button variant="ghost" size="sm" className="h-6" onClick={copy}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
      <div className="text-sm bg-muted/30 rounded p-3 whitespace-pre-line leading-relaxed">{value}</div>
    </div>
  );
}

export default function AiProductDescriptionPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const [manualName, setManualName] = useState("");
  const [keyFeatures, setKeyFeatures] = useState("");
  const [targetAudience, setTargetAudience] = useState("國小 3-6 年級學生與家長");
  const [tone, setTone] = useState("friendly");
  const [saveToItem, setSaveToItem] = useState(false);
  const [result, setResult] = useState<{ generated: Generated; savedToItem: boolean } | null>(null);

  const items = useQuery<{ items: Item[] }>({
    queryKey: ["items-search", search],
    queryFn: async () => {
      const u = new URL(`/erp-api/ai/product-description/items`, window.location.origin);
      if (search) u.searchParams.set("q", search);
      const res = await fetch(u.toString(), { credentials: "include" });
      return res.json();
    },
  });

  const m = useMutation({
    mutationFn: async () => {
      const body: any = {
        target_audience: targetAudience,
        tone,
        key_features: keyFeatures.split("\n").map(s => s.trim()).filter(Boolean),
        saveToItem,
      };
      if (selected) body.itemId = selected.id;
      else body.item_name = manualName;
      const res = await fetch(`/erp-api/ai/product-description`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    },
    onSuccess: (r) => {
      setResult(r);
      if (r.savedToItem) toast({ title: "已存回商品描述" });
    },
    onError: (e: Error) => toast({ title: "失敗", description: e.message, variant: "destructive" }),
  });

  const canRun = !!selected || manualName.trim().length > 0;

  return (
    <div className="space-y-4 max-w-6xl" data-testid="page-ai-product-desc">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="h-6 w-6 text-primary" /> AI 商品描述生成
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          選擇現有商品或輸入新商品名稱，AI 會自動生成短/長描述、行銷文案、社群貼文與 SEO 關鍵字。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Pick existing item */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">選擇現有商品</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-2">
            <Input
              placeholder="搜尋商品名稱或編號..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search"
            />
            <div className="border rounded max-h-56 overflow-y-auto">
              {items.data?.items?.map((it) => (
                <button
                  key={it.id}
                  onClick={() => { setSelected(it); setManualName(""); }}
                  className={`w-full text-left px-3 py-1.5 text-xs border-b hover:bg-muted/40 ${selected?.id === it.id ? "bg-primary/10" : ""}`}
                  data-testid={`item-${it.id}`}
                >
                  <div className="font-medium truncate">{it.item_name}</div>
                  <div className="text-muted-foreground">{it.item_code} · {it.item_group || "—"} · NT${Number(it.selling_price).toLocaleString()}</div>
                </button>
              ))}
              {!items.data?.items?.length && <div className="p-3 text-xs text-muted-foreground text-center">無資料</div>}
            </div>
            {selected && <div className="text-xs text-primary">已選：{selected.item_name}</div>}
          </CardContent>
        </Card>

        {/* Or new product */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">或輸入新商品</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-2">
            <Input
              placeholder="商品/課程名稱"
              value={manualName}
              onChange={(e) => { setManualName(e.target.value); if (e.target.value) setSelected(null); }}
              data-testid="input-name"
            />
            <Textarea
              placeholder="關鍵特色（每行一個，例：8 週速成、小班制、結業證書）"
              value={keyFeatures}
              onChange={(e) => setKeyFeatures(e.target.value)}
              rows={3}
              data-testid="textarea-features"
            />
            <Input
              placeholder="目標受眾"
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              data-testid="input-audience"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">語氣：</span>
              {TONES.map((t) => (
                <Button key={t.value} size="sm" variant={tone === t.value ? "default" : "outline"} onClick={() => setTone(t.value)} className="h-7 text-xs" data-testid={`tone-${t.value}`}>
                  {t.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-end gap-3">
        {selected && (
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={saveToItem} onChange={(e) => setSaveToItem(e.target.checked)} data-testid="check-save" />
            生成後存回商品描述
          </label>
        )}
        <Button onClick={() => m.mutate()} disabled={!canRun || m.isPending} data-testid="button-generate">
          {m.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          生成描述
        </Button>
      </div>

      {result && (
        <Card data-testid="card-result">
          <CardHeader className="pb-2"><CardTitle className="text-base">生成結果</CardTitle></CardHeader>
          <CardContent className="pt-0 grid grid-cols-1 md:grid-cols-2 gap-4">
            <CopyBox label="一句話描述" value={result.generated.short_description} />
            <div>
              <div className="text-sm font-medium mb-1">特色重點</div>
              <ul className="list-disc pl-5 text-sm space-y-1 bg-muted/30 rounded p-3">
                {result.generated.feature_bullets?.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
            <div className="md:col-span-2"><CopyBox label="完整描述" value={result.generated.long_description} /></div>
            <CopyBox label="行銷推播文案" value={result.generated.marketing_copy} />
            <CopyBox label="社群貼文" value={result.generated.social_post} />
            <div className="md:col-span-2">
              <div className="text-sm font-medium mb-1">SEO 關鍵字</div>
              <div className="flex flex-wrap gap-1.5">
                {result.generated.seo_keywords?.map((k, i) => <Badge key={i} variant="secondary">{k}</Badge>)}
              </div>
            </div>
            {result.savedToItem && (
              <div className="md:col-span-2 text-sm text-green-700 flex items-center gap-2">
                <Save className="h-3 w-3" /> 已將完整描述存回商品資料
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
