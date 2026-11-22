import { Router, type IRouter } from "express";
import { pgErrorCode, pgErrorConstraint } from "../lib/pg-error";
import { eq, and, sql, gte, lte, desc, isNull } from "drizzle-orm";
import { ListAttendanceQueryParams } from "@workspace/erp-api-zod";
import { requireAuth, requireRole, sessionEmployeeScope } from "../middleware/require-auth";
import { db, attendanceTable, employeesTable, shiftTypesTable, leavesTable, clockInLocationsTable, activitiesTable } from "@workspace/erp-db";
import { addDays, computeCheckout, isDateString, isTimeString, lateMinutesFor, shiftTimeline, summarizeMonth, taipeiToday, type ShiftLike } from "../lib/hr-rules";
import { loadHolidays } from "../lib/hr-data";
import { machineOnly } from "../lib/api-key-user";

const router: IRouter = Router();
router.use("/attendance", requireAuth);

const HR_ROLES = ["owner", "admin", "hr_admin"] as const;

/** 員工自助帳號：確認可操作指定員工資料，回傳最終可用的員工 id（未綁定或不符回傳 null 並已回應錯誤） */
function resolveEmployeeScope(req: Parameters<typeof sessionEmployeeScope>[0], res: import("express").Response, requestedEmployeeId: number | undefined): { blocked: boolean; employeeId?: number } {
  const scope = sessionEmployeeScope(req);
  if (!scope.isEmployee) return { blocked: false, employeeId: requestedEmployeeId };
  if (!scope.employeeId) {
    res.status(403).json({ error: "帳號尚未綁定員工，請聯絡管理員" });
    return { blocked: true };
  }
  if (requestedEmployeeId !== undefined && requestedEmployeeId !== scope.employeeId) {
    res.status(403).json({ error: "只能查詢或打自己的卡" });
    return { blocked: true };
  }
  return { blocked: false, employeeId: scope.employeeId };
}

/** 非員工帳號需具備 HR/管理角色才能操作出勤資料（員工自助另由 resolveEmployeeScope 限制只能看自己） */
function requireAttendanceRole(req: Parameters<typeof sessionEmployeeScope>[0], res: import("express").Response): boolean {
  const scope = sessionEmployeeScope(req);
  if (scope.isEmployee) return true;
  if (machineOnly(req)) return true;
  const u = req.session?.user;
  if (!u || (u.role !== "super_admin" && !["owner", "admin", "hr_admin"].includes(u.role))) {
    res.status(403).json({ error: "權限不足" });
    return false;
  }
  return true;
}

type ResolvedShift = ShiftLike & { id: number | null; name: string };

const FALLBACK_SHIFT: ResolvedShift = {
  id: null,
  name: "標準班制",
  startTime: "09:00",
  endTime: "18:00",
  breakStart: "12:00",
  breakEnd: "13:00",
  workingHours: "8",
};

function taipeiNow(): { date: string; time: string } {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date());
  return { date: taipeiToday(), time };
}

function locationString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object" && "lat" in value && "lng" in value) {
    const { lat, lng } = value as { lat: unknown; lng: unknown };
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) return `${lat},${lng}`;
  }
  return null;
}

function parseCoords(value: string | null): { lat: number; lng: number } | null {
  if (!value) return null;
  const [lat, lng] = value.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function employeeShift(employeeId: number) {
  const [employee] = await db.select({
    id: employeesTable.id,
    shiftTypeId: employeesTable.shiftTypeId,
    status: employeesTable.status,
  }).from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!employee) return { employee: null, shift: FALLBACK_SHIFT };

  if (!employee.shiftTypeId) return { employee, shift: FALLBACK_SHIFT };
  const [shift] = await db.select().from(shiftTypesTable).where(eq(shiftTypesTable.id, employee.shiftTypeId));
  return { employee, shift: (shift as ResolvedShift | undefined) || FALLBACK_SHIFT };
}

/** 打卡紀錄當時用的班別（紀錄上有存就用那個，沒有就用員工目前的班別） */
async function shiftForRecord(record: { shiftTypeId: number | null; employeeId: number }): Promise<ResolvedShift> {
  if (record.shiftTypeId) {
    const [snapshot] = await db.select().from(shiftTypesTable).where(eq(shiftTypesTable.id, record.shiftTypeId));
    if (snapshot) return snapshot as ResolvedShift;
  }
  return (await employeeShift(record.employeeId)).shift;
}

