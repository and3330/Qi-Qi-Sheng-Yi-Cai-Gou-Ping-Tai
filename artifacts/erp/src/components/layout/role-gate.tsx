import React from 'react';
import { useErpAuth } from '@/hooks/use-erp-auth';
import { NAV_CONFIG } from '@/lib/nav';
import { useGetErpMenuPermissions, getGetErpMenuPermissionsQueryKey } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { ShieldAlert } from 'lucide-react';

export function RoleGate({ children }: { children: React.ReactNode }) {
  const { user } = useErpAuth();
  const [location] = useLocation();
  const { data: menuPermissions, isLoading } = useGetErpMenuPermissions({
    query: {
      queryKey: getGetErpMenuPermissionsQueryKey(),
      enabled: !!user?.erpRole,
    }
  });

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="animate-pulse space-y-4 text-center">
          <div className="h-4 w-32 bg-muted rounded mx-auto"></div>
        </div>
      </div>
    );
  }

  const role = user?.erpRole;
  if (!role) {
    return <AccessDenied />;
  }

  const navItem = NAV_CONFIG.find(item => item.path === location);
  
  if (!navItem) {
    // If it's a dynamic route or not in nav config, we might need custom logic.
    // For this ERP, all pages are in NAV_CONFIG explicitly. If not found, let it pass and App router will handle 404.
    return <>{children}</>;
  }

  const overrides = menuPermissions?.overrides || {};
  const allowedRoles = overrides[navItem.path] || navItem.defaultRoles;

  const canSee = role === 'super_admin' || allowedRoles.length === 0 || allowedRoles.includes(role);

  if (!canSee) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center max-w-md mx-auto">
      <div className="w-16 h-16 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mb-6">
        <ShieldAlert className="w-8 h-8" />
      </div>
      <h2 className="text-2xl font-bold mb-2">無權限</h2>
      <p className="text-muted-foreground mb-8">
        您的角色無法存取此頁面。若您認為這是個錯誤，請聯繫系統管理員調整您的選單權限。
      </p>
    </div>
  );
}
