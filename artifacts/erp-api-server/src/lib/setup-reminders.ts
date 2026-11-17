import { sql } from "drizzle-orm";
import { taipeiToday } from "./hr-rules";

/**
 * 開始使用前要設定的資料。沒設定時，特休、缺勤、薪資、收入科目、期初帳算出來的數字會不對。
 * 能從資料判斷的項目自動判斷完成與否；無法判斷的（例如到職日填得對不對）列為「請確認」。
 */
export interface SetupReminder {
  key: string;
  title: string;
  detail: string;
  /** 去哪一頁處理 */
  path: string;
  /** auto：系統能判斷是否完成；confirm：要管理員自己確認 */
  kind: "auto" | "confirm";
  done: boolean;
}

interface Counts {
  activeEmployees: number; employeesWithoutShift: number; employeesWithoutGrade: number;
  shiftTypes: number; grades: number; holidaysThisYear: number;
  items: number; virtualItems: number; openingEntries: number; journalEntries: number;
  manualLeaveGrants: number; cashAccounts: number;
}

/** 由統計數字組出提醒清單（純計算，方便測試） */
export function buildSetupReminders(c: Counts, year: number): SetupReminder[] {
  const list: SetupReminder[] = [
    {
      key: "employee-join-date", kind: "confirm", done: c.activeEmployees === 0, path: "/hr/employees",
      title: "確認員工的到職日",
      detail: `特休與年資從到職日起算。請確認 ${c.activeEmployees} 位在職員工的到職日都是實際的日期。`,
    },
    {
      key: "holidays", kind: "auto", done: c.holidaysThisYear > 0, path: "/system/calendar",
      title: `建立 ${year} 年的假日`,
      detail: "國定假日要在行事曆新增成類型「假日」的事件，否則那幾天會被算成缺勤，請假也會多扣天數。",
    },
    {
      key: "shift-types", kind: "auto", done: c.shiftTypes > 0 && c.employeesWithoutShift === 0, path: "/hr/shift-types",
      title: "建立班制並指定給員工",
      detail: c.shiftTypes === 0
        ? "還沒有建立班制。沒指定班制的員工一律以 09:00–18:00 計算遲到、早退與加班。"
        : `還有 ${c.employeesWithoutShift} 位員工沒指定班制，會以 09:00–18:00 計算。`,
    },
    {
      key: "grades", kind: "auto", done: c.grades > 0 && c.employeesWithoutGrade === 0, path: "/admin/grades",
      title: "建立職級並指定給員工",
      detail: c.grades === 0 ? "還沒有建立職級。" : `還有 ${c.employeesWithoutGrade} 位員工沒指定職級。`,
    },
    {
      key: "virtual-items", kind: c.items > 0 && c.virtualItems === 0 ? "auto" : "confirm", done: c.items === 0 ? true : c.virtualItems > 0, path: "/inventory/items",
      title: "課程、服務類品項勾選「虛擬」",
      detail: "勾了「虛擬」的品項不算庫存，收入會記到勞務收入；沒勾的會被當成實體商品。目前沒有任何品項勾選虛擬。",
    },
    {
      key: "opening-balance", kind: "auto", done: c.openingEntries > 0, path: "/accounting/journal",
      title: "輸入期初餘額（開帳）",
      detail: "把開始使用系統前各科目的餘額輸入進來，資產負債表才會是完整的數字。在日記帳頁按「期初餘額」。",
    },
    {
      key: "cash-accounts", kind: "auto", done: c.cashAccounts > 0, path: "/accounting/accounts",
      title: "建立現金與銀行存款科目",
      detail: "科目表裡沒有現金或銀行存款的明細科目，收款、付款、發薪會沒有帳戶可以選。",
    },
    {
      key: "leave-adjust", kind: "confirm", done: c.activeEmployees === 0 || c.manualLeaveGrants > 0, path: "/hr/leaves",
      title: "扣掉系統上線前已經休掉的特休",
      detail: "系統會依到職日發放整期的特休。上線前已經休掉的天數，請到「請假管理 → 特休總覽」用「調整」填負數扣掉。",
    },
  ];
  return list;
}

