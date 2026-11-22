import { useAuth } from "@/contexts/auth-context";

export function useInvoicePermissions() {
  const { user } = useAuth();
  const allowed = (action: "issue" | "print") => {
    if (!user) return false;
    if (["owner", "admin", "super_admin"].includes(user.role)) return true;
    const permissions = user.customRole?.permissions;
    if (permissions) return permissions[`/actions/invoices/${action}`]?.includes("view") ?? false;
    return false;
  };
  return { canIssueInvoice: allowed("issue"), canPrintInvoice: allowed("print") };
}
