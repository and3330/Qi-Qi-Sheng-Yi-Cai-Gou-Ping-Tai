import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useErpAuth } from '@/hooks/use-erp-auth';
import { NAV_CONFIG } from '@/lib/nav';
import { useMobileTableCards } from '@/hooks/use-mobile-table-cards';
import { PageTableExport } from '@/components/shared/page-table-export';
import { ERP_ROLES, ErpRole } from '@/lib/roles';
import { useGetErpMenuPermissions, getGetErpMenuPermissionsQueryKey } from '@workspace/api-client-react';
import { 
  LogOut, LayoutDashboard, Users, Building2, Shield, Activity, 
  Bell, ExternalLink, BookOpen, Search, ChevronDown, ChevronRight, Menu 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useErpAuth();
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  // 手機上把各頁的表格自動排成卡片（樣式在 index.css）
  useMobileTableCards();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const { data: menuPermissions } = useGetErpMenuPermissions({
    query: {
      queryKey: getGetErpMenuPermissionsQueryKey(),
      enabled: !!user?.erpRole,
    }
  });

  // Expand the group that contains the current location
  useEffect(() => {
    const matchingItem = NAV_CONFIG.slice().sort((a, b) => b.path.length - a.path.length).find(item => 
      location === item.path || (location.startsWith(item.path + '/') && item.path !== '/')
    );
    if (matchingItem?.group) {
      setExpandedGroups(prev => ({ ...prev, [matchingItem.group]: true }));
    }
  }, [location]);

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
      case '/': return <LayoutDashboard className="w-4 h-4 mr-3 shrink-0" />;
      case '/system/users': return <Users className="w-4 h-4 mr-3 shrink-0" />;
      case '/system/departments': return <Building2 className="w-4 h-4 mr-3 shrink-0" />;
      case '/system/menu-permissions': return <Shield className="w-4 h-4 mr-3 shrink-0" />;
      case '/system/audit-logs': return <Activity className="w-4 h-4 mr-3 shrink-0" />;
      default: return null;
    }
  };

  const renderIcon = (path: string) => {
    const icon = getIcon(path);
    if (icon) return icon;
    return (
      <div className="w-4 h-4 mr-3 flex items-center justify-center shrink-0">
        <div className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
      </div>
    );
  };

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  // Close mobile menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  return (
    <div className="flex min-h-screen bg-background text-foreground font-sans">
      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground flex flex-col shrink-0
        transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="h-16 flex items-center gap-2.5 px-6 border-b border-sidebar-border shrink-0">
          <img
            src="/images/brand/logo-mark.png"
            alt="七期生醫"
            className="h-8 w-8 rounded-lg object-cover shrink-0"
          />
          <span className="font-bold text-lg tracking-wider truncate">七期生醫 ERP</span>
        </div>

        <nav className="flex-1 py-4 px-3 overflow-y-auto space-y-1">
          {Object.entries(visibleNavGroups).map(([groupName, items]) => {
            const isExpanded = expandedGroups[groupName];
            const hasActiveItem = items.some(item => 
              location === item.path || (location.startsWith(item.path + '/') && item.path !== '/')
            );
            
            return (
              <div key={groupName} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(groupName)}
                  aria-expanded={!!isExpanded}
                  aria-controls={`erp-nav-group-${groupName}`}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    hasActiveItem && !isExpanded 
                      ? 'text-sidebar-primary-foreground bg-sidebar-primary/20' 
                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                  }`}
                >
                  <span className="uppercase tracking-wider text-[13px]">{groupName}</span>
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 opacity-70 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 opacity-70 shrink-0" />
                  )}
                </button>
                
                {isExpanded && (
                  <ul id={`erp-nav-group-${groupName}`} className="mt-1 space-y-0.5 pl-2">
                    {items.map(item => {
                      const isActive = location === item.path || (location.startsWith(item.path + '/') && item.path !== '/');
                      return (
                        <li key={item.path}>
                          <Link
                            href={item.path}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`flex items-center px-3 py-2 text-sm rounded-md transition-colors ${
                              isActive
                                ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm'
                                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                            }`}
                          >
                            {renderIcon(item.path)}
                            <span className="truncate">{item.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}

          <div className="mt-6 mb-2">
             <h3 className="px-5 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-2">
                外部連結
              </h3>
              <ul className="space-y-0.5 pl-2">
                <li>
                  <a
                    href="/admin"
                    className="flex items-center px-3 py-2 text-sm rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 mr-3 shrink-0 opacity-70" />
                    <span className="truncate">回到管理後台</span>
                  </a>
                </li>
                <li>
                  <a
                    href="/manual"
                    className="flex items-center px-3 py-2 text-sm rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
                  >
                    <BookOpen className="w-4 h-4 mr-3 shrink-0 opacity-70" />
                    <span className="truncate">系統說明書</span>
                  </a>
                </li>
              </ul>
          </div>
        </nav>

        <div className="p-4 border-t border-sidebar-border bg-sidebar/50 shrink-0">
          <div className="flex items-center justify-between">
            <div className="truncate pr-2">
              <p className="text-sm font-medium truncate">{user?.name || user?.username}</p>
              <p className="text-xs text-sidebar-foreground/60 truncate">
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
      <main className="flex-1 flex flex-col min-w-0 bg-secondary/30 relative">
        <header className="h-16 bg-card border-b flex items-center gap-2 md:gap-4 px-4 md:px-8 shrink-0 sticky top-0 z-10">
          <Button 
            variant="ghost" 
            size="icon" 
            className="md:hidden shrink-0 -ml-2"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="開啟選單"
          >
            <Menu className="size-5" />
          </Button>
          <h2 className="text-lg font-semibold text-card-foreground truncate hidden sm:block min-w-0">
            {NAV_CONFIG.slice().sort((a, b) => b.path.length - a.path.length).find(item => 
              location === item.path || (location.startsWith(item.path + '/') && item.path !== '/')
            )?.label || '頁面'}
          </h2>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="ml-auto flex h-9 w-full max-w-xs sm:max-w-sm items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground hover:bg-accent shrink"
          >
            <Search className="size-4 shrink-0" />
            <span className="hidden sm:inline-flex truncate">搜尋品項、單據、客戶…</span>
            <span className="sm:hidden truncate">搜尋…</span>
            <kbd className="ml-auto hidden sm:inline-flex shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[10px]">⌘ K</kbd>
          </button>
          <PageTableExport title={NAV_CONFIG.slice().sort((a, b) => b.path.length - a.path.length).find(item => location === item.path || (location.startsWith(item.path + '/') && item.path !== '/'))?.label || '頁面'} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative shrink-0" aria-label="通知">
                <Bell className="size-5" />
                {(unread?.count ?? 0) > 0 && (
                  <Badge className="absolute -right-1 -top-1 h-5 min-w-5 justify-center px-1 text-[10px]">
                    {(unread?.count ?? 0) > 99 ? '99+' : unread?.count}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 sm:w-96">
              <div className="flex items-center justify-between px-2">
                <DropdownMenuLabel>通知</DropdownMenuLabel>
                {(unread?.count ?? 0) > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => markRead.mutate({ all: true })}>全部已讀</Button>
                )}
              </div>
              <DropdownMenuSeparator />
              {notifications.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">目前沒有通知</p>
              ) : (
                <div className="max-h-[70vh] overflow-y-auto">
                  {notifications.map((notification) => (
                    <DropdownMenuItem
                      key={notification.id}
                      className="items-start py-3 cursor-pointer"
                      onSelect={() => {
                        if (!notification.isRead) markRead.mutate({ ids: [notification.id] });
                        if (notification.linkPath) navigate(notification.linkPath);
                      }}
                    >
                      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${notification.isRead ? 'bg-muted' : 'bg-primary'}`} />
                      <span className="min-w-0 ml-3">
                        <span className="block font-medium">{notification.title}</span>
                        {notification.body && <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{notification.body}</span>}
                        <span className="mt-1 block text-[11px] text-muted-foreground">{new Date(notification.createdAt).toLocaleString('zh-TW')}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <div className="flex-1 p-4 sm:p-6 md:p-8 overflow-y-auto">
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
                  className="cursor-pointer"
                >
                  <Search className="size-4 text-muted-foreground mr-2 shrink-0" />
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
