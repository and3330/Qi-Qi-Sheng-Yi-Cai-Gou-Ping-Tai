import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { ROLE_EMPLOYEE } from "@/lib/roles";
import { navGroups, topLevelNavs, NavItem } from "./sidebar";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { APP_VERSION } from "@/lib/app-version";
import { X, LogOut, Plus, Minus, Check, ChevronDown, ChevronRight, ShieldCheck, Search, HelpCircle } from "lucide-react";
import { useMenuAllowed } from "@/hooks/use-menu-allowed";

type FlatItem = {
  label: string;
  path: string;
  icon: React.ReactNode;
  groupId: string;
};

type SectionItem = {
  label: string;
  path?: string;
  icon: React.ReactNode;
  groupId: string;
  children?: FlatItem[];
};

const GROUP_COLORS: Record<string, { bg: string; text: string }> = {
  "常用功能": { bg: "bg-pink-100 dark:bg-pink-900/30", text: "text-pink-600 dark:text-pink-400" },
  "AI 助理": { bg: "bg-pink-100 dark:bg-pink-900/30", text: "text-pink-600 dark:text-pink-400" },
  "進銷存系統": { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-600 dark:text-blue-400" },
  "人事管理": { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-600 dark:text-green-400" },
  "財務管理": { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-600 dark:text-orange-400" },
  "系統設定": { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-600 dark:text-purple-400" },
};

export function MobileMoreMenu({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const isEmployee = user?.role === ROLE_EMPLOYEE;
  const { allowed } = useMenuAllowed();

  const [shortcutPaths, setShortcutPaths] = useState<string[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { dark, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      setIsEditing(false); // Reset edit mode when closed
      setQuery("");
      setExpandedFolder(null);
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  useEffect(() => {
    setShortcutPaths([]); // 換帳號時先清空,避免殘留上一位使用者的捷徑
    if (user?.id) {
      const saved = localStorage.getItem(`erp-quick-icons-${user.id}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            const cleaned = Array.from(new Set(parsed.filter((p): p is string => typeof p === "string")));
            setShortcutPaths(cleaned);
          }
        } catch { }
      }
    }
  }, [user?.id]);

  const saveShortcuts = (paths: string[]) => {
    setShortcutPaths(paths);
    if (user?.id) {
      localStorage.setItem(`erp-quick-icons-${user.id}`, JSON.stringify(paths));
    }
  };

  // 建立分區:保留兩層結構,有子項目的顯示為「資料夾」,點開才展開
  const buildSectionItems = (groupLabel: string, items: NavItem[]): SectionItem[] => {
    const result: SectionItem[] = [];
    items.forEach(item => {
      const children = (item.children || [])
        .filter(c => allowed(c.path, c.roles))
        .map(c => ({ label: c.label, path: c.path, icon: c.icon, groupId: groupLabel }));
      if (item.children) {
        if (children.length > 0) {
          result.push({ label: item.label, icon: item.icon, groupId: groupLabel, children });
        }
      } else if (item.path && allowed(item.path, item.roles)) {
        result.push({ label: item.label, path: item.path, icon: item.icon, groupId: groupLabel });
      }
    });
    return result;
  };

  const sections: { groupLabel: string; items: SectionItem[] }[] = [];

  if (!isEmployee) {
    topLevelNavs.forEach(item => {
      const items = buildSectionItems(item.label, [item]);
      if (items.length > 0) sections.push({ groupLabel: item.label, items });
    });
    navGroups.forEach(g => {
      const items = buildSectionItems(g.groupLabel, g.items);
      if (items.length > 0) sections.push({ groupLabel: g.groupLabel, items });
    });
  }

  // 所有可直接前往的項目(直接項目 + 資料夾內子項目),供捷徑使用
  const allPathsMap = new Map<string, FlatItem>();
  sections.forEach(s => s.items.forEach(item => {
    if (item.path) allPathsMap.set(item.path, { label: item.label, path: item.path, icon: item.icon, groupId: item.groupId });
    item.children?.forEach(c => allPathsMap.set(c.path, c));
  }));

  const toggleShortcut = (path: string) => {
    // 只保留目前仍有效(有權限且存在)的路徑,失效項目不再佔用 8 格上限
    let newPaths = shortcutPaths.filter(p => allPathsMap.has(p));
    if (newPaths.includes(path)) {
      newPaths = newPaths.filter(p => p !== path);
    } else {
      if (newPaths.length >= 8) return;
      newPaths.push(path);
    }
    saveShortcuts(newPaths);
  };

  const activeShortcuts = shortcutPaths
    .map(path => allPathsMap.get(path))
    .filter((item): item is FlatItem => item !== undefined);

  const isFull = activeShortcuts.length >= 8;

  const renderNavIcon = (item: FlatItem) => {
    const inShortcuts = shortcutPaths.includes(item.path);
    let actionIcon = undefined;
    let actionIconBg = "bg-background";
    if (isEditing) {
      if (inShortcuts) {
        actionIcon = <Check size={12} className="text-primary-foreground" />;
        actionIconBg = "bg-primary border border-primary";
      } else {
        actionIcon = <Plus size={12} className="text-foreground" />;
        actionIconBg = "bg-background border border-border";
      }
    }
    const handleClick = () => {
      if (isEditing) {
        if (inShortcuts || !isFull) toggleShortcut(item.path);
      } else {
        onClose();
        setLocation(item.path);
      }
    };
    return (
      <AppIcon
        key={item.path}
        item={item}
        onClick={handleClick}
        actionIcon={actionIcon}
        actionIconBg={actionIconBg}
        onAction={isEditing ? handleClick : undefined}
        disabled={isEditing && !inShortcuts && isFull}
      />
    );
  };

  // 關鍵字搜尋：可用空白分隔多個關鍵字，功能名稱或所屬分類符合就列出
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searchResults = words.length === 0 ? [] : Array.from(allPathsMap.values())
    .filter(item => words.every(w => (item.label + " " + item.groupId).toLowerCase().includes(w)));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col animate-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
            {user?.displayName?.[0] || user?.username?.[0] || "U"}
          </div>
          <div>
            <div className="font-semibold">{user?.displayName || user?.username}</div>
            <div className="text-xs text-muted-foreground">{isEmployee ? "員工" : "管理員"}</div>
          </div>
        </div>
        <button onClick={onClose} aria-label="關閉功能總覽" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent active:bg-accent/80 touch-manipulation">
          <X size={24} />
        </button>
      </div>

      {!isEmployee && (
        <div className="px-4 py-2.5 border-b border-border">
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜尋功能，例如：報價、請假、發票"
              aria-label="搜尋功能"
              className="h-11 w-full rounded-xl border border-border bg-muted/40 pl-10 pr-3 outline-none focus:border-primary focus:bg-background"
              data-testid="input-mobile-menu-search"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto overscroll-contain pb-24">
        {words.length > 0 && (
          <div className="px-2 py-2" data-testid="mobile-menu-search-results">
            {searchResults.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">找不到符合「{query.trim()}」的功能</div>
            ) : searchResults.map(item => {
              const colorObj = GROUP_COLORS[item.groupId] || { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-600 dark:text-slate-300" };
              return (
                <button
                  key={item.path}
                  onClick={() => { onClose(); setLocation(item.path); }}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-accent touch-manipulation"
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${colorObj.bg} ${colorObj.text} [&>svg]:h-5 [&>svg]:w-5`}>{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{item.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.groupId}</span>
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden />
                </button>
              );
            })}
          </div>
        )}
        {words.length === 0 && !isEmployee && (
          <div className="px-4 py-5 border-b border-border bg-muted/10">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-bold text-foreground">我的捷徑</div>
              <button
                onClick={() => setIsEditing(!isEditing)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                  isEditing
                    ? "bg-primary text-primary-foreground"
                    : "bg-primary/10 text-primary active:bg-primary/20"
                }`}
              >
                {isEditing ? "完成" : "編輯"}
              </button>
            </div>

            {activeShortcuts.length === 0 && !isEditing ? (
              <div className="text-sm text-muted-foreground text-center py-6 bg-muted/30 rounded-2xl border border-dashed border-border">
                點「編輯」加入常用功能
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-y-5 gap-x-2">
                {activeShortcuts.map(item => (
                  <AppIcon
                    key={item.path}
                    item={item}
                    onClick={isEditing ? undefined : () => { onClose(); setLocation(item.path); }}
                    actionIcon={isEditing ? <Minus size={12} className="text-destructive-foreground" /> : undefined}
                    actionIconBg="bg-destructive border border-destructive"
                    onAction={isEditing ? () => toggleShortcut(item.path) : undefined}
                  />
                ))}
                {isEditing && activeShortcuts.length < 8 && (
                  <div className="flex flex-col items-center gap-2 opacity-50">
                    <div className="w-[52px] h-[52px] rounded-2xl flex items-center justify-center border-2 border-dashed border-border bg-muted/20">
                      <Plus size={20} className="text-muted-foreground" />
                    </div>
                    <span className="text-[11px] leading-tight text-center font-medium text-muted-foreground">
                      {activeShortcuts.length}/8
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {words.length === 0 && sections.map(section => {
          // 每 4 個一列;展開的資料夾面板插在「該圖示所在列」的正下方
          const rows: SectionItem[][] = [];
          for (let i = 0; i < section.items.length; i += 4) {
            rows.push(section.items.slice(i, i + 4));
          }
          return (
            <div key={section.groupLabel} className="px-4 py-5 border-b border-border">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4 pl-1">
                {section.groupLabel}
              </div>
              {rows.map((row, rowIdx) => {
                const expandedInRow = row.find(
                  it => it.children && `${section.groupLabel}::${it.label}` === expandedFolder
                );
                return (
                  <div key={rowIdx} className={rowIdx > 0 || expandedInRow ? "" : undefined}>
                    <div className={`grid grid-cols-4 gap-y-5 gap-x-2 ${rowIdx > 0 ? "mt-5" : ""}`}>
                      {row.map(item => {
                        if (!item.children) {
                          return renderNavIcon({ label: item.label, path: item.path!, icon: item.icon, groupId: item.groupId });
                        }
                        const key = `${section.groupLabel}::${item.label}`;
                        const isExpanded = expandedFolder === key;
                        return (
                          <FolderIcon
                            key={key}
                            item={item}
                            isExpanded={isExpanded}
                            onClick={() => setExpandedFolder(isExpanded ? null : key)}
                          />
                        );
                      })}
                    </div>
                    {expandedInRow && (
                      <div className="mt-4 rounded-2xl border border-border bg-muted/20 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="text-xs font-semibold text-muted-foreground mb-3 pl-1">
                          {expandedInRow.label}
                        </div>
                        <div className="grid grid-cols-4 gap-y-5 gap-x-2">
                          {expandedInRow.children!.map(child => renderNavIcon(child))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        <div className="p-4 mt-2">
          <button onClick={toggleTheme} className="mb-3 w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-muted text-foreground font-semibold active:bg-muted/70 transition-colors touch-manipulation" data-testid="button-mobile-theme">
            {dark ? <Sun size={18} /> : <Moon size={18} />}
            {dark ? "切換成淺色" : "切換成深色"}
          </button>
          <button onClick={() => { setLocation("/help"); onClose(); }} className="mb-3 w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-muted text-foreground font-semibold active:bg-muted/70 transition-colors touch-manipulation" data-testid="button-mobile-help">
            <HelpCircle size={18} />
            使用說明
          </button>
          <button onClick={() => { setLocation("/account/security"); onClose(); }} className="mb-3 w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary/10 text-primary font-semibold active:bg-primary/20 transition-colors touch-manipulation" data-testid="button-mobile-account-security">
            <ShieldCheck size={18} />
            帳號與安全性
          </button>
          <button onClick={() => { logout(); onClose(); }} className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-destructive/10 text-destructive font-semibold active:bg-destructive/20 transition-colors touch-manipulation" data-testid="button-mobile-logout">
            <LogOut size={18} />
            登出系統
          </button>
          <p className="mt-3 text-center text-[11px] text-muted-foreground" data-testid="text-mobile-app-version">版本 {APP_VERSION.version}</p>
        </div>
      </div>
    </div>
  );
}

function FolderIcon({ item, isExpanded, onClick }: { item: SectionItem; isExpanded: boolean; onClick: () => void }) {
  const colorObj = GROUP_COLORS[item.groupId] || { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-600 dark:text-slate-300" };
  return (
    <div className="flex flex-col items-center gap-2 touch-manipulation">
      <div className="relative">
        <button
          onClick={onClick}
          className={`w-[52px] h-[52px] rounded-[18px] flex items-center justify-center ${colorObj.bg} ${colorObj.text} [&>svg]:w-[22px] [&>svg]:h-[22px] active:scale-95 transition-all shadow-sm ${isExpanded ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
        >
          {item.icon}
        </button>
        <span className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-background border border-border shadow-sm flex items-center justify-center transition-transform ${isExpanded ? "rotate-180" : ""}`}>
          <ChevronDown size={12} className="text-muted-foreground" />
        </span>
      </div>
      <span className="text-[11px] leading-tight text-center font-medium text-foreground max-w-[72px] break-words line-clamp-2 px-0.5">
        {item.label}
      </span>
    </div>
  );
}

function AppIcon({
  item,
  actionIcon,
  actionIconBg,
  onAction,
  onClick,
  disabled
}: {
  item: FlatItem;
  actionIcon?: React.ReactNode;
  actionIconBg?: string;
  onAction?: () => void;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const colorObj = GROUP_COLORS[item.groupId] || { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-600 dark:text-slate-300" };

  return (
    <div className={`flex flex-col items-center gap-2 touch-manipulation ${disabled ? 'opacity-40' : ''}`}>
      <div className="relative">
        <button
          onClick={onClick}
          disabled={disabled}
          className={`w-[52px] h-[52px] rounded-[18px] flex items-center justify-center ${colorObj.bg} ${colorObj.text} [&>svg]:w-[22px] [&>svg]:h-[22px] ${!disabled && 'active:scale-95'} transition-transform shadow-sm`}
        >
          {item.icon}
        </button>
        {actionIcon && (
          <button
            onClick={(e) => { e.stopPropagation(); onAction?.(); }}
            disabled={disabled}
            className={`absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full ${actionIconBg || 'bg-background border border-border'} shadow-sm flex items-center justify-center z-10 ${!disabled && 'active:scale-90'} transition-transform`}
          >
            {actionIcon}
          </button>
        )}
      </div>
      <span className="text-[11px] leading-tight text-center font-medium text-foreground max-w-[72px] break-words line-clamp-2 px-0.5">
        {item.label}
      </span>
    </div>
  );
}
