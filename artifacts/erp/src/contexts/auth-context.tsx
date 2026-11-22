import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { retainChatScope } from "@/lib/ai-chat-session";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
  employeeId?: number | null;
  tenantId?: number;
  companyCode?: string | null;
  /** 套用的自訂角色：每個功能頁允許的動作（view／create／edit／delete）；沒有套用時是 null */
  customRole?: { id: string; name: string; permissions: Record<string, string[]> } | null;
}

interface AuthCtx {
  user: SessionUser | null;
  loading: boolean;
  login: (companyCode: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  hasRole: (...roles: string[]) => boolean;
}

const Ctx = createContext<AuthCtx>({
  user: null, loading: true,
  login: async () => {}, logout: async () => {}, refresh: async () => {}, hasRole: () => false,
});

export function useAuth() { return useContext(Ctx); }

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const userScopeRef = useRef<string | null>(null);

  const updateUser = (nextUser: SessionUser | null) => {
    const nextScope = nextUser
      ? `${nextUser.tenantId ?? ""}:${nextUser.id}:${nextUser.role}:${nextUser.companyCode ?? ""}`
      : null;
    if (userScopeRef.current !== nextScope) {
      queryClient.clear();
      userScopeRef.current = nextScope;
    }
    retainChatScope(nextScope);
    setUser(nextUser);
  };

  const refresh = async () => {
    try {
      const res = await fetch(`/erp-api/admin/me`, { credentials: "include" });
      if (res.ok) {
        updateUser(await res.json());
      } else {
        updateUser(null);
      }
    } catch {
      updateUser(null);
    }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  // 登入回應只有基本身分，不含自訂角色；登入後另外補讀一次。
  // 讀不到就維持現狀，不會因此把人登出（後端仍會依角色把關）。
  const userId = user?.id;
  const needsCustomRole = !!user && user.customRole === undefined;
  useEffect(() => {
    if (!needsCustomRole) return;
    let cancelled = false;
    fetch(`/erp-api/admin/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => {
        if (cancelled || !me || me.id !== userId) return;
        setUser((current) => (current && current.id === me.id ? { ...current, customRole: me.customRole ?? null } : current));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, needsCustomRole]);

  const login = async (companyCode: string, username: string, password: string) => {
    const res = await fetch(`/erp-api/admin/login`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyCode, username, password }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({ error: "登入失敗" }));
      throw new Error(e.error || "登入失敗");
    }
    updateUser(await res.json());
  };

  const logout = async () => {
    try {
      await fetch(`/erp-api/admin/logout`, { method: "POST", credentials: "include" });
    } finally {
      // Never leave tenant data in memory if logout fails or the network drops.
      updateUser(null);
      window.location.href = `${BASE}login`;
    }
  };

  const hasRole = (...roles: string[]) =>
    !!user && (roles.length === 0 || user.role === "super_admin" || roles.includes(user.role));

  return <Ctx.Provider value={{ user, loading, login, logout, refresh, hasRole }}>{children}</Ctx.Provider>;
}
