import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useErpAuth } from '@/hooks/use-erp-auth';
import { NAV_CONFIG } from '@/lib/nav';
import { ERP_ROLES, ErpRole } from '@/lib/roles';
import { useGetErpMenuPermissions, getGetErpMenuPermissionsQueryKey } from '@workspace/api-client-react';
import { LogOut, LayoutDashboard, Users, Building2, Shield, Activity, Bell, ExternalLink, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useErpAuth();
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const { data: menuPermissions } = useGetErpMenuPermissions({
    query: {
      queryKey: getGetErpMenuPermissionsQueryKey(),
      enabled: !!user?.erpRole,
    }
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchText.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ['erp-global-search', debouncedSearch],
    queryFn: () => api<SearchResult[]>(`/erp/search?q=${encodeURIComponent(debouncedSearch)}`),
    enabled: searchOpen && debouncedSearch.length > 0,
  });
  const { data: notifications = [] } = useQuery({
    queryKey: ['erp-notifications'],
    queryFn: () => api<Notification[]>('/erp/notifications'),
    refetchInterval: 60_000,
  });
  const { data: unread } = useQuery({
    queryKey: ['erp-notifications-unread'],
    queryFn: () => api<{ count: number }>('/erp/notifications/unread-count'),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: (body: { ids?: number[]; all?: boolean }) => api('/erp/notifications/read', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['erp-notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['erp-notifications-unread'] });
    },
  });

  const groupedResults = useMemo(() => {
    const groups = new Map<string, SearchResult[]>();
    for (const result of searchResults) groups.set(result.type, [...(groups.get(result.type) ?? []), result]);
    return groups;
  }, [searchResults]);

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
        <header className="h-16 bg-card border-b flex items-center gap-4 px-8 shrink-0">
          <h2 className="text-lg font-semibold text-card-foreground">
            {NAV_CONFIG.find(item => item.path === location)?.label || '頁面'}
          </h2>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="ml-auto flex h-9 w-full max-w-sm items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground hover:bg-accent"
          >
            <Search className="size-4" />
            <span>搜尋品項、單據、客戶…</span>
            <kbd className="ml-auto rounded border bg-muted px-1.5 py-0.5 text-[10px]">⌘ K</kbd>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative" aria-label="通知">
                <Bell className="size-5" />
                {(unread?.count ?? 0) > 0 && (
                  <Badge className="absolute -right-1 -top-1 h-5 min-w-5 justify-center px-1 text-[10px]">
                    {(unread?.count ?? 0) > 99 ? '99+' : unread?.count}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-96">
              <div className="flex items-center justify-between px-2">
                <DropdownMenuLabel>通知</DropdownMenuLabel>
                {(unread?.count ?? 0) > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => markRead.mutate({ all: true })}>全部已讀</Button>
                )}
              </div>
              <DropdownMenuSeparator />
              {notifications.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">目前沒有通知</p>
              ) : notifications.map((notification) => (
                <DropdownMenuItem
                  key={notification.id}
                  className="items-start py-3"
                  onSelect={() => {
                    if (!notification.isRead) markRead.mutate({ ids: [notification.id] });
                    if (notification.linkPath) navigate(notification.linkPath);
                  }}
                >
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${notification.isRead ? 'bg-muted' : 'bg-primary'}`} />
                  <span className="min-w-0">
                    <span className="block font-medium">{notification.title}</span>
                    {notification.body && <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{notification.body}</span>}
                    <span className="mt-1 block text-[11px] text-muted-foreground">{new Date(notification.createdAt).toLocaleString('zh-TW')}</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <div className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder="輸入關鍵字搜尋…" value={searchText} onValueChange={setSearchText} />
        <CommandList>
          <CommandEmpty>{searching ? '搜尋中…' : debouncedSearch ? '找不到符合的結果' : '請輸入搜尋關鍵字'}</CommandEmpty>
          {[...groupedResults.entries()].map(([type, results]) => (
            <CommandGroup key={type} heading={SEARCH_TYPE_LABELS[type] ?? type}>
              {results.map((result) => (
                <CommandItem
                  key={`${result.type}-${result.id}`}
                  value={`${result.type}-${result.id}-${result.title}`}
                  onSelect={() => {
                    setSearchOpen(false);
                    setSearchText('');
                    navigate(result.path);
                  }}
                >
                  <Search className="size-4 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate">{result.title}</span>
                    {result.subtitle && <span className="block truncate text-xs text-muted-foreground">{result.subtitle}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </div>
  );
}

type SearchResult = { type: string; id: string | number; title: string; subtitle?: string | null; path: string };

type Notification = { id: number; type: string; title: string; body?: string | null; linkPath?: string | null; isRead: boolean; createdAt: string };

const SEARCH_TYPE_LABELS: Record<string, string> = {
  item: '品項', customer: '客戶', supplier: '供應商', sales_order: '銷貨單',
  purchase_order: '採購單', employee: '員工', project: '專案', work_order: '製令',
  ticket: '工單票', complaint: '客訴', contract: '合約', knowledge_base: '知識庫',
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) throw new Error(`API request failed (${response.status})`);
  return response.json() as Promise<T>;
}
