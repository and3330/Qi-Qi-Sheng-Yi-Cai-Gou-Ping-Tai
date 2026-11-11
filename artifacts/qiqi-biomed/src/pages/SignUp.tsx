import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useRegister, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, User, Lock, AlertCircle, Phone, CreditCard } from "lucide-react";

export default function SignUpPage() {
  const [, setLocation] = useLocation();
  const { mutateAsync: register, isPending } = useRegister();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const searchParams = new URLSearchParams(window.location.search);
  const typeParam = searchParams.get("type");
  const tier = typeParam === "hospital" ? "hospital" : typeParam === "clinic" ? "clinic" : "consumer";

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || username.length < 3) {
      setErrorMsg("帳號需至少 3 字元");
      return;
    }
    if (!password || password.length < 8) {
      setErrorMsg("密碼需至少 8 碼");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("兩次密碼輸入不一致");
      return;
    }
    if (!name) {
      setErrorMsg("請輸入姓名");
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMsg("Email 格式不正確");
      return;
    }
    
    setErrorMsg("");
    try {
      await register({ data: { username, password, name, phone, email: email.trim() || null, tier: tier as any } });
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast(
        tier === "consumer"
          ? { title: "註冊成功" }
          : { title: "註冊成功，身份審核中", description: "審核通過前會先顯示一般價格，通過後自動切換為專屬價格。" },
      );
      setLocation("/");
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || "註冊失敗，請確認資料格式");
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        {/* Header */}
        <div className="bg-primary/5 p-6 border-b border-primary/10 relative">
          <Link href="/sign-in" className="absolute left-4 top-6 text-gray-500 hover:text-primary transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center overflow-hidden shadow-sm mb-3">
              <img src="/images/brand/logo-mark.png" alt="七期生醫" className="w-full h-full object-cover" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">
              {tier === "hospital" ? "醫院院所會員註冊" : tier === "clinic" ? "診所/藥局會員註冊" : "建立帳號"}
            </h1>
            <p className="text-sm text-gray-500 mt-1">立即註冊，體驗專業醫療採購服務</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleRegister} className="p-6 space-y-4">
          {errorMsg && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-xl flex items-center gap-2">
              <AlertCircle size={16} />
              {errorMsg}
            </div>
          )}
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">帳號 <span className="text-destructive">*</span></label>
            <div className="relative">
              <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <Input 
                type="text" 
                placeholder="3-30 字元英數" 
                className="pl-10 h-11 rounded-xl"
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">密碼 <span className="text-destructive">*</span></label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <Input 
                type="password" 
                placeholder="至少 8 碼" 
                className="pl-10 h-11 rounded-xl"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">確認密碼 <span className="text-destructive">*</span></label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <Input 
                type="password" 
                placeholder="請再次輸入密碼" 
                className="pl-10 h-11 rounded-xl"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">姓名 <span className="text-destructive">*</span></label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <Input 
                type="text" 
                placeholder="真實姓名" 
                className="pl-10 h-11 rounded-xl"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">聯絡電話</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <Input 
                type="tel" 
                placeholder="選填" 
                className="pl-10 h-11 rounded-xl"
                value={phone}
                onChange={e => setPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="signup-email" className="text-sm font-medium text-gray-700">Email</label>
            <Input
              id="signup-email"
              type="email"
              autoComplete="email"
              placeholder="選填，忘記密碼時用來收重設信"
              className="h-11 rounded-xl"
              value={email}
              onChange={e => setEmail(e.target.value)}
              data-testid="input-signup-email"
            />
          </div>

          {tier !== "consumer" && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800" data-testid="text-signup-tier-note">
              {tier === "hospital" ? "醫院院所" : "診所／藥局"}身份需要平台審核。審核通過前會先顯示一般價格，通過後自動切換為專屬價格。
            </p>
          )}
          
          <Button 
            type="submit" 
            className="w-full h-12 rounded-xl text-base font-bold mt-4" 
            disabled={isPending}
          >
            {isPending ? "註冊中..." : "註冊"}
          </Button>
          
          <div className="relative mt-6 mb-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-gray-400">社群登入</span>
            </div>
          </div>
          
          <div className="flex flex-col gap-3">
            <Button variant="outline" type="button" disabled className="h-11 rounded-xl text-gray-400 border-gray-200 cursor-not-allowed">
              使用 LINE 登入
            </Button>
            <p className="text-center text-[10px] text-gray-400">LINE / Google 快速登入即將推出</p>
          </div>
        </form>

        <div className="bg-gray-50 p-4 text-center border-t border-gray-100">
          <span className="text-sm text-gray-500">已經有帳號了嗎？ </span>
          <Link href="/sign-in" className="text-sm font-bold text-primary hover:underline">
            登入
          </Link>
        </div>
      </div>
    </div>
  );
}