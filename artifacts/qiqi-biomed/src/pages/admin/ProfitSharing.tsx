import { useMemo, useState } from "react";
import {
  useListAdminProfitRules,
  getListAdminProfitRulesQueryKey,
  useCreateAdminProfitRule,
  useUpdateAdminProfitRule,
  useDeleteAdminProfitRule,
  useGetAdminProfitReport,
  getGetAdminProfitReportQueryKey,
  type GetAdminProfitReportParams,
  type ProfitRule,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { HandCoins, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getTierName } from "@/lib/utils";
import { AdminLayout } from "./AdminLayout";

const TIER_LABEL: Record<string, string> = {
  all: "全部會員",
  hospital: "醫院",
  clinic: "診所/藥局",
  consumer: "一般消費者",
};

function firstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function RuleDialog({
  rule,
  onClose,
}: {
  rule: ProfitRule | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { mutateAsync: create, isPending: creating } = useCreateAdminProfitRule();
  const { mutateAsync: update, isPending: updating } = useUpdateAdminProfitRule();

  const [name, setName] = useState(rule?.name ?? "");
  const [tier, setTier] = useState<string>(rule?.tier ?? "all");
  const [percent, setPercent] = useState(rule ? String(rule.percentBps / 100) : "");
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);

  const submit = async () => {
    const pct = Number(percent);
    if (!name.trim() || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
      toast({ title: "請填寫名稱與 0–100 的分潤比例", variant: "destructive" });
      return;
    }
    const data = {
      name: name.trim(),
      tier: tier as any,
      percentBps: Math.round(pct * 100),
      isActive,
    };
    try {
      if (rule) await update({ id: rule.id, data });
      else await create({ data });
      queryClient.invalidateQueries({ queryKey: getListAdminProfitRulesQueryKey() });
      toast({ title: rule ? "規則已更新" : "規則已新增" });
      onClose();
    } catch (e: any) {
      toast({ title: e?.data?.error || "儲存失敗", variant: "destructive" });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[92vw] max-w-[440px] rounded-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? "編輯分潤規則" : "新增分潤規則"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>規則名稱</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：醫院會員回饋" data-testid="input-rule-name" />
          </div>
          <div className="space-y-1.5">
            <Label>適用會員身份</Label>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger data-testid="select-rule-tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部會員</SelectItem>
                <SelectItem value="hospital">醫院</SelectItem>
                <SelectItem value="clinic">診所/藥局</SelectItem>
                <SelectItem value="consumer">一般消費者</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              身份專屬規則優先於「全部會員」規則。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>分潤比例 (%)</Label>
            <Input type="number" step="0.01" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="例如：3 代表 3%" data-testid="input-rule-percent" />
          </div>
          <div className="flex items-center justify-between rounded-xl border p-3">
            <span className="text-sm font-medium">啟用此規則</span>
            <Switch checked={isActive} onCheckedChange={setIsActive} data-testid="switch-rule-active" />
          </div>
          <Button className="w-full" onClick={submit} disabled={creating || updating} data-testid="button-rule-submit">
            {creating || updating ? "儲存中..." : "儲存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminProfitSharingPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: rules, isLoading: rulesLoading } = useListAdminProfitRules();
  const { mutateAsync: deleteRule } = useDeleteAdminProfitRule();

  const [dialog, setDialog] = useState<{ open: boolean; rule: ProfitRule | null }>({ open: false, rule: null });

  const [fromInput, setFromInput] = useState(firstDayOfMonth());
  const [toInput, setToInput] = useState(today());
  const [range, setRange] = useState({ from: firstDayOfMonth(), to: today() });

  const params = useMemo(() => {
    const p: GetAdminProfitReportParams = {};
    if (range.from) p.from = range.from;
    if (range.to) p.to = range.to;
    return p;
  }, [range]);

  const { data: report, isLoading: reportLoading } = useGetAdminProfitReport(params, {
    query: { queryKey: getGetAdminProfitReportQueryKey(params) },
  });

  const handleDelete = async (id: number) => {
    if (!window.confirm("確定刪除此分潤規則？")) return;
    try {
      await deleteRule({ id });
      queryClient.invalidateQueries({ queryKey: getListAdminProfitRulesQueryKey() });
      toast({ title: "規則已刪除" });
    } catch (e: any) {
      toast({ title: e?.data?.error || "刪除失敗", variant: "destructive" });
    }
  };

  return (
    <AdminLayout title="利潤分享">
      {/* Rules */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">分潤規則</h2>
          <Button size="sm" onClick={() => setDialog({ open: true, rule: null })} data-testid="button-rule-create">
            新增規則
          </Button>
        </div>
        {rulesLoading ? (
          <Skeleton className="h-32 rounded-2xl" />
        ) : !rules?.length ? (
          <div className="rounded-2xl border border-dashed bg-white py-10 text-center text-sm text-muted-foreground">
            尚未設定分潤規則，訂單完成時將不會產生分潤
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">名稱</th>
                  <th className="px-4 py-3 font-medium">適用身份</th>
                  <th className="px-4 py-3 text-right font-medium">比例</th>
                  <th className="px-4 py-3 font-medium">狀態</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b last:border-0" data-testid={`row-rule-${r.id}`}>
                    <td className="px-4 py-3 font-medium">{r.name}</td>
                    <td className="px-4 py-3">{TIER_LABEL[r.tier] ?? r.tier}</td>
                    <td className="px-4 py-3 text-right">{(r.percentBps / 100).toLocaleString()}%</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${r.isActive ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {r.isActive ? "啟用中" : "停用"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="icon" onClick={() => setDialog({ open: true, rule: r })} data-testid={`button-rule-edit-${r.id}`}>
                        <Pencil size={16} />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(r.id)} data-testid={`button-rule-delete-${r.id}`}>
                        <Trash2 size={16} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Report */}
      <section>
        <h2 className="mb-3 text-sm font-bold">利潤報表</h2>
        <form
          className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setRange({ from: fromInput, to: toInput });
          }}
        >
          <div className="space-y-1.5">
            <Label>開始日期</Label>
            <Input type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} className="bg-white sm:w-44" data-testid="input-profit-from" />
          </div>
          <div className="space-y-1.5">
            <Label>結束日期</Label>
            <Input type="date" value={toInput} onChange={(e) => setToInput(e.target.value)} className="bg-white sm:w-44" data-testid="input-profit-to" />
          </div>
          <Button type="submit" data-testid="button-profit-query">查詢</Button>
        </form>

        {reportLoading ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:w-1/2">
              <div className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="rounded-xl bg-amber-50 p-2 text-amber-600">
                    <HandCoins size={18} />
                  </div>
                  <p className="text-xs text-muted-foreground">期間分潤總額</p>
                </div>
                <p className="mt-2 text-xl font-bold" data-testid="text-profit-total">
                  NT${(report?.totalAmount ?? 0).toLocaleString()}
                </p>
              </div>
              <div className="rounded-2xl border bg-white p-4 shadow-sm">
                <p className="text-xs text-muted-foreground">分潤筆數</p>
                <p className="mt-2 text-xl font-bold">{report?.recordCount ?? 0}</p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                <p className="border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground">
                  依會員彙總
                </p>
                <table className="w-full text-sm">
                  <tbody>
                    {report?.members.length ? (
                      report.members.map((m) => (
                        <tr key={m.memberId} className="border-b last:border-0" data-testid={`row-profit-member-${m.memberId}`}>
                          <td className="px-4 py-2.5">
                            <p className="font-medium">{m.memberName}</p>
                            <p className="text-xs text-muted-foreground">{getTierName(m.tier)}</p>
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                            {m.orderCount} 筆
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold">
                            NT${m.amount.toLocaleString()}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="py-10 text-center text-muted-foreground">期間內沒有分潤紀錄</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                <p className="border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground">
                  分潤明細
                </p>
                {report?.recordsTruncated && (
                  <p className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-700" data-testid="text-profit-records-truncated">
                    明細僅顯示最新 500 筆（共 {report.recordCount.toLocaleString()} 筆）；上方彙總數字仍包含全部紀錄。請縮小日期區間查看更多明細。
                  </p>
                )}
                <div className="max-h-[420px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {report?.records.length ? (
                        report.records.map((r) => (
                          <tr key={r.id} className="border-b last:border-0" data-testid={`row-profit-record-${r.id}`}>
                            <td className="px-4 py-2.5">
                              <p className="font-medium">{r.memberName}</p>
                              <p className="text-xs text-muted-foreground">
                                {r.orderNo}｜{r.ruleName}（{(r.percentBps / 100).toLocaleString()}%）
                              </p>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <p className="font-semibold">NT${r.amount.toLocaleString()}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {new Date(r.createdAt).toLocaleDateString("zh-TW")}
                              </p>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="py-10 text-center text-muted-foreground">期間內沒有分潤紀錄</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {dialog.open && (
        <RuleDialog rule={dialog.rule} onClose={() => setDialog({ open: false, rule: null })} />
      )}
    </AdminLayout>
  );
}
