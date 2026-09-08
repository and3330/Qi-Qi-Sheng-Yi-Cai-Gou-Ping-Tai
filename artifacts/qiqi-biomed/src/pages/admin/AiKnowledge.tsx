import { useState, useMemo } from "react";
import { AdminLayout } from "./AdminLayout";
import { 
  useListAdminAiKnowledge, 
  useCreateAdminAiKnowledge, 
  useUpdateAdminAiKnowledge, 
  useDeleteAdminAiKnowledge,
  getListAdminAiKnowledgeQueryKey,
  type AdminAiKnowledge
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Plus, Pencil, Trash2, Info, BookOpen } from "lucide-react";

export default function AdminAiKnowledgePage() {
  const queryClient = useQueryClient();
  const { data: knowledgeList, isLoading, isError } = useListAdminAiKnowledge();
  
  const createMutation = useCreateAdminAiKnowledge();
  const updateMutation = useUpdateAdminAiKnowledge();
  const deleteMutation = useDeleteAdminAiKnowledge();

  const [search, setSearch] = useState("");
  const [editingItem, setEditingItem] = useState<AdminAiKnowledge | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState<AdminAiKnowledge | null>(null);

  // Form states
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [content, setContent] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState("");

  const filteredList = useMemo(() => {
    if (!knowledgeList) return [];
    const term = search.toLowerCase();
    return knowledgeList.filter(
      (item) =>
        item.title.toLowerCase().includes(term) ||
        item.category.toLowerCase().includes(term) ||
        item.content.toLowerCase().includes(term)
    );
  }, [knowledgeList, search]);

  const resetForm = () => {
    setTitle("");
    setCategory("");
    setContent("");
    setIsActive(true);
    setFormError("");
  };

  const openCreateModal = () => {
    resetForm();
    setIsCreateModalOpen(true);
  };

  const openEditModal = (item: AdminAiKnowledge) => {
    setTitle(item.title);
    setCategory(item.category);
    setContent(item.content);
    setIsActive(item.isActive);
    setFormError("");
    setEditingItem(item);
  };

  const closeModals = () => {
    setIsCreateModalOpen(false);
    setEditingItem(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    
    if (!title.trim() || !category.trim() || !content.trim()) {
      setFormError("標題、分類與內容皆為必填");
      return;
    }

    try {
      if (editingItem) {
        await updateMutation.mutateAsync({
          id: editingItem.id,
          data: {
            title: title.trim(),
            category: category.trim(),
            content: content.trim(),
            isActive,
          },
        });
      } else {
        await createMutation.mutateAsync({
          data: {
            title: title.trim(),
            category: category.trim(),
            content: content.trim(),
            isActive,
          },
        });
      }
      queryClient.invalidateQueries({ queryKey: getListAdminAiKnowledgeQueryKey() });
      closeModals();
    } catch (err) {
      setFormError("儲存失敗，請稍後再試");
    }
  };

  const handleToggleStatus = async (item: AdminAiKnowledge) => {
    try {
      await updateMutation.mutateAsync({
        id: item.id,
        data: { isActive: !item.isActive },
      });
      queryClient.setQueryData(getListAdminAiKnowledgeQueryKey(), (old: AdminAiKnowledge[] | undefined) => 
        old ? old.map(k => k.id === item.id ? { ...k, isActive: !item.isActive } : k) : old
      );
    } catch (err) {
      // Revert handle failure if needed, relying on toaster if available globally
    }
  };

  const handleDelete = async () => {
    if (!deletingItem) return;
    try {
      await deleteMutation.mutateAsync({ id: deletingItem.id });
      queryClient.invalidateQueries({ queryKey: getListAdminAiKnowledgeQueryKey() });
      setDeletingItem(null);
    } catch (err) {
      // Error handled by UI informally or toast globally
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;
  const isModalOpen = isCreateModalOpen || editingItem !== null;

  return (
    <AdminLayout title="AI 客服知識庫">
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center mb-6">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input
            placeholder="搜尋標題、分類或內容..."
            className="pl-10 rounded-xl bg-white shadow-sm border-border/60"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={openCreateModal} className="rounded-xl shadow-sm shrink-0 w-full md:w-auto">
          <Plus className="mr-2" size={18} />
          新增知識
        </Button>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 flex items-start gap-3">
        <Info className="text-blue-500 shrink-0 mt-0.5" size={20} />
        <div className="text-sm text-blue-900 leading-relaxed">
          <strong>AI 客服檢索機制說明：</strong>
          <br />
          這裡建立的知識將做為前台 AI 客服回應的參考基礎。
          <span className="font-semibold text-blue-700">狀態為「啟用」的項目，會立即寫入 AI 知識庫並可被檢索；</span>
          「停用」的項目則不會被 AI 採用。為了確保 AI 回答準確，請盡量將內容描述得具體且清晰。
        </div>
      </div>

      <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <div className="p-12 text-center text-destructive font-medium">
            無法載入知識庫資料，請稍後再試
          </div>
        ) : filteredList.length === 0 ? (
          <div className="p-16 flex flex-col items-center justify-center text-muted-foreground text-center">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
              <BookOpen size={32} className="text-muted-foreground/50" />
            </div>
            <p className="font-medium text-foreground">目前沒有符合的知識項目</p>
            <p className="text-sm mt-1 max-w-sm">請嘗試調整搜尋條件，或點擊上方按鈕新增第一筆 AI 知識。</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm text-left">
              <thead className="bg-muted/50 border-b">
                <tr className="text-muted-foreground">
                  <th className="px-5 py-3.5 font-medium w-[15%]">分類</th>
                  <th className="px-5 py-3.5 font-medium w-[25%]">標題</th>
                  <th className="px-5 py-3.5 font-medium w-[40%]">內容預覽</th>
                  <th className="px-5 py-3.5 font-medium w-[10%]">狀態</th>
                  <th className="px-5 py-3.5 font-medium w-[10%] text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredList.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-4 align-top">
                      <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 truncate max-w-[120px]">
                        {item.category}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <div className="font-semibold text-foreground line-clamp-2">
                        {item.title}
                      </div>
                    </td>
                    <td className="px-5 py-4 align-top text-muted-foreground">
                      <div className="line-clamp-2 leading-relaxed">
                        {item.content}
                      </div>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <button
                        onClick={() => handleToggleStatus(item)}
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                          item.isActive 
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" 
                            : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200"
                        }`}
                      >
                        {item.isActive ? "啟用" : "停用"}
                      </button>
                    </td>
                    <td className="px-5 py-4 align-top text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-primary hover:bg-primary/10 hover:text-primary"
                        onClick={() => openEditModal(item)}
                      >
                        <Pencil size={16} />
                        <span className="sr-only">編輯</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeletingItem(item)}
                      >
                        <Trash2 size={16} />
                        <span className="sr-only">刪除</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={isModalOpen} onOpenChange={(open) => !open && closeModals()}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {editingItem ? "編輯知識" : "新增知識"}
            </DialogTitle>
          </DialogHeader>
          
          <form onSubmit={handleSave} className="space-y-5 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label htmlFor="category">分類</Label>
                <Input
                  id="category"
                  placeholder="例如：配送問題、產品退換貨"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="title">標題 (問題或關鍵字)</Label>
                <Input
                  id="title"
                  placeholder="例如：如何辦理退換貨？"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="content">完整解答與知識內容</Label>
                  <span className="text-xs text-muted-foreground">
                    提供給 AI 的詳細指導
                  </span>
                </div>
                <Textarea
                  id="content"
                  placeholder="請輸入詳盡的處理方式或回答內容，AI 將依據此內容生成回覆..."
                  className="min-h-[200px] resize-y"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </div>
              
              <div className="space-y-3 md:col-span-2">
                <Label>狀態設定</Label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="radio" 
                      name="isActive" 
                      checked={isActive} 
                      onChange={() => setIsActive(true)}
                      className="accent-primary"
                    />
                    <span className="text-sm font-medium">啟用 (AI 立即採用)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="radio" 
                      name="isActive" 
                      checked={!isActive} 
                      onChange={() => setIsActive(false)}
                      className="accent-primary"
                    />
                    <span className="text-sm font-medium text-muted-foreground">停用 (暫存不使用)</span>
                  </label>
                </div>
              </div>
            </div>

            {formError && (
              <div className="text-sm text-destructive font-medium bg-destructive/10 px-3 py-2 rounded-lg">
                {formError}
              </div>
            )}

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={closeModals} disabled={isSaving}>
                取消
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "儲存中..." : "儲存設定"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingItem} onOpenChange={(open) => !open && setDeletingItem(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>確認刪除此知識？</AlertDialogTitle>
            <AlertDialogDescription className="text-base mt-2">
              您即將刪除「<span className="font-semibold text-foreground">{deletingItem?.title}</span>」。
              <br className="mb-2" />
              刪除後無法復原，AI 客服將不再參考此資料，請確認是否繼續？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6">
            <AlertDialogCancel disabled={isDeleting}>取消保留</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "刪除中..." : "確認永久刪除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </AdminLayout>
  );
}
