import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "wouter";
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { clearTokenFromUrl, PASSWORD_POLICY_TEXT, passwordValidationMessage, readTokenFromFragment, recoveryRequest } from "@/lib/recovery";
import { RecoveryLayout } from "./recovery-layout";

type ResetForm = { password: string; confirmation: string };

export default function ResetPasswordPage() {
  const [token] = useState(() => readTokenFromFragment());
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ResetForm>({ defaultValues: { password: "", confirmation: "" } });

  useEffect(() => {
    clearTokenFromUrl();
  }, []);

  const submit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await recoveryRequest("reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      form.reset();
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重設失敗，請稍後再試");
    }
  });

  if (success) {
    return (
      <RecoveryLayout title="密碼已更新" description="您的密碼已成功重設，請使用新密碼登入。">
        <div className="space-y-5 text-center" role="status" data-testid="status-reset-success">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <Link href="/login" className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground" data-testid="link-login-after-reset">
            返回登入
          </Link>
        </div>
      </RecoveryLayout>
    );
  }

  return (
    <RecoveryLayout title="設定新密碼" description={`新密碼需${PASSWORD_POLICY_TEXT}。`}>
      {!token ? (
        <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive" role="alert" data-testid="status-reset-invalid-token">
          此重設連結無效或缺少驗證資訊，請重新申請密碼重設信。
        </p>
      ) : (
        <Form {...form}>
          <form onSubmit={submit} className="space-y-5">
            <PasswordField
              name="password"
              label="新密碼"
              visible={showPassword}
              onToggle={() => setShowPassword(value => !value)}
              form={form}
              testId="new-password"
              rules={{
                required: "請輸入新密碼",
                validate: value => passwordValidationMessage(value) ?? true,
              }}
            />
            <PasswordField
              name="confirmation"
              label="確認新密碼"
              visible={showConfirmation}
              onToggle={() => setShowConfirmation(value => !value)}
              form={form}
              testId="confirm-password"
              rules={{
                required: "請再次輸入新密碼",
                validate: value => value === form.getValues("password") || "兩次輸入的密碼不一致",
              }}
            />
            {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="status-reset-error">{error}</p>}
            <Button className="w-full" type="submit" disabled={form.formState.isSubmitting} data-testid="button-reset-password">
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              更新密碼
            </Button>
          </form>
        </Form>
      )}
    </RecoveryLayout>
  );
}

function PasswordField({
  name,
  label,
  visible,
  onToggle,
  form,
  testId,
  rules,
}: {
  name: keyof ResetForm;
  label: string;
  visible: boolean;
  onToggle: () => void;
  form: ReturnType<typeof useForm<ResetForm>>;
  testId: string;
  rules: { required: string; validate: (value: string) => string | true };
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      rules={rules}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="relative">
            <FormControl>
              <Input {...field} type={visible ? "text" : "password"} autoComplete="new-password" className="pr-11" data-testid={`input-${testId}`} />
            </FormControl>
            <button type="button" onClick={onToggle} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground" aria-label={visible ? `隱藏${label}` : `顯示${label}`} data-testid={`button-toggle-${testId}`}>
              {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}