import {
  useGetAdminStats,
  getGetAdminStatsQueryKey,
} from "@workspace/api-client-react";
import {
  ClipboardList,
  Clock,
  DollarSign,
  Users,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminLayout } from "./AdminLayout";

export default function AdminDashboardPage() {
  const { data: stats, isLoading } = useGetAdminStats({
    query: { queryKey: getGetAdminStatsQueryKey() },
  });

  const cards = [
    {
      key: "orders",
      label: "訂單總數",
      value: stats?.orderCount,
      icon: ClipboardList,
      color: "bg-blue-50 text-blue-600",
    },
    {
      key: "pending",
      label: "待處理訂單",
      value: stats?.pendingOrderCount,
      icon: Clock,
      color: "bg-amber-50 text-amber-600",
    },
    {
      key: "revenue",
      label: "營收（NT$）",
      value: stats?.totalRevenue,
      icon: DollarSign,
      color: "bg-green-50 text-green-600",
    },
    {
      key: "members",
      label: "會員數",
      value: stats?.memberCount,
      icon: Users,
      color: "bg-indigo-50 text-indigo-600",
    },
  ];

  return (
    <AdminLayout title="儀表板">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.key}
              className="rounded-2xl border bg-white p-5 shadow-sm"
              data-testid={`card-stat-${card.key}`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{card.label}</p>
                <div className={`rounded-xl p-2 ${card.color}`}>
                  <Icon size={18} />
                </div>
              </div>
              {isLoading ? (
                <Skeleton className="mt-2 h-8 w-24" />
              ) : (
                <p
                  className="mt-1 text-2xl font-bold"
                  data-testid={`text-stat-${card.key}`}
                >
                  {(card.value ?? 0).toLocaleString("zh-TW")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </AdminLayout>
  );
}
