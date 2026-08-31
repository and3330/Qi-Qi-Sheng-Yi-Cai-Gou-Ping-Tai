import { ReactNode } from "react";
import { Link } from "wouter";
import { Redirect } from "wouter";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "../../hooks/use-auth";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

function AdminOnly({ children }: { children: ReactNode }) {
  const { data: me, isLoading, isError } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-muted/40">
        <Spinner className="size-8 text-primary" />
      </div>
    );
  }

  if (isError || me?.role !== "admin") {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-muted/40 px-6 text-center">
        <div className="rounded-2xl bg-destructive/10 p-4 text-destructive">
          <ShieldX size={32} />
        </div>
        <div>
          <p className="text-lg font-bold" data-testid="text-admin-denied">
            無權限進入後台
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            此區域僅限管理員使用，如有需求請聯繫平台管理者。
          </p>
        </div>
        <Link href="/">
          <Button data-testid="button-back-home">回到首頁</Button>
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}

export function AdminGuard({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-muted/40">
        <Spinner className="size-8 text-primary" />
      </div>
    );
  }
  if (!isSignedIn) {
    return <Redirect to="/sign-in" />;
  }
  return <AdminOnly>{children}</AdminOnly>;
}
