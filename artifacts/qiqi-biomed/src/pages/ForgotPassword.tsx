import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useForgotPassword, useResetPassword } from "@workspace/api-client-react";
import { ArrowLeft, AlertCircle, CheckCircle2, Lock, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function errorText(err: unknown, fallback: string) {
  const e = err as { data?: { error?: string }; response?: { data?: { error?: string } } };
  return e?.data?.error || e?.response?.data?.error || fallback;
}

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-lg">
        <div className="relative border-b border-primary/10 bg-primary/5 p-6">
          <Link href="/sign-in" className="absolute left-4 top-6 text-gray-500 transition-colors hover:text-primary" aria-label="回到登入">
            <ArrowLeft size={20} />
          </Link>
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900">{title}</h1>
            <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
          </div>
        </div>
        <div className="space-y-4 p-6">{children}</div>
      </div>
    </div>
  );
}

/** 忘記密碼：輸入帳號，系統把重設連結寄到該帳號設定的 Email。 */
export function ForgotPasswordPage() {
  const { mutateAsync: forgot, isPending } = useForgotPassword();
  const [username, setUsername] = useState("");
  const [sentMessage, setSentMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setErrorMsg("請輸入帳號");
      return;
    }
    setErrorMsg("");
    try {
      const result = await forgot({ data: { username: username.trim() } });
      setSentMessage(result.message || "若此帳號有設定 Email，重設密碼的連結已寄出。");
    } catch (err) {
      setErrorMsg(errorText(err, "送出失敗，請稍後再試"));
    }
  };

  if (sentMessage) {
    return (
      <Shell title="請查看信箱" subtitle="重設連結 30 分鐘內有效">
        <div className="flex gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800" data-testid="text-forgot-sent">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <p>{sentMessage}</p>
        </div>
        <p className="text-xs text-gray-500">
          帳號沒有設定 Email 的話收不到信，請聯繫客服協助重設密碼。
        </p>
        <Button asChild className="h-12 w-full rounded-xl">
          <Link href="/sign-in">回到登入</Link>
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title="忘記密碼" subtitle="輸入帳號，我們會把重設連結寄到您設定的 Email">
      <form onSubmit={submit} className="space-y-4">
        {errorMsg && (
          <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle size={16} />
            {errorMsg}
          </div>
        )}
        <div className="space-y-2">
          <label htmlFor="forgot-username" className="text-sm font-medium text-gray-700">帳號</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <Input
              id="forgot-username"
              autoComplete="username"
              placeholder="請輸入帳號"
              className="h-12 rounded-xl pl-10"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              data-testid="input-forgot-username"
            />
          </div>
        </div>
        <Button type="submit" className="h-12 w-full rounded-xl text-base font-bold" disabled={isPending} data-testid="button-forgot-submit">
          {isPending ? "送出中..." : "寄出重設連結"}
        </Button>
      </form>
    </Shell>
  );
}

/** 從信裡的連結進來，設定新密碼。 */
export function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const { mutateAsync: reset, isPending } = useResetPassword();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setErrorMsg("新密碼至少 8 碼");
      return;
    }
    if (password !== confirm) {
      setErrorMsg("兩次密碼輸入不一致");
      return;
    }
    setErrorMsg("");
    try {
      await reset({ data: { token, newPassword: password } });
      setDone(true);
    } catch (err) {
      setErrorMsg(errorText(err, "重設失敗，請重新申請"));
    }
  };

  if (!token) {
    return (
      <Shell title="連結無效" subtitle="請重新申請重設密碼">
        <Button asChild className="h-12 w-full rounded-xl">
          <Link href="/forgot-password">重新申請</Link>
        </Button>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell title="密碼已更新" subtitle="請用新密碼登入">
        <Button className="h-12 w-full rounded-xl" onClick={() => setLocation("/sign-in")} data-testid="button-reset-go-signin">
          前往登入
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title="設定新密碼" subtitle="密碼至少 8 碼">
      <form onSubmit={submit} className="space-y-4">
        {errorMsg && (
          <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle size={16} />
            {errorMsg}
          </div>
        )}
        {[
          { id: "reset-new", label: "新密碼", value: password, set: setPassword },
          { id: "reset-confirm", label: "再輸入一次", value: confirm, set: setConfirm },
        ].map((f) => (
          <div key={f.id} className="space-y-2">
            <label htmlFor={f.id} className="text-sm font-medium text-gray-700">{f.label}</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <Input
                id={f.id}
                type="password"
                autoComplete="new-password"
                className="h-12 rounded-xl pl-10"
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
                data-testid={`input-${f.id}`}
              />
            </div>
          </div>
        ))}
        <Button type="submit" className="h-12 w-full rounded-xl text-base font-bold" disabled={isPending} data-testid="button-reset-submit">
          {isPending ? "更新中..." : "更新密碼"}
        </Button>
      </form>
    </Shell>
  );
}
