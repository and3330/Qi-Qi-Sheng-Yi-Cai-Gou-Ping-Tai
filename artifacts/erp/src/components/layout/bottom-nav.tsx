import { Link, useLocation } from "wouter";
import { LayoutDashboard, Clock, ClipboardCheck, Bell, Menu, User, CalendarOff } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ROLE_EMPLOYEE } from "@/lib/roles";
import { useState, useEffect } from "react";
import { MobileMoreMenu } from "./mobile-more-menu";
import { defaultRolesForPath } from "./sidebar";
import { useMenuAllowed } from "@/hooks/use-menu-allowed";

export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();
  const isEmployee = user?.role === ROLE_EMPLOYEE;
  const { allowed } = useMenuAllowed();
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  
  const [notifCount, setNotifCount] = useState(0);

  useEffect(() => {
    if (isEmployee) return;
    const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
    const fetchNotifications = () => fetch(`/erp-api/notifications?limit=1`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { unreadCount: 0 })
      .then(d => setNotifCount(d.unreadCount || 0))
      .catch(() => {});
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [isEmployee]);

  const isActive = (path: string) => {
    if (path === "/") return location === "/";
    return location.startsWith(path);
  };

  const navItems = isEmployee 
    ? [
        { label: "打卡", icon: Clock, path: "/hr/clock-in" },
        { label: "請假", icon: CalendarOff, path: "/hr/leaves" },
        { label: "我的", icon: User, path: "/hr/me" },
        { label: "更多", icon: Menu, action: () => setMoreMenuOpen(true) }
      ]
    : ([
        { label: "首頁", icon: LayoutDashboard, path: "/" },
        { label: "打卡", icon: Clock, path: "/hr/clock-in" },
        { label: "審批", icon: ClipboardCheck, path: "/system/approval-requests" },
        { label: "通知", icon: Bell, path: "/system/notifications", badge: notifCount },
      ] as { label: string; icon: typeof Menu; path?: string; badge?: number; action?: () => void }[])
        // 與側邊欄相同的選單權限過濾
        .filter((item) => !item.path || allowed(item.path, defaultRolesForPath(item.path)))
        .concat([{ label: "更多", icon: Menu, action: () => setMoreMenuOpen(true) }]);

  const isAnyTabActive = navItems.some(i => i.path && isActive(i.path));

  return (
    <>
      <nav aria-label="主要功能" className="md:hidden fixed bottom-0 left-0 right-0 h-[calc(60px+env(safe-area-inset-bottom))] bg-card/90 backdrop-blur-lg border-t border-border flex items-stretch justify-around px-1 pb-[env(safe-area-inset-bottom)] z-50 select-none">
        {navItems.map((item) => {
          let active = false;
          if (item.path) {
            active = isActive(item.path);
          } else {
            active = moreMenuOpen || (!isAnyTabActive && !moreMenuOpen);
          }
          
          const content = (
            <div className={`flex flex-col items-center justify-center w-full h-full gap-0.5 transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}>
              <div className={`relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200 ${active ? "bg-primary/12" : ""}`}>
                <item.icon size={22} strokeWidth={active ? 2.4 : 2} aria-hidden />
                {item.badge ? (
                  <span className="absolute top-0 right-1.5 bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none border border-background">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                ) : null}
              </div>
              <span className={`text-[11px] leading-none ${active ? "font-semibold" : "font-medium"}`}>{item.label}</span>
            </div>
          );

          if (item.action) {
            return (
              <button key={item.label} onClick={item.action} aria-label={item.label} className="flex-1 h-full active:opacity-60 transition-opacity touch-manipulation">
                {content}
              </button>
            );
          }

          return (
            <Link key={item.label} href={item.path!} aria-current={active ? "page" : undefined} className="flex-1 h-full active:opacity-60 transition-opacity touch-manipulation">
              {content}
            </Link>
          );
        })}
      </nav>
      <MobileMoreMenu isOpen={moreMenuOpen} onClose={() => setMoreMenuOpen(false)} />
    </>
  );
}
