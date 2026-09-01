import React, { useMemo } from 'react';
import { Link, useLocation } from 'wouter';
import { useErpAuth } from '@/hooks/use-erp-auth';
import { NAV_CONFIG } from '@/lib/nav';
import { ERP_ROLES, ErpRole } from '@/lib/roles';
import { useGetErpMenuPermissions, getGetErpMenuPermissionsQueryKey } from '@workspace/api-client-react';
import { LogOut, LayoutDashboard, Users, Building2, Shield, Activity, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useErpAuth();
  const [location] = useLocation();

  const { data: menuPermissions } = useGetErpMenuPermissions({
    query: {
      queryKey: getGetErpMenuPermissionsQueryKey(),
      enabled: !!user?.erpRole,
    }
  });

  const visibleNavGroups = useMemo(() => {
    if (!user?.erpRole) return {};

    const role = user.erpRole;
    const overrides = menuPermissions?.overrides || {};

    const groups: Record<string, typeof NAV_CONFIG> = {};

    for (const item of NAV_CONFIG) {
      const allowedRoles = overrides[item.path] || item.defaultRoles;
      const canSee = role === 'super_admin' || allowedRoles.length === 0 || allowedRoles.includes(role);

      if (canSee) {
        if (!groups[item.group]) {
          groups[item.group] = [];
        }
        groups[item.group].push(item);
      }
    }

    return groups;
  }, [user, menuPermissions]);

  const getIcon = (path: string) => {
    switch (path) {
      case '/': return <LayoutDashboard className="w-4 h-4 mr-3" />;
      case '/system/users': return <Users className="w-4 h-4 mr-3" />;
      case '/system/departments': return <Building2 className="w-4 h-4 mr-3" />;
      case '/system/menu-permissions': return <Shield className="w-4 h-4 mr-3" />;
      case '/system/audit-logs': return <Activity className="w-4 h-4 mr-3" />;
      default: return null;
    }
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col shrink-0">
        <div className="h-16 flex items-center gap-2.5 px-6 border-b border-sidebar-border">
          <img
            src="/images/brand/logo-mark.png"
            alt="七期生醫"
            className="h-8 w-8 rounded-lg object-cover shrink-0"
          />
          <span className="font-bold text-lg tracking-wider">七期生醫 ERP</span>
        </div>

        <nav className="flex-1 py-6 px-4 space-y-8 overflow-y-auto">
          {Object.entries(visibleNavGroups).map(([groupName, items]) => (
            <div key={groupName}>
              <h3 className="px-2 text-xs font-semibold text-sidebar-foreground/60 uppercase tracking-wider mb-2">
                {groupName}
              </h3>
              <ul className="space-y-1">
                {items.map(item => (
                  <li key={item.path}>
                    <Link
                      href={item.path}
                      className={`flex items-center px-3 py-2 text-sm rounded-md transition-colors ${
                        location === item.path
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                      }`}
                    >
                      {getIcon(item.path)}
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
             <h3 className="px-2 text-xs font-semibold text-sidebar-foreground/60 uppercase tracking-wider mb-2">
                外部連結
              </h3>
              <ul className="space-y-1">
                <li>
                  <a
                    href="/admin"
                    className="flex items-center px-3 py-2 text-sm rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 mr-3" />
                    回到管理後台
                  </a>
                </li>
              </ul>
          </div>
        </nav>

        <div className="p-4 border-t border-sidebar-border bg-sidebar/50">
          <div className="flex items-center justify-between">
            <div className="truncate pr-2">
              <p className="text-sm font-medium truncate">{user?.name || user?.username}</p>
              <p className="text-xs text-sidebar-foreground/60">
                {user?.erpRole ? ERP_ROLES[user.erpRole as ErpRole] || user.erpRole : '無權限'}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground shrink-0"
              onClick={logout}
              title="登出"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-secondary/30">
        <header className="h-16 bg-card border-b flex items-center px-8 shrink-0">
          <h2 className="text-lg font-semibold text-card-foreground">
            {NAV_CONFIG.find(item => item.path === location)?.label || '頁面'}
          </h2>
        </header>
        <div className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
