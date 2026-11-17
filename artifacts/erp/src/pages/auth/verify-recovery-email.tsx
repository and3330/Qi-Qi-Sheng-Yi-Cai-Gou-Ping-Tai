import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearTokenFromUrl, readTokenFromFragment, recoveryRequest } from "@/lib/recovery";
import { RecoveryLayout } from "./recovery-layout";

export default function VerifyRecoveryEmailPage() {
  const [token] = useState(() => readTokenFromFragment());
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    clearTokenFromUrl();
  }, []);

  const verify = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await recoveryRequest("verify-recovery-email", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "驗證失敗，請稍後再試");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <RecoveryLayout title="驗證救援信箱" description="為避免郵件掃描器誤觸連結，請由您親自按下按鈕完成驗證。">
      {success ? (
        <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" role="status" data-testid="status-verification-success">
          <CheckCircle2 className="mb-2 h-6 w-6" />
          救援信箱已驗證完成，之後可用於密碼重設。
        </div>
      ) : (
        <div className="space-y-4">
          {!token && (
            <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="status-verification-missing">
              此驗證連結無效或缺少驗證資訊。
            </p>
          )}
          {error && (
            <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="status-verification-error">
              {error}。連結可能已過期，請登入後重新設定救援信箱。
            </p>
          )}
          <Button className="w-full" onClick={verify} disabled={!token || submitting} data-testid="button-confirm-recovery-email">
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            確認驗證信箱
          </Button>
        </div>
      )}
    </RecoveryLayout>
  );
}