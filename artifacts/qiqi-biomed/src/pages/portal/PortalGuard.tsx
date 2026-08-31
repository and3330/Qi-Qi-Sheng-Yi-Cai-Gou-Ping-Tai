import { ReactNode } from "react";
import { Redirect, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PortalGuard({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, me } = useAuth();

  if (!isLoaded) {
    return <div className="flex h-screen items-center justify-center">載入中...</div>;
  }

  if (!isSignedIn) {
    return <Redirect to="/sign-in" />;
  }

  if (me?.tier !== "hospital" && me?.tier !== "clinic") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
        <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-4">
          <ShieldAlert size={32} />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">無權限存取</h1>
        <p className="text-sm text-gray-500 mb-6">此區域僅開放醫療院所與合作藥局專屬會員使用</p>
        <Link href="/">
          <Button className="h-11 rounded-xl px-6">
            <ArrowLeft className="mr-2" size={18} /> 返回首頁
          </Button>
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}