import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { menuPathForLocation } from "@/components/layout/sidebar";

export interface PagePermissions { create: boolean; edit: boolean; delete: boolean }

const ALL: PagePermissions = { create: true, edit: true, delete: true };

/**
 * 目前這一頁，登入的人可以做哪些動作。
 * 只用來決定按鈕要不要顯示；真正的把關在後端（permission-guard），這裡算錯也不會放寬權限。
 */
export function usePagePermissions(): PagePermissions {
  const [location] = useLocation();
  const { user } = useAuth();
  if (!user) return ALL;

  // 自訂角色與內建角色（財務長、業務、倉管…）都由後端算好勾選表放在這裡
  const custom = user.customRole?.permissions;
  if (custom) {
    const menuPath = menuPathForLocation(location);
    // 不屬於任何功能頁的畫面（首頁、通知、個人設定）不限制
    if (!menuPath) return ALL;
    const actions = custom[menuPath] || [];
    return { create: actions.includes("create"), edit: actions.includes("edit"), delete: actions.includes("delete") };
  }
  return ALL;
}
