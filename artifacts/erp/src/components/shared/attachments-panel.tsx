import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Paperclip, Download, Trash2, Upload } from "lucide-react";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;

interface AttachmentsPanelProps {
  module: string;
  documentType: string;
  documentId: number;
}

export function AttachmentsPanel({ module, documentType, documentId }: AttachmentsPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const { data: attachments = [] } = useQuery({
    queryKey: ["attachments", module, documentType, documentId],
    queryFn: () => fetch(api(`attachments?module=${module}&documentType=${documentType}&documentId=${documentId}`)).then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetch(api(`attachments/${id}?module=${module}&documentType=${documentType}&documentId=${documentId}`), { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attachments", module, documentType, documentId] });
      toast({ title: "附件已刪除" });
    },
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("module", module);
    formData.append("documentType", documentType);
    formData.append("documentId", String(documentId));
    formData.append("uploadedBy", "admin");
    try {
      const res = await fetch(api("attachments"), { method: "POST", body: formData });
      if (!res.ok) throw new Error("上傳失敗");
      qc.invalidateQueries({ queryKey: ["attachments", module, documentType, documentId] });
      toast({ title: "附件已上傳" });
    } catch {
      toast({ title: "上傳失敗", variant: "destructive" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Paperclip className="h-4 w-4" />附件 ({attachments.length})
          </CardTitle>
          <label className="cursor-pointer">
            <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
            <Button variant="outline" size="sm" asChild disabled={uploading}>
              <span><Upload className="mr-1 h-3 w-3" />{uploading ? "上傳中..." : "上傳"}</span>
            </Button>
          </label>
        </div>
      </CardHeader>
      <CardContent>
        {attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">尚無附件</p>
        ) : (
          <div className="space-y-2">
            {attachments.map((att: any) => (
              <div key={att.id} className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{att.fileName}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{formatSize(att.fileSize)}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => window.open(api(`attachments/download/${att.id}?module=${module}&documentType=${documentType}&documentId=${documentId}`), "_blank")}>
                    <Download className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => { if (confirm("確定刪除此附件？")) deleteMutation.mutate(att.id); }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