const numeric = <T extends { workingHours: string | null; overtimeHours: string | null }>(r: T) => ({
  ...r,
  workingHours: r.workingHours ? Number(r.workingHours) : null,
  overtimeHours: Number(r.overtimeHours || 0),
});

router.get("/attendance/today-state", async (req, res): Promise<void> => {
  let employeeId = Number(req.query.employeeId);
  const date = String(req.query.date || "");
  if (!Number.isInteger(employeeId) || !isDateString(date)) {
    res.status(400).json({ error: "員工與日期格式不正確" });
    return;
  }
  // 員工自助：只能查自己的今日狀態；其他帳號需 HR/管理角色
  if (!requireAttendanceRole(req, res)) return;
  const scoped = resolveEmployeeScope(req, res, employeeId);
  if (scoped.blocked) return;
  if (scoped.employeeId !== undefined) employeeId = scoped.employeeId;
  const { employee, shift } = await employeeShift(employeeId);
  if (!employee) { res.status(404).json({ error: "找不到員工" }); return; }
  let [record] = await db.select().from(attendanceTable).where(and(
    eq(attendanceTable.employeeId, employeeId),
    eq(attendanceTable.date, date),
  ));
  // 跨夜班：過了午夜才下班，昨天那筆還沒打下班卡的紀錄才是「這一班」
  if (!record && shiftTimeline(shift).overnight) {
    const [open] = await db.select().from(attendanceTable).where(and(
      eq(attendanceTable.employeeId, employeeId),
      eq(attendanceTable.date, addDays(date, -1)),
      isNull(attendanceTable.checkOut),
    ));
    if (open?.checkIn) record = open;
  }
  res.json({
    record: record ? numeric(record) : null,
    shift: {
      id: shift.id,
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      breakStart: shift.breakStart,
      breakEnd: shift.breakEnd,
      workingHours: Number(shift.workingHours),
    },
  });
});

router.get("/attendance/monthly-summary", async (req, res): Promise<void> => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  let employeeId = req.query.employeeId !== undefined ? Number(req.query.employeeId) : undefined;
  const scope = sessionEmployeeScope(req);
  if (scope.isEmployee) {
    // 員工自助：只能看自己的月結
    const scoped = resolveEmployeeScope(req, res, employeeId);
    if (scoped.blocked) return;
    employeeId = scoped.employeeId;
  } else if (!requireAttendanceRole(req, res)) {
    return;
  }
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 ||
      (employeeId !== undefined && !Number.isInteger(employeeId))) {
    res.status(400).json({ error: "年月或員工格式不正確" });
    return;
  }
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;

  const [allEmployees, attendance, leaves, holidays] = await Promise.all([
    db.select({
      id: employeesTable.id,
      employeeId: employeesTable.employeeId,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      status: employeesTable.status,
      dateOfJoining: employeesTable.dateOfJoining,
      resignationDate: employeesTable.resignationDate,
    }).from(employeesTable).where(employeeId !== undefined ? eq(employeesTable.id, employeeId) : undefined),
    db.select().from(attendanceTable).where(and(
      gte(attendanceTable.date, startDate),
      lte(attendanceTable.date, endDate),
      ...(employeeId !== undefined ? [eq(attendanceTable.employeeId, employeeId)] : []),
    )),
    db.select().from(leavesTable).where(and(
      eq(leavesTable.status, "Approved"),
      lte(leavesTable.fromDate, endDate),
      gte(leavesTable.toDate, startDate),
      ...(employeeId !== undefined ? [eq(leavesTable.employeeId, employeeId)] : []),
    )),
    loadHolidays(startDate, endDate),
  ]);
  // 在職的，加上這個月才離職的（離職當月還是要結算）
  const employees = allEmployees.filter(e => e.status === "Active" || (e.resignationDate && e.resignationDate >= startDate));
  const today = taipeiToday();

  const rows = employees.map(employee => {
    const summary = summarizeMonth({
      year, month, today,
      joinDate: employee.dateOfJoining, resignationDate: employee.resignationDate, holidays,
      records: attendance.filter(a => a.employeeId === employee.id),
      approvedLeaves: leaves.filter(l => l.employeeId === employee.id),
    });
    return {
      employeeId: employee.id,
      employeeCode: employee.employeeId,
      employeeName: `${employee.firstName}${employee.lastName}`,
      ...summary,
    };
  });
  const workingDays = rows.length === 1 ? rows[0].workingDays
    : summarizeMonth({ year, month, today, holidays, records: [], approvedLeaves: [] }).workingDays;
  res.json({ year, month, workingDays, holidays: [...holidays].sort(), rows });
});

