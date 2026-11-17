import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Save } from "lucide-react";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { DEFAULT_QUOTATION_CATEGORIES, mergeCategories } from "@/lib/template-fields";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const apiFetch = (path: string, opts?: RequestInit) =>
  fetch(`/erp-api${path}`, { headers: { "Content-Type": "application/json" }, ...opts }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "請求失敗");
    if (r.status === 204) return null;
    return r.json();
  });


interface TplItem { code?: string; name: string; qty: number; unit: string; unitPrice: number; summary?: string; }

const emptyItem = (): TplItem => ({ code: "", name: "", qty: 1, unit: "個", unitPrice: 0, summary: "" });

export default function QuotationTemplatesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [category, setCategory] = useState<string>(DEFAULT_QUOTATION_CATEGORIES[0]);
  const [terms, setTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<TplItem[]>([]);
  // 剛新增、還沒儲存的類別
  const [draftCategories, setDraftCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState("");

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["/erp-api/quotation-templates"],
    queryFn: () => apiFetch("/quotation-templates"),
  });

  const { data: catalogItems = [] } = useQuery({
    queryKey: ["/erp-api/items-list"],
    queryFn: () => apiFetch("/items"),
  });

  useEffect(() => {
    const tpl = (templates as any[]).find((t: any) => t.category === category);
    setTerms(tpl?.terms || "");
    setNotes(tpl?.notes || "");
    setItems(Array.isArray(tpl?.items) && tpl.items.length > 0 ? tpl.items : []);
  }, [category, templates]);

  // 類別＝內建幾種＋自己建的（已儲存的與剛新增的）
  const CATEGORIES = useMemo(
    () => mergeCategories([...(templates as any[]).map((t: any) => t.category), ...draftCategories]),
    [templates, draftCategories],
  );
  const isCustomCategory = !DEFAULT_QUOTATION_CATEGORIES.includes(category);

  const addCategory = () => {
    const name = newCategory.trim();
    if (!name) return;
    if (name.length > 20) { toast({ title: "類別名稱最多 20 個字", variant: "destructive" }); return; }
    if (!CATEGORIES.includes(name)) setDraftCategories((prev) => [...prev, name]);
    setCategory(name);
    setNewCategory("");
  };

  const deleteMut = useMutation({
    mutationFn: async () => {
      const saved = (templates as any[]).some((t: any) => t.category === category);
      if (saved) await apiFetch(`/quotation-templates/${encodeURIComponent(category)}`, { method: "DELETE" });
    },
    onSuccess: () => {
      const removed = category;
      setDraftCategories((prev) => prev.filter((c) => c !== removed));
      setCategory(DEFAULT_QUOTATION_CATEGORIES[0]);
      qc.invalidateQueries({ queryKey: ["/erp-api/quotation-templates"] });
      toast({ title: "類別已刪除", description: `「${removed}」已移除，已開出的報價單不受影響` });
    },
    onError: (e: Error) => toast({ title: "刪除失敗", description: e.message, variant: "destructive" }),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      apiFetch(`/quotation-templates/${encodeURIComponent(category)}`, {
        method: "PUT",
        body: JSON.stringify({ terms: terms || null, notes: notes || null, items: items.filter((i) => i.name) }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/erp-api/quotation-templates"] });
      toast({ title: "模板已儲存", description: `「${category}」模板已更新` });
    },
    onError: (e: Error) => toast({ title: "儲存失敗", description: e.message, variant: "destructive" }),
  });

  const updateItem = (i: number, field: keyof TplItem, val: any) => {
    const next = [...items];
    (next[i] as any)[field] = val;
    setItems(next);
  };

  const hasTemplate = (cat: string) => (templates as any[]).some((t: any) => t.category === cat && (t.terms || t.notes || (Array.isArray(t.items) && t.items.length > 0)));

  return (
    <div className="space-y-6">
      <PageHeader title="報價模板管理" description="設定各類別報價單的預設條款、備註與品項，新增報價單時點選類別即自動套用。類別可以自己新增。" />

      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${category === c ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setCategory(c)}
              >
                {c}
                {hasTemplate(c) && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />}
              </button>
            ))}
          </div>
            <div className="flex items-center gap-1.5">
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } }}
                placeholder="新類別名稱"
                maxLength={20}
                className="h-9 w-36"
                aria-label="新類別名稱"
              />
              <Button type="button" variant="outline" size="sm" onClick={addCategory} disabled={!newCategory.trim()}>
                <Plus size={14} className="mr-1" />新增類別
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">載入中...</div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm text-muted-foreground">預設報價條款</label>
                  <textarea
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[100px]"
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    placeholder={"如：報價有效期限：30天\n付款方式：月結30天"}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">預設備註</label>
                  <textarea
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[100px]"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="套用此類別時自動帶入的備註"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">預設品項</label>
                  <Button variant="outline" size="sm" onClick={() => setItems([...items, emptyItem()])}>
                    <Plus size={14} className="mr-1" />新增品項
                  </Button>
                </div>
                {items.length === 0 ? (
                  <div className="text-sm text-muted-foreground border rounded-md py-6 text-center">尚未設定預設品項（可留空）</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] table-fixed text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="text-left px-2 py-2 font-medium w-44">品項編號</th>
                          <th className="text-left px-2 py-2 font-medium min-w-[140px]">品項名稱</th>
                          <th className="text-left px-2 py-2 font-medium w-32">數量</th>
                          <th className="text-left px-2 py-2 font-medium w-24">單位</th>
                          <th className="text-left px-2 py-2 font-medium w-40">單價</th>
                          <th className="text-left px-2 py-2 font-medium w-40">摘要（備註）</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, i) => (
                          <tr key={i} className="border-b">
                            <td className="px-1.5 py-1.5">
                              <SearchableSelect
                                value={item.code || ""}
                                onValueChange={(code) => {
                                  const ci = (catalogItems as any[]).find((c: any) => c.itemCode === code);
                                  const next = [...items];
                                  next[i] = {
                                    ...next[i],
                                    code,
                                    ...(ci ? {
                                      name: ci.itemName || next[i].name,
                                      unit: ci.unit || next[i].unit,
                                      unitPrice: ci.sellingPrice != null && !isNaN(Number(ci.sellingPrice)) ? Number(ci.sellingPrice) : next[i].unitPrice,
                                    } : {}),
                                  };
                                  setItems(next);
                                }}
                                options={(catalogItems as any[]).map((c: any) => ({
                                  value: c.itemCode,
                                  label: `${c.itemCode} ${c.itemName}`,
                                }))}
                                placeholder="選擇編號"
                                searchPlaceholder="輸入編號或名稱搜尋..."
                                emptyText="找不到品項"
                              />
                            </td>
                            <td className="px-1.5 py-1.5"><Input value={item.name} onChange={(e) => updateItem(i, "name", e.target.value)} className="h-10 px-2 text-base" placeholder="品項名稱" /></td>
                            <td className="px-1.5 py-1.5"><Input type="number" min={1} inputMode="decimal" step="any" value={item.qty === 0 ? "" : item.qty} placeholder="0" onChange={(e) => updateItem(i, "qty", Number(e.target.value))} className="h-10 px-2 text-right text-base tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" /></td>
                            <td className="px-1.5 py-1.5"><Input value={item.unit} onChange={(e) => updateItem(i, "unit", e.target.value)} className="h-10 px-2 text-base" /></td>
                            <td className="px-1.5 py-1.5"><Input type="number" min={0} inputMode="decimal" step="any" value={item.unitPrice === 0 ? "" : item.unitPrice} placeholder="0" onChange={(e) => updateItem(i, "unitPrice", Number(e.target.value))} className="h-10 px-2 text-right text-base tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" /></td>
                            <td className="px-1.5 py-1.5"><Input value={item.summary || ""} onChange={(e) => updateItem(i, "summary", e.target.value)} className="h-10 px-2 text-base" placeholder="摘要／備註" /></td>
                            <td className="px-1 py-1.5">
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => setItems(items.filter((_, idx) => idx !== i))}>
                                <Trash2 size={14} />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                  <Save size={14} className="mr-1" />儲存「{category}」模板
                </Button>
                {isCustomCategory && (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-red-600"
                    disabled={deleteMut.isPending}
                    onClick={() => { if (confirm(`確定刪除類別「${category}」？已開出的報價單不受影響。`)) deleteMut.mutate(); }}
                  >
                    <Trash2 size={14} className="mr-1" />刪除此類別
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
