import { todayText } from "@/lib/call";

/**
 * 部門、專案下拉選單共用的規則（老闆 2026-11-18）：
 * - 部門：停用的不列出。
 * - 專案：名稱後面帶期間；停用的、已結束的（結束日期早於今天）不列出。
 * - 例外：目前選到的那一筆一定列出，編輯舊單據時才看得到原本的值，並標上「（已停用）」或「（已結束）」。
 *
 * 只用在「填單時挑選」的選單。管理頁、報表篩選、依編號查名稱要用完整清單，不要套這裡的篩選。
 */

type Id = number | string;
type Current = Id | null | undefined;

export interface DepartmentLike { id: Id; name: string; isActive?: boolean | null }
export interface ProjectLike {
  id: Id;
  name: string;
  isActive?: boolean | null;
  startDate?: string | null;
  endDate?: string | null;
}

const isCurrent = (id: Id, current: Current) =>
  current !== null && current !== undefined && current !== "" && String(id) === String(current);

/** 只取日期的前 10 個字（YYYY-MM-DD），空白或格式不對回傳空字串 */
const dateOnly = (value?: string | null) => {
  const text = (value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
};

/** 專案是否已結束：有結束日期，而且早於今天（台北時間）。結束日當天還算進行中。 */
export function isProjectEnded(project: { endDate?: string | null }, today: string = todayText()): boolean {
  const end = dateOnly(project.endDate);
  return end !== "" && end < today;
}

/** 可以選的部門：啟用中的，加上目前選到的那一個（即使已停用）。 */
export function selectableDepartments<T extends { id: Id; isActive?: boolean | null }>(
  list: readonly T[] | null | undefined,
  currentValue?: Current,
): T[] {
  return (Array.isArray(list) ? list : []).filter((d) => d.isActive !== false || isCurrent(d.id, currentValue));
}

/** 可以選的專案：啟用中而且還沒結束的，加上目前選到的那一個。 */
export function selectableProjects<T extends { id: Id; isActive?: boolean | null; endDate?: string | null }>(
  list: readonly T[] | null | undefined,
  currentValue?: Current,
  today: string = todayText(),
): T[] {
  return (Array.isArray(list) ? list : []).filter(
    (p) => (p.isActive !== false && !isProjectEnded(p, today)) || isCurrent(p.id, currentValue),
  );
}

/** 部門顯示文字：停用的後面加「（已停用）」。 */
export function departmentLabel(department: { name: string; isActive?: boolean | null }): string {
  return department.isActive === false ? `${department.name}（已停用）` : department.name;
}

/** 專案期間文字，例如「2026/09/01～2027/01/15」「2026/09/01 起」「到 2027/01/15」；沒有日期回傳空字串。 */
export function projectPeriod(project: { startDate?: string | null; endDate?: string | null }): string {
  const start = dateOnly(project.startDate).replace(/-/g, "/");
  const end = dateOnly(project.endDate).replace(/-/g, "/");
  if (start && end) return `${start}～${end}`;
  if (start) return `${start} 起`;
  if (end) return `到 ${end}`;
  return "";
}

/** 專案顯示文字：名稱加期間，例如「校園社團（2026/09/01～2027/01/15）」。報表篩選用這個。 */
export function projectLabel(project: { name: string; startDate?: string | null; endDate?: string | null }): string {
  const period = projectPeriod(project);
  return period ? `${project.name}（${period}）` : project.name;
}

/** 填單選單用的專案文字：名稱加期間，停用或已結束的再加註記（只有目前選到的那一筆才會出現）。 */
export function projectPickerLabel(
  project: { name: string; isActive?: boolean | null; startDate?: string | null; endDate?: string | null },
  today: string = todayText(),
): string {
  const label = projectLabel(project);
  if (project.isActive === false) return `${label}（已停用）`;
  if (isProjectEnded(project, today)) return `${label}（已結束）`;
  return label;
}
