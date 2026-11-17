/**
 * 人事規則（純計算，不碰資料庫，方便測試）。
 * 依據：勞動基準法第 38 條（特別休假）、勞工請假規則、性別平等工作法。
 */

// ---------- 日期工具（一律用 YYYY-MM-DD 字串，以 UTC 計算避免時區位移）----------

export function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function parse(date: string): Date { return new Date(`${date}T00:00:00Z`); }
function fmt(d: Date): string { return d.toISOString().slice(0, 10); }

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}

/** 加月份；目標月份沒有那一天時取月底（1/31 + 1 個月 = 2/28） */
export function addMonths(date: string, months: number): string {
  const d = parse(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fmt(target);
}

export function taipeiToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isWeekend(date: string): boolean {
  const day = parse(date).getUTCDay();
  return day === 0 || day === 6;
}

/** 起訖之間的每一天 */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > 800) break;
  }
  return out;
}

/** 起訖之間的工作日（排除六日與假日） */
export function workingDates(from: string, to: string, holidays: ReadonlySet<string> = new Set()): string[] {
  return eachDate(from, to).filter(d => !isWeekend(d) && !holidays.has(d));
}

// ---------- 特別休假（勞基法第 38 條，週年制）----------

/** 滿 years 年的特休天數（years ≥ 1）；滿半年未滿一年另計 3 天 */
export function annualLeaveDaysForYears(years: number): number {
  if (years < 1) return 0;
  if (years < 2) return 7;
  if (years < 3) return 10;
  if (years < 5) return 14;
  if (years < 10) return 15;
  return Math.min(30, 15 + (years - 9)); // 滿 10 年 16 天，每年加 1 天，最多 30 天
}

export interface AnnualLeavePeriod {
  /** 年資區間開始（特休發放日） */
  periodStart: string;
  /** 區間最後一天（期滿日），沒休完要折發工資 */
  periodEnd: string;
  days: number;
  /** 0 = 滿半年；1 以上 = 滿幾年 */
  seniorityYears: number;
  label: string;
}

function periodAt(joinDate: string, index: number): AnnualLeavePeriod {
  if (index === 0) {
    return {
      periodStart: addMonths(joinDate, 6),
      periodEnd: addDays(addMonths(joinDate, 12), -1),
      days: 3, seniorityYears: 0, label: "滿半年",
    };
  }
  return {
    periodStart: addMonths(joinDate, index * 12),
    periodEnd: addDays(addMonths(joinDate, (index + 1) * 12), -1),
    days: annualLeaveDaysForYears(index), seniorityYears: index, label: `滿 ${index} 年`,
  };
}

/** asOf 當天所在的特休區間；到職未滿半年回傳 null */
export function currentAnnualLeavePeriod(joinDate: string, asOf: string): AnnualLeavePeriod | null {
  if (!isDateString(joinDate) || !isDateString(asOf)) return null;
  if (asOf < addMonths(joinDate, 6)) return null;
  for (let i = 0; i < 80; i++) {
    const p = periodAt(joinDate, i);
    if (asOf >= p.periodStart && asOf <= p.periodEnd) return p;
  }
  return null;
}

/** 下一次發放特休的日期與天數 */
export function nextAnnualLeaveGrant(joinDate: string, asOf: string): { date: string; days: number; label: string } | null {
  if (!isDateString(joinDate) || !isDateString(asOf)) return null;
  for (let i = 0; i < 80; i++) {
    const p = periodAt(joinDate, i);
    if (p.periodStart > asOf) return { date: p.periodStart, days: p.days, label: p.label };
  }
  return null;
}

