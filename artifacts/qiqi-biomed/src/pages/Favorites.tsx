import { Link } from "wouter";
import { Heart, ShoppingCart, Trash2, ArrowLeft } from "lucide-react";
import { useListFavorites, useRemoveFavorite, useAddCartItem, useGetMe, getGetCartQueryKey, getListFavoritesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatPrice } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

export default function FavoritesPage() {
  const { data: me } = useGetMe();
  const { data: favorites, isLoading } = useListFavorites();
  const { mutate: rmFav } = useRemoveFavorite();
  const { mutate: addToCart } = useAddCartItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleRemove = (productId: number) => {
    rmFav({ productId }, {
      onSuccess: () => {
        toast({ title: "已取消收藏" });
        queryClient.invalidateQueries({ queryKey: getListFavoritesQueryKey() });
      }
    });
  };

  const handleAddToCart = (productId: number) => {
    addToCart({ data: { productId, quantity: 1 } }, {
      onSuccess: () => {
        toast({ title: "已加入購物車" });
        queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
      }
    });
  };

  const getPrice = (product: any) => {
    if (me?.tier === "hospital") return product.priceHospital;
    if (me?.tier === "clinic") return product.priceClinic;
    return product.priceConsumer;
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-20 animate-in fade-in">
      <div className="bg-white px-4 pt-safe pb-4 shadow-sm sticky top-0 z-30 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="-ml-2"><Link href="/member"><ArrowLeft size={20}/></Link></Button>
        <h1 className="font-bold text-xl text-gray-900 pt-1">收藏清單</h1>
      </div>

      <div className="p-4 space-y-3">
        {isLoading ? (
          Array(3).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))
        ) : favorites?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Heart size={48} className="text-gray-300 mb-4" />
            <p className="text-gray-500 mb-6">您的收藏清單是空的</p>
            <Button asChild className="rounded-xl px-8"><Link href="/shop">去逛逛</Link></Button>
          </div>
        ) : (
          favorites?.map(product => (
            <div key={product.id} className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 flex gap-3">
              <Link href={`/product/${product.id}`} className="w-24 h-24 bg-gray-50 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover mix-blend-multiply" />
                ) : (
                  <span className="text-xs font-bold text-gray-300">{product.code}</span>
                )}
              </Link>
              
              <div className="flex-1 flex flex-col min-w-0">
                <Link href={`/product/${product.id}`}>
                  <h3 className="font-bold text-sm text-gray-900 line-clamp-2 leading-tight mb-1">{product.name}</h3>
                  <div className="text-xs text-gray-500 mb-2">{product.spec || product.category}</div>
                </Link>
                
                <div className="flex justify-between items-end mt-auto">
                  <div className="font-bold text-primary">{formatPrice(getPrice(product))}</div>
                  
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="h-8 w-8 rounded-full border-gray-200 text-gray-400 hover:text-destructive hover:bg-destructive/5"
                      onClick={() => handleRemove(product.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                    <Button 
                      size="icon" 
                      className="h-8 w-8 rounded-full shadow-sm"
                      onClick={() => handleAddToCart(product.id)}
                    >
                      <ShoppingCart size={14} />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
