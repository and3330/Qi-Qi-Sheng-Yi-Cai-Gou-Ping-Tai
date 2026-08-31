import { useState, useMemo } from "react";
import { useListProducts, useGetMe, useAddCartItem, getGetCartQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatPrice } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Search, ShoppingCart, Plus, Minus, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "wouter";

export default function QuickOrderPage() {
  const { data: me } = useGetMe();
  const [search, setSearch] = useState("");
  const { data: products, isLoading } = useListProducts({ search: search || undefined });
  
  const { mutateAsync: addToCart } = useAddCartItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getPrice = (product: any) => {
    if (me?.tier === "hospital") return product.priceHospital;
    if (me?.tier === "clinic") return product.priceClinic;
    return product.priceConsumer;
  };

  const updateQuantity = (id: number, delta: number, max: number) => {
    setQuantities(prev => {
      const current = prev[id] || 1;
      const next = Math.max(1, Math.min(max, current + delta));
      return { ...prev, [id]: next };
    });
    // Auto-select if interacting
    setSelected(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchAddToCart = async () => {
    if (selected.size === 0) {
      toast({ title: "請選擇商品", variant: "destructive" });
      return;
    }
    
    setIsSubmitting(true);
    try {
      const items = Array.from(selected).map(id => ({
        productId: id,
        quantity: quantities[id] || 1
      }));
      
      // We process them sequentially as per simple API
      for (const item of items) {
        await addToCart({ data: item });
      }
      
      toast({ title: "已批次加入購物車" });
      queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
      setSelected(new Set());
      setQuantities({});
    } catch (e) {
      toast({ title: "加入失敗，請重試", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isAllSelected = products && products.length > 0 && selected.size === products.length;
  const toggleAll = () => {
    if (isAllSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(products?.map(p => p.id) || []));
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <div className="sticky top-0 z-40 bg-primary px-4 pt-safe pb-4 shadow-md flex flex-col gap-3">
        <div className="flex items-center text-white">
          <Button asChild variant="ghost" size="icon" className="text-white hover:bg-white/20 -ml-2"><Link href="/"><ArrowLeft size={20}/></Link></Button>
          <h1 className="font-bold flex-1 text-center pr-8 text-lg">快速訂購</h1>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <Input 
            type="search" 
            placeholder="搜尋商品編號或名稱" 
            className="w-full bg-white border-0 pl-10 h-10 rounded-xl"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 bg-white">
        <div className="flex bg-gray-50 border-b p-3 text-xs font-medium text-gray-500 sticky top-[108px] z-30">
          <div className="flex items-center pl-1 pr-3">
            <Checkbox checked={isAllSelected} onCheckedChange={toggleAll} />
          </div>
          <div className="flex-1">商品編號/商品名</div>
          <div className="w-20 text-right pr-4">單價</div>
          <div className="w-24 text-center">數量</div>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-4">
            {Array(5).fill(0).map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-gray-100 pb-20">
            {products?.map(product => (
              <div key={product.id} className="flex p-3 items-center hover:bg-slate-50 transition-colors">
                <div className="flex items-center pl-1 pr-3">
                  <Checkbox checked={selected.has(product.id)} onCheckedChange={() => toggleSelect(product.id)} />
                </div>
                <div className="flex-1 min-w-0 pr-2">
                  <div className="text-primary font-bold text-xs">{product.code}</div>
                  <div className="text-sm font-medium text-gray-900 line-clamp-1">{product.name}</div>
                </div>
                <div className="w-20 text-right font-bold text-gray-900 pr-3">
                  {formatPrice(getPrice(product)).replace('NT$', '$')}
                </div>
                <div className="w-24 flex items-center border rounded border-gray-200 bg-white h-8 overflow-hidden">
                  <button 
                    className="flex-1 flex justify-center items-center h-full text-gray-500 disabled:opacity-30 bg-gray-50 hover:bg-gray-100"
                    onClick={() => updateQuantity(product.id, -1, product.stock)}
                    disabled={product.stock <= 0}
                  >
                    <Minus size={12} />
                  </button>
                  <div className="w-8 text-center text-sm font-medium">
                    {quantities[product.id] || 1}
                  </div>
                  <button 
                    className="flex-1 flex justify-center items-center h-full text-gray-500 disabled:opacity-30 bg-gray-50 hover:bg-gray-100"
                    onClick={() => updateQuantity(product.id, 1, product.stock)}
                    disabled={product.stock <= 0}
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            ))}
            {products?.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">沒有找到符合的商品</div>
            )}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 z-50 w-full max-w-md bg-white border-t p-3 pb-safe shadow-[0_-4px_16px_rgba(0,0,0,0.05)]">
        <Button 
          className="w-full h-12 text-base font-bold rounded-xl"
          disabled={selected.size === 0 || isSubmitting}
          onClick={handleBatchAddToCart}
        >
          {isSubmitting ? "加入中..." : `批次加入購物車 (${selected.size})`}
        </Button>
      </div>
    </div>
  );
}
