import { lazy, Suspense } from "react";
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
const QuickOrderPage = lazy(() => import("./pages/QuickOrder"));
const CartPage = lazy(() => import("./pages/Cart"));
const CheckoutPage = lazy(() => import("./pages/Checkout"));
const OrdersPage = lazy(() => import("./pages/Orders"));
const OrderDetailPage = lazy(() => import("./pages/OrderDetail"));
const KnowledgePage = lazy(() => import("./pages/Knowledge"));
const ArticlePage = lazy(() => import("./pages/Article"));
const HospitalsPage = lazy(() => import("./pages/Hospitals"));
const NewsPage = lazy(() => import("./pages/News"));
const FavoritesPage = lazy(() => import("./pages/Favorites"));
const MemberPage = lazy(() => import("./pages/Member"));
const PointsPage = lazy(() => import("./pages/Points"));
const SupportPage = lazy(() => import("./pages/Support"));
import SignInPage from "./pages/SignIn";
const MemberLinktreePage = lazy(() => import("./pages/MemberLinktree"));
const LinktreePage = lazy(() => import("./pages/Linktree"));
const AdminLinktreePage = lazy(() => import("./pages/admin/Linktree"));
const SignUpPage = lazy(() => import("./pages/SignUp"));
import { AdminGuard } from "./pages/admin/AdminGuard";
const AdminDashboardPage = lazy(() => import("./pages/admin/Dashboard"));
const AdminMembersPage = lazy(() => import("./pages/admin/Members"));
const AdminProductsPage = lazy(() => import("./pages/admin/Products"));
const AdminOrdersPage = lazy(() => import("./pages/admin/Orders"));
const AdminProfitSharingPage = lazy(() => import("./pages/admin/ProfitSharing"));
const AdminWalletsPage = lazy(() => import("./pages/admin/Wallets"));
const AdminInstitutionWalletsPage = lazy(() => import("./pages/admin/InstitutionWallets"));
const AdminCommissionsPage = lazy(() => import("./pages/admin/Commissions"));
const AdminContentPage = lazy(() => import("./pages/admin/Content"));
const AdminSupportPage = lazy(() => import("./pages/admin/Support"));
const AdminAiAssistantPage = lazy(() => import("./pages/admin/AiAssistant"));
const AdminInstitutionsPage = lazy(() => import("./pages/admin/Institutions"));
import { PortalGuard } from "./pages/portal/PortalGuard";
const PortalDashboard = lazy(() => import("./pages/portal/Dashboard"));
const PortalOrders = lazy(() => import("./pages/portal/Orders"));
const PortalWallet = lazy(() => import("./pages/portal/Wallet"));
const PortalCommissions = lazy(() => import("./pages/portal/Commissions"));
const PortalReports = lazy(() => import("./pages/portal/Reports"));
const AdminSocialAccountsPage = lazy(() => import("./pages/admin/SocialAccounts"));
const AdminSocialPostsPage = lazy(() => import("./pages/admin/SocialPosts"));
const AdminNewsletterDomainsPage = lazy(() => import("./pages/admin/NewsletterDomains"));
const AdminNewsletterSubscribersPage = lazy(() => import("./pages/admin/NewsletterSubscribers"));
const AdminNewsletterCampaignsPage = lazy(() => import("./pages/admin/NewsletterCampaigns"));
const AdminNewsletterSequencesPage = lazy(() => import("./pages/admin/NewsletterSequences"));
const AdminSequenceFlowEditorPage = lazy(() => import("./pages/admin/SequenceFlowEditor"));
const AdminAiCmoPage = lazy(() => import("./pages/admin/AiCmo"));
const AdminAiKnowledgePage = lazy(() => import("./pages/admin/AiKnowledge"));
const AdminBotConnectionPage = lazy(() => import("./pages/admin/BotConnection"));
const AdminAiCreditsPage = lazy(() => import("./pages/admin/AiCredits"));
const SystemManualPage = lazy(() => import("./pages/SystemManual"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// 頁面分開載入時的等待畫面
function PageLoading() {
  return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">載入中...</div>;
}

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

function PortalRoute({ component: Component, ...rest }: { component: any, [x: string]: any }) {
  return (
    <Route {...rest}>
      <PortalGuard>
        <Component />
      </PortalGuard>
    </Route>
  );
}

function AppLayoutWithHealthCheck({ children }: { children: React.ReactNode }) {
  useHealthCheck();
  return <AppLayout>{children}</AppLayout>;
}

function AdminArea() {
  return (
    <AdminGuard>
      <ErrorBoundary resetKey={window.location.pathname}>
        <Suspense fallback={<PageLoading />}>
        <Switch>
          <Route path="/admin" component={AdminDashboardPage} />
          <Route path="/admin/members" component={AdminMembersPage} />
          <Route path="/admin/products" component={AdminProductsPage} />
          <Route path="/admin/orders" component={AdminOrdersPage} />
          <Route path="/admin/content" component={AdminContentPage} />
          <Route path="/admin/support" component={AdminSupportPage} />
          <Route path="/admin/ai-assistant" component={AdminAiAssistantPage} />
          <Route path="/admin/ai-knowledge" component={AdminAiKnowledgePage} />
          <Route path="/admin/ai-cmo" component={AdminAiCmoPage} />
          <Route path="/admin/bot" component={AdminBotConnectionPage} />
          <Route path="/admin/ai-credits" component={AdminAiCreditsPage} />
          <Route path="/admin/institutions" component={AdminInstitutionsPage} />
          <Route path="/admin/social-accounts" component={AdminSocialAccountsPage} />
          <Route path="/admin/social-posts" component={AdminSocialPostsPage} />
          <Route path="/admin/commissions" component={AdminCommissionsPage} />
          <Route path="/admin/profit-sharing" component={AdminProfitSharingPage} />
          <Route path="/admin/institution-wallets" component={AdminInstitutionWalletsPage} />
          <Route path="/admin/wallets" component={AdminWalletsPage} />
          <Route path="/admin/linktree" component={AdminLinktreePage} />
          <Route path="/admin/newsletter/domains" component={AdminNewsletterDomainsPage} />
          <Route path="/admin/newsletter/subscribers" component={AdminNewsletterSubscribersPage} />
          <Route path="/admin/newsletter/campaigns" component={AdminNewsletterCampaignsPage} />
          <Route path="/admin/newsletter/sequences/:id" component={AdminSequenceFlowEditorPage} />
          <Route path="/admin/newsletter/sequences" component={AdminNewsletterSequencesPage} />
          <Route>
            <Redirect to="/admin" />
          </Route>
        </Switch>
        </Suspense>
      </ErrorBoundary>
    </AdminGuard>
  );
}

function AppRoutes() {
  const [location] = useLocation();
  const isAdminArea = location.startsWith("/admin");
  const isPublicLinktree = location.startsWith("/u/");

  if (isPublicLinktree) {
    // 公開連結頁：免登入、不套用商城版型
    return (
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<PageLoading />}>
          <Route path="/u/:memberId" component={LinktreePage} />
        </Suspense>
      </QueryClientProvider>
    );
  }

  if (location === "/manual" || location.startsWith("/manual/")) {
    // 系統說明書：內部人員專用，不套用商城版型
    return (
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary resetKey={window.location.pathname}>
          <Suspense fallback={<PageLoading />}>
            <SystemManualPage />
          </Suspense>
        </ErrorBoundary>
      </QueryClientProvider>
    );
  }

  if (isAdminArea) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AdminArea />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppLayoutWithHealthCheck>
          <ErrorBoundary resetKey={window.location.pathname}>
            <Suspense fallback={<PageLoading />}>
            <Switch>
              <Route path="/" component={HomePage} />
              <Route path="/shop" component={ShopPage} />
              <Route path="/product/:id" component={ProductPage} />
              <Route path="/knowledge" component={KnowledgePage} />
              <Route path="/knowledge/:id" component={ArticlePage} />
              <Route path="/hospitals" component={HospitalsPage} />
              <Route path="/news" component={NewsPage} />

              <PortalRoute path="/portal" component={PortalDashboard} />
              <PortalRoute path="/portal/orders" component={PortalOrders} />
              <PortalRoute path="/portal/wallet" component={PortalWallet} />
              <PortalRoute path="/portal/commissions" component={PortalCommissions} />
              <PortalRoute path="/portal/reports" component={PortalReports} />

              <ProtectedRoute path="/quick-order" component={QuickOrderPage} />
              <ProtectedRoute path="/cart" component={CartPage} />
              <ProtectedRoute path="/checkout" component={CheckoutPage} />
              <ProtectedRoute path="/orders" component={OrdersPage} />
              <ProtectedRoute path="/orders/:id" component={OrderDetailPage} />
              <ProtectedRoute path="/favorites" component={FavoritesPage} />
              <ProtectedRoute path="/member" component={MemberPage} />
              <ProtectedRoute path="/points" component={PointsPage} />
              <ProtectedRoute path="/member/linktree" component={MemberLinktreePage} />
              <ProtectedRoute path="/support" component={SupportPage} />

              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />

              <Route>
                <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
                  找不到此頁面
                </div>
              </Route>
            </Switch>
            </Suspense>
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
