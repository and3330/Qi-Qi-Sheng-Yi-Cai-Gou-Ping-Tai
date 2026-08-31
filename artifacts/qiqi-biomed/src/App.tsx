import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useHealthCheck } from "@workspace/api-client-react";
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppLayout } from "./components/layout/AppLayout";
import { ErrorBoundary } from '@/components/error-boundary';

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

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(122 35% 39%)",
    colorForeground: "hsl(120 5% 15%)",
    colorMutedForeground: "hsl(120 5% 45%)",
    colorDanger: "hsl(0 84.2% 60.2%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(120 10% 90%)",
    colorInputForeground: "hsl(120 5% 15%)",
    colorNeutral: "hsl(120 10% 90%)",
    fontFamily: "'Noto Sans TC', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-lg",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground font-bold",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    formFieldLabel: "text-foreground font-medium",
    footerActionLink: "text-primary hover:text-primary/80 font-medium",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
    identityPreviewEditButton: "text-primary",
    formFieldSuccessText: "text-primary",
    alertText: "text-foreground",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 pb-20">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 pb-20">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function ProtectedRoute({ component: Component, ...rest }: { component: any, [x: string]: any }) {
  return (
    <Route {...rest}>
      <Show when="signed-in">
        <Component />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </Route>
  );
}

function AppLayoutWithHealthCheck({ children }: { children: React.ReactNode }) {
  useHealthCheck();
  return <AppLayout>{children}</AppLayout>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "歡迎回來",
            subtitle: "登入以繼續使用七期生醫採購平台",
          },
        },
        signUp: {
          start: {
            title: "建立帳號",
            subtitle: "立即註冊，體驗專業醫療採購服務",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ClerkQueryClientCacheInvalidator />
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
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
