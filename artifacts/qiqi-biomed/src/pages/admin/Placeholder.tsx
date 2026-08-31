import { Construction } from "lucide-react";
import { AdminLayout } from "./AdminLayout";

export default function AdminPlaceholderPage({ title }: { title: string }) {
  return (
    <AdminLayout title={title}>
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-white py-24 text-center"
        data-testid="section-admin-placeholder"
      >
        <div className="rounded-2xl bg-primary/10 p-4 text-primary">
          <Construction size={32} />
        </div>
        <p className="text-lg font-bold">{title}模組建置中</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          此功能將於後續版本開放，敬請期待。
        </p>
      </div>
    </AdminLayout>
  );
}
