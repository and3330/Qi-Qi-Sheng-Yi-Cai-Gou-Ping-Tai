import React from 'react';
import { ShieldX, Home, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function LoginRequired() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 font-sans text-foreground">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="mx-auto w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center text-primary border border-primary/20 shadow-sm">
          <ShieldX className="w-12 h-12" />
        </div>
        
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight">需要 ERP 權限</h1>
          <p className="text-muted-foreground">
            您尚未登入，或是您的帳號目前尚未具備七期生醫 ERP 系統的存取權限。
            請先登入具備權限的帳號。
          </p>
        </div>

        <div className="flex flex-col gap-3 pt-4">
          <a href="/sign-in" className="w-full">
            <Button size="lg" className="w-full font-medium h-12 bg-primary hover:bg-primary/90">
              <LogIn className="w-4 h-4 mr-2" />
              前往商城登入
            </Button>
          </a>
          <a href="/" className="w-full">
            <Button size="lg" variant="outline" className="w-full font-medium h-12">
              <Home className="w-4 h-4 mr-2" />
              回到商城首頁
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}
