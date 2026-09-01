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
import SupportPage from "./pages/Support";
import SignInPage from "./pages/SignIn";
import MemberLinktreePage from "./pages/MemberLinktree";
import LinktreePage from "./pages/Linktree";
import AdminLinktreePage from "./pages/admin/Linktree";
import SignUpPage from "./pages/SignUp";
import { AdminGuard } from "./pages/admin/AdminGuard";
import AdminDashboardPage from "./pages/admin/Dashboard";
import AdminMembersPage from "./pages/admin/Members";
import AdminProductsPage from "./pages/admin/Products";
import AdminOrdersPage from "./pages/admin/Orders";
import AdminProfitSharingPage from "./pages/admin/ProfitSharing";
import AdminWalletsPage from "./pages/admin/Wallets";
import AdminInstitutionWalletsPage from "./pages/admin/InstitutionWallets";
import AdminCommissionsPage from "./pages/admin/Commissions";
import AdminContentPage from "./pages/admin/Content";
import AdminSupportPage from "./pages/admin/Support";
import AdminAiAssistantPage from "./pages/admin/AiAssistant";
import AdminInstitutionsPage from "./pages/admin/Institutions";
import { PortalGuard } from "./pages/portal/PortalGuard";
import PortalDashboard from "./pages/portal/Dashboard";
import PortalOrders from "./pages/portal/Orders";
import PortalWallet from "./pages/portal/Wallet";
import PortalCommissions from "./pages/portal/Commissions";
import PortalReports from "./pages/portal/Reports";
import AdminSocialAccountsPage from "./pages/admin/SocialAccounts";
import AdminSocialPostsPage from "./pages/admin/SocialPosts";
import AdminNewsletterDomainsPage from "./pages/admin/NewsletterDomains";
import AdminNewsletterSubscribersPage from "./pages/admin/NewsletterSubscribers";
import AdminNewsletterCampaignsPage from "./pages/admin/NewsletterCampaigns";
import AdminNewsletterSequencesPage from "./pages/admin/NewsletterSequences";
import AdminSequenceFlowEditorPage from "./pages/admin/SequenceFlowEditor";

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
        <Switch>
          <Route path="/admin" component={AdminDashboardPage} />
          <Route path="/admin/members" component={AdminMembersPage} />
          <Route path="/admin/products" component={AdminProductsPage} />
          <Route path="/admin/orders" component={AdminOrdersPage} />
          <Route path="/admin/content" component={AdminContentPage} />
          <Route path="/admin/support" component={AdminSupportPage} />
          <Route path="/admin/ai-assistant" component={AdminAiAssistantPage} />
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
        <Route path="/u/:memberId" component={LinktreePage} />
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
