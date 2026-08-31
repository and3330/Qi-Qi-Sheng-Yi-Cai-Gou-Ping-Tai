import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLogin, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, User, Lock, AlertCircle } from "lucide-react";

export default function SignInPage() {
  const [, setLocation] = useLocation();
  const { mutateAsync: login, isPending } = useLogin();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setErrorMsg("請輸入帳號與密碼");
      return;
    }
    
    setErrorMsg("");
    try {
      await login({ data: { username, password } });
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast({ title: "登入成功" });
      setLocation("/");
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || "登入失敗，請檢查帳號密碼");
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-4 pb-20">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        {/* Header */}
        <div className="bg-primary/5 p-6 border-b border-primary/10 relative">
          <Link href="/" className="absolute left-4 top-6 text-gray-500 hover:text-primary transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-3">
              <img src="/logo.svg" alt="Logo" className="w-8 h-8 object-contain" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">歡迎回來</h1>
            <p className="text-sm text-gray-500 mt-1">登入以繼續使用七期生醫採購平台</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="p-6 space-y-4">
          {errorMsg && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-xl flex items-center gap-2">
              <AlertCircle size={16} />
              {errorMsg}
            </div>
          )}
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">帳號</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <Input 
                type="text" 
                placeholder="請輸入帳號" 
                className="pl-10 h-12 rounded-xl"
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">密碼</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <Input 
                type="password" 
                placeholder="請輸入密碼" 
                className="pl-10 h-12 rounded-xl"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>
          
          <Button 
            type="submit" 
            className="w-full h-12 rounded-xl text-base font-bold mt-2" 
            disabled={isPending}
          >
            {isPending ? "登入中..." : "登入"}
          </Button>

          <div className="relative mt-8 mb-6">
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
            <Button variant="outline" type="button" disabled className="h-11 rounded-xl text-gray-400 border-gray-200 cursor-not-allowed">
              使用 Google 登入
            </Button>
            <p className="text-center text-[10px] text-gray-400">LINE / Google 快速登入即將推出</p>
          </div>
        </form>

        <div className="bg-gray-50 p-4 text-center border-t border-gray-100">
          <span className="text-sm text-gray-500">還沒有帳號嗎？ </span>
          <Link href="/sign-up" className="text-sm font-bold text-primary hover:underline">
            立即註冊
          </Link>
        </div>
      </div>
    </div>
  );
}