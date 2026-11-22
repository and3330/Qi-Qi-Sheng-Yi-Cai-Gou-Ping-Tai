import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";

import { selectableProjects, projectPickerLabel } from "@/lib/select-options";

interface ProjectOption { id: number; name: string; isActive?: boolean; parentId?: number | null; startDate?: string | null; endDate?: string | null }

/**
 * 「歸屬專案」欄位。專案是收支統計的單位，每一筆收入與支出都要選。
 * 停用或已結束的專案不列出，除非目前選的就是它（編輯舊資料時才看得到原本的值）。
 * 名稱後面帶專案期間。
 */
export function ProjectField({ value, onChange, label = "歸屬專案", required = true, className }: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  className?: string;
}) {
  const { data } = useQuery<ProjectOption[]>({
    queryKey: ["/erp-api/projects"],
    queryFn: async () => {
      const response = await fetch("/erp-api/projects", { credentials: "include" });
      if (!response.ok) throw new Error("無法取得專案清單");
      return response.json();
    },
    staleTime: 60_000,
  });
  const usable = selectableProjects(data, value);
  // 主專案在前，它的子專案緊跟在後面並縮排；主專案沒列出來的子專案當成一般專案
  const ids = new Set(usable.map(p => p.id));
  const byName = (a: ProjectOption, b: ProjectOption) => a.name.localeCompare(b.name, "zh-Hant");
  const projects = usable.filter(p => !p.parentId || !ids.has(p.parentId)).sort(byName)
    .flatMap(p => [{ ...p, label: projectPickerLabel(p) }, ...usable.filter(c => c.parentId === p.id).sort(byName).map(c => ({ ...c, label: `　└ ${projectPickerLabel(c)}` }))]);

  return (
    <div className={className}>
      <Label>{label}{required && <span className="ml-0.5 text-red-500">*</span>}</Label>
      <select
        className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm ${required && !value ? "border-red-300" : "border-input"}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        data-testid="select-project"
      >
        <option value="">請選擇專案</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
    </div>
  );
}
