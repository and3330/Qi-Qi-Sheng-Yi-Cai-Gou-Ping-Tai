import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Sparkles } from "lucide-react";
import { companyCodeValidationMessage, normalizeCompanyCode } from "@/lib/company-code";

export default function SignupPage() {
  const { user, loading, refresh } = useAuth();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({ companyName: "", companyCode: "", contactEmail: "", username: "", password: "", password2: "" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (!loading && user) navigate("/"); }, [user, loading, navigate]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const companyCodeError = companyCodeValidationMessage(form.companyCode);
    if (companyCodeError) { setError(companyCodeError); return; }
    if (form.password !== form.password2) { setError("兩次密碼不一致"); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/erp-api/public/signup`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.companyName, companyCode: normalizeCompanyCode(form.companyCode), contactEmail: form.contactEmail,
          username: form.username, password: form.password, displayName: form.companyName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "註冊失敗，請稍後再試"); return; }
      await refresh();
      navigate("/");
    } catch {
      setError("網路錯誤，請稍後再試");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background md:bg-muted/30 p-4 md:p-8 pt-safe-top pb-safe">
      <div className="w-full max-w-sm flex-1 flex flex-col justify-center">
        <div className="mb-8 flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
            <Sparkles className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-center">首次設定 七期生醫 ERP</h1>
          <div className="text-center text-sm text-muted-foreground mt-2">
            建立公司資料與第一個管理員帳號（只需要做一次）
          </div>
        </div>

        <Card className="border-0 shadow-none bg-transparent md:border md:shadow-sm md:bg-card">
          <CardContent className="p-0 md:p-6">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="companyName">公司名稱</Label>
                <Input id="companyName" value={form.companyName} onChange={set("companyName")} required autoFocus className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="companyCode">公司編碼（統編）</Label>
                <Input
                  id="companyCode"
                  value={form.companyCode}
                  onChange={set("companyCode")}
                  required
                  inputMode="numeric"
                  maxLength={8}
                  autoComplete="organization"
                  aria-describedby="signup-company-code-hint"
                  data-testid="input-signup-company-code"
                  className="h-11"
                />
                <p id="signup-company-code-hint" className="text-xs text-muted-foreground">8 位半形數字；若開頭為 0，請保留輸入。</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contactEmail">聯絡 Email</Label>
                <Input id="contactEmail" type="email" value={form.contactEmail} onChange={set("contactEmail")} required className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="username">登入帳號</Label>
                <Input id="username" value={form.username} onChange={set("username")} required autoComplete="username" placeholder="3-50 字元英數字" className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">密碼</Label>
                <Input id="password" type="password" value={form.password} onChange={set("password")} required autoComplete="new-password" placeholder="至少 6 字元" className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password2">確認密碼</Label>
                <Input id="password2" type="password" value={form.password2} onChange={set("password2")} required autoComplete="new-password" className="h-11" />
              </div>
              {error && <div className="text-sm text-destructive font-medium p-3 bg-destructive/10 rounded-lg" role="alert">{error}</div>}
              <Button type="submit" className="w-full h-11 text-base mt-2" disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                建立公司帳戶
              </Button>
              <div className="text-center text-sm text-muted-foreground">
                已有帳號？<a href="login" className="text-primary font-medium hover:underline">前往登入</a>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
