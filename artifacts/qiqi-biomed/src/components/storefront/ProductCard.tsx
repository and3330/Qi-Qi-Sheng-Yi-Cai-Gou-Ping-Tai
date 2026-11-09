import { Link, useLocation } from "wouter";
import { ShoppingBag } from "lucide-react";
import type { Product, Member } from "@workspace/api-client-react";
import { useAddCartItem, getGetCartQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatPrice } from "@/lib/utils";

export function tierPrice(p: Product, me?: Member | null) {
  if (me?.tier === "hospital") return p.priceHospital;
  if (me?.tier === "clinic") return p.priceClinic;
  return p.priceConsumer;
}
export function tierLabel(me?: Member | null) {
  if (me?.tier === "hospital") return "醫院專屬價";
  if (me?.tier === "clinic") return "合作價";
  return "售價";
}

/** Shared add-to-cart: variant products (detected from detail payload or backend rejection) route to detail. */
export function useStoreAddToCart(isSignedIn: boolean) {
  const { mutate, isPending } = useAddCartItem();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const add = (p: Product) => {
    if (!isSignedIn) {
      toast({ title: "請先登入會員", description: "登入後即可加入購物車", duration: 2500 });
      setLocation("/sign-in");
      return;
    }
    if (p.variants && p.variants.length > 0) {
      setLocation(`/product/${p.id}`);
      return;
    }
    mutate({ data: { productId: p.id, quantity: 1 } }, {
      onSuccess: () => {
        toast({ title: "已加入購物車", description: p.name, duration: 2000 });
        qc.invalidateQueries({ queryKey: getGetCartQueryKey() });
      },
      onError: () => {
        toast({ title: "無法加入購物車", description: "請前往商品頁確認規格、購買資格及庫存，或稍後再試。", variant: "destructive", duration: 4000 });
      },
    });
  };
  return { add, isPending };
}

export function ProductCard({ product, me, onAdd }: { product: Product; me?: Member | null; onAdd: (p: Product) => void }) {
  const soldOut = product.stock <= 0;
  return (
    <article className="group flex flex-col" data-testid={`card-product-${product.id}`}>
      <Link
        href={`/product/${product.id}`}
        className="relative block overflow-hidden rounded-lg border-2 border-primary/80 bg-white focus-visible:outline-offset-4"
        data-testid={`link-product-${product.id}`}
      >
        <div className="flex items-center justify-between bg-primary px-2.5 py-1 text-[10px] font-medium tracking-wider text-white">
          <span>七期生醫</span>
          <span className="opacity-80">{product.code}</span>
        </div>
        <div className="aspect-square bg-white flex items-center justify-center overflow-hidden">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} loading="lazy" className="h-full w-full object-contain p-2 transition-transform duration-500 group-hover:scale-[1.04]" />
          ) : (
            <ShoppingBag className="text-primary/20" size={40} aria-hidden />
          )}
        </div>
        {(product.isHot || product.isNew) && (
          <div className={`py-1.5 text-center text-xs font-bold text-white ${product.isHot ? "bg-[hsl(352_72%_48%)]" : "bg-[hsl(196_82%_32%)]"}`}>
            {product.isHot ? "熱銷商品" : "新品上架"}
          </div>
        )}
        {soldOut && (
          <span className="absolute right-2 top-8 rounded bg-foreground/80 px-2 py-0.5 text-[10px] font-bold text-white">暫無庫存</span>
        )}
      </Link>
      <Link href={`/product/${product.id}`} className="mt-3 text-[15px] font-bold leading-snug text-foreground line-clamp-2 hover:text-primary">
        {product.name}
      </Link>
      {product.spec && <p className="mt-1 text-xs text-muted-foreground line-clamp-1">{product.spec}</p>}
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[11px] text-muted-foreground">{tierLabel(me)}</span>
        <span className="text-base font-bold text-[hsl(196_82%_34%)]" data-testid={`text-price-${product.id}`}>
          {formatPrice(tierPrice(product, me))}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onAdd(product)}
        disabled={soldOut}
        className="mt-2 self-start text-sm font-bold text-[hsl(var(--sf-deep))] underline underline-offset-4 decoration-2 hover:text-primary disabled:text-muted-foreground disabled:no-underline"
        data-testid={`button-add-cart-${product.id}`}
      >
        {soldOut ? "暫無庫存" : "加入購物車"}
      </button>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="aspect-[1/1.12] rounded-lg bg-primary/10" />
      <div className="mt-3 h-4 w-5/6 rounded bg-primary/10" />
      <div className="mt-2 h-4 w-1/3 rounded bg-primary/10" />
    </div>
  );
}
