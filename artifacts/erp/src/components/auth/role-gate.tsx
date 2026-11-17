import type { ReactNode } from "react";
import { useAuth } from "@/contexts/auth-context";
import { ShieldAlert } from "lucide-react";

interface RoleGateProps {
  roles: readonly string[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function RoleGate({ roles, children, fallback }: RoleGateProps) {
  const { hasRole, user } = useAuth();
  if (!user) return null;
  if (hasRole(...roles)) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center" data-testid="role-gate-denied">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <ShieldAlert className="w-8 h-8 text-destructive" />
      </div>
      <h2 className="text-xl font-semibold mb-2">權限不足</h2>
      <p className="text-muted-foreground max-w-md">
        此頁面僅限管理員或被授權的角色存取。如需檢視，請聯繫系統管理員調整您的角色。
      </p>
      <p className="text-xs text-muted-foreground mt-3">
        目前角色：<span className="font-mono">{user.role}</span>
      </p>
    </div>
  );
}

export function withRoleGate<P extends object>(
  Component: React.ComponentType<P>,
  roles: readonly string[],
) {
  return function GatedComponent(props: P) {
    return (
      <RoleGate roles={roles}>
        <Component {...props} />
      </RoleGate>
    );
  };
}
