import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { CheckCircle2, Eye, EyeOff, Loader2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PASSWORD_POLICY_TEXT, passwordValidationMessage, recoveryRequest, type RecoveryEmailStatus } from "@/lib/recovery";

type PasswordForm = { currentPassword: string; password: string; confirmation: string };
type EmailForm = { email: string; currentPassword: string };

export default function AccountSecurityPage() {
  const [status, setStatus] = useState<RecoveryEmailStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState(false);
  const passwordForm = useForm<PasswordForm>({ defaultValues: { currentPassword: "", password: "", confirmation: "" } });
  const emailForm = useForm<EmailForm>({ defaultValues: { email: "", currentPassword: "" } });

  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try {
      const result = await recoveryRequest<RecoveryEmailStatus>("recovery-email");
      if (!result || (result.email !== null && typeof result.email !== "string") || typeof result.verified !== "boolean") {
        throw new Error("伺服器回傳的救援信箱狀態格式不正確");
      }
      setStatus(result);
      emailForm.setValue("email", result.email ?? "");
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "無法讀取救援信箱狀態");
    }
  }, [emailForm]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const updatePassword = passwordForm.handleSubmit(async values => {
    setPasswordError(null);
    setPasswordMessage(null);
    try {
      await recoveryRequest("me/change-password", {
        method: "POST",
        body: JSON.stringify({ oldPassword: values.currentPassword, newPassword: values.password }),
      });
      passwordForm.reset();
      setPasswordMessage("密碼已成功更新。");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "密碼更新失敗");
    }
  });

  const updateEmail = emailForm.handleSubmit(async values => {
    setEmailError(null);
    setEmailMessage(null);
    try {
      await recoveryRequest("recovery-email", {
        method: "POST",
        body: JSON.stringify({ email: values.email.trim(), currentPassword: values.currentPassword }),
      });
      emailForm.setValue("currentPassword", "");
      setStatus({ email: values.email.trim(), verified: false });
      setEmailMessage("驗證信已寄出。完成信中確認前，此信箱不會用於密碼重設。");
      await loadStatus();
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "救援信箱設定失敗");
    }
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-account-security-title">帳號與安全性</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理您自己的登入密碼與救援信箱。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="h-5 w-5 text-primary" />變更密碼</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...passwordForm}>
            <form onSubmit={updatePassword} className="space-y-4">
              <FormField
                control={passwordForm.control}
                name="currentPassword"
                rules={{ required: "請輸入目前密碼" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>目前密碼</FormLabel>
                    <FormControl><Input {...field} type={showPasswords ? "text" : "password"} autoComplete="current-password" data-testid="input-current-password" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passwordForm.control}
                name="password"
                rules={{ required: "請輸入新密碼", validate: value => passwordValidationMessage(value) ?? true }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>新密碼</FormLabel>
                    <FormControl><Input {...field} type={showPasswords ? "text" : "password"} autoComplete="new-password" data-testid="input-account-new-password" /></FormControl>
                    <FormDescription>{PASSWORD_POLICY_TEXT}。</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passwordForm.control}
                name="confirmation"
                rules={{
                  required: "請再次輸入新密碼",
                  validate: value => value === passwordForm.getValues("password") || "兩次輸入的密碼不一致",
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>確認新密碼</FormLabel>
                    <FormControl><Input {...field} type={showPasswords ? "text" : "password"} autoComplete="new-password" data-testid="input-account-confirm-password" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <button type="button" onClick={() => setShowPasswords(value => !value)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" data-testid="button-toggle-account-passwords">
                {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showPasswords ? "隱藏密碼" : "顯示密碼"}
              </button>
              {passwordError && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="status-password-error">{passwordError}</p>}
              {passwordMessage && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" role="status" data-testid="status-password-success">{passwordMessage}</p>}
              <Button type="submit" disabled={passwordForm.formState.isSubmitting} data-testid="button-change-password">
                {passwordForm.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                更新密碼
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Mail className="h-5 w-5 text-primary" />救援信箱</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">此信箱只綁定目前登入的帳號。忘記密碼時，重設連結會寄到已驗證的信箱。</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {!status && !statusError && <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="status-recovery-loading"><Loader2 className="h-4 w-4 animate-spin" />讀取狀態中…</div>}
          {statusError && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="status-recovery-load-error">
              {statusError}
              <button type="button" onClick={() => void loadStatus()} className="ml-2 font-medium underline" data-testid="button-retry-recovery-status">重試</button>
            </div>
          )}
          {status && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm" data-testid="status-recovery-email">
              <span className="font-medium">{status.email ?? "尚未設定"}</span>
              {status.email && (status.verified
                ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />已驗證</span>
                : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">等待驗證</span>)}
            </div>
          )}
          <Form {...emailForm}>
            <form onSubmit={updateEmail} className="space-y-4">
              <FormField
                control={emailForm.control}
                name="email"
                rules={{
                  required: "請輸入救援信箱",
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "請輸入有效的 Email" },
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>救援 Email</FormLabel>
                    <FormControl><Input {...field} type="email" autoComplete="email" data-testid="input-recovery-email" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={emailForm.control}
                name="currentPassword"
                rules={{ required: "請輸入目前密碼以確認身分" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>目前密碼</FormLabel>
                    <FormControl><Input {...field} type="password" autoComplete="current-password" data-testid="input-recovery-current-password" /></FormControl>
                    <FormDescription>為保護帳號，設定或更換信箱時需再次輸入密碼。</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {emailError && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="status-recovery-error">{emailError}</p>}
              {emailMessage && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" role="status" data-testid="status-recovery-success">{emailMessage}</p>}
              <Button type="submit" disabled={emailForm.formState.isSubmitting} data-testid="button-save-recovery-email">
                {emailForm.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                儲存並寄送驗證信
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}