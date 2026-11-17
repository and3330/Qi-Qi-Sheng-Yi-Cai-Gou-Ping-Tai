import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/page-header";
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, ArrowLeft, Star, Printer, RotateCcw } from "lucide-react";
import {
  PRINT_DOC_TYPES, defaultLayout, normalizeLayout, renderPrintHtml, samplePrintData,
  type PrintDocType, type PrintLayout, type PrintFieldSetting,
} from "@/lib/print-layout";

const api = (path: string) => `/erp-api/${path}`;
const COLORS = ["#000000", "#1e3a8a", "#2563eb", "#0f766e", "#15803d", "#b45309", "#b91c1c", "#7c3aed"];
const docLabel = (t: string) => PRINT_DOC_TYPES.find(d => d.value === t)?.label || t;

type Editing = { id: number | null; name: string; documentType: PrintDocType; isDefault: boolean; status: string; layout: PrintLayout };

/** 一組可以勾選、改名、排順序的欄位 */
function FieldList({ items, onChange }: { items: PrintFieldSetting[]; onChange: (next: PrintFieldSetting[]) => void }) {
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={it.key} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${it.visible ? "bg-background" : "bg-muted/40"}`}>
          <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={it.visible} aria-label={`顯示 ${it.label}`}
            onChange={e => onChange(items.map((x, k) => (k === i ? { ...x, visible: e.target.checked } : x)))} />
          <Input className={`h-8 flex-1 ${it.visible ? "" : "text-muted-foreground"}`} value={it.label} aria-label="欄位名稱"
            onChange={e => onChange(items.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0} onClick={() => move(i, -1)} aria-label="往上移"><ArrowUp size={14} /></Button>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="往下移"><ArrowDown size={14} /></Button>
        </div>
      ))}
    </div>
  );
}

/** 預覽：照真實紙寬排版，再等比例縮小放進可用空間（窄螢幕也看得到整張） */
function ScaledPreview({ html, landscape }: { html: string; landscape: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const paperW = landscape ? 1120 : 820;
  const paperH = landscape ? 800 : 1160;
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(1, width / paperW);
  return (
    <div ref={boxRef} className="w-full overflow-hidden bg-muted/40" style={{ height: paperH * scale }}>
      <iframe title="列印預覽" srcDoc={html} sandbox="" className="max-w-none origin-top-left bg-white shadow" style={{ width: paperW, height: paperH, transform: `scale(${scale})` }} />
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="space-y-3 border-b pb-5 last:border-0">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{title}</h3>{right}</div>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`rounded px-3 py-1 text-sm ${value === o.value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{o.label}</button>
      ))}
    </div>
  );
}

