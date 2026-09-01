import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListErpPriceListsQueryKey, useCreateErpPriceList, useListErpItems,
  useListErpPriceLists, usePutErpPriceListItems, useUpdateErpPriceList, type ErpPriceList,
} from "@workspace/api-client-react";
import { Loader2, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const errorMessage = (e: any) => e?.response?.data?.error || e?.data?.error || e?.message || "發生未知錯誤";
type PriceLine = { productId: string; variantId: string; price: string };
const emptyLine = (): PriceLine => ({ productId: "", variantId: "", price: "" });

export default function PriceListsPage() {
  const queryClient = useQueryClient(); const { toast } = useToast();
  const { data: lists, isLoading } = useListErpPriceLists(); const { data: products } = useListErpItems();
  const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState<ErpPriceList | null>(null);
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [isActive, setIsActive] = useState(true);
  const [itemsList, setItemsList] = useState<ErpPriceList | null>(null); const [lines, setLines] = useState<PriceLine[]>([emptyLine()]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListErpPriceListsQueryKey() });
  const openCreate = () => { setEditing(null); setName(""); setDescription(""); setIsActive(true); setFormOpen(true); };
  const openEdit = (list: ErpPriceList) => { setEditing(list); setName(list.name); setDescription(list.description || ""); setIsActive(list.isActive); setFormOpen(true); };
  const openItems = (list: ErpPriceList) => { setItemsList(list); setLines(list.items.length ? list.items.map((i) => ({ productId: String(i.productId), variantId: i.variantId ? String(i.variantId) : "", price: String(i.price) })) : [emptyLine()]); };
  const create = useCreateErpPriceList({ mutation: { onSuccess: () => { invalidate(); toast({ title: "已建立價格表" }); setFormOpen(false); }, onError: (e: any) => toast({ title: "建立失敗", description: errorMessage(e), variant: "destructive" }) } });
  const update = useUpdateErpPriceList({ mutation: { onSuccess: () => { invalidate(); toast({ title: "價格表已更新" }); setFormOpen(false); }, onError: (e: any) => toast({ title: "更新失敗", description: errorMessage(e), variant: "destructive" }) } });
  const putItems = usePutErpPriceListItems({ mutation: { onSuccess: () => { invalidate(); toast({ title: "品項價格已儲存" }); setItemsList(null); }, onError: (e: any) => toast({ title: "儲存失敗", description: errorMessage(e), variant: "destructive" }) } });
  const submitForm = () => {
    if (!name.trim()) { toast({ title: "請填寫價格表名稱", variant: "destructive" }); return; }
    if (editing) update.mutate({ id: editing.id, data: { name: name.trim(), description: description || null, isActive } });
    else create.mutate({ data: { name: name.trim(), description: description || null } });
  };
  const submitItems = () => {
    if (!itemsList) return;
    const items = lines.filter((x) => x.productId).map((x) => ({ productId: Number(x.productId), variantId: x.variantId ? Number(x.variantId) : null, price: Number(x.price) }));
    if (items.some((x) => !Number.isFinite(x.price) || x.price < 0)) { toast({ title: "價格需為大於等於 0 的整數", variant: "destructive" }); return; }
    const duplicate = new Set(items.map((x) => `${x.productId}-${x.variantId || 0}`)).size !== items.length;
    if (duplicate) { toast({ title: "同一品項與規格不可重複", variant: "destructive" }); return; }
    putItems.mutate({ id: itemsList.id, data: { items } });
  };

  return <div className="space-y-6">
    <div className="flex justify-end"><Button onClick={openCreate}><Plus className="mr-1 h-4 w-4" />建立價格表</Button></div>
    <Card className="overflow-hidden border-t-2 border-t-primary"><Table><TableHeader className="bg-secondary/50"><TableRow><TableHead>名稱</TableHead><TableHead>說明</TableHead><TableHead className="text-right">設價品項</TableHead><TableHead>狀態</TableHead><TableHead>建立時間</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
      <TableBody>{isLoading ? <TableRow><TableCell colSpan={6} className="h-32 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></TableCell></TableRow> : !lists?.length ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">尚無價格表</TableCell></TableRow> : lists.map((list) => <TableRow key={list.id}><TableCell className="font-medium">{list.name}</TableCell><TableCell className="max-w-sm text-muted-foreground">{list.description || "—"}</TableCell><TableCell className="text-right">{list.items.length}</TableCell><TableCell><Badge variant={list.isActive ? "default" : "secondary"}>{list.isActive ? "啟用" : "停用"}</Badge></TableCell><TableCell>{new Date(list.createdAt).toLocaleDateString("zh-TW")}</TableCell><TableCell className="space-x-1 text-right"><Button size="sm" variant="ghost" onClick={() => openItems(list)}><Tags className="mr-1 h-4 w-4" />品項設價</Button><Button size="sm" variant="ghost" onClick={() => openEdit(list)}><Pencil className="mr-1 h-4 w-4" />編輯</Button></TableCell></TableRow>)}</TableBody>
    </Table></Card>

    <Dialog open={formOpen} onOpenChange={setFormOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? "編輯價格表" : "建立價格表"}</DialogTitle></DialogHeader>
      <div className="space-y-4"><div className="space-y-2"><Label>名稱 *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div><div className="space-y-2"><Label>說明</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        {editing && <div className="flex items-center justify-between"><Label>啟用價格表</Label><Switch checked={isActive} onCheckedChange={setIsActive} /></div>}</div>
      <DialogFooter><Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button><Button disabled={create.isPending || update.isPending} onClick={submitForm}>儲存</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={!!itemsList} onOpenChange={(open) => !open && setItemsList(null)}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>品項設價－{itemsList?.name}</DialogTitle></DialogHeader>
      <div className="space-y-2"><div className="grid grid-cols-12 gap-2 px-1 text-sm text-muted-foreground"><span className="col-span-5">品項</span><span className="col-span-3">規格</span><span className="col-span-3">價格（NT$）</span></div>
        {lines.map((line, index) => { const product = products?.find((p) => p.id === Number(line.productId)); return <div key={index} className="grid grid-cols-12 gap-2">
          <Select value={line.productId} onValueChange={(v) => setLines(lines.map((x,i) => i === index ? {...x,productId:v,variantId:""}:x))}><SelectTrigger className="col-span-5"><SelectValue placeholder="選擇品項" /></SelectTrigger><SelectContent>{products?.filter((p) => p.isActive).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code}－{p.name}</SelectItem>)}</SelectContent></Select>
          <Select value={line.variantId || "none"} onValueChange={(v) => setLines(lines.map((x,i) => i === index ? {...x,variantId:v === "none" ? "" : v}:x))}><SelectTrigger className="col-span-3"><SelectValue placeholder="規格" /></SelectTrigger><SelectContent><SelectItem value="none">無規格</SelectItem>{product?.variants.filter((v) => v.isActive).map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent></Select>
          <Input className="col-span-3" type="number" min="0" step="1" value={line.price} onChange={(e) => setLines(lines.map((x,i) => i === index ? {...x,price:e.target.value}:x))} />
          <Button className="col-span-1" size="icon" variant="ghost" onClick={() => setLines(lines.filter((_,i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
        </div>;})}
        <Button variant="outline" size="sm" onClick={() => setLines([...lines, emptyLine()])}><Plus className="mr-1 h-4 w-4" />新增品項</Button>
      </div><DialogFooter><Button variant="outline" onClick={() => setItemsList(null)}>取消</Button><Button disabled={putItems.isPending} onClick={submitItems}>儲存全部設價</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}