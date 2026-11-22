import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DocWindow, DocStatus, statusTone } from "@/components/shared/doc-window";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, Eye } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = <T,>(path: string, opts?: RequestInit) =>
  fetch(`/erp-api${path}`, { headers: { "Content-Type": "application/json" }, ...opts })
    .then(r => { if (!r.ok) throw new Error("請求失敗"); return r.status === 204 ? (undefined as T) : r.json() as Promise<T>; });

interface Article { id: number; title: string; content: string | null; categoryId: number | null; status: string; authorId: number | null; tags: string | null; viewCount: number; createdAt: string; updatedAt: string; categoryName: string | null; authorName: string | null; }
interface KbCat { id: number; name: string; description: string | null; }

const statusLabel: Record<string, string> = { Draft: "草稿", Published: "已發布", Archived: "已封存" };

export default function KnowledgeBasePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("articles");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Article | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState({ title: "", content: "", categoryId: "", status: "Draft", tags: "" });
  const [catOpen, setCatOpen] = useState(false);
  const [catForm, setCatForm] = useState({ name: "", description: "" });
  const [editingCat, setEditingCat] = useState<KbCat | null>(null);

  const { data: articles = [] } = useQuery<Article[]>({ queryKey: ["kb-articles", searchTerm], queryFn: () => api(`/kb-articles${searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : ""}`) });
  const { data: categories = [] } = useQuery<KbCat[]>({ queryKey: ["kb-categories"], queryFn: () => api("/kb-categories") });

  const articleMut = useMutation({
    mutationFn: (data: any) => editing ? api(`/kb-articles/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) }) : api("/kb-articles", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kb-articles"] }); setOpen(false); setEditing(null); toast({ title: editing ? "已更新" : "已建立" }); },
  });
  const deleteArticleMut = useMutation({
    mutationFn: (id: number) => api(`/kb-articles/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kb-articles"] }); toast({ title: "已刪除" }); },
  });
  const catMut = useMutation({
    mutationFn: (data: any) => editingCat ? api(`/kb-categories/${editingCat.id}`, { method: "PATCH", body: JSON.stringify(data) }) : api("/kb-categories", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kb-categories"] }); setCatOpen(false); setEditingCat(null); toast({ title: "已儲存" }); },
  });
  const deleteCatMut = useMutation({
    mutationFn: (id: number) => api(`/kb-categories/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kb-categories"] }); toast({ title: "已刪除" }); },
  });

  const batch = useBatchSelection(articles);
  const kbBatchFields: BatchField[] = [{key:"status",label:"狀態",type:"select",options:[{value:"Published",label:"已發佈"},{value:"Draft",label:"草稿"}]}];

  const openCreate = () => { setEditing(null); setForm({ title: "", content: "", categoryId: "", status: "Draft", tags: "" }); setOpen(true); };
  const openEdit = (a: Article) => { setEditing(a); setForm({ title: a.title, content: a.content || "", categoryId: a.categoryId ? String(a.categoryId) : "", status: a.status, tags: a.tags || "" }); setOpen(true); };
  const handleSave = () => {
    const payload: any = { title: form.title, content: form.content || null, status: form.status, tags: form.tags || null };
    if (form.categoryId) payload.categoryId = Number(form.categoryId);
    articleMut.mutate(payload);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">知識庫</h1>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="articles">文章</TabsTrigger><TabsTrigger value="categories">分類</TabsTrigger></TabsList>
        <TabsContent value="articles" className="space-y-4">
          {batch.count > 0 && (
            <BatchActionBar
              count={batch.count}
              entityName="文章"
              entityEndpoint="kb-articles"
              ids={batch.ids}
              batchFields={kbBatchFields}
              onClear={batch.clearSelection}
              onComplete={() => qc.invalidateQueries({ queryKey: ["kb-articles"] })}
            />
          )}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="搜尋文章..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <Button onClick={openCreate}><Plus className="w-4 h-4 mr-1" />新增文章</Button>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></TableHead>
                    <TableHead>標題</TableHead><TableHead>分類</TableHead><TableHead>狀態</TableHead>
                    <TableHead>標籤</TableHead><TableHead>瀏覽次數</TableHead><TableHead>更新時間</TableHead>
                    <TableHead className="w-20">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {articles.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">尚無文章</TableCell></TableRow>}
                  {articles.map(a => (
                    <TableRow key={a.id}>
                      <TableCell><CheckboxCell checked={batch.selectedIds.has(a.id)} onChange={() => batch.toggle(a.id)} /></TableCell>
                      <TableCell className="font-medium">{a.title}</TableCell>
                      <TableCell>{a.categoryName || "-"}</TableCell>
                      <TableCell><Badge variant="secondary">{statusLabel[a.status] || a.status}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{a.tags || "-"}</TableCell>
                      <TableCell><div className="flex items-center gap-1"><Eye className="w-3 h-3" />{a.viewCount}</div></TableCell>
                      <TableCell className="text-sm">{new Date(a.updatedAt).toLocaleDateString("zh-TW")}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(a)}><Pencil className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => { if (confirm("確定刪除？")) deleteArticleMut.mutate(a.id); }}><Trash2 className="w-4 h-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="categories" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditingCat(null); setCatForm({ name: "", description: "" }); setCatOpen(true); }}><Plus className="w-4 h-4 mr-1" />新增分類</Button>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>名稱</TableHead><TableHead>說明</TableHead><TableHead className="w-20">操作</TableHead></TableRow></TableHeader>
                <TableBody>
                  {categories.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">尚無分類</TableCell></TableRow>}
                  {categories.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>{c.description || "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { setEditingCat(c); setCatForm({ name: c.name, description: c.description || "" }); setCatOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => { if (confirm("確定刪除？")) deleteCatMut.mutate(c.id); }}><Trash2 className="w-4 h-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <DocWindow
        open={open}
        onClose={() => setOpen(false)}
        name={editing ? "文章" : "新增文章"}
        status={editing ? <DocStatus label={statusLabel[editing.status] || editing.status} tone={statusTone(editing.status)} /> : undefined}
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleSave} disabled={!form.title}>{editing ? "更新" : "建立"}</Button>
        </>}
      >
          <div className="grid gap-4">
            <div><label className="text-sm font-medium">標題 *</label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div><label className="text-sm font-medium">內容</label><Textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} rows={8} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">分類</label>
                <LookupSelect value={form.categoryId} onValueChange={v => setForm({ ...form, categoryId: v })}>
                  <SelectTrigger><SelectValue placeholder="選擇分類" /></SelectTrigger>
                  <SelectContent>{categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </LookupSelect>
              </div>
              <div>
                <label className="text-sm font-medium">狀態</label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Draft">草稿</SelectItem>
                    <SelectItem value="Published">已發布</SelectItem>
                    <SelectItem value="Archived">已封存</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><label className="text-sm font-medium">標籤 (逗號分隔)</label><Input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="例: FAQ, 常見問題, 操作手冊" /></div>
          </div>
      </DocWindow>

      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingCat ? "編輯分類" : "新增分類"}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div><label className="text-sm font-medium">名稱 *</label><Input value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} /></div>
            <div><label className="text-sm font-medium">說明</label><Input value={catForm.description} onChange={e => setCatForm({ ...catForm, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatOpen(false)}>取消</Button>
            <Button onClick={() => catMut.mutate(catForm)} disabled={!catForm.name}>{editingCat ? "更新" : "建立"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