router.get("/attendance", async (req, res): Promise<void> => {
  const query = ListAttendanceQueryParams.safeParse(req.query);
  // 員工自助：只能看自己的出勤紀錄；其他帳號需 HR/管理角色
  if (!requireAttendanceRole(req, res)) return;
  const requested = query.success ? query.data.employeeId : undefined;
  const scoped = resolveEmployeeScope(req, res, requested);
  if (scoped.blocked) return;
  const conditions = [];
  if (scoped.employeeId) conditions.push(eq(attendanceTable.employeeId, scoped.employeeId));
  if (query.success && query.data.date) conditions.push(eq(attendanceTable.date, query.data.date));
  // 期間篩選：頁面一律帶期間，避免每次把所有歷史紀錄都撈出來
  if (isDateString(req.query.from)) conditions.push(gte(attendanceTable.date, req.query.from));
  if (isDateString(req.query.to)) conditions.push(lte(attendanceTable.date, req.query.to));

  const records = await db
    .select({
      id: attendanceTable.id,
      employeeId: attendanceTable.employeeId,
      employeeName: sql<string>`${employeesTable.firstName} || ${employeesTable.lastName}`,
      employeeCode: employeesTable.employeeId,
      date: attendanceTable.date,
      status: attendanceTable.status,
      checkIn: attendanceTable.checkIn,
      checkOut: attendanceTable.checkOut,
      workingHours: attendanceTable.workingHours,
      lateMinutes: attendanceTable.lateMinutes,
      earlyLeaveMinutes: attendanceTable.earlyLeaveMinutes,
      overtimeHours: attendanceTable.overtimeHours,
      shiftTypeId: attendanceTable.shiftTypeId,
      checkInLocation: attendanceTable.checkInLocation,
      checkOutLocation: attendanceTable.checkOutLocation,
      checkInLocationName: attendanceTable.checkInLocationName,
      checkOutLocationName: attendanceTable.checkOutLocationName,
      note: attendanceTable.note,
      createdAt: attendanceTable.createdAt,
    })
    .from(attendanceTable)
    .innerJoin(employeesTable, eq(attendanceTable.employeeId, employeesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(attendanceTable.date), employeesTable.employeeId);

  res.json(records.map(numeric));
});

router.post("/attendance", async (req, res): Promise<void> => {
  const employeeId = Number(req.body.employeeId);
  const { date, time: checkIn } = taipeiNow();
  if (!Number.isInteger(employeeId)) {
    res.status(400).json({ error: "打卡資料格式不正確" });
    return;
  }
  // 員工自助：只能替自己打卡；其他帳號需 HR/管理角色（kiosk 共用打卡機亦為管理帳號）
  if (!requireAttendanceRole(req, res)) return;
  const scoped = resolveEmployeeScope(req, res, employeeId);
  if (scoped.blocked) return;
  const targetEmployeeId = scoped.employeeId !== undefined ? scoped.employeeId : employeeId;
  const existing = await db.select().from(attendanceTable).where(and(
    eq(attendanceTable.employeeId, targetEmployeeId),
    eq(attendanceTable.date, date),
  ));
  if (existing.length > 0) {
    res.status(409).json({ error: existing[0].checkOut ? "今日已完成上下班打卡，請勿重複打卡" : "今日已上班打卡，請勿重複打卡" });
    return;
  }
  const { employee, shift } = await employeeShift(targetEmployeeId);
  if (!employee) { res.status(404).json({ error: "找不到員工" }); return; }
  if (employee.status !== "Active") { res.status(403).json({ error: "這位員工不是在職狀態，不能打卡" }); return; }

  const checkInLocation = locationString(req.body.location);
  const geofence = await checkGeofence(targetEmployeeId, checkInLocation);
  if (!geofence.ok) { res.status(geofence.status).json({ error: geofence.error }); return; }
  const lateMinutes = lateMinutesFor(shift, checkIn);
  try {
    const [record] = await db.insert(attendanceTable).values({
      employeeId: targetEmployeeId,
      date,
      status: lateMinutes > 0 ? "Late" : "Present",
      checkIn,
      lateMinutes,
      shiftTypeId: shift.id,
      checkInLocation,
      checkInLocationName: geofence.locationName,
      note: typeof req.body.note === "string" ? req.body.note.trim() || null : null,
    }).returning();
    res.status(201).json({ ...record, workingHours: null, overtimeHours: 0 });
  } catch (error) {
    if (pgErrorCode(error) === "23505" && pgErrorConstraint(error) === "attendance_emp_date_uniq") {
      const [duplicate] = await db.select().from(attendanceTable).where(and(
        eq(attendanceTable.employeeId, targetEmployeeId),
        eq(attendanceTable.date, date),
      ));
      res.status(409).json({ error: duplicate?.checkOut ? "今日已完成上下班打卡，請勿重複打卡" : "今日已上班打卡，請勿重複打卡" });
      return;
    }
    throw error;
  }
});

/** 補登與更正共用的檢查：時間格式、原因必填 */
function readCorrection(body: any): { error: string } | { checkIn: string; checkOut: string | null; reason: string } {
  const checkIn = body?.checkIn;
  const checkOut = body?.checkOut === "" || body?.checkOut == null ? null : body.checkOut;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!isTimeString(checkIn)) return { error: "請填寫上班時間（例如 09:00）" };
  if (checkOut !== null && !isTimeString(checkOut)) return { error: "下班時間格式不正確（例如 18:00）" };
  if (!reason) return { error: "請填寫補登或更正的原因" };
  return { checkIn, checkOut, reason };
}

