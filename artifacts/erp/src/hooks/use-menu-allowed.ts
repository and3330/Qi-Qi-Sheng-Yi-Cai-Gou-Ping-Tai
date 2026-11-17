import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";

/** 每個人都看得到的基本頁面：首頁、通知、說明、自己的帳號，不受自訂角色限制 */
const ALWAYS_VISIBLE = ["/", "/my-page", "/system/notifications", "/help", "/account/security"];

/** 共用的選單權限判斷：讀取 menu-permissions 覆寫，否則回退到預設角色 */
export function useMenuAllowed() {
  const { hasRole, user } = useAuth();
  const customPermissions = user?.customRole?.permissions;
  const [overrides, setOverrides] = useState<Record<string, string[]>>({});
  useEffect(() => {
    const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
    fetch(`/erp-api/menu-permissions`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => setOverrides(d || {}))
      .catch(() => {});
  }, []);
  const allowed = (path: string | undefined, defaultRoles?: readonly string[]) => {
    if (!path) return defaultRoles ? hasRole(...defaultRoles) : true;
    // 套用自訂角色的人：沒有「檢視」權限的功能不顯示（後端也會擋）
    if (customPermissions && !ALWAYS_VISIBLE.includes(path) && !(customPermissions[path] || []).includes("view")) return false;
    if (path in overrides) {
      const r = overrides[path];
      // 平台方停用的模組對所有角色（含 super_admin）一律隱藏
      if (r.includes("__disabled__")) return false;
      return r.length === 0 ? true : hasRole(...r);
    }
    return defaultRoles ? hasRole(...defaultRoles) : true;
  };
  return { allowed, overrides };
}
