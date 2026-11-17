import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Download, Search, FileText, Image, Film, Archive, File, Pencil } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;

const moduleOptions = [
  { value: "HR", label: "人力資源" },
  { value: "Sales", label: "銷售" },
  { value: "Purchasing", label: "採購" },
  { value: "Inventory", label: "庫存" },
  { value: "Accounting", label: "會計" },
  { value: "Projects", label: "專案管理" },
  { value: "CRM", label: "客戶關係" },
  { value: "Assets", label: "資產管理" },
  { value: "Manufacturing", label: "製造" },
  { value: "Quality", label: "品質管理" },
  { value: "Helpdesk", label: "客服中心" },
  { value: "Contracts", label: "合約管理" },
  { value: "System", label: "系統" },
  { value: "General", label: "一般" },
];

const moduleLabel: Record<string, string> = Object.fromEntries(moduleOptions.map(m => [m.value, m.label]));

const statusColor: Record<string, string> = {
  Active: "bg-green-100 text-green-700",
  Archived: "bg-gray-100 text-gray-700",
  Deleted: "bg-red-100 text-red-700",
};
const statusLabel: Record<string, string> = { Active: "啟用", Archived: "已歸檔", Deleted: "已刪除" };

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(fileType: string | null) {
  if (!fileType) return <File size={16} />;
  if (fileType.startsWith("image/")) return <Image size={16} className="text-blue-500" />;
  if (fileType.startsWith("video/")) return <Film size={16} className="text-purple-500" />;
  if (fileType.includes("pdf")) return <FileText size={16} className="text-red-500" />;
  if (fileType.includes("zip") || fileType.includes("rar") || fileType.includes("tar")) return <Archive size={16} className="text-orange-500" />;
  return <FileText size={16} className="text-gray-500" />;
}

const PAGE_SIZE = 20;