function correctedValues(shift: ResolvedShift, checkIn: string, checkOut: string | null) {
  const lateMinutes = lateMinutesFor(shift, checkIn);
  const out = checkOut ? computeCheckout(shift, checkIn, checkOut) : null;
  return {
    checkIn, checkOut,
    status: lateMinutes > 0 ? "Late" : "Present",
    lateMinutes,
    workingHours: out ? String(out.workingHours) : null,
    overtimeHours: String(out?.overtimeHours ?? 0),
    earlyLeaveMinutes: out?.earlyLeaveMinutes ?? 0,
    shiftTypeId: shift.id,
  };
}

// 補登：員工忘記打卡的那一天，由人資補一筆（出勤紀錄依法要保存，補登一定要留原因與經手人）
router.post("/attendance/manual", requireRole(...HR_ROLES), async (req, res): Promise<void> => {
  const employeeId = Number(req.body?.employeeId);
  const date = req.body?.date;
  if (!Number.isInteger(employeeId) || !isDateString(date)) { res.status(400).json({ error: "請選擇員工與日期" }); return; }
  if (date > taipeiToday()) { res.status(400).json({ error: "不能補登未來的日期" }); return; }
  const input = readCorrection(req.body);
  if ("error" in input) { res.status(400).json({ error: input.error }); return; }
  const { employee, shift } = await employeeShift(employeeId);
  if (!employee) { res.status(404).json({ error: "找不到員工" }); return; }
  const actor = req.session?.user?.username || "api";
  try {
    const [record] = await db.insert(attendanceTable).values({
      employeeId, date, ...correctedValues(shift, input.checkIn, input.checkOut),
      note: `〔補登 ${actor}〕${input.reason}`,
    }).returning();
    await db.insert(activitiesTable).values({ type: "create", title: "補登打卡", module: "HR", description: `${actor} 補登員工 #${employeeId} ${date} 的打卡：${input.reason}` });
    res.status(201).json(numeric(record));
  } catch (error) {
    if (pgErrorCode(error) === "23505") { res.status(409).json({ error: "這一天已經有打卡紀錄，請直接更正那一筆" }); return; }
    throw error;
  }
});

// 更正：改上下班時間（例如忘記打下班卡），遲到、工時、加班會重新計算
router.put("/attendance/:id", requireRole(...HR_ROLES), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "格式不正確" }); return; }
  const input = readCorrection(req.body);
  if ("error" in input) { res.status(400).json({ error: input.error }); return; }
  const [existing] = await db.select().from(attendanceTable).where(eq(attendanceTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到打卡紀錄" }); return; }
  const shift = await shiftForRecord(existing);
  const actor = req.session?.user?.username || "api";
  const before = `${existing.checkIn || "--"}~${existing.checkOut || "--"}`;
  const [record] = await db.update(attendanceTable).set({
    ...correctedValues(shift, input.checkIn, input.checkOut),
    shiftTypeId: existing.shiftTypeId || shift.id,
    note: [existing.note, `〔更正 ${actor}：原 ${before}〕${input.reason}`].filter(Boolean).join("；"),
  }).where(eq(attendanceTable.id, id)).returning();
  await db.insert(activitiesTable).values({ type: "update", title: "更正打卡", module: "HR", description: `${actor} 更正員工 #${existing.employeeId} ${existing.date} 的打卡（原 ${before}）：${input.reason}` });
  res.json(numeric(record));
});

