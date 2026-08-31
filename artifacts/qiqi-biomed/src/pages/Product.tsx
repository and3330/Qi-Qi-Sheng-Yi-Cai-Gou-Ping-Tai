import { useState, useMemo } from "react";
import { useRoute, Link } from "wouter";
import { ChevronLeft, ShoppingCart, Heart, Share2, Plus, Minus } from "lucide-react";
import { 
  useGetProduct, 
  useGetMe, 
  useAddCartItem, 
  useListFavorites,
  useAddFavorite,
  useRemoveFavorite,
  getGetProductQueryKey,
  getGetMeQueryKey,
  getListFavoritesQueryKey,
  getGetCartQueryKey
} from "@workspace/api-client-react";
import { formatPrice, classNames } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProductPage() {
  const [, params] = useRoute("/product/:id");
  const id = Number(params?.id);
  const { isLoaded, isSignedIn } = useAuth();
  
  const { data: me } = useGetMe({ query: { enabled: isLoaded && !!isSignedIn, retry: false, queryKey: getGetMeQueryKey() } });
  const { data: product, isLoading } = useGetProduct(id, { query: { enabled: !!id, queryKey: getGetProductQueryKey(id) } });
  
  const { data: favorites } = useListFavorites({ query: { enabled: isLoaded && !!isSignedIn, retry: false, queryKey: getListFavoritesQueryKey() } });
  const { mutate: addFav } = useAddFavorite();
  const { mutate: rmFav } = useRemoveFavorite();
  
  const { mutate: addToCart } = useAddCartItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [quantity, setQuantity] = useState(1);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);

  const hasVariants = product?.variants && product.variants.length > 0;
  
  const selectedVariant = useMemo(() => {
    if (!hasVariants) return null;
    return product.variants!.find(v => v.id === selectedVariantId) || null;
  }, [product, selectedVariantId, hasVariants]);

  const activeStock = hasVariants ? (selectedVariant ? selectedVariant.stock : 0) : (product?.stock ?? 0);

  const isFavorite = useMemo(() => {
    return favorites?.some(f => f.id === id) ?? false;
  }, [favorites, id]);

  const handleToggleFavorite = () => {
    if (!me) {
      toast({ title: "請先登入", variant: "destructive" });
      return;
    }
    if (isFavorite) {
      rmFav({ productId: id }, {
        onSuccess: () => {
          toast({ title: "已取消收藏" });
          queryClient.invalidateQueries({ queryKey: getListFavoritesQueryKey() });
        }
      });
    } else {
      addFav({ data: { productId: id } }, {
        onSuccess: () => {
          toast({ title: "已加入收藏" });
          queryClient.invalidateQueries({ queryKey: getListFavoritesQueryKey() });
        }
      });
    }
  };

  const handleAddToCart = () => {
    if (!product) return;
    if (hasVariants && !selectedVariantId) {
      toast({ title: "請選擇商品規格", variant: "destructive" });
      return;
    }
    
    addToCart({ data: { productId: id, quantity, variantId: selectedVariantId } }, {
      onSuccess: () => {
        const title = selectedVariant ? `${product.name} (${selectedVariant.name})` : product.name;
        toast({ title: "已加入購物車", description: `${title} x ${quantity}` });
        queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
      },
      onError: () => {
        toast({ title: "請先登入", variant: "destructive" });
      }
    });
  };

  // Determine current price based on tier, default to consumer
  const currentPrice = useMemo(() => {
    if (!product) return 0;
    const target = hasVariants && selectedVariant ? selectedVariant : product;
    if (me?.tier === 'hospital') return target.priceHospital;
    if (me?.tier === 'clinic') return target.priceClinic;
    return target.priceConsumer;
  }, [product, me, hasVariants, selectedVariant]);

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <div className="aspect-square bg-gray-100 animate-pulse" />
        <div className="p-4 space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex flex-col min-h-screen bg-background items-center justify-center">
        <p className="text-muted-foreground mb-4">找不到商品</p>
        <Link href="/shop" className="text-primary font-medium">返回商城</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background animate-in fade-in pb-36">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 bg-white/80 backdrop-blur-md max-w-md mx-auto">
        <Button variant="ghost" size="icon" className="rounded-full bg-white shadow-sm" onClick={() => window.history.back()}>
          <ChevronLeft size={20} />
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" className="rounded-full bg-white shadow-sm text-gray-600" onClick={handleToggleFavorite}>
            <Heart size={20} className={isFavorite ? "fill-destructive text-destructive" : ""} />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full bg-white shadow-sm text-gray-600">
            <Share2 size={20} />
          </Button>
        </div>
      </div>

      {/* Image */}
      <div className="aspect-square bg-white w-full pt-16 flex items-center justify-center p-8">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="w-full h-full object-contain mix-blend-multiply" />
        ) : (
          <div className="text-gray-300 font-bold text-4xl">{product.code}</div>
        )}
      </div>

      <div className="p-4 bg-white mt-2 rounded-t-3xl -mt-6 relative z-10 shadow-[0_-8px_16px_-4px_rgba(0,0,0,0.05)]">
        <div className="flex justify-between items-start mb-2">
          <div>
            <div className="text-xs text-primary font-bold bg-primary/10 px-2 py-0.5 rounded-sm inline-block mb-2">
              {product.category}
            </div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">{product.name}</h1>
            <p className="text-xs text-gray-400 mt-1">商品編號: {product.code}</p>
          </div>
        </div>

        <div className="my-4 p-4 rounded-xl bg-gray-50 border border-gray-100 flex items-end justify-between">
          <div>
            <p className="text-xs text-gray-500 mb-1">
              {me?.tier === 'hospital' ? '醫院專屬價' : me?.tier === 'clinic' ? '合作價' : '一般售價'}
            </p>
            <p className="text-2xl font-bold text-primary">{formatPrice(currentPrice)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 mb-0.5">庫存狀態</p>
            <p className={classNames("text-sm font-bold", activeStock > 10 ? "text-green-600" : activeStock > 0 ? "text-orange-500" : "text-destructive")}>
              {activeStock > 10 ? "庫存充足" : activeStock > 0 ? `倒數 ${activeStock} 件` : "售完補貨中"}
            </p>
          </div>
        </div>

        {hasVariants && (
          <div className="mb-4 pt-4 border-t border-gray-100">
            <h3 className="font-bold text-gray-900 mb-3">商品規格</h3>
            <div className="flex flex-wrap gap-2">
              {product.variants!.filter(v => v.isActive).map(v => (
                <button
                  key={v.id}
                  onClick={() => {
                    setSelectedVariantId(v.id);
                    setQuantity(1);
                  }}
                  className={classNames(
                    "px-4 py-2 rounded-xl text-sm font-medium border-2 transition-all active:scale-95",
                    selectedVariantId === v.id 
                      ? "border-primary bg-primary/10 text-primary" 
                      : "border-gray-100 bg-white text-gray-600 hover:border-primary/30 hover:bg-gray-50",
                    v.stock <= 0 && "opacity-50 cursor-not-allowed"
                  )}
                  disabled={v.stock <= 0}
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tier Price Preview */}
        {!me && (
          <div className="mb-4 text-xs text-gray-500 bg-orange-50 p-3 rounded-lg border border-orange-100 flex items-center justify-between">
            <span>登入後可查看醫療院所專屬合約價</span>
            <Link href="/sign-in" className="text-orange-600 font-bold hover:underline">登入</Link>
          </div>
        )}

        <div className="space-y-4 pt-4 border-t border-gray-100">
          <h3 className="font-bold text-gray-900">商品說明</h3>
          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
            {product.description || "暫無詳細說明"}
          </p>
          {product.spec && (
            <div className="mt-2 text-sm text-gray-600">
              <span className="font-medium text-gray-900 mr-2">規格：</span>{product.spec}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="fixed bottom-nav-offset z-50 w-full max-w-md bg-white border-t p-3 shadow-[0_-4px_16px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-3">
          <div className="flex items-center border rounded-lg overflow-hidden h-12 bg-gray-50">
            <button 
              className="w-10 h-full flex items-center justify-center text-gray-500 disabled:opacity-50"
              onClick={() => setQuantity(q => Math.max(1, q - 1))}
              disabled={quantity <= 1}
            >
              <Minus size={16} />
            </button>
            <div className="w-10 h-full flex items-center justify-center font-bold text-sm bg-white">
              {quantity}
            </div>
            <button 
              className="w-10 h-full flex items-center justify-center text-gray-500 disabled:opacity-50"
              onClick={() => setQuantity(q => Math.min(activeStock, q + 1))}
              disabled={quantity >= activeStock}
            >
              <Plus size={16} />
            </button>
          </div>
          
          <Button 
            className="flex-1 h-12 text-base font-bold rounded-xl"
            disabled={activeStock <= 0}
            onClick={handleAddToCart}
          >
            {activeStock > 0 ? (
              <>
                <ShoppingCart size={18} className="mr-2" />
                加入購物車
              </>
            ) : "已售完"}
          </Button>
        </div>
      </div>
    </div>
  );
}
