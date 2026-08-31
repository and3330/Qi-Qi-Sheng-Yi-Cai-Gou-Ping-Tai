import { useState } from "react";
import { Link } from "wouter";
import { Search, ShoppingCart, SlidersHorizontal, ChevronDown } from "lucide-react";
import { useListProducts, useGetMe, useAddCartItem, getGetCartQueryKey, getGetMeQueryKey } from "@workspace/api-client-react";
import { formatPrice, classNames } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";

const CATEGORIES = ["全部", "保健食品", "醫療耗材", "保養清潔", "院所專區"];

export default function ShopPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { data: me } = useGetMe({ query: { enabled: isLoaded && !!isSignedIn, retry: false, queryKey: getGetMeQueryKey() } }); // won't throw if not logged in if backend returns 401 and we ignore it
  
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部");
  const [sort, setSort] = useState<"recommended" | "priceAsc" | "priceDesc" | "newest">("recommended");
  
  const { data: products, isLoading } = useListProducts({
    search: search || undefined,
    category: category === "全部" ? undefined : category,
    sort,
  });

  const { mutate: addToCart } = useAddCartItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleAddCart = (productId: number) => {
    addToCart({ data: { productId, quantity: 1 } }, {
      onSuccess: () => {
        toast({ title: "已加入購物車", duration: 2000 });
        queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
      },
      onError: () => {
        toast({ title: "請先登入", variant: "destructive", duration: 2000 });
      }
    });
  };

  const getPrice = (product: any) => {
    if (me?.tier === "hospital") return product.priceHospital;
    if (me?.tier === "clinic") return product.priceClinic;
    return product.priceConsumer;
  };

  const getTierLabel = () => {
    if (me?.tier === "hospital") return "醫院專屬價";
    if (me?.tier === "clinic") return "合作價";
    return "一般售價";
  };

  return (
    <div className="flex flex-col min-h-screen bg-background animate-in fade-in duration-300">
      <div className="sticky top-0 z-40 bg-primary px-4 pt-safe pb-4 shadow-md">
        <h1 className="text-white font-bold text-center text-lg mb-4">商城</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <Input 
            type="search" 
            placeholder="搜尋商品、品牌或關鍵字" 
            className="w-full bg-white border-0 pl-10 h-10 rounded-xl"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="px-4 py-3 bg-white border-b shadow-sm sticky top-[108px] z-30">
        <div className="flex overflow-x-auto no-scrollbar gap-2 pb-1">
          {CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={classNames(
                "px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
                category === c ? "bg-primary text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {/* Filters & Sort */}
        <div className="flex justify-between items-center mb-4 px-1">
          <div className="flex items-center text-sm font-medium text-gray-700">
            <span className="text-gray-500 font-normal">共 {products?.length || 0} 件商品</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 text-xs font-medium px-2">
                {sort === "recommended" && "推薦排序"}
                {sort === "priceAsc" && "價格由低到高"}
                {sort === "priceDesc" && "價格由高到低"}
                {sort === "newest" && "最新上架"}
                <ChevronDown size={14} className="ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[140px]">
              <DropdownMenuItem onClick={() => setSort("recommended")}>推薦排序</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSort("priceAsc")}>價格由低到高</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSort("priceDesc")}>價格由高到低</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSort("newest")}>最新上架</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Product Grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array(6).fill(0).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 animate-pulse h-64" />
            ))}
          </div>
        ) : products?.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p>找不到符合條件的商品</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {products?.map(product => (
              <Link key={product.id} href={`/product/${product.id}`} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex flex-col h-full hover-elevate">
                <div className="relative aspect-square rounded-xl overflow-hidden mb-3 bg-gray-50 flex items-center justify-center">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover mix-blend-multiply" />
                  ) : (
                    <div className="text-gray-300 font-bold text-xs">{product.code}</div>
                  )}
                  {product.isHot && (
                    <span className="absolute top-2 left-2 bg-destructive text-white text-[10px] font-bold px-1.5 py-0.5 rounded-sm">熱銷</span>
                  )}
                  {product.isNew && !product.isHot && (
                    <span className="absolute top-2 left-2 bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded-sm">新品</span>
                  )}
                </div>
                
                <h3 className="text-sm font-bold text-gray-800 line-clamp-2 mb-1">{product.name}</h3>
                <p className="text-[10px] text-gray-500 line-clamp-1 mb-auto">{product.spec || product.description || "\u00A0"}</p>
                
                <div className="mt-3 pt-3 border-t border-gray-50 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-gray-400 block -mb-0.5">{getTierLabel()}</span>
                    <span className="text-primary font-bold text-sm">{formatPrice(getPrice(product))}</span>
                  </div>
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    className="h-7 w-7 rounded-full bg-primary/10 text-primary hover:bg-primary hover:text-white shrink-0"
                    onClick={(e) => { e.preventDefault(); handleAddCart(product.id); }}
                  >
                    <ShoppingCart size={14} />
                  </Button>
                </div>
              </Link>
            ))}
          </div>
        )}
        
        {/* Delivery banner */}
        {!isLoading && products && products.length > 0 && (
          <div className="mt-6 bg-primary/5 rounded-xl p-4 flex items-center justify-between border border-primary/10">
            <div className="flex items-center gap-3">
              <div className="bg-white p-2 rounded-full text-primary">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
              </div>
              <div>
                <p className="font-bold text-sm text-gray-800">院所專區滿 NT$3,000 免運費</p>
                <p className="text-xs text-gray-500">專屬服務・快速出貨・安心保障</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
