import { useState } from "react";
import { useForm } from "react-hook-form";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { recoveryRequest } from "@/lib/recovery";
import { RecoveryLayout } from "./recovery-layout";
import { COMPANY_CODE_ERROR, isValidCompanyCode, normalizeCompanyCode } from "@/lib/company-code";

type ForgotForm = { companyCode: string; username: string };

export default function ForgotPasswordPage() {
  const form = useForm<ForgotForm>({ defaultValues: { companyCode: "", username: "" } });
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = form.handleSubmit(async ({ companyCode, username }) => {
    setError(null);
    try {
      await recoveryRequest("forgot-password", {
        method: "POST",
        body: JSON.stringify({ companyCode: normalizeCompanyCode(companyCode), username: username.trim() }),
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "請求失敗，請稍後再試");
    }
  });

  return (
    <RecoveryLayout title="忘記密碼" description="輸入公司編碼與登入帳號，以確認您所屬的公司。我們會將重設連結寄到已驗證的救援信箱。">
      {success ? (
        <div className="rounded-lg bg-emerald-50 p-4 text-sm leading-6 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" role="status" data-testid="status-forgot-success">
          <MailCheck className="mb-2 h-5 w-5" aria-hidden="true" />
          如果此公司中的帳號存在且已設定救援信箱，我們已寄出密碼重設信。請查看收件匣與垃圾郵件。
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={submit} className="space-y-5">
            <FormField
              control={form.control}
              name="companyCode"
              rules={{
                required: "請輸入公司編碼（統編）",
                validate: value => isValidCompanyCode(value) || COMPANY_CODE_ERROR,
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>公司編碼（統編）</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoFocus
                      inputMode="numeric"
                      maxLength={8}
                      autoComplete="organization"
                      aria-describedby="forgot-company-code-hint"
                      data-testid="input-forgot-company-code"
                    />
                  </FormControl>
                  <p id="forgot-company-code-hint" className="text-xs text-muted-foreground">請輸入 8 位半形數字，以辨識帳號所屬公司。</p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="username"
              rules={{ required: "請輸入帳號" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>登入帳號</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="username" data-testid="input-forgot-username" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="status-forgot-error">{error}</p>}
            <Button className="w-full" type="submit" disabled={form.formState.isSubmitting} data-testid="button-send-reset">
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              寄送重設連結
            </Button>
          </form>
        </Form>
      )}
    </RecoveryLayout>
  );
}