export default function PrintTemplates() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Editing | null>(null);

  const { data: templates = [] } = useQuery<any[]>({ queryKey: ["print-templates"], queryFn: () => fetch(api("print-templates")).then(r => r.json()) });

  const saveMutation = useMutation({
    mutationFn: async (e: Editing) => {
      const body = {
        name: e.name.trim(), module: PRINT_DOC_TYPES.find(d => d.value === e.documentType)?.module || "Sales", documentType: e.documentType,
        format: e.layout.paper, orientation: e.layout.orientation, isDefault: e.isDefault ? "Yes" : "No", status: e.status, layout: e.layout,
      };
      const res = await fetch(e.id ? api(`print-templates/${e.id}`) : api("print-templates"), { method: e.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "儲存失敗");
      return json;
    },
    onSuccess: (row: any) => {
      qc.invalidateQueries({ queryKey: ["print-templates"] });
      setEditing(p => (p ? { ...p, id: row.id } : p));
      toast({ title: "版面已儲存", description: "之後列印這種單據就會用這個版面（要設為預設才會套用）" });
    },
    onError: (err: any) => toast({ title: "沒有成功", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetch(api(`print-templates/${id}`), { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["print-templates"] }); toast({ title: "已刪除" }); },
  });

  const startNew = (docType: PrintDocType) => setEditing({ id: null, name: `${docLabel(docType)}版面`, documentType: docType, isDefault: !templates.some(t => t.documentType === docType && t.isDefault === "Yes"), status: "Active", layout: defaultLayout(docType) });
  const startEdit = (t: any) => {
    const docType = (PRINT_DOC_TYPES.some(d => d.value === t.documentType) ? t.documentType : "Quotation") as PrintDocType;
    setEditing({ id: t.id, name: t.name, documentType: docType, isDefault: t.isDefault === "Yes", status: t.status || "Active", layout: normalizeLayout(docType, t.layout) });
  };

  const setLayout = (patch: Partial<PrintLayout>) => setEditing(p => (p ? { ...p, layout: { ...p.layout, ...patch } } : p));
  const previewHtml = useMemo(() => (editing ? renderPrintHtml(editing.documentType, samplePrintData(editing.documentType), editing.layout, { forPreview: true }) : ""), [editing]);

  if (editing) {
    const L = editing.layout;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setEditing(null)} aria-label="回列表"><ArrowLeft className="h-5 w-5" /></Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold">{editing.id ? "編輯" : "新增"}{docLabel(editing.documentType)}列印版面</h1>
            <p className="text-sm text-muted-foreground">左邊勾選、改字，右邊馬上看到印出來的樣子（右邊是範例資料）。</p>
          </div>
          <Button variant="outline" onClick={() => setLayout(defaultLayout(editing.documentType))}><RotateCcw size={14} className="mr-1" />回到預設</Button>
          <Button onClick={() => saveMutation.mutate(editing)} disabled={!editing.name.trim() || saveMutation.isPending} data-testid="button-save-print-layout">{saveMutation.isPending ? "儲存中…" : "儲存版面"}</Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
          <Card className="lg:max-h-[calc(100dvh-170px)] lg:overflow-y-auto">
            <CardContent className="space-y-5 pt-5">
              <Section title="基本">
                <div className="space-y-1.5"><Label htmlFor="pl-name">版面名稱</Label><Input id="pl-name" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
                <Toggle label="設為這種單據的預設版面" checked={editing.isDefault} onChange={v => setEditing({ ...editing, isDefault: v })} />
                <div className="space-y-1.5"><Label htmlFor="pl-title">標題文字</Label><Input id="pl-title" value={L.titleText} onChange={e => setLayout({ titleText: e.target.value })} /><p className="text-xs text-muted-foreground">{"{公司}"} 會換成單據上的公司（品牌）名稱</p></div>
                <div className="space-y-1.5">
                  <Label>主色</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    {COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setLayout({ accentColor: c })} aria-label={`主色 ${c}`}
                        className={`h-7 w-7 rounded-full border-2 ${L.accentColor === c ? "border-primary ring-2 ring-primary/40" : "border-transparent"}`} style={{ background: c }} />
                    ))}
                    <input type="color" value={L.accentColor} onChange={e => setLayout({ accentColor: e.target.value })} className="h-7 w-10 cursor-pointer rounded border" aria-label="自訂顏色" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-4">
                  <div className="space-y-1.5"><Label>字體大小</Label><Segmented value={L.fontSize} onChange={v => setLayout({ fontSize: v })} options={[{ value: "small", label: "小" }, { value: "normal", label: "中" }, { value: "large", label: "大" }]} /></div>
                  <div className="space-y-1.5"><Label>紙張</Label><Segmented value={L.paper} onChange={v => setLayout({ paper: v })} options={[{ value: "A4", label: "A4" }, { value: "A5", label: "A5" }, { value: "Letter", label: "Letter" }]} /></div>
                  <div className="space-y-1.5"><Label>方向</Label><Segmented value={L.orientation} onChange={v => setLayout({ orientation: v })} options={[{ value: "portrait", label: "直向" }, { value: "landscape", label: "橫向" }]} /></div>
                </div>
              </Section>

              <Section title="單頭：客戶與單據資料"><p className="-mt-1 text-xs text-muted-foreground">勾選要印的欄位；欄位名稱可以直接改；箭頭調整順序。</p><FieldList items={L.customerFields} onChange={v => setLayout({ customerFields: v })} /></Section>

              <Section title="單頭：公司資料" right={<Switch checked={L.showCompanyBlock} onCheckedChange={v => setLayout({ showCompanyBlock: v })} aria-label="印公司資料" />}>
                {L.showCompanyBlock ? <FieldList items={L.companyFields} onChange={v => setLayout({ companyFields: v })} /> : <p className="text-xs text-muted-foreground">不印公司資料區塊</p>}
              </Section>

              <Section title="金額與模板欄位">
                <Toggle label="印金額總計列" checked={L.showTotalBar} onChange={v => setLayout({ showTotalBar: v })} />
                <Toggle label="印訂單模板的自訂欄位（例如活動日期、服務地址）" checked={L.showExtraFields} onChange={v => setLayout({ showExtraFields: v })} />
              </Section>

              <Section title="品項明細欄位"><FieldList items={L.columns} onChange={v => setLayout({ columns: v })} /></Section>

              <Section title="頁尾">
                <Toggle label="印單據上的條款／備註" checked={L.showTerms} onChange={v => setLayout({ showTerms: v })} />
                <div className="space-y-1.5"><Label htmlFor="pl-footer">固定頁尾文字（每張都會印）</Label><Textarea id="pl-footer" rows={3} value={L.footerText} placeholder="例如：匯款帳號、聯絡方式、感謝詞" onChange={e => setLayout({ footerText: e.target.value })} /></div>
                <Toggle label="印簽名欄" checked={L.showSignatures} onChange={v => setLayout({ showSignatures: v })} />
                {L.showSignatures && <div className="space-y-1.5"><Label htmlFor="pl-sigs">簽名欄（用頓號分隔）</Label><Input id="pl-sigs" value={L.signatureLabels} onChange={e => setLayout({ signatureLabels: e.target.value })} /></div>}
              </Section>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b px-4 py-2 text-sm text-muted-foreground">
              <span>預覽（範例資料）</span>
              <span>{L.paper}・{L.orientation === "portrait" ? "直向" : "橫向"}</span>
            </div>
            <div className="lg:max-h-[calc(100dvh-215px)] lg:overflow-y-auto"><ScaledPreview html={previewHtml} landscape={L.orientation === "landscape"} /></div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="列印模板" description="設定報價單、銷貨單印出來的樣子：勾選欄位、改標題、配色、頁尾與簽名欄，不用寫程式。" />
      {PRINT_DOC_TYPES.map(dt => {
        const list = templates.filter(t => t.documentType === dt.value);
        return (
          <Card key={dt.value}>
            <CardContent className="space-y-3 pt-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2"><Printer size={16} /><h2 className="font-semibold">{dt.label}</h2></div>
                <Button size="sm" onClick={() => startNew(dt.value)}><Plus size={14} className="mr-1" />新增版面</Button>
              </div>
              {list.length === 0 ? (
                <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">還沒有自訂版面，列印時用系統預設的樣子。按「新增版面」開始調整。</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {list.map(t => (
                    <div key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => startEdit(t)}>
                        <span className="truncate font-medium">{t.name}</span>
                        {t.isDefault === "Yes" && <Badge className="gap-1"><Star size={11} />預設</Badge>}
                        {t.status !== "Active" && <Badge variant="secondary">停用</Badge>}
                        {!t.layout && <Badge variant="outline" title="舊的 HTML 模板，打開後會改用視覺化設定">舊格式</Badge>}
                      </button>
                      {t.isDefault !== "Yes" && t.layout && <Button variant="ghost" size="sm" onClick={() => saveMutation.mutate({ ...{ id: t.id, name: t.name, documentType: t.documentType, status: t.status || "Active", layout: normalizeLayout(t.documentType, t.layout) }, isDefault: true })}>設為預設</Button>}
                      <Button variant="ghost" size="icon" onClick={() => startEdit(t)} aria-label="編輯"><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm(`刪除版面「${t.name}」？`)) deleteMutation.mutate(t.id); }} aria-label="刪除"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
