import CompanyFooter from '@/components/CompanyFooter';
import { Link } from "wouter";
import { 
  ShoppingBag, Building2, BookOpen, Bell, Search, 
  ShoppingCart, User, ShieldCheck, CheckCircle2, 
  Truck, Crown, Menu, CreditCard, HeadphonesIcon, TrendingUp, ChevronRight
} from "lucide-react";
import { useGetHomeSummary, useGetPortalSummary, getGetPortalSummaryQueryKey, useAddCartItem, getGetCartQueryKey, useGetCart } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useQueryClient } from "@tanstack/react-query";
import { formatPrice, classNames } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function HomePage() {
  const { isLoaded, isSignedIn, me } = useAuth();
  const { data: cart } = useGetCart({ 
    query: { 
      enabled: isLoaded && !!isSignedIn,
      queryKey: getGetCartQueryKey() 
    } 
  });
  const cartCount = cart?.reduce((acc, item) => acc + item.quantity, 0) || 0;

  const { data: portalSummary } = useGetPortalSummary({
    query: {
      enabled: isLoaded && !!isSignedIn && (me?.tier === 'hospital' || me?.tier === 'clinic'),
      queryKey: getGetPortalSummaryQueryKey()
    }
  });

  const { data: summary, isLoading } = useGetHomeSummary();
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

  const features = [
    { name: "商城", desc: "私域商城採購", icon: ShoppingBag, path: "/shop" },
    { name: "合作醫院", desc: "院所清單", icon: Building2, path: "/hospitals" },
    { name: "知識專區", desc: "文章・常見問題", icon: BookOpen, path: "/knowledge" },
    { name: "最新消息", desc: "平台公告", icon: Bell, path: "/news", badge: "新" },
    { name: "訂單查詢", desc: "出貨・追蹤", icon: Search, path: "/orders" },
    { name: "會員分級", desc: "等級・權益", icon: Crown, path: "/member" },
  ];

  return (
    <div className="flex flex-col animate-in fade-in duration-500 pb-8 bg-gray-50 min-h-screen">
      
      {/* Sticky Header */}
      <div className="sticky top-0 z-40 bg-primary px-4 pt-safe pb-3 shadow-sm flex items-center justify-between">
        <div className="p-2 text-white/90 hover:text-white transition-colors -ml-2 cursor-pointer">
          <Menu size={24} />
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center p-1 shadow-sm">
            <img src="/logo.svg" alt="Logo" className="w-full h-full object-contain" />
          </div>
          <span className="text-white font-bold text-lg tracking-wide">七期生醫採購平台</span>
        </div>
        <div className="flex items-center gap-1 -mr-2">
          <Link href="/shop" className="p-2 text-white/90 hover:text-white transition-colors">
            <Search size={22} />
          </Link>
          <Link href="/cart" className="p-2 text-white/90 hover:text-white transition-colors relative">
            <ShoppingCart size={22} />
            {cartCount > 0 && (
              <span className="absolute top-1.5 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white shadow-sm ring-1 ring-primary">
                {cartCount > 99 ? '99+' : cartCount}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* Hero Banner */}
      <div className="bg-primary pb-12 pt-4 relative overflow-hidden -mb-6 rounded-b-[2rem]">
        <div className="px-4">
          <div className="bg-[#2a7a44] rounded-2xl relative overflow-hidden flex items-center min-h-[220px] shadow-lg border border-white/10">
            {/* Content left */}
            <div className="flex-1 p-5 z-10 relative text-white max-w-[65%]">
              <span className="inline-block px-2.5 py-1 bg-white/20 text-white text-[10px] font-medium rounded-full mb-3 backdrop-blur-sm shadow-sm border border-white/10">
                專業醫療・用心守護
              </span>
              <h1 className="text-2xl font-bold mb-2 leading-tight drop-shadow-sm">一站式醫藥採購平台</h1>
              <p className="text-[11px] text-white/90 mb-4 leading-relaxed whitespace-nowrap drop-shadow-sm font-medium">
                醫院・診所・藥局・消費者<br/>共創健康價值
              </p>
              
              <div className="flex flex-wrap gap-x-2 gap-y-1.5 text-[9px] text-white mb-5 max-w-[180px] font-medium">
                <span className="flex items-center gap-0.5"><CheckCircle2 size={10} className="text-green-300"/>正品保障</span>
                <span className="flex items-center gap-0.5"><Truck size={10} className="text-green-300"/>快速出貨</span>
                <span className="flex items-center gap-0.5"><ShieldCheck size={10} className="text-green-300"/>合規透明</span>
                <span className="flex items-center gap-0.5"><User size={10} className="text-green-300"/>會員專屬</span>
              </div>
              
              <div className="bg-white text-primary text-[11px] font-bold px-4 py-2 rounded-full shadow-md hover:bg-white/90 transition-colors inline-block cursor-pointer active:scale-95">
                了解更多 →
              </div>
            </div>
            
            {/* Illustration right */}
            <div className="absolute right-0 bottom-0 top-0 w-1/2 z-0">
              <div className="absolute inset-0 bg-gradient-to-r from-[#2a7a44] via-[#2a7a44]/80 to-transparent z-10 w-full"></div>
              <img src="/images/hero-banner.jpg" alt="Hero Illustration" className="w-full h-full object-cover object-left opacity-90 mix-blend-luminosity" />
            </div>
          </div>
          
          {/* Dots */}
          <div className="flex justify-center gap-1.5 mt-4">
            <div className="w-5 h-1.5 rounded-full bg-white shadow-sm"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-white/40 shadow-sm"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-white/40 shadow-sm"></div>
          </div>
        </div>
      </div>

      {/* Portal Entry (for Hospital/Clinic members) */}
      {isSignedIn && (me?.tier === 'hospital' || me?.tier === 'clinic') && portalSummary && (
        <div className="px-4 relative z-20 mb-6">
          <div className="bg-gradient-to-r from-primary to-[#2a7a44] rounded-2xl shadow-md p-4 text-white overflow-hidden relative">
            <div className="absolute top-0 right-0 opacity-10 transform translate-x-1/4 -translate-y-1/4 pointer-events-none">
              <Building2 size={120} />
            </div>
            <div className="relative z-10 flex flex-col h-full justify-between">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-medium mb-1.5 inline-block">
                    {me.tier === 'hospital' ? '醫院會員' : '診所/藥局會員'}
                  </span>
                  <h2 className="font-bold text-lg">{portalSummary.institutionName || '尚未綁定院所'}</h2>
                </div>
                <div className="bg-white text-primary w-10 h-10 rounded-full flex items-center justify-center shadow-sm">
                  <Building2 size={20} />
                </div>
              </div>
              <div className="flex items-end justify-between bg-white/10 rounded-xl p-3 backdrop-blur-sm border border-white/20">
                <div>
                  <div className="text-[10px] text-white/80 mb-0.5 flex items-center gap-1">
                    <TrendingUp size={10} /> 本月採購金額
                  </div>
                  <div className="font-bold text-xl">{formatPrice(portalSummary.monthPurchaseTotal)}</div>
                </div>
                <Link href="/portal" className="bg-white text-primary text-xs font-bold px-4 py-2 rounded-full shadow-sm hover:bg-gray-50 transition-colors active:scale-95 inline-flex items-center">
                  進入機構後台 <ChevronRight size={14} className="ml-1" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Entry (for Admin/Ops/Support) */}
      {isSignedIn && me?.role && me.role !== 'member' && (
        <div className="px-4 relative z-20 mb-6">
          <Link href="/admin" className="bg-gray-900 rounded-2xl shadow-md p-4 text-white overflow-hidden relative flex items-center justify-between active:scale-95 transition-transform">
            <div>
              <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-medium mb-1.5 inline-block">
                內部人員
              </span>
              <h2 className="font-bold text-lg">進入管理後台</h2>
            </div>
            <div className="bg-white/10 w-10 h-10 rounded-full flex items-center justify-center">
              <ChevronRight size={20} />
            </div>
          </Link>
        </div>
      )}

      {/* Feature Grid */}
      <div className="px-4 relative z-20 mb-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 grid grid-cols-2 gap-y-3 gap-x-2">
          {features.map((f, i) => (
            <Link key={i} href={f.path} className="flex items-center gap-3 p-2 rounded-xl hover:bg-[#f8faf9] transition-colors active-elevate group">
              <div className="w-12 h-12 rounded-xl bg-[#eaf4ed] text-primary flex items-center justify-center relative flex-shrink-0 group-hover:bg-primary group-hover:text-white transition-colors duration-300">
                <f.icon size={22} strokeWidth={2} />
                {f.badge && (
                  <span className="absolute -top-1 -right-1 bg-destructive text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-white shadow-sm">
                    {f.badge}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-800 text-[13px] whitespace-nowrap mb-0.5">{f.name}</h3>
                <p className="text-[10px] text-gray-400 truncate">{f.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Announcements */}
      <div className="px-4 mb-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-900 text-base">
              最新消息
            </h2>
            <Link href="/news" className="text-[11px] text-gray-400 hover:text-primary flex items-center">
              查看全部 &gt;
            </Link>
          </div>
          <div className="space-y-3.5">
            {isLoading ? (
              Array(3).fill(0).map((_, i) => (
                <div key={i} className="flex justify-between items-center animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-2/3" />
                  <div className="h-3 bg-gray-100 rounded w-16" />
                </div>
              ))
            ) : summary?.announcements?.slice(0, 3).map(ann => (
              <Link key={ann.id} href={`/news`} className="flex justify-between items-center group">
                <div className="flex items-center gap-2.5 overflow-hidden flex-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0"></div>
                  <span className="text-[13px] font-medium text-gray-700 truncate group-hover:text-primary transition-colors">{ann.title}</span>
                </div>
                <span className="text-[10px] text-gray-400 flex-shrink-0 ml-3">
                  {new Date(ann.publishedAt).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Hot Products */}
      <div className="mb-6">
        <div className="flex items-center justify-between px-4 mb-3">
          <h2 className="font-bold text-gray-900 text-base">熱門商品</h2>
          <Link href="/shop" className="text-[11px] text-gray-400 hover:text-primary flex items-center">
            查看全部 &gt;
          </Link>
        </div>
        
        {/* Horizontal Scroll */}
        <div className="flex overflow-x-auto gap-3 px-4 pb-4 snap-x snap-mandatory hide-scrollbar">
          {isLoading ? (
            Array(4).fill(0).map((_, i) => (
              <div key={i} className="w-[140px] flex-shrink-0 bg-white rounded-xl shadow-sm border border-gray-100 p-2 animate-pulse snap-start">
                <div className="aspect-square bg-gray-100 rounded-lg mb-2" />
                <div className="h-3 bg-gray-200 rounded w-full mb-1" />
                <div className="h-3 bg-gray-200 rounded w-2/3 mb-2" />
                <div className="mt-2 pt-2 border-t border-gray-50 flex justify-between">
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                  <div className="w-6 h-6 bg-gray-200 rounded-full" />
                </div>
              </div>
            ))
          ) : summary?.hotProducts.map(product => (
            <Link key={product.id} href={`/product/${product.id}`} className="w-[140px] flex-shrink-0 bg-white rounded-xl shadow-sm border border-gray-100 p-2 flex flex-col snap-start active-elevate group">
              <div className="relative aspect-square rounded-lg overflow-hidden mb-2 bg-gray-50 flex items-center justify-center">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover mix-blend-multiply group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <ShoppingBag className="text-gray-200" size={24} />
                )}
                {product.isHot && (
                  <span className="absolute top-1.5 left-1.5 bg-destructive text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm">熱銷</span>
                )}
              </div>
              
              <h3 className="text-xs font-bold text-gray-800 line-clamp-2 mb-1 leading-snug">{product.name}</h3>
              <p className="text-[10px] text-gray-400 line-clamp-1 mb-auto">{product.description || product.category || '規格詳情'}</p>
              
              <div className="mt-2 pt-2 flex items-center justify-between">
                <div>
                  <span className="text-primary font-bold text-sm leading-none">{formatPrice(product.priceConsumer)}</span>
                </div>
                <div 
                  role="button"
                  tabIndex={0}
                  className="h-6 w-6 rounded-full bg-primary text-white hover:bg-primary/90 flex-shrink-0 shadow-sm flex items-center justify-center transition-colors"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAddCart(product.id); }}
                >
                  <ShoppingCart size={12} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Light Strip Features */}
      <div className="px-4 mb-4">
        <div className="bg-[#f8faf9] border border-[#edf3f0] rounded-2xl p-4 flex justify-between gap-1 shadow-sm">
          <div className="flex-1 flex flex-col items-center text-center">
            <div className="w-8 h-8 rounded-full bg-white shadow-sm border border-gray-50 flex items-center justify-center text-primary mb-2">
              <ShieldCheck size={16} />
            </div>
            <span className="text-[11px] font-bold text-gray-800 mb-0.5 whitespace-nowrap">合規正品</span>
            <span className="text-[9px] text-gray-500 whitespace-nowrap">原廠授權</span>
          </div>
          <div className="flex-1 flex flex-col items-center text-center">
            <div className="w-8 h-8 rounded-full bg-white shadow-sm border border-gray-50 flex items-center justify-center text-primary mb-2">
              <Crown size={16} />
            </div>
            <span className="text-[11px] font-bold text-gray-800 mb-0.5 whitespace-nowrap">合約價優惠</span>
            <span className="text-[9px] text-gray-500 whitespace-nowrap">會員專屬</span>
          </div>
          <div className="flex-1 flex flex-col items-center text-center">
            <div className="w-8 h-8 rounded-full bg-white shadow-sm border border-gray-50 flex items-center justify-center text-primary mb-2">
              <CreditCard size={16} />
            </div>
            <span className="text-[11px] font-bold text-gray-800 mb-0.5 whitespace-nowrap">彈性付款</span>
            <span className="text-[9px] text-gray-500 whitespace-nowrap">線上對帳</span>
          </div>
          <div className="flex-1 flex flex-col items-center text-center">
            <div className="w-8 h-8 rounded-full bg-white shadow-sm border border-gray-50 flex items-center justify-center text-primary mb-2">
              <HeadphonesIcon size={16} />
            </div>
            <span className="text-[11px] font-bold text-gray-800 mb-0.5 whitespace-nowrap">專業客服</span>
            <span className="text-[9px] text-gray-500 whitespace-nowrap">即時支援</span>
          </div>
        </div>
      </div>

      <CompanyFooter />
    </div>
  );
}
