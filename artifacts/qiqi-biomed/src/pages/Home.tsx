import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ShieldCheck, BadgePercent, HeadphonesIcon, ChevronLeft, ChevronRight, Building2, TrendingUp, LayoutDashboard,
  Pill, Syringe, Sparkles, Hospital,
} from "lucide-react";
import { useGetHomeSummary, useGetPortalSummary, getGetPortalSummaryQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { formatPrice } from "@/lib/utils";
import { ProductCard, ProductCardSkeleton, useStoreAddToCart } from "@/components/storefront/ProductCard";
import { SHOP_CATEGORIES, categoryHref } from "@/components/storefront/nav";

const CAT_ICONS = [Pill, Syringe, Sparkles, Hospital];

type Slide = { key: string; image: string; eyebrow: string; title: string; body: string; href: string; cta: string };

function Carousel({ slides }: { slides: Slide[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = slides.length;
  const go = useCallback((d: number) => setI((v) => (v + d + n) % n), [n]);
  useEffect(() => {
    if (paused || n < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => go(1), 6000);
    return () => clearInterval(t);
  }, [paused, n, go]);
  useEffect(() => { if (i >= n) setI(0); }, [n, i]);
  if (!n) return null;
  return (
    <section
      aria-roledescription="carousel" aria-label="精選資訊"
      className="relative mx-auto max-w-5xl"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}
    >
      <div className="relative overflow-hidden bg-white shadow-lg md:rounded-lg">
        <div className="flex transition-transform duration-700 ease-out" style={{ transform: `translateX(-${i * 100}%)` }}>
          {slides.map((s, idx) => (
            <div key={s.key} className="relative w-full shrink-0" role="group" aria-roledescription="slide" aria-label={`${idx + 1} / ${n}`} aria-hidden={idx !== i}>
              <div className="grid md:grid-cols-[1.1fr_1fr] min-h-[260px] md:min-h-[320px]">
                <div className="relative order-2 flex flex-col justify-center px-6 py-6 md:order-1 md:px-10">
                  <span className="text-xs font-bold tracking-[0.25em] text-[hsl(var(--sf-gold-deep))]">{s.eyebrow}</span>
                  <h2 className="mt-2 text-xl font-bold leading-snug text-[hsl(var(--sf-deep))] md:text-3xl line-clamp-2">{s.title}</h2>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground line-clamp-3">{s.body}</p>
                  <Link href={s.href} tabIndex={idx === i ? 0 : -1} className="mt-5 inline-flex w-fit items-center gap-1 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-[hsl(var(--sf-deep))]">
                    {s.cta} <ChevronRight size={16} />
                  </Link>
                </div>
                <div className="order-1 h-44 md:order-2 md:h-auto">
                  <img src={s.image} alt="" className="h-full w-full object-cover" />
                </div>
              </div>
            </div>
          ))}
        </div>
        {n > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="上一則" className="absolute left-2 top-[88px] flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-primary shadow md:top-1/2 md:-translate-y-1/2" data-testid="button-carousel-prev"><ChevronLeft size={20} /></button>
            <button type="button" onClick={() => go(1)} aria-label="下一則" className="absolute right-2 top-[88px] flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-primary shadow md:top-1/2 md:-translate-y-1/2" data-testid="button-carousel-next"><ChevronRight size={20} /></button>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="mt-4 flex justify-center gap-1" role="tablist" aria-label="選擇輪播">
          {slides.map((s, idx) => (
            <button key={s.key} type="button" role="tab" aria-selected={idx === i} aria-label={`第 ${idx + 1} 則`} onClick={() => setI(idx)}
              className="flex h-6 w-6 items-center justify-center" data-testid={`button-carousel-dot-${idx}`}>
              <span className={`block h-2 rounded-full transition-all ${idx === i ? "w-6 bg-primary" : "w-2 bg-primary/25"}`} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default function HomePage() {
  const { isLoaded, isSignedIn, me } = useAuth();
  const isInstitution = me?.tier === "hospital" || me?.tier === "clinic";
  const { data: portalSummary } = useGetPortalSummary({
    query: { enabled: isLoaded && !!isSignedIn && isInstitution, queryKey: getGetPortalSummaryQueryKey() },
  });
  const { data: summary, isLoading, isError, refetch } = useGetHomeSummary();
  const { add } = useStoreAddToCart(!!isSignedIn);

  const slides = useMemo<Slide[]>(() => {
    const base: Slide[] = [{
      key: "brand", image: "/images/hero-banner.jpg", eyebrow: "七期生醫採購平台",
      title: "一站式醫療採購，依身份顯示專屬價格",
      body: "醫院、診所藥局與一般消費者分級會員，登入後商品價格自動套用您的會員等級。",
      href: "/shop", cta: "瀏覽商品",
    }];
    const ann = (summary?.announcements ?? []).slice(0, 3).map((a) => ({
      key: `ann-${a.id}`, image: a.imageUrl || "/images/news-banner.jpg", eyebrow: a.category || "最新消息",
      title: a.title, body: a.content?.replace(/[#*_>`]/g, "").slice(0, 90) || "查看平台最新公告。", href: "/news", cta: "閱讀公告",
    }));
    const art = (summary?.latestArticles ?? []).slice(0, 2).map((a) => ({
      key: `art-${a.id}`, image: a.imageUrl || "/images/news-banner.jpg", eyebrow: "知識專區",
      title: a.title, body: a.summary || "專業衛教知識整理。", href: `/knowledge/${a.id}`, cta: "閱讀文章",
    }));
    return [...base, ...ann, ...art];
  }, [summary]);

  const benefits = [
    { icon: ShieldCheck, title: "合規正品", sub: "來源可追溯" },
    { icon: BadgePercent, title: "分級價格", sub: "依會員身份計價" },
    { icon: HeadphonesIcon, title: "專人客服", sub: "0800-789-188" },
  ];

  return (
    <div className="animate-in fade-in duration-500">
      {/* Benefit band + carousel overlapping */}
      <div className="sf-band pb-28 pt-6 text-white md:pb-36">
        <ul className="mx-auto grid max-w-4xl grid-cols-3 gap-2 px-3">
          {benefits.map((b) => (
            <li key={b.title} className="flex flex-col items-center gap-1.5 text-center sm:flex-row sm:justify-center sm:gap-3 sm:text-left">
              <b.icon size={34} strokeWidth={1.4} aria-hidden />
              <span>
                <span className="block text-base font-bold tracking-wider sm:text-xl">{b.title}</span>
                <span className="block text-[11px] text-white/80 sm:text-xs">{b.sub}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="-mt-24 px-0 md:-mt-32 md:px-6">
        {isLoading ? <div className="mx-auto h-[420px] max-w-5xl animate-pulse bg-white/70 md:h-[320px] md:rounded-lg" /> : <Carousel slides={slides} />}
      </div>

      {/* Institution / staff entries */}
      {isSignedIn && ((isInstitution && portalSummary) || (me?.role && me.role !== "member")) && (
        <div className="mx-auto mt-8 grid max-w-5xl gap-3 px-4 md:grid-cols-2 md:px-6">
          {isInstitution && portalSummary && (
            <Link href="/portal" className="flex items-center justify-between gap-4 rounded-lg border-l-4 border-[hsl(var(--sf-gold))] bg-white p-4 shadow-sm hover:shadow-md" data-testid="link-portal-entry">
              <div className="flex items-center gap-3">
                <Building2 className="text-primary" size={28} aria-hidden />
                <div>
                  <div className="text-xs text-muted-foreground">{me?.tier === "hospital" ? "醫院會員" : "診所/藥局會員"}・{portalSummary.institutionName || "尚未綁定院所"}</div>
                  <div className="flex items-center gap-1 font-bold"><TrendingUp size={14} aria-hidden />本月採購 {formatPrice(portalSummary.monthPurchaseTotal)}</div>
                </div>
              </div>
              <span className="flex items-center text-sm font-bold text-primary">機構後台 <ChevronRight size={16} /></span>
            </Link>
          )}
          {me?.role && me.role !== "member" && (
            <Link href="/admin" className="flex items-center justify-between rounded-lg bg-[hsl(var(--sf-deep))] p-4 text-white shadow-sm" data-testid="link-admin-entry">
              <span className="flex items-center gap-3"><LayoutDashboard size={26} aria-hidden /><span><span className="block text-xs text-white/70">內部人員</span><span className="font-bold">進入管理後台</span></span></span>
              <ChevronRight size={18} />
            </Link>
          )}
        </div>
      )}

      {/* Category entry */}
      <section className="mx-auto mt-10 max-w-5xl px-4 md:px-6" aria-labelledby="cat-title">
        <h2 id="cat-title" className="sr-only">商品分類</h2>
        <div className="grid grid-cols-4 gap-2 md:gap-4">
          {SHOP_CATEGORIES.map((c, idx) => {
            const Icon = CAT_ICONS[idx];
            return (
              <Link key={c.name} href={categoryHref(c.name)} className="group flex flex-col items-center gap-2 rounded-lg py-3 text-center hover:bg-white md:flex-row md:gap-3 md:border md:bg-white md:px-4 md:text-left" data-testid={`link-home-cat-${c.name}`}>
                <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-primary/20 text-primary group-hover:bg-primary group-hover:text-white"><Icon size={22} aria-hidden /></span>
                <span><span className="block text-[13px] font-bold md:text-sm">{c.name}</span><span className="hidden text-xs text-muted-foreground md:block">{c.desc}</span></span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Featured */}
      <section className="mx-auto mt-10 max-w-7xl px-4 md:px-6" aria-labelledby="featured-title">
        <h2 id="featured-title" className="text-center text-2xl font-bold tracking-wider text-[hsl(var(--sf-deep))] md:text-3xl">熱門推薦商品</h2>
        {isError ? (
          <div className="mt-8 rounded-lg bg-white p-8 text-center">
            <p className="text-muted-foreground">商品載入失敗</p>
            <button type="button" onClick={() => refetch()} className="mt-3 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white">重新載入</button>
          </div>
        ) : (
          <div className="mt-7 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={i} />)
              : summary?.hotProducts.map((p) => <ProductCard key={p.id} product={p} me={me} onAdd={add} />)}
          </div>
        )}
        {!isLoading && !isError && summary?.hotProducts.length === 0 && <p className="mt-8 text-center text-muted-foreground">目前沒有推薦商品，歡迎前往商城瀏覽。</p>}
        <div className="mt-8 border-t pt-6 text-center">
          <Link href="/shop" className="text-sm font-bold text-[hsl(var(--sf-deep))] underline underline-offset-4" data-testid="link-view-more">查看更多</Link>
        </div>
      </section>

      {/* News + knowledge */}
      <section className="mx-auto mt-12 grid max-w-7xl gap-6 [&>*]:min-w-0 px-4 md:grid-cols-2 md:px-6">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between border-b pb-3">
            <h2 className="text-lg font-bold text-[hsl(var(--sf-deep))]">最新消息</h2>
            <Link href="/news" className="text-xs font-bold text-primary underline underline-offset-4">全部消息</Link>
          </div>
          <ul className="divide-y">
            {isLoading ? Array.from({ length: 3 }).map((_, i) => <li key={i} className="h-10 animate-pulse" />) :
              (summary?.announcements ?? []).slice(0, 4).map((a) => (
                <li key={a.id}>
                  <Link href="/news" className="flex items-center gap-3 py-3 hover:text-primary">
                    <span className="shrink-0 rounded bg-accent px-2 py-0.5 text-[11px] font-bold text-primary">{a.category}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{a.title}</span>
                    <time className="shrink-0 text-xs text-muted-foreground">{new Date(a.publishedAt).toLocaleDateString("zh-TW")}</time>
                  </Link>
                </li>
              ))}
            {!isLoading && !summary?.announcements?.length && <li className="py-4 text-sm text-muted-foreground">尚無公告</li>}
          </ul>
        </div>
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between border-b pb-3">
            <h2 className="text-lg font-bold text-[hsl(var(--sf-deep))]">知識專區</h2>
            <Link href="/knowledge" className="text-xs font-bold text-primary underline underline-offset-4">全部文章</Link>
          </div>
          <ul className="divide-y">
            {(summary?.latestArticles ?? []).slice(0, 4).map((a) => (
              <li key={a.id}>
                <Link href={`/knowledge/${a.id}`} className="block py-3 hover:text-primary">
                  <span className="block truncate text-sm font-medium">{a.title}</span>
                  <span className="text-xs text-muted-foreground">{a.category}</span>
                </Link>
              </li>
            ))}
            {!isLoading && !summary?.latestArticles?.length && <li className="py-4 text-sm text-muted-foreground">尚無文章</li>}
          </ul>
        </div>
      </section>
    </div>
  );
}
