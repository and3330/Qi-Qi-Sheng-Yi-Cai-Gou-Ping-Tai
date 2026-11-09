import { useEffect, useState, FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Search, X, PackageSearch } from "lucide-react";
import { useListProducts, useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { ProductCard, ProductCardSkeleton, useStoreAddToCart, tierLabel } from "@/components/storefront/ProductCard";
import { SHOP_CATEGORIES } from "@/components/storefront/nav";

type Sort = "recommended" | "priceAsc" | "priceDesc" | "newest";
const SORTS: { v: Sort; label: string }[] = [
  { v: "recommended", label: "推薦排序" },
  { v: "newest", label: "最新上架" },
  { v: "priceAsc", label: "價格由低到高" },
  { v: "priceDesc", label: "價格由高到低" },
];
const VALID_CATS = SHOP_CATEGORIES.map((c) => c.name as string);

export default function ShopPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { data: me } = useGetMe({ query: { enabled: isLoaded && !!isSignedIn, retry: false, queryKey: getGetMeQueryKey() } });
  const [, setLocation] = useLocation();
  const qs = useSearch();
  const params = new URLSearchParams(qs);
  const rawCat = params.get("category") ?? "";
  const category = VALID_CATS.includes(rawCat) ? rawCat : "";
  const search = params.get("q") ?? "";
  const sortParam = params.get("sort") as Sort | null;
  const sort: Sort = SORTS.some((s) => s.v === sortParam) ? (sortParam as Sort) : "recommended";

  const [draft, setDraft] = useState(search);
  useEffect(() => setDraft(search), [search]);

  const update = (next: { category?: string; q?: string; sort?: Sort }) => {
    const p = new URLSearchParams();
    const c = next.category ?? category;
    const q = next.q ?? search;
    const s = next.sort ?? sort;
    if (c) p.set("category", c);
    if (q) p.set("q", q);
    if (s !== "recommended") p.set("sort", s);
    const str = p.toString();
    setLocation(str ? `/shop?${str}` : "/shop");
  };

  const { data: products, isLoading, isError, refetch } = useListProducts({
    search: search || undefined,
    category: category || undefined,
    sort,
  });
  const { add } = useStoreAddToCart(!!isSignedIn);

  const onSubmit = (e: FormEvent) => { e.preventDefault(); update({ q: draft.trim() }); };
  const title = category || (search ? `搜尋「${search}」` : "全部商品");

  const catBtn = (active: boolean) =>
    `whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${active ? "bg-primary text-white" : "bg-white text-foreground border hover:border-primary hover:text-primary"}`;

  return (
    <div className="animate-in fade-in duration-300">
      <div className="sf-band px-4 pb-6 pt-5 text-white md:px-6">
        <div className="mx-auto max-w-7xl">
          <nav aria-label="麵包屑" className="text-xs text-white/75"><Link href="/" className="hover:underline">首頁</Link> / <Link href="/shop" className="hover:underline">商城</Link>{category && ` / ${category}`}</nav>
          <h1 className="mt-2 text-2xl font-bold tracking-wider md:text-3xl">{title}</h1>
          <form onSubmit={onSubmit} role="search" className="relative mt-4 max-w-xl">
            <label htmlFor="shop-search" className="sr-only">搜尋商品</label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} aria-hidden />
            <input id="shop-search" type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="搜尋商品名稱、編號"
              className="h-11 w-full rounded-full bg-white pl-10 pr-24 text-sm text-foreground" data-testid="input-shop-search" />
            {draft && <button type="button" aria-label="清除搜尋" onClick={() => { setDraft(""); update({ q: "" }); }} className="absolute right-[4.5rem] top-1/2 -translate-y-1/2 p-1 text-muted-foreground"><X size={16} /></button>}
            <button type="submit" className="absolute right-1 top-1 h-9 rounded-full bg-[hsl(var(--sf-deep))] px-4 text-sm font-bold" data-testid="button-shop-search">搜尋</button>
          </form>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-6 md:px-6 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block" aria-label="商品分類">
          <h2 className="border-b-2 border-primary pb-2 text-sm font-bold text-[hsl(var(--sf-deep))]">商品分類</h2>
          <ul className="mt-2">
            {["", ...VALID_CATS].map((c) => (
              <li key={c || "all"}>
                <button type="button" onClick={() => update({ category: c })} aria-current={category === c ? "true" : undefined}
                  className={`w-full border-b py-3 text-left text-sm ${category === c ? "font-bold text-primary" : "hover:text-primary"}`}>
                  {c || "全部商品"}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-6 rounded-lg bg-accent p-4 text-xs leading-relaxed text-accent-foreground">
            目前顯示價格：<strong>{tierLabel(me)}</strong>
            {!isSignedIn && <><br /><Link href="/sign-in" className="font-bold underline">登入</Link>後依會員身份顯示專屬價格。</>}
          </div>
        </aside>

        <div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar lg:hidden" role="group" aria-label="商品分類">
            {["", ...VALID_CATS].map((c) => (
              <button key={c || "all"} type="button" onClick={() => update({ category: c })} aria-pressed={category === c} className={catBtn(category === c)} data-testid={`button-cat-${c || "all"}`}>
                {c || "全部"}
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between lg:mt-0">
            <p className="text-sm text-muted-foreground" aria-live="polite">共 {products?.length ?? 0} 件商品</p>
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">排序方式</span>
              <select value={sort} onChange={(e) => update({ sort: e.target.value as Sort })} className="h-9 rounded-md border bg-white px-2 text-sm" data-testid="select-sort">
                {SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </label>
          </div>

          {isError ? (
            <div className="mt-10 rounded-lg bg-white p-10 text-center">
              <p className="text-muted-foreground">商品載入失敗</p>
              <button type="button" onClick={() => refetch()} className="mt-3 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white">重新載入</button>
            </div>
          ) : isLoading ? (
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
            </div>
          ) : products?.length === 0 ? (
            <div className="mt-10 flex flex-col items-center rounded-lg border border-dashed bg-white px-6 py-16 text-center">
              <PackageSearch size={44} className="text-primary/40" aria-hidden />
              <p className="mt-4 font-bold">找不到符合條件的商品</p>
              <p className="mt-1 text-sm text-muted-foreground">試試其他關鍵字，或瀏覽全部商品。</p>
              <button type="button" onClick={() => setLocation("/shop")} className="mt-5 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white">清除篩選</button>
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 xl:grid-cols-4">
              {products?.map((p) => <ProductCard key={p.id} product={p} me={me} onAdd={add} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