/** 讀出這家公司目前的設定狀態 */
export async function loadSetupReminders(executor: any): Promise<SetupReminder[]> {
  const today = taipeiToday();
  const year = Number(today.slice(0, 4));
  const result = await executor.execute(sql`
    SELECT
      (SELECT count(*) FROM employees WHERE status = 'Active')::int AS "activeEmployees",
      (SELECT count(*) FROM employees WHERE status = 'Active' AND shift_type_id IS NULL)::int AS "employeesWithoutShift",
      (SELECT count(*) FROM employees WHERE status = 'Active' AND grade_id IS NULL)::int AS "employeesWithoutGrade",
      (SELECT count(*) FROM shift_types)::int AS "shiftTypes",
      (SELECT count(*) FROM grades WHERE is_active)::int AS "grades",
      (SELECT count(*) FROM calendar_events WHERE event_type = 'Holiday' AND status = 'Active'
         AND start_date <= ${`${year}-12-31`} AND COALESCE(end_date, start_date) >= ${`${year}-01-01`})::int AS "holidaysThisYear",
      (SELECT count(*) FROM items)::int AS "items",
      (SELECT count(*) FROM items WHERE is_virtual)::int AS "virtualItems",
      (SELECT count(*) FROM journal_entries WHERE entry_number LIKE 'JE-OPEN-%' AND status = 'Posted')::int AS "openingEntries",
      (SELECT count(*) FROM journal_entries)::int AS "journalEntries",
      (SELECT count(*) FROM leave_grants WHERE source = 'manual')::int AS "manualLeaveGrants",
      (SELECT count(*) FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_account_id
         WHERE a.is_group = false AND a.account_type = 'Asset'
           AND (a.cash_flow_category = 'cash' OR p.account_name ~ '現金' OR a.account_name ~ '^(庫存現金|零用金|現金|銀行存款|銀行存摺)'))::int AS "cashAccounts"
  `);
  const row = (result?.rows ?? result ?? [])[0] ?? {};
  const counts = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v) || 0])) as unknown as Counts;
  return buildSetupReminders(counts, year);
}

export const SETUP_NOTIFICATION_TITLE = "系統設定尚未完成";

/**
 * 還有系統判斷得出來的未完成項目時，通知老闆與管理員（每人最多一則未讀，不會重複轟炸）。
 * 回傳這次新發出的通知數。
 */
export async function notifySetupReminders(executor: any): Promise<number> {
  const pending = (await loadSetupReminders(executor)).filter(r => !r.done && r.kind === "auto");
  if (pending.length === 0) return 0;
  const adminsResult = await executor.execute(sql`SELECT username FROM admin_users WHERE is_active AND role IN ('owner', 'admin')`);
  const admins: Array<{ username: string }> = adminsResult?.rows ?? adminsResult ?? [];
  const message = `還有 ${pending.length} 項設定沒完成：${pending.map(r => r.title).join("、")}。沒設定時，特休、缺勤、薪資與帳務的數字會不正確。請到首頁的「上線前設定」逐項處理。`;
  let sent = 0;
  for (const admin of admins) {
    const existingResult = await executor.execute(sql`
      SELECT id FROM notifications WHERE recipient = ${admin.username} AND title = ${SETUP_NOTIFICATION_TITLE} AND is_read = 'No' LIMIT 1
    `);
    if ((existingResult?.rows ?? existingResult ?? []).length > 0) continue;
    await executor.execute(sql`
      INSERT INTO notifications (title, message, type, module, document_type, recipient)
      VALUES (${SETUP_NOTIFICATION_TITLE}, ${message}, 'warning', 'System', 'Setup', ${admin.username})
    `);
    sent++;
  }
  return sent;
}