/** 年資文字，例如「2 年 3 個月」 */
export function seniorityText(joinDate: string, asOf: string): string {
  if (!isDateString(joinDate) || !isDateString(asOf) || asOf < joinDate) return "—";
  const a = parse(joinDate), b = parse(asOf);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} 個月`;
  return rest === 0 ? `${years} 年` : `${years} 年 ${rest} 個月`;
}

// ---------- 假別 ----------

export type LeavePay = "full" | "half" | "none";

export interface LeaveTypeRule {
  code: string;
  label: string;
  pay: LeavePay;
  /** 一年可請的天數上限（null = 沒有固定上限或依個案） */
  yearlyLimit: number | null;
  /** 一個月可請的天數上限 */
  monthlyLimit?: number;
  /** 以日曆天計算（含假日），例如產假 */
  calendarDays?: boolean;
  /** 這個假別的天數要併入另一個假別的年度上限計算 */
  countsInto?: string;
  note: string;
}

export const LEAVE_TYPES: LeaveTypeRule[] = [
  { code: "Annual Leave", label: "特休", pay: "full", yearlyLimit: null, note: "依年資發放，工資照給；期滿或離職沒休完要折發工資" },
  { code: "Casual Leave", label: "事假", pay: "none", yearlyLimit: 14, note: "一年 14 天，不給工資" },
  { code: "Sick Leave", label: "病假", pay: "half", yearlyLimit: 30, note: "未住院一年 30 天，工資折半" },
  { code: "Hospitalized Sick Leave", label: "住院病假", pay: "half", yearlyLimit: null, note: "住院兩年內合計一年；全年 30 天內工資折半" },
  { code: "Menstrual Leave", label: "生理假", pay: "half", yearlyLimit: null, monthlyLimit: 1, note: "每月 1 天，工資折半；全年 3 天內不併入病假" },
  { code: "Family Care Leave", label: "家庭照顧假", pay: "none", yearlyLimit: 7, countsInto: "Casual Leave", note: "一年 7 天，併入事假計算，不給工資" },
  { code: "Marriage Leave", label: "婚假", pay: "full", yearlyLimit: 8, note: "8 天，工資照給" },
  { code: "Bereavement Leave", label: "喪假", pay: "full", yearlyLimit: null, note: "依親等 3、6 或 8 天，工資照給" },
  { code: "Maternity Leave", label: "產假", pay: "full", yearlyLimit: null, calendarDays: true, note: "分娩前後 8 週（含假日）；到職滿 6 個月工資照給，未滿折半" },
  { code: "Prenatal Checkup Leave", label: "產檢假", pay: "full", yearlyLimit: 7, note: "7 天，工資照給" },
  { code: "Paternity Leave", label: "陪產檢及陪產假", pay: "full", yearlyLimit: 7, note: "7 天，工資照給" },
  { code: "Occupational Injury Leave", label: "公傷病假", pay: "full", yearlyLimit: null, note: "職業災害醫療期間，工資照給" },
  { code: "Official Leave", label: "公假", pay: "full", yearlyLimit: null, note: "依法令規定，工資照給" },
];

export function leaveTypeRule(code: string): LeaveTypeRule | undefined {
  return LEAVE_TYPES.find(t => t.code === code);
}

/** 請假扣薪比例：不給薪扣 1 天、半薪扣半天、全薪不扣 */
export function leaveDeductionFactor(code: string): number {
  const rule = leaveTypeRule(code);
  if (!rule) return 0;
  return rule.pay === "none" ? 1 : rule.pay === "half" ? 0.5 : 0;
}

export type DayPart = "full" | "am" | "pm";

/** 一張假單算幾天。半天假只能請單日。回傳 0 代表期間內沒有工作日。 */
export function countLeaveDays(input: { leaveType: string; fromDate: string; toDate: string; dayPart?: DayPart; holidays?: ReadonlySet<string> }): number {
  const rule = leaveTypeRule(input.leaveType);
  if (rule?.calendarDays) return eachDate(input.fromDate, input.toDate).length;
  const days = workingDates(input.fromDate, input.toDate, input.holidays).length;
  if (days === 0) return 0;
  if (input.dayPart && input.dayPart !== "full") return input.fromDate === input.toDate ? 0.5 : days;
  return days;
}

interface LeaveLike { leaveType: string; fromDate: string; toDate: string; totalDays: number | string; status?: string }

/** 一張假單落在指定期間內的天數（跨月的假單只算在期間內的那幾天） */
export function leaveDaysWithin(leave: LeaveLike, from: string, to: string, holidays: ReadonlySet<string> = new Set()): number {
  const start = leave.fromDate > from ? leave.fromDate : from;
  const end = leave.toDate < to ? leave.toDate : to;
  if (start > end) return 0;
  if (leave.fromDate === leave.toDate) return Number(leave.totalDays) || 0;
  const rule = leaveTypeRule(leave.leaveType);
  return rule?.calendarDays ? eachDate(start, end).length : workingDates(start, end, holidays).length;
}

/** 檢查年度／每月上限。回傳超過上限的說明，沒超過回傳 null。 */
export function leaveLimitProblem(input: {
  leaveType: string; fromDate: string; requestedDays: number;
  /** 同一位員工今年已核准或待審的假單（不含這一張） */
  existing: LeaveLike[];
  holidays?: ReadonlySet<string>;
}): string | null {
  const rule = leaveTypeRule(input.leaveType);
  if (!rule) return null;
  const year = input.fromDate.slice(0, 4);
  const yearStart = `${year}-01-01`, yearEnd = `${year}-12-31`;
  const used = (codes: string[], from: string, to: string) => input.existing
    .filter(l => codes.includes(l.leaveType))
    .reduce((sum, l) => sum + leaveDaysWithin(l, from, to, input.holidays), 0);

  if (rule.monthlyLimit) {
    const month = input.fromDate.slice(0, 7);
    const monthEnd = addDays(addMonths(`${month}-01`, 1), -1);
    const usedThisMonth = used([rule.code], `${month}-01`, monthEnd);
    if (usedThisMonth + input.requestedDays > rule.monthlyLimit) {
      return `${rule.label}每月最多 ${rule.monthlyLimit} 天，這個月已請 ${usedThisMonth} 天`;
    }
  }
  if (rule.yearlyLimit !== null) {
    const usedThisYear = used([rule.code], yearStart, yearEnd);
    if (usedThisYear + input.requestedDays > rule.yearlyLimit) {
      return `${rule.label}一年最多 ${rule.yearlyLimit} 天，今年已請 ${usedThisYear} 天，剩 ${Math.max(0, rule.yearlyLimit - usedThisYear)} 天`;
    }
  }
  // 併入計算的假別（家庭照顧假併入事假 14 天）
  const parent = rule.countsInto ? leaveTypeRule(rule.countsInto) : rule;
  if (parent && parent.yearlyLimit !== null) {
    const group = LEAVE_TYPES.filter(t => t.code === parent.code || t.countsInto === parent.code).map(t => t.code);
    if (group.length > 1) {
      const usedGroup = used(group, yearStart, yearEnd);
      if (usedGroup + input.requestedDays > parent.yearlyLimit) {
        return `${parent.label}與家庭照顧假一年合計最多 ${parent.yearlyLimit} 天，今年已請 ${usedGroup} 天`;
      }
    }
  }
  return null;
}

// ---------- 月出勤彙總 ----------

interface AttendanceLike {
  date: string; status: string; lateMinutes: number; earlyLeaveMinutes: number;
  workingHours: string | number | null; overtimeHours: string | number | null;
}

export interface MonthSummary {
  presentDays: number; lateCount: number; totalLateMinutes: number; earlyLeaveCount: number;
  totalWorkingHours: number; totalOvertimeHours: number;
  leaveDays: number; absentDays: number; workingDays: number;
  /** 忘記打下班卡的天數（有上班卡、沒下班卡，且不是今天） */
  missingCheckoutDays: number;
  /** 請假要扣薪的天數（事假 1 天算 1、病假 1 天算 0.5） */
  unpaidLeaveDays: number;
}

const PRESENT = new Set(["present", "late", "early leave", "early_leave", "early-leave"]);

/**
 * 彙總一位員工一個月的出勤。
 * 應出勤日 = 平日、不是假日、在到職日之後、在離職日之前；
 * 缺勤只算「已經過去」的應出勤日（今天和未來的日子不算缺勤）。
 */
export function summarizeMonth(input: {
  year: number; month: number; today: string;
  joinDate?: string | null; resignationDate?: string | null;
  holidays?: ReadonlySet<string>;
  records: (AttendanceLike & { checkIn?: string | null; checkOut?: string | null })[];
  approvedLeaves: LeaveLike[];
}): MonthSummary {
  const holidays = input.holidays ?? new Set<string>();
  const mm = String(input.month).padStart(2, "0");
  const monthStart = `${input.year}-${mm}-01`;
  const monthEnd = addDays(addMonths(monthStart, 1), -1);
  const from = input.joinDate && isDateString(input.joinDate) && input.joinDate > monthStart ? input.joinDate : monthStart;
  const to = input.resignationDate && isDateString(input.resignationDate) && input.resignationDate < monthEnd ? input.resignationDate : monthEnd;
  const expected = from <= to ? workingDates(from, to, holidays) : [];

  const records = input.records;
  const leaveDates = new Set<string>();
  for (const leave of input.approvedLeaves) {
    const start = leave.fromDate > monthStart ? leave.fromDate : monthStart;
    const end = leave.toDate < monthEnd ? leave.toDate : monthEnd;
    if (start > end) continue;
    for (const d of eachDate(start, end)) leaveDates.add(d);
  }
  for (const r of records) if (r.status.toLowerCase() === "on leave") leaveDates.add(r.date);

  const attendanceDates = new Set(records.map(r => r.date));
  const explicitAbsent = records.filter(r => r.status.toLowerCase() === "absent").map(r => r.date);
  const missing = expected.filter(d => d < input.today && !attendanceDates.has(d) && !leaveDates.has(d));
  const round1 = (n: number) => Math.round(n * 10) / 10;

  let leaveDays = 0, unpaidLeaveDays = 0;
  for (const leave of input.approvedLeaves) {
    const days = leaveDaysWithin(leave, monthStart, monthEnd, holidays);
    leaveDays += days;
    unpaidLeaveDays += days * leaveDeductionFactor(leave.leaveType);
  }
  leaveDays += records.filter(r => r.status.toLowerCase() === "on leave" &&
    !input.approvedLeaves.some(l => l.fromDate <= r.date && l.toDate >= r.date)).length;

  return {
    presentDays: new Set(records.filter(r => PRESENT.has(r.status.toLowerCase())).map(r => r.date)).size,
    lateCount: records.filter(r => r.lateMinutes > 0).length,
    totalLateMinutes: records.reduce((sum, r) => sum + r.lateMinutes, 0),
    earlyLeaveCount: records.filter(r => r.earlyLeaveMinutes > 0).length,
    totalWorkingHours: round1(records.reduce((sum, r) => sum + Number(r.workingHours || 0), 0)),
    totalOvertimeHours: round1(records.reduce((sum, r) => sum + Number(r.overtimeHours || 0), 0)),
    leaveDays: round1(leaveDays),
    absentDays: new Set([...explicitAbsent, ...missing]).size,
    workingDays: expected.length,
    missingCheckoutDays: records.filter(r => r.checkIn && !r.checkOut && r.date < input.today).length,
    unpaidLeaveDays: round1(unpaidLeaveDays),
  };
}

// ---------- 打卡計算 ----------

export interface ShiftLike {
  startTime: string; endTime: string;
  breakStart: string | null; breakEnd: string | null;
  workingHours: string | number;
}

/** 遲到幾分鐘內不算遲到（超過就從表定上班時間起算） */
export const LATE_GRACE_MINUTES = 5;

export function toMinutes(time: string): number {
  const [hour, minute] = time.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

export function isTimeString(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function shiftTimeline(shift: ShiftLike) {
  const start = toMinutes(shift.startTime);
  let end = toMinutes(shift.endTime);
  const overnight = end <= start;
  if (overnight) end += 24 * 60;
  let breakStart: number | null = shift.breakStart ? toMinutes(shift.breakStart) : null;
  let breakEnd: number | null = shift.breakEnd ? toMinutes(shift.breakEnd) : null;
  if (breakStart !== null && breakEnd !== null) {
    if (overnight && breakStart < start) breakStart += 24 * 60;
    while (breakEnd <= breakStart) breakEnd += 24 * 60;
  } else {
    breakStart = null; breakEnd = null;
  }
  return { start, end, overnight, breakStart, breakEnd };
}

function punchMinute(time: string, timeline: ReturnType<typeof shiftTimeline>): number {
  let punch = toMinutes(time);
  if (timeline.overnight && punch <= timeline.end - 24 * 60) punch += 24 * 60;
  return punch;
}

export function lateMinutesFor(shift: ShiftLike, checkIn: string): number {
  const timeline = shiftTimeline(shift);
  const late = punchMinute(checkIn, timeline) - timeline.start;
  return late > LATE_GRACE_MINUTES ? late : 0;
}

/** 下班打卡後的工時、早退、加班 */
export function computeCheckout(shift: ShiftLike, checkIn: string, checkOut: string) {
  const timeline = shiftTimeline(shift);
  const inMinute = punchMinute(checkIn, timeline);
  let outMinute = toMinutes(checkOut);
  while (outMinute < inMinute) outMinute += 24 * 60;
  let worked = outMinute - inMinute;
  if (timeline.breakStart !== null && timeline.breakEnd !== null) {
    worked -= Math.max(0, Math.min(outMinute, timeline.breakEnd) - Math.max(inMinute, timeline.breakStart));
  }
  worked = Math.max(0, worked);
  const workingHours = Math.round((worked / 60) * 100) / 100;
  const overtimeRaw = workingHours - Number(shift.workingHours);
  return {
    workingHours,
    // 加班以半小時為單位，不足半小時不計
    overtimeHours: overtimeRaw > 0 ? Math.floor(overtimeRaw * 2) / 2 : 0,
    earlyLeaveMinutes: Math.max(0, timeline.end - outMinute),
  };
}
