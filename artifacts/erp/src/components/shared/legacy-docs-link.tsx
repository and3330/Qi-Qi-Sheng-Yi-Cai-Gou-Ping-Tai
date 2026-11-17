import { Link } from "wouter";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { FINANCE_ROLES } from "@/lib/roles";

/**
 * 「歷史單據」入口：放在銷貨單、進貨單這類頁面上，點了直接看舊系統（Ecount）同一種單據。
 * 歷史單據頁只開放給管理與財務角色，其他角色不顯示這顆按鈕。
 */
export function LegacyDocsLink({ type, label }: { type: string; label?: string }) {
  const allowed = useAuth().hasRole(...FINANCE_ROLES);
  if (!allowed) return null;
  return (
    <Button asChild variant="outline" data-testid={`link-legacy-${type}`}>
      <Link href={`/system/legacy-documents?type=${encodeURIComponent(type)}`}>
        <History size={16} className="mr-1" />{label ?? `歷史${type}`}
      </Link>
    </Button>
  );
}
