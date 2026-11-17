import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useDemoMode } from "@/hooks/use-demo-mode";
import { companyCodeValidationMessage, normalizeCompanyCode } from "@/lib/company-code";

export default function LoginPage() {
  const demoMode = useDemoMode();
  const { user, login, loading } = useAuth();
  const [, navigate] = useLocation();
  const [companyCode, setCompanyCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 七期網站只有一家公司：還沒建立時才顯示「首次設定」
  const [needsSetup, setNeedsSetup] = useState(false);
  // 公司已經建立：公司編碼自動帶入，登入只要輸入帳號密碼
  const [singleCompany, setSingleCompany] = useState(false);
  useEffect(() => {
    fetch("/erp-api/public/setup-state").then(r => r.ok ? r.json() : null).then(d => { setNeedsSetup(!!d?.needsSetup); if (d?.companyCode) { setCompanyCode(d.companyCode); setSingleCompany(true); } }).catch(() => {});
  }, []);

  useEffect(() => { if (!loading && user) navigate("/"); }, [user, loading, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const companyCodeError = companyCodeValidationMessage(companyCode);
    if (companyCodeError) {
      setError(companyCodeError);
      return;
    }
    setSubmitting(true);
    try {
      await login(normalizeCompanyCode(companyCode), username.trim(), password);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "登入失敗");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background md:bg-muted/30 p-4 md:p-8 pt-safe-top pb-safe">
      <div className="w-full max-w-sm flex-1 flex flex-col justify-center">
        <div className="mb-8 flex flex-col items-center">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="七期生醫" className="w-20 h-20 object-contain mb-6" />
          <h1 className="text-2xl md:text-xl font-bold text-center">七期生醫</h1>
          <div className="text-center text-sm text-muted-foreground mt-2">企業管理系統登入</div>
          {demoMode && (
            <div className="mt-4 w-full rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-sm text-center px-4 py-3">
              <div className="font-semibold mb-0.5">展示環境</div>
              <div>帳號 <span className="font-mono font-bold">test</span>／密碼 <span className="font-mono font-bold">test</span></div>
              <div className="text-xs mt-1 text-amber-700">公司編碼請依展示邀請資訊輸入</div>
              <div className="text-xs mt-1 text-amber-700">資料皆為虛構，每日凌晨自動重置</div>
            </div>
          )}
        </div>
        
        <Card className="border-0 shadow-none bg-transparent md:border md:shadow-sm md:bg-card">
          <CardContent className="p-0 md:p-6">
            <form onSubmit={submit} className="space-y-5">
              <div className={singleCompany ? "hidden" : "space-y-1.5"}>
                <Label htmlFor="companyCode" className="text-muted-foreground md:text-foreground">公司編碼（統編）</Label>
                <Input
                  id="companyCode"
                  value={companyCode}
                  onChange={e => setCompanyCode(e.target.value)}
                  autoFocus
                  required
                  inputMode="numeric"
                  maxLength={8}
                  autoComplete="organization"
                  aria-describedby="company-code-hint"
                  data-testid="input-company-code"
                  className="h-12 md:h-10 text-base rounded-xl md:rounded-md bg-muted/50 border-transparent focus-visible:bg-background focus-visible:border-primary"
                />
                <p id="company-code-hint" className="text-xs text-muted-foreground">請輸入 8 位半形數字，前方的 0 也需輸入。</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-muted-foreground md:text-foreground">帳號</Label>
                <Input id="username" value={username} onChange={e => setUsername(e.target.value)} required autoComplete="username" className="h-12 md:h-10 text-base rounded-xl md:rounded-md bg-muted/50 border-transparent focus-visible:bg-background focus-visible:border-primary" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-muted-foreground md:text-foreground">密碼</Label>
                  <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline" data-testid="link-forgot-password">忘記密碼？</Link>
                </div>
                <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" className="h-12 md:h-10 text-base rounded-xl md:rounded-md bg-muted/50 border-transparent focus-visible:bg-background focus-visible:border-primary" />
              </div>
              {error && <div className="text-sm text-destructive font-medium p-3 bg-destructive/10 rounded-lg" role="alert">{error}</div>}
              <Button type="submit" className="w-full h-12 md:h-10 text-base rounded-xl md:rounded-md shadow-md active:scale-95 transition-transform touch-manipulation mt-2" disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                登入系統
              </Button>
              {needsSetup && (
                <div className="text-center text-sm text-muted-foreground pt-1">
                  第一次使用？<Link href="/signup" className="text-primary font-medium hover:underline" data-testid="link-signup">建立公司與管理員帳號</Link>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
      <div className="text-xs text-muted-foreground/50 pb-4 text-center">
        &copy; {new Date().getFullYear()} 七期生醫
      </div>
    </div>
  );
}
