import {
  ReactNode,
  useEffect,
  useState,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
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
  Cable,
  Coins,
  BookOpen,
  BookMarked,
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
      { name: "Bot 連線", path: "/admin/bot", icon: Cable, roles: ["admin", "ops"] },
      { name: "AI 點數", path: "/admin/ai-credits", icon: Coins, roles: ["admin", "ops"] },
      { name: "系統說明書", path: "/manual", icon: BookMarked },
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
      { name: "AI 知識庫", path: "/admin/ai-knowledge", icon: BookOpen, roles: ["admin", "ops"] },
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

function NavLinks({
  visibleGroups,
  onNavigate,
}: {
  visibleGroups: AdminNavGroup[];
  onNavigate?: () => void;
}) {
  const [location] = useLocation();

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
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/60 transition-colors"
              data-testid={`button-admin-navgroup-${group.title}`}
            >
              {group.title}
              <ChevronDown
                size={14}
                className={`transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
            {open && (
              <div className="mt-0.5 flex flex-col gap-0.5 animate-in fade-in slide-in-from-top-1 duration-200">
                {group.items.map((item) => {
                  const isActive = isItemActive(location, item.path);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.path}
                      href={item.path}
                      onClick={onNavigate}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
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

/** 具 ERP 權限（erpRole 有值，或平台 admin 視同 super_admin）才顯示「進入ERP」按鈕 */
function ErpEntryLink({ variant = "desktop" }: { variant?: "desktop" | "mobile" }) {
  const { me } = useAuth();
  const meAny = me as (typeof me & { erpRole?: string | null }) | undefined;
  const canErp = !!meAny && (meAny.role === "admin" || !!meAny.erpRole);
  
  if (!canErp) return null;

  if (variant === "mobile") {
    return (
      <div className="mb-2">
        <a
          href="/erp/"
          className="flex items-center justify-between w-full p-4 rounded-2xl bg-gradient-to-r from-primary to-primary/90 text-primary-foreground shadow-md active:scale-[0.98] transition-all"
          data-testid="link-admin-enter-erp-mobile"
        >
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 bg-white/20 rounded-xl backdrop-blur-sm">
              <Briefcase size={22} className="text-white" strokeWidth={2.5} />
            </div>
            <div className="text-left">
              <div className="font-bold text-[16px] tracking-wide">進入 ERP 系統</div>
              <div className="text-[12px] text-primary-foreground/85 font-medium mt-0.5">
                企業資源規劃與進銷存
              </div>
            </div>
          </div>
          <ChevronDown size={20} className="rotate-[-90deg] opacity-70" />
        </a>
      </div>
    );
  }

  return (
    <a
      href="/erp/"
      className="group flex items-center justify-between w-full px-3 py-2.5 mb-2 rounded-xl bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-all hover:shadow-md"
      data-testid="link-admin-enter-erp"
    >
      <div className="flex items-center gap-2.5">
        <Briefcase size={18} strokeWidth={2.5} />
        <span className="font-semibold text-sm">進入 ERP</span>
      </div>
      <ChevronDown
        size={16}
        className="rotate-[-90deg] opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all"
      />
    </a>
  );
}

function SidebarHeader() {
  return (
    <div className="flex items-center gap-3 px-6 py-5">
      <img
        src="/images/brand/logo-mark.png"
        alt="七期生醫"
        className="h-9 w-9 rounded-xl object-cover shadow-sm"
      />
      <div>
        <p className="text-[15px] font-bold leading-tight">七期生醫</p>
        <p className="text-xs font-medium text-muted-foreground mt-0.5">後台管理系統</p>
      </div>
    </div>
  );
}

function MobileBottomNav({
  visibleGroups,
  mobileOpen,
  setMobileOpen,
}: {
  visibleGroups: AdminNavGroup[];
  mobileOpen: boolean;
  setMobileOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const [location] = useLocation();

  const preferredTabs = [
    { path: "/admin", name: "首頁", icon: LayoutDashboard },
    { path: "/admin/products", name: "商品", icon: Package },
    { path: "/admin/orders", name: "訂單", icon: ClipboardList },
    { path: "/admin/members", name: "會員", icon: Users },
    { path: "/admin/commissions", name: "分潤", icon: HandCoins },
  ];

  const availableTabs = preferredTabs
    .filter((tab) =>
      visibleGroups.some((g) => g.items.some((item) => item.path === tab.path)),
    )
    .slice(0, 4);

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl border-t border-border/50 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.1)]">
      <div className="flex items-center justify-around h-[4.25rem] px-2">
        {availableTabs.map((tab) => {
          const isActive = isItemActive(location, tab.path) && !mobileOpen;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.path}
              href={tab.path}
              onClick={() => setMobileOpen(false)}
              className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors active:scale-95 ${
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <div
                className={`flex items-center justify-center w-10 h-8 rounded-full transition-colors ${
                  isActive ? "bg-primary/10" : "bg-transparent"
                }`}
              >
                <Icon
                  size={22}
                  strokeWidth={isActive ? 2.5 : 2}
                  className={isActive ? "scale-110 transition-transform" : ""}
                />
              </div>
              <span className={`text-[10px] ${isActive ? "font-semibold" : "font-medium"} leading-none`}>
                {tab.name}
              </span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors active:scale-95 ${
            mobileOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="button-admin-mobile-menu"
        >
          <div
            className={`flex items-center justify-center w-10 h-8 rounded-full transition-colors ${
              mobileOpen ? "bg-primary/10" : "bg-transparent"
            }`}
          >
            <Menu
              size={22}
              strokeWidth={mobileOpen ? 2.5 : 2}
              className={mobileOpen ? "scale-110 transition-transform" : ""}
            />
          </div>
          <span className={`text-[10px] ${mobileOpen ? "font-semibold" : "font-medium"} leading-none`}>
            選單
          </span>
        </button>
      </div>
    </nav>
  );
}

function MobileMenuOverlay({
  visibleGroups,
  mobileOpen,
  setMobileOpen,
}: {
  visibleGroups: AdminNavGroup[];
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}) {
  const [location] = useLocation();

  if (!mobileOpen) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden flex flex-col bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex-1" onClick={() => setMobileOpen(false)} />
      
      <div className="w-full h-[88dvh] flex flex-col bg-[#F2F2F7] dark:bg-black rounded-t-[2rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-full duration-300 ease-out">
        <div className="flex flex-col items-center justify-center pt-3 pb-2 px-4 bg-white dark:bg-[#1C1C1E] border-b shrink-0 relative z-10 rounded-t-[2rem]">
          <div className="w-10 h-1.5 rounded-full bg-muted-foreground/30 mb-3" />
          <div className="flex items-center justify-between w-full">
            <div className="w-16" />
            <h2 className="text-[17px] font-semibold text-foreground tracking-tight">所有功能</h2>
            <button
              onClick={() => setMobileOpen(false)}
              className="w-16 flex justify-end p-2 -mr-2 text-primary font-semibold active:opacity-70 text-[15px]"
            >
              完成
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto pb-[calc(5.5rem+env(safe-area-inset-bottom))] px-4 pt-5 space-y-7">
          <ErpEntryLink variant="mobile" />

          {visibleGroups.map((group) => (
            <div key={group.title} className="space-y-2.5">
              <h3 className="text-[13px] font-semibold text-muted-foreground uppercase px-2 tracking-wide">
                {group.title}
              </h3>
              <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden shadow-sm border border-border/40">
                {group.items.map((item, i) => {
                  const isActive = isItemActive(location, item.path);
                  const Icon = item.icon;
                  return (
                    <div key={item.path}>
                      <Link
                        href={item.path}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-3.5 px-4 py-3.5 transition-colors active:bg-muted/50 ${
                          isActive ? "bg-primary/5" : ""
                        }`}
                      >
                        <div
                          className={`p-1.5 rounded-xl flex items-center justify-center ${
                            isActive
                              ? "bg-primary text-white shadow-sm"
                              : "bg-muted/60 text-muted-foreground"
                          }`}
                        >
                          <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                        </div>
                        <span
                          className={`text-[15px] flex-1 ${
                            isActive
                              ? "font-bold text-primary"
                              : "font-medium text-foreground"
                          }`}
                        >
                          {item.name}
                        </span>
                        {isActive && (
                          <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                        )}
                      </Link>
                      {i < group.items.length - 1 && (
                        <div className="h-[1px] bg-border/40 ml-[3.25rem]" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="pt-2 pb-6">
            <Link
              href="/"
              className="flex items-center justify-center gap-2 w-full py-3.5 bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-sm border border-border/40 text-destructive font-bold active:bg-destructive/5 transition-colors text-[15px]"
            >
              <ArrowLeft size={18} strokeWidth={2.5} />
              回前台商城
            </Link>
          </div>
        </div>
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
  const { me } = useAuth();
  const role = me?.role as string;

  const visibleGroups = useMemo(
    () =>
      adminNavGroups
        .map((g) => ({
          ...g,
          items: g.items.filter((item) => !item.roles || item.roles.includes(role)),
        }))
        .filter((g) => g.items.length > 0),
    [role],
  );

  return (
    <div className="flex min-h-[100dvh] bg-muted/20 md:bg-muted/40 w-full relative">
      <aside className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 flex-col border-r bg-white md:flex">
        <SidebarHeader />
        <div className="px-3 pb-2">
          <ErpEntryLink variant="desktop" />
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <NavLinks visibleGroups={visibleGroups} />
        </div>
        <div className="border-t p-4">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-primary/10 hover:text-foreground transition-colors"
            data-testid="link-admin-back-to-site"
          >
            <ArrowLeft size={18} /> 回前台商城
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col relative w-full">
        <header className="hidden md:flex sticky top-0 z-30 h-16 items-center gap-3 border-b bg-white/95 backdrop-blur px-6">
          <h1 className="text-lg font-bold text-foreground" data-testid="text-admin-page-title">
            {title}
          </h1>
        </header>

        <header className="md:hidden fixed top-0 inset-x-0 z-30 bg-white/85 dark:bg-[#1C1C1E]/85 backdrop-blur-lg border-b border-border/50 pt-[env(safe-area-inset-top)] shadow-sm transition-all">
          <div className="flex items-center justify-center h-[3.5rem] px-4 relative">
            <div className="absolute left-4 flex items-center">
              <img
                src="/images/brand/logo-mark.png"
                alt="七期生醫"
                className="h-8 w-8 rounded-lg object-cover shadow-sm"
              />
            </div>
            <h1 className="text-[17px] font-semibold text-foreground tracking-tight truncate max-w-[55%]">
              {title}
            </h1>
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden p-4 pt-[calc(4.5rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:p-8 md:pt-8 md:pb-8">
          {children}
        </main>
      </div>

      <MobileBottomNav
        visibleGroups={visibleGroups}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />
      <MobileMenuOverlay
        visibleGroups={visibleGroups}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />
    </div>
  );
}
