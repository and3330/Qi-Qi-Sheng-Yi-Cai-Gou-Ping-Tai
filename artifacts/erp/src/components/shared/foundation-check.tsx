import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { SYSTEM_ADMIN_ROLES } from "@/lib/roles";

interface FoundationStatus {
  ready: boolean;
  fixable: string[];
  manual: string[];
}

const QUERY_KEY = ["/erp-api/setup/status"];

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => null);
  return (data && typeof data.error === "string" && data.error) || fallback;
}

/**
 * 基礎資料檢查：會計科目、倉庫、會計設定、投保級距缺了，單據之間的連動就會卡住。
 * 只對管理員顯示；一切就緒時不佔版面。
 */
export function FoundationCheck() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fixing, setFixing] = useState(false);
  const isAdmin = hasRole(...SYSTEM_ADMIN_ROLES);

  const { data } = useQuery<FoundationStatus>({
    queryKey: QUERY_KEY,
    enabled: isAdmin,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const response = await fetch(`/erp-api/setup/status`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response, "無法取得基礎資料狀態"));
      return response.json();
    },
  });

  if (!isAdmin || !data || data.ready) return null;

  const fix = async () => {
    setFixing(true);
    try {
      const response = await fetch(`/erp-api/setup/ensure`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(await readError(response, "補齊失敗"));
      const result: { status: FoundationStatus } = await response.json();
      queryClient.setQueryData(QUERY_KEY, result.status);
      toast({ title: "已補齊基礎資料", description: "會計科目、倉庫與會計設定已建立，既有資料沒有被更動。" });
    } catch (error) {
      toast({ title: "補齊失敗", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
    } finally {
      setFixing(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" data-testid="foundation-check">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">基礎資料還沒準備好，部分單據無法自動入帳或出入庫</p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {data.fixable.map((item) => <li key={item}>{item}</li>)}
              {data.manual.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
        {data.fixable.length > 0 && (
          <Button size="sm" onClick={fix} disabled={fixing} className="shrink-0" data-testid="button-foundation-fix">
            {fixing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wrench className="mr-1.5 h-4 w-4" />}
            一鍵補齊
          </Button>
        )}
      </div>
    </div>
  );
}