export default function FileManagementPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [selectedFile, setSelectedFile] = useState<globalThis.File | null>(null);
  const [form, setForm] = useState({ module: "General", documentType: "一般文件", description: "", tags: "" });

  const { data: attachments = [], isLoading } = useQuery({
    queryKey: ["attachments"],
    queryFn: () => fetch(api("attachments")).then(r => r.json()),
  });

  const filtered = useMemo(() => {
    let items = attachments;
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((a: any) =>
        a.fileNumber?.toLowerCase().includes(q) ||
        a.fileName?.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q) ||
        a.tags?.toLowerCase().includes(q)
      );
    }
    if (moduleFilter !== "all") items = items.filter((a: any) => a.module === moduleFilter);
    if (statusFilter !== "all") items = items.filter((a: any) => a.status === statusFilter);
    return items;
  }, [attachments, search, moduleFilter, statusFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const batch = useBatchSelection(paged);

  const batchFields: BatchField[] = [
    { key: "status", label: "狀態", type: "select", options: [{ value: "Active", label: "啟用" }, { value: "Archived", label: "已歸檔" }] },
    { key: "module", label: "模組", type: "select", options: moduleOptions },
  ];

  const uploadMut = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch(api("attachments"), { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attachments"] });
      toast({ title: "檔案上傳成功" });
      setUploadOpen(false);
      setSelectedFile(null);
      setForm({ module: "General", documentType: "一般文件", description: "", tags: "" });
    },
    onError: (err: any) => toast({ title: "上傳失敗", description: err.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await fetch(api(`attachments/${id}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attachments"] });
      toast({ title: "更新成功" });
      setEditOpen(false);
    },
    onError: (err: any) => toast({ title: "更新失敗", description: err.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(api(`attachments/${id}`), { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attachments"] });
      toast({ title: "已刪除" });
    },
  });

  const handleUpload = () => {
    if (!selectedFile) { toast({ title: "請選擇檔案", variant: "destructive" }); return; }
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("module", form.module);
    formData.append("documentType", form.documentType);
    formData.append("documentId", "0");
    formData.append("description", form.description);
    formData.append("tags", form.tags);
    uploadMut.mutate(formData);
  };

  const handleDelete = (a: any) => {
    if (!confirm(`確定刪除檔案「${a.fileName}」？`)) return;
    deleteMut.mutate(a.id);
  };

  const openEdit = (a: any) => {
    setEditing({ ...a });
    setEditOpen(true);
  };

  const handleUpdate = () => {
    if (!editing) return;
    updateMut.mutate({ id: editing.id, data: { fileName: editing.fileName, description: editing.description, tags: editing.tags, module: editing.module, status: editing.status } });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="檔案管理" description="管理系統中的所有檔案與附件">
        <Button onClick={() => setUploadOpen(true)} size="sm"><Plus className="h-4 w-4 mr-1" />上傳檔案</Button>
      </PageHeader>

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="檔案"
          entityEndpoint="attachments"
          ids={batch.ids}
          batchFields={batchFields}
          onClear={batch.clearSelection}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ["attachments"] })}
        />
      )}

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">搜尋</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="搜尋編號、檔名、說明、標籤..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-8" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">模組</Label>
              <select className="border rounded px-3 py-2 text-sm" value={moduleFilter} onChange={e => { setModuleFilter(e.target.value); setPage(1); }}>
                <option value="all">全部模組</option>
                {moduleOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">狀態</Label>
              <select className="border rounded px-3 py-2 text-sm" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="all">全部</option>
                <option value="Active">啟用</option>
                <option value="Archived">已歸檔</option>
              </select>
            </div>
            <div className="text-sm text-muted-foreground whitespace-nowrap">共 {filtered.length} 筆</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} />
                <th className="px-4 py-3 text-left font-medium">檔案編號</th>
                <th className="px-4 py-3 text-left font-medium">檔案名稱</th>
                <th className="px-4 py-3 text-left font-medium hidden md:table-cell">模組</th>
                <th className="px-4 py-3 text-left font-medium hidden md:table-cell">文件類型</th>
                <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">說明</th>
                <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">標籤</th>
                <th className="px-4 py-3 text-right font-medium hidden md:table-cell">大小</th>
                <th className="px-4 py-3 text-center font-medium">狀態</th>
                <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">上傳日期</th>
                <th className="px-4 py-3 text-center font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className="text-center py-8 text-muted-foreground">載入中...</td></tr>
              ) : paged.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-8 text-muted-foreground">尚無檔案</td></tr>
              ) : paged.map((a: any) => (
                <tr key={a.id} className="border-b hover:bg-muted/30">
                  <CheckboxCell checked={batch.selectedIds.has(a.id)} onChange={() => batch.toggle(a.id)} />
                  <td className="px-4 py-3 font-mono text-xs text-blue-600">{a.fileNumber}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {getFileIcon(a.fileType)}
                      <span className="truncate max-w-[200px]" title={a.fileName}>{a.fileName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">{moduleLabel[a.module] || a.module}</td>
                  <td className="px-4 py-3 hidden md:table-cell">{a.documentType}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className="truncate max-w-[150px] block" title={a.description}>{a.description || "-"}</span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {a.tags ? a.tags.split(",").map((t: string) => (
                      <Badge key={t} variant="secondary" className="mr-1 text-xs">{t.trim()}</Badge>
                    )) : "-"}
                  </td>
                  <td className="px-4 py-3 text-right hidden md:table-cell">{formatFileSize(a.fileSize)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${statusColor[a.status] || "bg-gray-100"}`}>
                      {statusLabel[a.status] || a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                    {a.createdAt ? new Date(a.createdAt).toLocaleDateString("zh-TW") : "-"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex gap-1 justify-center">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(a)} title="編輯">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(a)} title="刪除">
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 py-3">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一頁</Button>
            <span className="text-sm leading-8">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一頁</Button>
          </div>
        )}
      </Card>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader><DialogTitle>上傳檔案</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>選擇檔案 *</Label>
              <Input type="file" onChange={e => setSelectedFile(e.target.files?.[0] || null)} />
            </div>
            <div>
              <Label>所屬模組</Label>
              <select className="w-full border rounded px-3 py-2 text-sm" value={form.module} onChange={e => setForm(f => ({ ...f, module: e.target.value }))}>
                {moduleOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <Label>文件類型</Label>
              <Input value={form.documentType} onChange={e => setForm(f => ({ ...f, documentType: e.target.value }))} placeholder="例如：合約、報價單、發票..." />
            </div>
            <div>
              <Label>說明</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <Label>標籤（以逗號分隔）</Label>
              <Input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="例如：2026年度,合約,重要" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>取消</Button>
            <Button onClick={handleUpload} disabled={uploadMut.isPending}>{uploadMut.isPending ? "上傳中..." : "上傳"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader><DialogTitle>編輯檔案資訊</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div>
                <Label>檔案編號</Label>
                <Input value={editing.fileNumber || ""} disabled className="bg-muted" />
              </div>
              <div>
                <Label>檔案名稱</Label>
                <Input value={editing.fileName} onChange={e => setEditing((p: any) => ({ ...p, fileName: e.target.value }))} />
              </div>
              <div>
                <Label>所屬模組</Label>
                <select className="w-full border rounded px-3 py-2 text-sm" value={editing.module} onChange={e => setEditing((p: any) => ({ ...p, module: e.target.value }))}>
                  {moduleOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <Label>狀態</Label>
                <select className="w-full border rounded px-3 py-2 text-sm" value={editing.status} onChange={e => setEditing((p: any) => ({ ...p, status: e.target.value }))}>
                  <option value="Active">啟用</option>
                  <option value="Archived">已歸檔</option>
                </select>
              </div>
              <div>
                <Label>說明</Label>
                <Input value={editing.description || ""} onChange={e => setEditing((p: any) => ({ ...p, description: e.target.value }))} />
              </div>
              <div>
                <Label>標籤</Label>
                <Input value={editing.tags || ""} onChange={e => setEditing((p: any) => ({ ...p, tags: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleUpdate} disabled={updateMut.isPending}>{updateMut.isPending ? "儲存中..." : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
