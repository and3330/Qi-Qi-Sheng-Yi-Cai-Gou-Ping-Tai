import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Home, Newspaper, ShoppingBag, User, ShoppingCart } from "lucide-react";
import { useGetCart, getGetCartQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@clerk/react";

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  
  const { data: cart } = useGetCart({ 
    query: { 
      enabled: isLoaded && !!isSignedIn,
      queryKey: getGetCartQueryKey() 
    } 
  });
  const cartCount = cart?.reduce((acc, item) => acc + item.quantity, 0) || 0;

  const tabs = [
    { name: "首頁", icon: Home, path: "/" },
    { name: "消息", icon: Newspaper, path: "/news" },
    { name: "商城", icon: ShoppingBag, path: "/shop" },
    { name: "會員", icon: User, path: "/member" },
    { name: "購物車", icon: ShoppingCart, path: "/cart", badge: cartCount },
  ];

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col bg-background shadow-2xl overflow-hidden relative">
      <main className="flex-1 overflow-y-auto pb-16 relative">
        {children}
      </main>

      <nav className="fixed bottom-0 z-50 w-full max-w-md border-t bg-white pb-safe">
        <div className="flex h-16 items-center justify-around px-2">
          {tabs.map((tab) => {
            const isActive = tab.path === "/" ? location === "/" : location.startsWith(tab.path);
            const Icon = tab.icon;
            
            return (
              <Link key={tab.path} href={tab.path} className="relative flex flex-col items-center justify-center w-full h-full text-xs transition-colors duration-200">
                <div className={`flex flex-col items-center gap-1 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                  <div className="relative">
                    <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                    {tab.badge !== undefined && tab.badge > 0 && (
                      <span className="absolute -right-2 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white shadow-sm ring-1 ring-white">
                        {tab.badge > 99 ? '99+' : tab.badge}
                      </span>
                    )}
                  </div>
                  <span className="font-medium">{tab.name}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
