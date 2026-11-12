import { ReactNode, useEffect, useRef, useState, FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Home, Heart, ShoppingBag, User, ShoppingCart, Menu, X, ChevronDown, Search, ArrowRight, Building2, LayoutDashboard,
} from "lucide-react";
import { useGetCart, getGetCartQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import CompanyFooter from "@/components/CompanyFooter";
import { SHOP_CATEGORIES, INFO_LINKS, MEMBER_LINKS, categoryHref } from "@/components/storefront/nav";

const FULL_BLEED = ["/", "/shop"];

function Accordion({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `acc-${title}`;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-3 text-[15px] font-bold text-white"
      >
        {title}
        <ChevronDown size={20} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <div id={id} hidden={!open} className="pb-2 pl-3">
        {children}
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { isLoaded, isSignedIn, me } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [q, setQ] = useState("");
  const catRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  // 頂部品牌列固定在畫面上方；把它的高度給各頁自己的固定列使用，避免被蓋住
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--sf-header-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--sf-header-h");
    };
  }, []);

  const { data: cart } = useGetCart({
    query: { enabled: isLoaded && !!isSignedIn, queryKey: getGetCartQueryKey() },
  });
  const cartCount = cart?.reduce((acc, item) => acc + item.quantity, 0) || 0;
  const isInstitution = me?.tier === "hospital" || me?.tier === "clinic";
  const isStaff = !!me?.role && me.role !== "member";

  useEffect(() => { setDrawerOpen(false); setCatOpen(false); }, [location, search]);
  useEffect(() => {
    if (!catOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCatOpen(false);
    const onClick = (e: MouseEvent) => { if (catRef.current && !catRef.current.contains(e.target as Node)) setCatOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [catOpen]);

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setLocation(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : "/shop");
  };

  const tabs = [
    { name: "首頁", icon: Home, path: "/" },
    { name: "商城", icon: ShoppingBag, path: "/shop" },
    { name: "收藏", icon: Heart, path: "/favorites" },
    { name: "購物車", icon: ShoppingCart, path: "/cart", badge: cartCount },
    { name: "會員", icon: User, path: "/member" },
  ];
  const isActive = (p: string) => (p === "/" ? location === "/" : location.startsWith(p));
  const fullBleed = FULL_BLEED.includes(location);

  const navLink = "rounded-sm px-3 py-2 text-sm font-medium text-white/90 hover:text-white hover:bg-white/10";

  return (
    <div className="storefront flex min-h-[100dvh] flex-col overflow-x-clip">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-primary">跳至主要內容</a>

      <header ref={headerRef} className="sf-band sticky top-0 z-40 text-white">
        <div className="bg-[hsl(var(--sf-deep))] px-4 py-1.5 text-center text-xs font-medium tracking-wide">
          {isSignedIn ? (
            <span>歡迎回來，{me?.name}　訂購／客服專線 0800-789-188</span>
          ) : (
            <span>醫院・診所・藥局・消費者會員分級採購　<Link href="/sign-up" className="underline underline-offset-2">立即註冊</Link></span>
          )}
        </div>

        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 lg:px-8">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="開啟選單"
            className="-ml-1 rounded p-1.5 lg:hidden"
            data-testid="button-open-menu"
          >
            <Menu size={26} />
          </button>
          <Link href="/" className="flex items-center gap-2.5" data-testid="link-home-logo">
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white">
              <img src="/images/brand/logo-mark.png" alt="" className="h-full w-full object-cover" />
            </span>
            <span className="leading-tight">
              <span className="block text-lg font-bold tracking-wider">七期生醫</span>
              <span className="block text-[11px] tracking-[0.2em] text-white/80">醫療採購平台</span>
            </span>
          </Link>

          <form onSubmit={submitSearch} role="search" className="relative ml-6 hidden max-w-md flex-1 md:block">
            <label htmlFor="sf-search" className="sr-only">搜尋商品</label>
            <input
              id="sf-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜尋商品名稱、編號"
              className="h-10 w-full rounded-full border-0 bg-white/95 pl-4 pr-11 text-sm text-foreground placeholder:text-muted-foreground"
              data-testid="input-header-search"
            />
            <button type="submit" aria-label="搜尋" className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white">
              <Search size={16} />
            </button>
          </form>

          <div className="ml-auto flex items-center gap-1">
            <Link href="/shop" aria-label="搜尋商品" className="rounded p-2 md:hidden"><Search size={22} /></Link>
            <Link href="/cart" aria-label={`購物車，${cartCount} 件`} className="relative hidden rounded p-2 lg:block" data-testid="link-header-cart">
              <ShoppingCart size={22} />
              {cartCount > 0 && (
                <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--sf-gold))] px-1 text-[10px] font-bold text-[hsl(205_60%_14%)]">
                  {cartCount > 99 ? "99+" : cartCount}
                </span>
              )}
            </Link>
            <Link href={isSignedIn ? "/member" : "/sign-in"} className="hidden items-center gap-1.5 rounded px-2 py-2 text-sm lg:flex" data-testid="link-header-account">
              <User size={20} />{isSignedIn ? "會員中心" : "登入"}
            </Link>
            <Link href={isSignedIn ? "/points" : "/sign-up"} className="sf-gold-btn ml-1 flex items-center gap-1.5 rounded-full py-1.5 pl-4 pr-1.5 text-sm font-bold shadow-sm" data-testid="link-member-cta">
              {isSignedIn ? "會員點數" : "加入會員"}
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--sf-deep))] text-white"><ArrowRight size={14} /></span>
            </Link>
          </div>
        </div>

        <nav aria-label="主選單" className="hidden border-t border-white/15 lg:block">
          <div className="mx-auto flex max-w-7xl items-center gap-1 px-6">
            <Link href="/" className={navLink}>首頁</Link>
            <div ref={catRef} className="relative">
              <button
                type="button"
                aria-expanded={catOpen}
                aria-haspopup="true"
                onClick={() => setCatOpen(!catOpen)}
                className={`${navLink} flex items-center gap-1`}
                data-testid="button-category-menu"
              >
                商品分類 <ChevronDown size={16} className={catOpen ? "rotate-180" : ""} />
              </button>
              {catOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md bg-white p-2 text-foreground shadow-xl">
                  <Link href="/shop" className="block rounded px-3 py-2 text-sm font-bold underline-offset-4 hover:bg-accent hover:underline">全部商品</Link>
                  {SHOP_CATEGORIES.map((c) => (
                    <Link key={c.name} href={categoryHref(c.name)} className="block rounded px-3 py-2 hover:bg-accent" data-testid={`link-cat-${c.name}`}>
                      <span className="block text-sm font-bold underline-offset-4">{c.name}</span>
                      <span className="block text-xs text-muted-foreground">{c.desc}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            {INFO_LINKS.map((l) => <Link key={l.path} href={l.path} className={navLink}>{l.name}</Link>)}
            <Link href="/quick-order" className={navLink}>快速訂購</Link>
            <Link href="/support" className={navLink}>客服中心</Link>
            {isInstitution && <Link href="/portal" className={`${navLink} ml-auto flex items-center gap-1.5`}><Building2 size={16} />機構後台</Link>}
            {isStaff && <Link href="/admin" className={`${navLink} ${isInstitution ? "" : "ml-auto"} flex items-center gap-1.5`}><LayoutDashboard size={16} />管理後台</Link>}
          </div>
        </nav>
      </header>

      {/* Mobile drawer */}
      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="storefront fixed inset-0 z-50 bg-[hsl(205_60%_10%/0.55)] data-[state=open]:animate-in data-[state=open]:fade-in" />
          <Dialog.Content className="storefront sf-drawer fixed inset-y-0 left-0 z-50 flex w-[86%] max-w-sm flex-col overflow-y-auto px-6 pb-10 pt-5 text-white shadow-2xl data-[state=open]:animate-in data-[state=open]:slide-in-from-left">
            <div className="flex items-center justify-between">
              <Dialog.Title className="flex items-center gap-2 text-lg font-bold tracking-wider">
                <span className="flex h-8 w-8 overflow-hidden rounded-full bg-white"><img src="/images/brand/logo-mark.png" alt="" className="h-full w-full object-cover" /></span>
                七期生醫
              </Dialog.Title>
              <Dialog.Close aria-label="關閉選單" className="rounded p-1" data-testid="button-close-menu"><X size={26} /></Dialog.Close>
            </div>
            <Dialog.Description className="mt-4 border-b border-white/30 pb-3 text-sm font-bold">尋找商品與服務</Dialog.Description>

            <nav aria-label="行動版選單" className="mt-2">
              <Link href="/shop" className="block py-3 text-[15px] font-bold">全部商品</Link>
              <Accordion title="商品分類" defaultOpen>
                {SHOP_CATEGORIES.map((c) => (
                  <Link key={c.name} href={categoryHref(c.name)} className="block py-2 text-sm text-white/90">{c.name}</Link>
                ))}
              </Accordion>
              <Accordion title="資訊專區">
                {INFO_LINKS.map((l) => <Link key={l.path} href={l.path} className="block py-2 text-sm text-white/90">{l.name}</Link>)}
              </Accordion>
              <Accordion title="會員服務">
                {MEMBER_LINKS.map((l) => <Link key={l.path} href={l.path} className="block py-2 text-sm text-white/90">{l.name}</Link>)}
                {isInstitution && <Link href="/portal" className="block py-2 text-sm text-white/90">機構後台</Link>}
                {isStaff && <Link href="/admin" className="block py-2 text-sm text-white/90">管理後台</Link>}
              </Accordion>
            </nav>

            <div className="mt-4 border-t border-white/30 pt-4 text-sm font-bold">帳戶</div>
            <div className="mt-3 space-y-3">
              {isSignedIn ? (
                <>
                  <p className="text-sm text-white/85">{me?.name}，您好</p>
                  <Link href="/member" className="block rounded-md bg-white py-2.5 text-center text-sm font-bold text-primary">會員中心</Link>
                  <Link href="/orders" className="block rounded-md border border-white/80 py-2.5 text-center text-sm font-bold">我的訂單</Link>
                </>
              ) : (
                <>
                  <Link href="/sign-in" className="block rounded-md bg-white py-2.5 text-center text-sm font-bold text-primary" data-testid="link-drawer-signin">會員登入</Link>
                  <Link href="/sign-up" className="block rounded-md border border-white/80 py-2.5 text-center text-sm font-bold" data-testid="link-drawer-signup">註冊新會員</Link>
                </>
              )}
            </div>
            <p className="mt-auto pt-10 text-xs text-white/70">訂購／客服專線 <a href="tel:0800789188" className="underline">0800-789-188</a></p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <main id="main" className="flex-1 pb-20 lg:pb-0">
        {fullBleed ? children : <div className="mx-auto w-full max-w-3xl lg:my-6 lg:overflow-hidden lg:rounded-xl lg:border lg:bg-white lg:shadow-sm">{children}</div>}
      </main>

      <div className="pb-16 lg:pb-0"><CompanyFooter /></div>

      <nav aria-label="底部導覽" className="fixed bottom-0 left-0 right-0 z-40 bg-primary pb-safe text-white lg:hidden">
        <div className="flex h-16 items-stretch justify-around">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab.path);
            return (
              <Link key={tab.path} href={tab.path} aria-current={active ? "page" : undefined} aria-label={tab.name}
                className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${active ? "text-white" : "text-white/70"}`}
                data-testid={`tab-${tab.path}`}>
                <span className="relative">
                  <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--sf-gold))] px-1 text-[10px] font-bold text-[hsl(205_60%_14%)]">
                      {tab.badge > 99 ? "99+" : tab.badge}
                    </span>
                  )}
                </span>
                <span className={active ? "font-bold" : ""}>{tab.name}</span>
                {active && <span className="absolute top-0 h-0.5 w-8 rounded bg-[hsl(var(--sf-gold))]" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
