import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Boxes,
  PackagePlus,
  Landmark,
  HandCoins,
  Wallet,
  Users,
  Menu,
  X,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";

export type AdminNavItem = {
  name: string;
  path: string;
  icon: typeof LayoutDashboard;
};

export const adminNavItems: AdminNavItem[] = [
  { name: "儀表板", path: "/admin", icon: LayoutDashboard },
  { name: "進銷存", path: "/admin/inventory", icon: Boxes },
  { name: "採購進貨", path: "/admin/purchasing", icon: PackagePlus },
  { name: "財務管理", path: "/admin/finance", icon: Landmark },
  { name: "利潤分享", path: "/admin/profit-sharing", icon: HandCoins },
  { name: "會員錢包", path: "/admin/wallets", icon: Wallet },
  { name: "使用者管理", path: "/admin/members", icon: Users },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  return (
    <nav className="flex flex-col gap-1 px-3">
      {adminNavItems.map((item) => {
        const isActive =
          item.path === "/admin"
            ? location === "/admin"
            : location.startsWith(item.path);
        const Icon = item.icon;
        return (
          <Link
            key={item.path}
            href={item.path}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-primary/10 hover:text-foreground"
            }`}
            data-testid={`link-admin-nav-${item.path.replace(/\//g, "-")}`}
          >
            <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarHeader() {
  return (
    <div className="flex items-center gap-2 px-6 py-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <ShieldCheck size={20} />
      </div>
      <div>
        <p className="text-sm font-bold leading-tight">七期生醫</p>
        <p className="text-xs text-muted-foreground">後台管理系統</p>
      </div>
    </div>
  );
}

export function AdminLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-[100dvh] bg-muted/40">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 flex-col border-r bg-white md:flex">
        <SidebarHeader />
        <div className="flex-1 overflow-y-auto py-2">
          <NavLinks />
        </div>
        <div className="border-t p-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-primary/10 hover:text-foreground"
            data-testid="link-admin-back-to-site"
          >
            <ArrowLeft size={16} /> 回前台商城
          </Link>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl animate-in slide-in-from-left">
            <div className="flex items-center justify-between pr-3">
              <SidebarHeader />
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
                data-testid="button-admin-close-menu"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="border-t p-3">
              <Link
                href="/"
                className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-primary/10"
              >
                <ArrowLeft size={16} /> 回前台商城
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-white px-4 md:px-6">
          <button
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted md:hidden"
            onClick={() => setMobileOpen(true)}
            data-testid="button-admin-open-menu"
          >
            <Menu size={20} />
          </button>
          <h1 className="text-base font-bold md:text-lg" data-testid="text-admin-page-title">
            {title}
          </h1>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
