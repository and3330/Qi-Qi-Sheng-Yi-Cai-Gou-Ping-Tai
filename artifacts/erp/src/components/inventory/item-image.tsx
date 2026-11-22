import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ImageIcon, Trash2, Upload } from "lucide-react";

/**
 * 品項圖片：一個品項一張主圖，存在附件裡（Inventory／ItemImage／品項 id）。
 * 清單的縮圖、品項內容裡的大圖與上傳都用這個檔案。
 */

const MODULE = "Inventory";
const DOCUMENT_TYPE = "ItemImage";
const QUERY_KEY = ["attachments", MODULE, DOCUMENT_TYPE];
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const MAX_BYTES = 20 * 1024 * 1024;

export const itemImageUrl = (attachmentId: number) => `/erp-api/attachments/download/${attachmentId}?inline=1`;

/** 所有品項的圖片對照表：品項 id → 附件 id（一次查完，清單不用一筆一筆問） */
export function useItemImages(): Map<number, number> {
  const { data } = useQuery<{ id: number; documentId: number }[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(`/erp-api/attachments?module=${MODULE}&documentType=${DOCUMENT_TYPE}`);
      if (!res.ok) return [];
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },
    staleTime: 60_000,
  });
  return useMemo(() => {
    const map = new Map<number, number>();
    // 清單是新的在前；同一個品項只取最新的一張
    for (const row of data ?? []) if (!map.has(row.documentId)) map.set(row.documentId, row.id);
    return map;
  }, [data]);
}

/** 清單用的小縮圖；沒有圖就放一個淡淡的佔位，讓每一列對齊 */
export function ItemThumb({ attachmentId, name }: { attachmentId?: number; name?: string }) {
  const [broken, setBroken] = useState(false);
  const box = "mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40 align-middle";
  if (!attachmentId || broken) {
    return <span className={box} aria-hidden="true"><ImageIcon className="h-4 w-4 text-muted-foreground/40" /></span>;
  }
  return (
    <span className={box}>
      <img src={itemImageUrl(attachmentId)} alt={name ? `${name} 的圖片` : "品項圖片"} loading="lazy" className="h-full w-full object-cover" onError={() => setBroken(true)} />
    </span>
  );
}

/** 品項內容裡的圖片區：看大圖、上傳、更換、移除 */
export function ItemImageEditor({ itemId, name, attachmentId }: { itemId: number; name?: string; attachmentId?: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPT.split(",").includes(file.type)) { toast({ title: "圖片只接受 JPG、PNG、WebP、GIF", variant: "destructive" }); return; }
    if (file.size > MAX_BYTES) { toast({ title: "圖片太大，請小於 20 MB", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("module", MODULE);
      body.append("documentType", DOCUMENT_TYPE);
      body.append("documentId", String(itemId));
      const res = await fetch("/erp-api/attachments", { method: "POST", body });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "上傳失敗");
      await refresh();
      toast({ title: attachmentId ? "圖片已更換" : "圖片已上傳" });
    } catch (err: any) {
      toast({ title: "圖片上傳失敗", description: err?.message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    if (!attachmentId || !confirm("確定移除這張圖片？")) return;
    setBusy(true);
    try {
      const res = await fetch(`/erp-api/attachments/${attachmentId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await refresh();
      toast({ title: "圖片已移除" });
    } catch {
      toast({ title: "移除失敗，請再試一次", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Label className="text-muted-foreground text-xs mb-2 block">品項圖片</Label>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
          {attachmentId ? (
            <a href={itemImageUrl(attachmentId)} target="_blank" rel="noreferrer" title="點一下看原圖">
              <img src={itemImageUrl(attachmentId)} alt={name ? `${name} 的圖片` : "品項圖片"} className="h-32 w-32 object-contain" />
            </a>
          ) : (
            <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground"><ImageIcon className="h-6 w-6 opacity-40" />尚無圖片</div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="input-item-image" />
          <Button type="button" variant="outline" size="sm" className="min-h-[44px] sm:min-h-9" disabled={busy} onClick={() => input.current?.click()}>
            <Upload className="mr-1 h-4 w-4" />{busy ? "處理中…" : attachmentId ? "更換圖片" : "上傳圖片"}
          </Button>
          {attachmentId && (
            <Button type="button" variant="ghost" size="sm" className="min-h-[44px] sm:min-h-9 text-destructive" disabled={busy} onClick={remove}>
              <Trash2 className="mr-1 h-4 w-4" />移除圖片
            </Button>
          )}
          <p className="text-xs text-muted-foreground">JPG、PNG、WebP、GIF，20 MB 以內</p>
        </div>
      </div>
    </div>
  );
}
