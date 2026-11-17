import { useState, createContext, useContext, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Sidebar, TopBar } from "./sidebar";
import { BottomNav } from "./bottom-nav";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { useDemoMode } from "@/hooks/use-demo-mode";
import { useMobileTableCards } from "@/hooks/use-mobile-table-cards";
import { usePagePermissions } from "@/hooks/use-page-permissions";
import { RefreshCw } from "lucide-react";

interface LayoutContextValue {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
}

const LayoutContext = createContext<LayoutContextValue>({ sidebarCollapsed: false, setSidebarCollapsed: () => {} });

export function useLayout() { return useContext(LayoutContext); }

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const { pullDistance, refreshing, triggered } = usePullToRefresh(mainRef);
  const demoMode = useDemoMode();
  useMobileTableCards();
  // 沒有權限的動作，按鈕直接不顯示（樣式在 index.css 的「依權限隱藏按鈕」）
  const permissions = usePagePermissions();
  const [location] = useLocation();
  const pageRef = useRef<HTMLDivElement | null>(null);

  // 換頁時回到頁面頂端，手機上再加一個很短的滑入效果（系統設定「減少動態效果」時不播）
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
    const el = pageRef.current;
    if (!el || typeof el.animate !== "function") return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }],
      { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  }, [location]);

  return (
    <LayoutContext.Provider value={{ sidebarCollapsed, setSidebarCollapsed }}>
      <div className="flex flex-col h-[100dvh] bg-background overflow-hidden overscroll-none" data-testid="app-layout">
        {demoMode && (
          <div className="shrink-0 bg-amber-500 text-white text-center text-xs md:text-sm font-medium py-1.5 px-3 pt-[max(0.375rem,env(safe-area-inset-top))]">
            展示環境 — 所有資料皆為虛構，每日凌晨自動重置
          </div>
        )}
        <div className="flex flex-1 overflow-hidden">
        {/* Desktop Sidebar */}
        <div className="hidden md:block" data-print-hide>
          {!sidebarCollapsed && (
            <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          )}
        </div>
        
        <div className="flex-1 flex flex-col h-full overflow-hidden w-full">
          <TopBar onMenuClick={() => sidebarCollapsed ? setSidebarCollapsed(false) : setSidebarOpen(true)} />
          <main ref={mainRef} data-no-create={permissions.create ? undefined : ""} data-no-edit={permissions.edit ? undefined : ""} data-no-delete={permissions.delete ? undefined : ""} className="relative flex-1 overflow-y-auto p-4 md:p-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-6 overscroll-y-contain md:overscroll-y-auto animate-in fade-in duration-300" data-testid="main-content">
            {/* 手機版下拉更新指示器 */}
            <div
              className="md:hidden flex items-center justify-center overflow-hidden transition-[height] duration-150"
              style={{ height: pullDistance > 0 ? pullDistance : 0, marginTop: pullDistance > 0 ? -8 : 0 }}
              aria-hidden={pullDistance <= 0}
            >
              <div className={`w-9 h-9 rounded-full bg-card border border-border shadow-sm flex items-center justify-center ${refreshing ? "" : "transition-transform"}`}>
                <RefreshCw
                  size={18}
                  className={`${refreshing ? "animate-spin text-primary" : triggered ? "text-primary" : "text-muted-foreground"}`}
                  style={refreshing ? undefined : { transform: `rotate(${pullDistance * 3}deg)` }}
                />
              </div>
            </div>
            <div ref={pageRef}>{children}</div>
          </main>
        </div>
        
          {/* Mobile Bottom Nav */}
          <BottomNav />
        </div>
      </div>
    </LayoutContext.Provider>
  );
}
