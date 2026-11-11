import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { Trash2, Plus, Minus, ArrowRight, ShoppingBag } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useGetCart, useUpdateCartItem, useRemoveCartItem, useClearCart, useGetMe, getGetCartQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export default function CartPage() {
  const [, setLocation] = useLocation();
  const { data: cart, isLoading } = useGetCart();
  const { data: me } = useGetMe();
  
  const { mutate: updateItem } = useUpdateCartItem();
  const { mutate: removeItem } = useRemoveCartItem();
  const { mutate: clearCartMutate } = useClearCart();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleClearCart = () => {
    clearCartMutate(undefined, {
      onSuccess: () => {
        toast({ title: "已清空購物車" });
        queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
      }
    });
  };

  const getPrice = (item: any) => {
    const target = item.variant || item.product;
    if (me?.tier === "hospital") return target.priceHospital;
    if (me?.tier === "clinic") return target.priceClinic;
    return target.priceConsumer;
  };

  const total = useMemo(() => {
    return cart?.reduce((sum, item) => sum + (getPrice(item) * item.quantity), 0) || 0;
  }, [cart, me]);

  const handleUpdateQuantity = (id: number, quantity: number) => {
    updateItem({ id, data: { quantity } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() })
    });
  };

  const handleRemove = (id: number) => {
    removeItem({ id }, {
      onSuccess: () => {
        toast({ title: "已移除商品" });
        queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 pb-20 pt-4 px-4 space-y-4">
        <Skeleton className="h-8 w-1/3 mb-2" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  }

  if (!cart || cart.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 animate-in fade-in">
        <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6">
          <ShoppingBag size={48} className="text-gray-300" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">購物車是空的</h2>
        <p className="text-sm text-gray-500 mb-8 text-center">再去逛逛，挑選適合的醫療保健商品吧！</p>
        <Button asChild className="rounded-full px-8"><Link href="/shop">前往商城</Link></Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-40 animate-in fade-in">
      <div className="bg-white px-4 pt-safe pb-4 shadow-sm sticky top-0 z-30 flex justify-between items-center">
        <h1 className="font-bold text-xl text-gray-900 pt-2">購物車 ({cart.length})</h1>
        <Button variant="ghost" size="sm" className="text-gray-400 hover:text-destructive mt-2" onClick={handleClearCart}>
          清空
        </Button>
      </div>

      <div className="p-4 space-y-3">
        {cart.map(item => (
          <div key={item.id} className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 flex gap-3">
            <div className="w-20 h-20 bg-gray-50 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center">
              {item.product.imageUrl ? (
                <img loading="lazy" decoding="async" src={item.product.imageUrl} alt={item.product.name} className="w-full h-full object-cover mix-blend-multiply" />
              ) : (
                <ShoppingBag className="text-gray-200" size={24} />
              )}
            </div>
            
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex justify-between items-start gap-2 mb-1">
                <div>
                  <h3 className="font-bold text-sm text-gray-900 line-clamp-2 leading-tight">{item.product.name}</h3>
                  {item.variant && (
                    <span className="inline-block bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded mt-1">
                      規格：{item.variant.name}
                    </span>
                  )}
                </div>
                <button onClick={() => handleRemove(item.id)} className="text-gray-400 hover:text-destructive p-1 -mr-1 -mt-1 shrink-0">
                  <Trash2 size={16} />
                </button>
              </div>
              
              <div className="text-xs text-gray-500 mb-auto">{item.product.spec || item.product.code}</div>
              
              <div className="flex justify-between items-end mt-2">
                <div className="font-bold text-primary">{formatPrice(getPrice(item))}</div>
                
                <div className="flex items-center border rounded-lg overflow-hidden h-8 bg-gray-50 border-gray-200">
                  <button 
                    className="w-8 h-full flex items-center justify-center text-gray-500 disabled:opacity-50"
                    onClick={() => handleUpdateQuantity(item.id, item.quantity - 1)}
                    disabled={item.quantity <= 1}
                  >
                    <Minus size={14} />
                  </button>
                  <div className="w-8 h-full flex items-center justify-center font-bold text-xs bg-white border-x border-gray-200">
                    {item.quantity}
                  </div>
                  <button 
                    className="w-8 h-full flex items-center justify-center text-gray-500 disabled:opacity-50"
                    onClick={() => handleUpdateQuantity(item.id, item.quantity + 1)}
                    disabled={item.quantity >= (item.variant ? item.variant.stock : item.product.stock)}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="sticky bottom-nav-offset lg:bottom-0 z-30 w-full bg-white border-t rounded-t-3xl shadow-[0_-8px_20px_rgba(0,0,0,0.08)]">
        <div className="p-5">
          <div className="flex justify-between items-center mb-4">
            <span className="text-gray-500 text-sm">結帳總金額</span>
            <span className="text-2xl font-bold text-destructive">{formatPrice(total)}</span>
          </div>
          <Button 
            className="w-full h-12 text-base font-bold rounded-xl"
            onClick={() => setLocation("/checkout")}
          >
            前往結帳 <ArrowRight size={18} className="ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
