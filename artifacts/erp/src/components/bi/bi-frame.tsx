import { useState, type ReactNode } from "react";
import { BiRangeBar, useBiRange } from "./bi-range";
import { BiError, BiHeader, BiSkeleton, NotesPanel } from "./bi-ui";
import { AIConsultantDrawer } from "./ai-consultant-drawer";
import { useBiPage, type BiPage, type ExecutiveResponse, type HrResponse, type InventoryResponse, type SalesResponse } from "@/lib/bi-api";

type DataOf = { executive: ExecutiveResponse; sales: SalesResponse; inventory: InventoryResponse; hr: HrResponse };

/** 五個 BI 頁共用框架：期間選擇、載入骨架、錯誤重試、重新計算、AI 顧問 */
export function BiFrame<P extends BiPage>({ page, title, subtitle, icon, children }: {
  page: P; title: string; subtitle: string; icon: ReactNode; children: (data: DataOf[P]) => ReactNode;
}) {
  const { preset, range, set } = useBiRange();
  const [aiOpen, setAiOpen] = useState(false);
  const q = useBiPage(page, range);
  const data = q.data as DataOf[P] | undefined;

  return (
    <div className="bi-root mx-auto max-w-[1600px] space-y-5 p-4 md:p-6">
      <BiHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        computedAt={data?.period.computedAt}
        fetching={q.isFetching}
        onRefresh={() => q.refetch()}
        onAi={q.isError && q.error?.status === 403 ? undefined : () => setAiOpen(true)}
      />
      <BiRangeBar preset={preset} range={range} onChange={set} />
      {q.isLoading ? <BiSkeleton /> : q.isError || !data ? <BiError error={q.error} onRetry={() => q.refetch()} /> : (
        <div className={`space-y-5 transition-opacity ${q.isFetching ? "opacity-60" : "opacity-100"}`}>
          {children(data)}
          <NotesPanel notes={data.notes} />
        </div>
      )}
      <AIConsultantDrawer open={aiOpen} onOpenChange={setAiOpen} page={page} range={range} pageTitle={title} />
    </div>
  );
}