router.patch("/attendance/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { time: checkOut } = taipeiNow();
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "下班打卡資料格式不正確" });
    return;
  }
  const [existing] = await db.select().from(attendanceTable).where(eq(attendanceTable.id, id));

  const checkOutLocation = locationString(req.body.location);
  if (!existing) { res.status(404).json({ error: "找不到打卡紀錄，請先上班打卡" }); return; }
  if (!requireAttendanceRole(req, res)) return;
  const scoped = resolveEmployeeScope(req, res, existing.employeeId);
  if (scoped.blocked) return;
  if (!existing.checkIn) { res.status(409).json({ error: "尚未上班打卡，無法下班打卡" }); return; }
  if (existing.checkOut) { res.status(409).json({ error: "今日已下班打卡，請勿重複打卡" }); return; }
  const shift = await shiftForRecord(existing);
  // 只能替今天打下班卡（跨夜班可以替昨天那一班打）；更早忘記打的要請人資更正，避免算出一整天的工時
  const today = taipeiToday();
  const isLastNightShift = shiftTimeline(shift).overnight && existing.date === addDays(today, -1);
  if (existing.date !== today && !isLastNightShift) {
    res.status(409).json({ error: `${existing.date} 忘記打下班卡，請聯絡人資更正` }); return;
  }
  const { workingHours, overtimeHours, earlyLeaveMinutes } = computeCheckout(shift, existing.checkIn, checkOut);
  const note = typeof req.body.note === "string"
    ? [existing.note, req.body.note.trim()].filter(Boolean).join("；") || null
    : existing.note;

  const geofence = await checkGeofence(existing.employeeId, checkOutLocation);
  if (!geofence.ok) { res.status(geofence.status).json({ error: geofence.error }); return; }

  const [record] = await db.update(attendanceTable).set({
    checkOut,
    workingHours: String(workingHours),
    earlyLeaveMinutes,
    overtimeHours: String(overtimeHours),
    shiftTypeId: existing.shiftTypeId || shift.id,
    checkOutLocation,
    checkOutLocationName: geofence.locationName,
    note,
  }).where(eq(attendanceTable.id, id)).returning();
  res.json({ ...record, workingHours, overtimeHours });
});

export default router;

type GeofenceResult =
  | { ok: true; locationName: string | null }
  | { ok: false; status: number; error: string };

async function checkGeofence(employeeId: number, location: string | null): Promise<GeofenceResult> {
  const zones = await db.select().from(clockInLocationsTable).where(eq(clockInLocationsTable.isActive, true));
  if (zones.length === 0) return { ok: true, locationName: null };

  const [employee] = await db.select({ geofenceExempt: employeesTable.geofenceExempt })
    .from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (employee?.geofenceExempt) return { ok: true, locationName: null };

  const coords = parseCoords(location);
  if (!coords) {
    return { ok: false, status: 400, error: "無法取得您的 GPS 位置，請開啟定位權限後再打卡" };
  }
  let nearest: { name: string; distance: number; radius: number } | null = null;
  for (const zone of zones) {
    const distance = distanceMeters(coords, { lat: Number(zone.latitude), lng: Number(zone.longitude) });
    if (!nearest || distance - zone.radiusMeters < nearest.distance - nearest.radius) {
      nearest = { name: zone.name, distance, radius: zone.radiusMeters };
    }
    if (distance <= zone.radiusMeters) return { ok: true, locationName: zone.name };
  }
  const distanceText = nearest!.distance >= 1000
    ? `${(nearest!.distance / 1000).toFixed(1)} 公里`
    : `${Math.round(nearest!.distance)} 公尺`;
  return {
    ok: false,
    status: 403,
    error: `您不在允許的打卡範圍內：距離「${nearest!.name}」約 ${distanceText}（允許範圍 ${nearest!.radius} 公尺）`,
  };
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
