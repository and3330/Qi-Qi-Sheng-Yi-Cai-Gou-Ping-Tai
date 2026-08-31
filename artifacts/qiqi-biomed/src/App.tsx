import { useEffect } from "react";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useHealthCheck } from "@workspace/api-client-react";
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppLayout } from "./components/layout/AppLayout";
import { ErrorBoundary } from '@/components/error-boundary';
import { useAuth } from "./hooks/use-auth";

// Pages
import HomePage from "./pages/Home";
import ShopPage from "./pages/Shop";
import ProductPage from "./pages/Product";
import QuickOrderPage from "./pages/QuickOrder";
import CartPage from "./pages/Cart";
import CheckoutPage from "./pages/Checkout";
import OrdersPage from "./pages/Orders";
import OrderDetailPage from "./pages/OrderDetail";
import KnowledgePage from "./pages/Knowledge";
import ArticlePage from "./pages/Article";
import HospitalsPage from "./pages/Hospitals";
import NewsPage from "./pages/News";
import FavoritesPage from "./pages/Favorites";
import MemberPage from "./pages/Member";
import SignInPage from "./pages/SignIn";
import SignUpPage from "./pages/SignUp";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function ProtectedRoute({ component: Component, ...rest }: { component: any, [x: string]: any }) {
  const { isLoaded, isSignedIn } = useAuth();
  
  if (!isLoaded) {
    return <div className="flex h-screen items-center justify-center">載入中...</div>;
  }
  
  if (!isSignedIn) {
    return <Redirect to="/sign-in" />;
  }

  return (
    <Route {...rest}>
      <Component />
    </Route>
  );
}

function AppLayoutWithHealthCheck({ children }: { children: React.ReactNode }) {
  useHealthCheck();
  return <AppLayout>{children}</AppLayout>;
}

function AppRoutes() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppLayoutWithHealthCheck>
          <ErrorBoundary resetKey={window.location.pathname}>
            <Switch>
              <Route path="/" component={HomePage} />
              <Route path="/shop" component={ShopPage} />
              <Route path="/product/:id" component={ProductPage} />
              <Route path="/knowledge" component={KnowledgePage} />
              <Route path="/knowledge/:id" component={ArticlePage} />
              <Route path="/hospitals" component={HospitalsPage} />
              <Route path="/news" component={NewsPage} />
              
              <ProtectedRoute path="/quick-order" component={QuickOrderPage} />
              <ProtectedRoute path="/cart" component={CartPage} />
              <ProtectedRoute path="/checkout" component={CheckoutPage} />
              <ProtectedRoute path="/orders" component={OrdersPage} />
              <ProtectedRoute path="/orders/:id" component={OrderDetailPage} />
              <ProtectedRoute path="/favorites" component={FavoritesPage} />
              <ProtectedRoute path="/member" component={MemberPage} />

              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              
              <Route>
                <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
                  找不到此頁面
                </div>
              </Route>
            </Switch>
          </ErrorBoundary>
        </AppLayoutWithHealthCheck>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AppRoutes />
    </WouterRouter>
  );
}

export default App;
