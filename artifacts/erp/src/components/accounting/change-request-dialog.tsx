import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/**
 * 送「異動申請」（刪除、修改已入帳的單據）：寫原因 → 送出 → 財務或超級管理員其一核准後系統才執行。
 * endpoint 回 202 代表已送審。
 */
export function ChangeRequestDialog({ open, title, description, endpoint, body, onClose, onSubmitted }: {
  open: boolean; title: string; description: React.ReactNode; endpoint: string; body?: Record<string, unknown>;
  onClose: () => void; onSubmitted?: (requestNumber: string) => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      const r = await fetch(endpoint, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(body ?? {}), reason }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "送出失敗");
      toast(j.applied ? { title: `已直接執行（${j.requestNumber}）`, description: "公司裡沒有其他可以審核的人，系統已直接執行並留下紀錄" } : { title: `申請 ${j.requestNumber} 已送出`, description: "財務或超級管理員核准後才會執行，可以到審批中心看進度" });
      setReason("");
      onSubmitted?.(j.requestNumber);
      onClose();
    } catch (e: any) {
      toast({ title: "送出失敗", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="md:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="text-sm">{description}</div>
        <p className="text-xs text-muted-foreground">要財務或超級管理員其中一位核准；財務提出的由超級管理員核准。核准後系統自動執行，H 紀錄會留下是誰申請、誰核准。</p>
        <div className="space-y-1">
          <Label htmlFor="change-reason">原因 *</Label>
          <textarea id="change-reason" className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={reason} onChange={e => setReason(e.target.value)} placeholder="例如：金額打錯，重開一張" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={saving || !reason.trim()} onClick={submit} data-testid="button-submit-change-request">送出申請</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
