import { useState } from "react";
import { useChangePassword } from "@workspace/api-client-react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/** 會員中心的「變更密碼」：要先輸入目前的密碼。 */
export function ChangePasswordDialog() {
  const { toast } = useToast();
  const { mutateAsync: changePassword, isPending } = useChangePassword();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const submit = async () => {
    if (next.length < 8) {
      toast({ title: "新密碼至少 8 碼", variant: "destructive" });
      return;
    }
    if (next !== confirm) {
      toast({ title: "兩次輸入的新密碼不一致", variant: "destructive" });
      return;
    }
    try {
      await changePassword({ data: { currentPassword: current, newPassword: next } });
      toast({ title: "密碼已更新" });
      reset();
      setOpen(false);
    } catch (err) {
      const e = err as { data?: { error?: string }; response?: { data?: { error?: string } } };
      toast({ title: e?.data?.error || e?.response?.data?.error || "變更失敗", variant: "destructive" });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center p-4 text-left transition-colors hover:bg-slate-50"
          data-testid="button-open-change-password"
        >
          <div className="mr-3 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <KeyRound size={16} />
          </div>
          <span className="flex-1 font-bold text-gray-800">變更密碼</span>
          <span className="text-gray-300">›</span>
        </button>
      </DialogTrigger>
      <DialogContent className="w-[90vw] max-w-[400px] rounded-2xl">
        <DialogHeader>
          <DialogTitle>變更密碼</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="pw-current">目前的密碼</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="input-pw-current" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-new">新密碼（至少 8 碼）</Label>
            <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} data-testid="input-pw-new" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-confirm">再輸入一次新密碼</Label>
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="input-pw-confirm" />
          </div>
          <Button className="w-full" onClick={submit} disabled={isPending || !current || !next || !confirm} data-testid="button-pw-submit">
            {isPending ? "更新中..." : "更新密碼"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
