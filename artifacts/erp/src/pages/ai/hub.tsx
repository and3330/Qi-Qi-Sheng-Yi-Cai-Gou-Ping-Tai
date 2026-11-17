import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Sparkles } from "lucide-react";
import { topLevelNavs } from "@/components/layout/sidebar";
import { useMenuAllowed } from "@/hooks/use-menu-allowed";
import { useAuth } from "@/contexts/auth-context";
import { EMPLOYEE_ALLOWED_PATHS, ROLE_EMPLOYEE } from "@/lib/roles";
import { cn } from "@/lib/utils";

/**
 * AI 助理的統一入口：所有 AI 功能集中在同一頁，用上方的分頁切換。
 * 分頁清單沿用選單定義，所以選單權限與模組停用的設定在這裡同樣生效。
 */
const SHORT_LABELS: Record<string, { label: string; hint: string }> = {
  "/ai/chat": { label: "對話", hint: "直接說你要什麼，也可以傳收據照片報銷。會改到資料的動作，按確認後才執行" },
  "/ai/assistant": { label: "查詢與起草", hint: "用中文問營運數字，或拍照報銷、請 AI 起草單據" },
  "/ai/anomalies": { label: "異常偵測", hint: "找出金額或單據不尋常的地方" },
  "/ai/monthly-report": { label: "月報", hint: "自動撰寫當月營運報告" },
  "/ai/document-ocr": { label: "文件辨識", hint: "上傳文件，讀出裡面的內容" },
  "/ai/complaint-classify": { label: "客訴分類", hint: "把客訴內容分類並給處理建議" },
  "/ai/product-description": { label: "商品描述", hint: "幫品項產生描述文字" },
};

export default function AiHub({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { allowed } = useMenuAllowed();
  const { user } = useAuth();
  const group = topLevelNavs.find((nav) => nav.singleEntry);
  // 員工自助帳號只看得到自己能用的分頁，不會出現點了進不去的分頁
  const employeePaths: readonly string[] = EMPLOYEE_ALLOWED_PATHS;
  const tabs = (group?.children ?? [])
    .filter((child) => allowed(child.path, child.roles))
    .filter((child) => user?.role !== ROLE_EMPLOYEE || (!!child.path && employeePaths.includes(child.path)));
  const current = tabs.find((tab) => location === tab.path || location.startsWith(`${tab.path}/`));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-3">
        <div className="mb-2 flex items-center gap-2 px-1">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">AI 助理</h1>
          {current && <span className="hidden text-sm text-muted-foreground sm:inline">{SHORT_LABELS[current.path]?.hint}</span>}
        </div>
        <nav className="flex gap-1 overflow-x-auto" aria-label="AI 功能">
          {tabs.map((tab) => {
            const active = tab.path === current?.path;
            return (
              <Link
                key={tab.path}
                href={tab.path}
                aria-current={active ? "page" : undefined}
                data-testid={`ai-tab-${tab.path.split("/").pop()}`}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {tab.icon}
                {SHORT_LABELS[tab.path]?.label ?? tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
