import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  HandCoins,
  Wallet,
  Building2,
  Users,
  Menu,
  X,
  ArrowLeft,
  Briefcase,
  ShieldCheck,
  FileText,
  Bot,
  Headphones,
  ChevronDown,
  Link2,
  Share2,
  Megaphone,
  Send,
  Mail,
  Workflow,
  Globe,
  BrainCircuit,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export type AdminNavItem = {
  name: string;
  path: string;
  icon: typeof LayoutDashboard;
  roles?: string[]; // undefined = admin/ops/support 皆可見
};

export type AdminNavGroup = {
  title: string;
  items: AdminNavItem[];
};

export const adminNavGroups: AdminNavGroup[] = [
  {
    title: "總覽",
    items: [
      { name: "儀表板", path: "/admin", icon: LayoutDashboard },
      { name: "AI 助理", path: "/admin/ai-assistant", icon: Bot, roles: ["admin", "ops"] },
      { name: "AI CMO", path: "/admin/ai-cmo", icon: BrainCircuit, roles: ["admin"] },
    ],
  },
  {
    title: "商品管理",
    items: [{ name: "商品管理", path: "/admin/products", icon: Package, roles: ["admin", "ops"] }],
  },
  {
    title: "訂單與客服",
    items: [
      { name: "訂單管理", path: "/admin/orders", icon: ClipboardList },
      { name: "客服對話", path: "/admin/support", icon: Headphones },
    ],
  },
  {
    title: "財務與分潤",
    items: [
      { name: "佣金報表", path: "/admin/commissions", icon: HandCoins, roles: ["admin"] },
      { name: "利潤分享", path: "/admin/profit-sharing", icon: HandCoins, roles: ["admin"] },
      { name: "機構錢包", path: "/admin/institution-wallets", icon: Building2, roles: ["admin"] },
      { name: "會員錢包", path: "/admin/wallets", icon: Wallet, roles: ["admin"] },
    ],
  },
  {
    title: "社群行銷",
    items: [
      { name: "社群帳號", path: "/admin/social-accounts", icon: Share2, roles: ["admin", "ops"] },
      { name: "社群貼文", path: "/admin/social-posts", icon: Megaphone, roles: ["admin", "ops"] },
    ],
  },
  {
    title: "電子報",
    items: [
      { name: "郵件活動", path: "/admin/newsletter/campaigns", icon: Send },
      { name: "訂閱者", path: "/admin/newsletter/subscribers", icon: Mail },
      { name: "自動序列", path: "/admin/newsletter/sequences", icon: Workflow },
      { name: "域名與金鑰", path: "/admin/newsletter/domains", icon: Globe, roles: ["admin", "ops"] },
    ],
  },
  {
    title: "內容與會員",
    items: [
      { name: "內容管理", path: "/admin/content", icon: FileText, roles: ["admin", "ops"] },
      { name: "使用者管理", path: "/admin/members", icon: Users },
      { name: "機構主檔", path: "/admin/institutions", icon: Building2, roles: ["admin", "ops"] },
      { name: "Linktree 管理", path: "/admin/linktree", icon: Link2 },
    ],
  },
];

/** 相容用途：攤平的選單清單 */
export const adminNavItems: AdminNavItem[] = adminNavGroups.flatMap((g) => g.items);

function isItemActive(location: string, path: string) {
  return path === "/admin" ? location === "/admin" : location.startsWith(path);
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const { me } = useAuth();
  const role = me?.role as string;

  const visibleGroups = adminNavGroups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => !item.roles || item.roles.includes(role)),
    }))
    .filter((g) => g.items.length > 0);

  // 預設展開「目前頁面所在」的群組，其餘收合；使用者可自行切換
  const activeTitle = visibleGroups.find((g) =>
    g.items.some((item) => isItemActive(location, item.path)),
  )?.title;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (activeTitle) setOpenGroups((prev) => ({ ...prev, [activeTitle]: true }));
  }, [activeTitle]);

  return (
    <nav className="flex flex-col gap-1 px-3">
      {visibleGroups.map((group) => {
        const hasActive = group.items.some((item) => isItemActive(location, item.path));
        const open = openGroups[group.title] ?? hasActive;
        return (
          <div key={group.title} className="mb-1">
            <button
              type="button"
              onClick={() => setOpenGroups((prev) => ({ ...prev, [group.title]: !open }))}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/60"
              data-testid={`button-admin-navgroup-${group.title}`}
            >
              {group.title}
              <ChevronDown
                size={14}
                className={`transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
            {open && (
              <div className="mt-0.5 flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = isItemActive(location, item.path);
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
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** 具 ERP 權限（erpRole 有值，或平台 admin 視同 super_admin）才顯示「進入ERP」 */
function ErpEntryLink() {
  const { me } = useAuth();
  const meAny = me as (typeof me & { erpRole?: string | null }) | undefined;
  const canErp = !!meAny && (meAny.role === "admin" || !!meAny.erpRole);
  if (!canErp) return null;
  return (
    <a
      href="/erp/"
      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-primary/10 hover:text-foreground"
      data-testid="link-admin-enter-erp"
    >
      <Briefcase size={16} /> 進入ERP
    </a>
  );
}
function SidebarHeader() {
  return (
    <div className="flex items-center gap-2 px-6 py-5">
      <img
        src="/images/brand/logo-mark.png"
        alt="七期生醫"
        className="h-9 w-9 rounded-xl object-cover shadow-sm"
      />
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
          <ErpEntryLink />
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
              <ErpEntryLink />
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
