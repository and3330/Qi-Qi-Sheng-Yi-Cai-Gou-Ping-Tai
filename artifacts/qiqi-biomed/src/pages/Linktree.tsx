import { useRoute } from "wouter";
import { useGetPublicLinktree } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { LinktreeView } from "@/components/LinktreeView";

/** 公開連結頁（免登入） */
export default function LinktreePage() {
  const [, params] = useRoute("/u/:memberId");
  const memberId = Number(params?.memberId);
  const { data, isLoading, isError } = useGetPublicLinktree(memberId, {
    query: { enabled: Number.isInteger(memberId), retry: false } as any,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-start justify-center bg-gray-50 px-4 py-10">
        <div className="w-full max-w-md space-y-4">
          <Skeleton className="mx-auto h-20 w-20 rounded-full" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-6 text-center">
        <p className="text-4xl font-bold text-gray-300">404</p>
        <p className="mt-2 text-sm text-gray-500">找不到此連結頁，或頁面已停用。</p>
      </div>
    );
  }

  return (
    <LinktreeView
      displayName={data.member.displayName}
      links={data.links}
      settings={data.settings}
    />
  );
}
