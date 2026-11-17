import { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const pad = (n: number) => String(n).padStart(2, "0");
const monthEnd = (y: number, m: number) => `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;
/** 2026-10-31 → 2026 年 10 月底；月中的舊設定照寫日期 */
export function lockText(date: string | null): string {
  if (!date) return "未鎖帳";
  const [y, m, d] = date.split("-").map(Number);
  return d === new Date(y, m, 0).getDate() ? `${y} 年 ${m} 月底` : date;
}

interface Settings { lockDate: string | null; pendingUnlock: { requestNumber: string; lockDate: string | null; requestedBy: string } | null }

/**
 * 按月鎖帳（老闆 2026-11-16）：選一個月份，那個月底（含）以前的帳都不能新增、修改、刪除。
 * 往後鎖直接生效；往回選（解鎖）要寫原因送審，財務或超級管理員其一核准才生效，財務送的給超級管理員。
 */
export function PeriodLockControl({ onChanged }: { onChanged?: (lockDate: string | null) => void }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [choice, setChoice] = useState("");
  const [unlockTo, setUnlockTo] = useState<string | null | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => fetch("/erp-api/accounting-settings", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(d => { if (d) { setSettings(d); onChanged?.(d.lockDate); } }).catch(() => {});
  useEffect(() => { load(); }, []);

  // 可選的月份：從上個月往回 36 個月（還沒過完的這個月不能鎖）
  const months = useMemo(() => {
    const now = new Date();
    const list: Array<{ value: string; label: string }> = [];
    for (let i = 1; i <= 36; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      list.push({ value: monthEnd(d.getFullYear(), d.getMonth() + 1), label: `${d.getFullYear()} 年 ${d.getMonth() + 1} 月` });
    }
    return list;
  }, []);

  const lockDate = settings?.lockDate ?? null;
  const put = async (value: string | null, why = "") => {
    setSaving(true);
    try {
      const r = await fetch("/erp-api/accounting-settings", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lockDate: value, reason: why }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "儲存失敗");
      if (j.applied) toast({ title: `已解鎖（${j.requestNumber}）`, description: "公司裡沒有其他可以審核的人，系統已直接解鎖並留下紀錄" });
      else if (r.status === 202) toast({ title: `解鎖申請 ${j.requestNumber} 已送出`, description: "財務或超級管理員核准後才會解鎖，可以到審批中心看進度" });
      else toast({ title: `已鎖帳到 ${lockText(value)}`, description: "這天（含）以前的帳都不能新增、修改、刪除" });
      setUnlockTo(undefined); setReason("");
      await load();
    } catch (e: any) {
      toast({ title: "鎖帳設定失敗", description: e.message, variant: "destructive" });
    } finally { setSaving(false); setChoice(""); }
  };

  const pick = (value: string) => {
    setChoice(value);
    const target = value === "none" ? null : value;
    if (lockDate && (!target || target < lockDate)) { setUnlockTo(target); return; }
    if (target && window.confirm(`確定鎖帳到 ${lockText(target)}？這天（含）以前的帳都不能新增、修改、刪除。之後要解鎖需要審核。`)) put(target);
    else setChoice("");
  };

  return (
    <div className="flex items-center gap-2">
      <Label className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" />鎖帳到</Label>
      <select className="h-9 w-44 rounded-md border border-input bg-background px-2 text-sm" value={choice} disabled={saving || !settings} onChange={e => pick(e.target.value)}
        title="選月份：那個月底（含）以前的帳都不能新增、修改、刪除；往回選是解鎖，要送審" aria-label="鎖帳月份" data-testid="select-lock-month">
        <option value="">{lockText(lockDate)}</option>
        {months.map(m => <option key={m.value} value={m.value}>{m.value === lockDate ? `✓ ${m.label}（目前）` : m.value < (lockDate ?? "") ? `解鎖到 ${m.label}` : `鎖到 ${m.label}`}</option>)}
        {lockDate && <option value="none">全部解鎖</option>}
      </select>
      {settings?.pendingUnlock && <Badge variant="outline" className="whitespace-nowrap" title={`${settings.pendingUnlock.requestedBy} 申請解鎖到 ${lockText(settings.pendingUnlock.lockDate)}`}>解鎖審核中 {settings.pendingUnlock.requestNumber}</Badge>}

      <Dialog open={unlockTo !== undefined} onOpenChange={v => { if (!v) { setUnlockTo(undefined); setChoice(""); } }}>
        <DialogContent className="md:max-w-md">
          <DialogHeader><DialogTitle>申請解鎖</DialogTitle></DialogHeader>
          <p className="text-sm">目前鎖到 <b>{lockText(lockDate)}</b>，要改成 <b>{unlockTo ? lockText(unlockTo) : "全部解鎖"}</b>。解鎖要財務或超級管理員核准，財務提出的由超級管理員核准。</p>
          <div className="space-y-1">
            <Label htmlFor="unlock-reason">原因 *</Label>
            <textarea id="unlock-reason" className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={reason} onChange={e => setReason(e.target.value)} placeholder="例如：10 月有一張發票金額打錯，要更正" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUnlockTo(undefined); setChoice(""); }}>取消</Button>
            <Button disabled={saving || !reason.trim()} onClick={() => put(unlockTo ?? null, reason)} data-testid="button-submit-unlock">送出申請</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
