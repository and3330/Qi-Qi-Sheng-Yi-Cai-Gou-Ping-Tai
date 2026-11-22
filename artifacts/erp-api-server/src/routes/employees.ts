import { pgErrorCode } from "../lib/pg-error";
import { todayTaipei } from "../lib/inventory-journal";
import { Router, type IRouter } from "express";
import { eq, ilike, and, sql, inArray } from "drizzle-orm";
import { db, employeesTable, departmentsTable, activitiesTable, teachersTable, adminUsersTable, gradesTable } from "@workspace/erp-db";
import { hashPassword } from "../lib/auth";
import { accountName } from "../lib/company-identity";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { isDateString, seniorityText, taipeiToday } from "../lib/hr-rules";
import { reqTenantId } from "../middleware/tenant-context";
import { BUILTIN_ROLES } from "../lib/role-defaults";
import { removeUserFromCustomRoles } from "../lib/custom-roles";
import { machineOnly } from "../lib/api-key-user";
import {
  ListEmployeesQueryParams,
  CreateEmployeeBody,
  GetEmployeeParams,
  UpdateEmployeeParams,
  UpdateEmployeeBody,
  DeleteEmployeeParams,
} from "@workspace/erp-api-zod";

const HR_ROLES = ["owner", "admin", "hr_admin"] as const;

const EMPLOYEE_STATUSES = ["Active", "Inactive", "Suspended"];
/** 沒帶回傳 undefined（用預設值）；不認得的值回傳 null */
function normalizeEmployeeStatus(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" && EMPLOYEE_STATUSES.includes(value) ? value : null;
}

/**
 * 產生的驗證定義裡沒有的欄位（班別、健保眷屬、勞退自提、離職日、生日、緊急聯絡人）。
 * 有帶才處理；格式不對回傳錯誤說明。
 */
function readEmployeeExtras(body: any): { error: string } | { values: Record<string, unknown> } {
  const values: Record<string, unknown> = {};
  const has = (key: string) => body?.[key] !== undefined;
  const blank = (v: unknown) => v === null || v === "";
  if (has("shiftTypeId")) {
    if (blank(body.shiftTypeId)) values.shiftTypeId = null;
    else if (Number.isInteger(Number(body.shiftTypeId)) && Number(body.shiftTypeId) > 0) values.shiftTypeId = Number(body.shiftTypeId);
    else return { error: "班別無效" };
  }
  if (has("gradeId")) {
    if (blank(body.gradeId)) values.gradeId = null;
    else if (Number.isInteger(Number(body.gradeId)) && Number(body.gradeId) > 0) values.gradeId = Number(body.gradeId);
    else return { error: "職級無效" };
  }
  if (has("healthInsuranceDependents")) {
    const n = Number(body.healthInsuranceDependents || 0);
    if (!Number.isInteger(n) || n < 0 || n > 20) return { error: "健保眷屬人數請填 0 以上的整數" };
    values.healthInsuranceDependents = n;
  }
  if (has("pensionSelfRate")) {
    const n = Number(body.pensionSelfRate || 0);
    if (!Number.isInteger(n) || n < 0 || n > 6) return { error: "勞退自提比例請填 0 到 6（%）" };
    values.pensionSelfRate = n;
  }
  for (const [key, label] of [["resignationDate", "離職日"], ["birthDate", "生日"]] as const) {
    if (!has(key)) continue;
    if (blank(body[key])) values[key] = null;
    else if (isDateString(body[key])) values[key] = body[key];
    else return { error: `${label}格式不正確` };
  }
  for (const key of ["emergencyContact", "emergencyPhone"]) {
    if (has(key)) values[key] = blank(body[key]) ? null : String(body[key]).trim().slice(0, 100);
  }
  if (has("geofenceExempt")) values.geofenceExempt = Boolean(body.geofenceExempt);
  return { values };
}

/** 職級要是這家公司職級管理裡有的；回傳錯誤說明 */
async function gradeProblem(gradeId: unknown): Promise<string | null> {
  if (gradeId === undefined || gradeId === null) return null;
  const [grade] = await db.select({ id: gradesTable.id }).from(gradesTable).where(eq(gradesTable.id, Number(gradeId)));
  return grade ? null : "找不到這個職級，請到「職級管理」確認";
}

/** 員工離職後，綁定的登入帳號要一起停用，避免離職的人還能登入 */
async function deactivateAccounts(employeeIds: number[]): Promise<void> {
  if (employeeIds.length === 0) return;
  await db.update(adminUsersTable).set({ isActive: false }).where(inArray(adminUsersTable.employeeId, employeeIds));
}

const router: IRouter = Router();
router.use("/employees", requireAuth);

function generateEmployeeId(): string {
  return "EMP-" + String(Date.now()).slice(-6);
}

router.get("/employees", async (req, res): Promise<void> => {
  const query = ListEmployeesQueryParams.safeParse(req.query);
  const conditions = [];
  if (query.success && query.data.department) {
    conditions.push(eq(departmentsTable.name, query.data.department));
  }
  if (query.success && query.data.status) {
    conditions.push(eq(employeesTable.status, query.data.status));
  }
  if (query.success && query.data.search) {
    conditions.push(
      sql`(${employeesTable.firstName} || ' ' || ${employeesTable.lastName}) ILIKE ${'%' + query.data.search + '%'}`
    );
  }

  const employees = await db
    .select({
      id: employeesTable.id,
      employeeId: employeesTable.employeeId,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      email: employeesTable.email,
      phone: employeesTable.phone,
      departmentId: employeesTable.departmentId,
      departmentName: departmentsTable.name,
      designation: employeesTable.designation,
      status: employeesTable.status,
      dateOfJoining: employeesTable.dateOfJoining,
      salary: employeesTable.salary,
      shiftTypeId: employeesTable.shiftTypeId,
      gradeId: employeesTable.gradeId,
      gradeName: gradesTable.name,
      healthInsuranceDependents: employeesTable.healthInsuranceDependents,
      pensionSelfRate: employeesTable.pensionSelfRate,
      geofenceExempt: employeesTable.geofenceExempt,
      resignationDate: employeesTable.resignationDate,
      birthDate: employeesTable.birthDate,
      emergencyContact: employeesTable.emergencyContact,
      emergencyPhone: employeesTable.emergencyPhone,
      createdAt: employeesTable.createdAt,
      accountId: adminUsersTable.id,
      accountUsername: adminUsersTable.username,
      accountIsActive: adminUsersTable.isActive,
      accountRole: adminUsersTable.role,
    })
    .from(employeesTable)
    .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
    .leftJoin(adminUsersTable, eq(adminUsersTable.employeeId, employeesTable.id))
    .leftJoin(gradesTable, eq(gradesTable.id, employeesTable.gradeId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(employeesTable.createdAt);

  const u = req.session?.user;
  const isHr = machineOnly(req) || (u && (u.role === "super_admin" || ["owner","admin","hr_admin","finance_admin"].includes(u.role)));
  const today = taipeiToday();
  res.json(employees.map(e => ({
    ...e,
    salary: isHr ? (e.salary ? Number(e.salary) : null) : null,
    // 個人資料與投保設定只給人資／財務看
    ...(isHr ? {} : { healthInsuranceDependents: null, pensionSelfRate: null, birthDate: null, emergencyContact: null, emergencyPhone: null }),
    seniority: seniorityText(e.dateOfJoining, e.resignationDate && e.resignationDate < today ? e.resignationDate : today),
  })));
});

router.post("/employees", requireRole(...HR_ROLES), async (req, res): Promise<void> => {
  const parsed = CreateEmployeeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const employeeId = typeof req.body.employeeId === "string" ? req.body.employeeId.trim() : "";
  if (!employeeId) { res.status(400).json({ error: "請填寫員工編號" }); return; }
  const status = normalizeEmployeeStatus(req.body.status);
  if (status === null) { res.status(400).json({ error: "員工狀態無效" }); return; }
  if (!isDateString(parsed.data.dateOfJoining)) { res.status(400).json({ error: "請填寫正確的到職日（特休與年資都從這天起算）" }); return; }
  const extras = readEmployeeExtras(req.body);
  if ("error" in extras) { res.status(400).json({ error: extras.error }); return; }
  const createGradeProblem = await gradeProblem(extras.values.gradeId);
  if (createGradeProblem) { res.status(400).json({ error: createGradeProblem }); return; }

  let emp;
  try {
    [emp] = await db.insert(employeesTable).values({
      ...parsed.data,
      ...extras.values,
      employeeId,
      ...(status ? { status } : {}),
      salary: parsed.data.salary != null ? String(parsed.data.salary) : undefined,
    }).returning();
  } catch (err) {
    if (pgErrorCode(err) === "23505") { res.status(409).json({ error: `員工編號「${employeeId}」已經有人使用` }); return; }
    throw err;
  }

  await db.insert(activitiesTable).values({
    type: "create",
    title: "New Employee Added",
    description: `${parsed.data.firstName} ${parsed.data.lastName} joined the team`,
    module: "HR",
  });

  res.status(201).json({ ...emp, salary: emp.salary ? Number(emp.salary) : null, departmentName: null });
});

router.post("/employees/import-from-teachers", requireRole(...HR_ROLES), async (req, res): Promise<void> => {
  const { teacherIds, departmentId } = req.body;
  if (!teacherIds || !Array.isArray(teacherIds) || teacherIds.length === 0) {
    res.status(400).json({ error: "請選擇至少一位老師" }); return;
  }

  const teachers = await db.select().from(teachersTable).where(inArray(teachersTable.id, teacherIds));
  if (teachers.length === 0) {
    res.status(404).json({ error: "找不到指定的老師" }); return;
  }

  const existingEmps = await db.select({ firstName: employeesTable.firstName, lastName: employeesTable.lastName, email: employeesTable.email })
    .from(employeesTable);
  const existingKeys = new Set(existingEmps.map(e => `${e.firstName}|${e.lastName}|${e.email || ""}`));

  let imported = 0;
  let skipped = 0;
  const results: any[] = [];

  for (const teacher of teachers) {
    const nameParts = (teacher.name || "").trim().split(/\s+/);
    const firstName = nameParts[0] || teacher.name || "";
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
    const key = `${firstName}|${lastName}|${teacher.email || ""}`;

    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }

    const [emp] = await db.insert(employeesTable).values({
      employeeId: generateEmployeeId() + "-" + String(teacher.id),
      firstName,
      lastName,
      email: teacher.email || `teacher-${teacher.id}@placeholder.local`,
      phone: teacher.phone || undefined,
      designation: teacher.position || "講師",
      status: teacher.status === "Active" ? "Active" : "Inactive",
      departmentId: departmentId ? Number(departmentId) : undefined,
      dateOfJoining: todayTaipei(),
    }).returning();

    existingKeys.add(key);
    results.push(emp);
    imported++;
  }

  await db.insert(activitiesTable).values({
    type: "create",
    title: "從老師匯入員工",
    description: `匯入 ${imported} 位，跳過 ${skipped} 位（已存在）`,
    module: "HR",
  });

  res.status(201).json({ success: true, imported, skipped, total: teachers.length });
});

router.post("/employees/batch-update", requireRole(...HR_ROLES), async (req, res): Promise<void> => {
  const { ids, updates } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "請選擇至少一位員工" }); return;
  }
  if (!updates || typeof updates !== "object") {
    res.status(400).json({ error: "請提供更新內容" }); return;
  }

  const allowed: Record<string, string> = {
    departmentId: "departmentId",
    status: "status",
    designation: "designation",
    salary: "salary",
  };

  const setData: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(updates)) {
    if (allowed[key] && val !== undefined && val !== "") {
      if (key === "salary") setData[key] = String(val);
      else if (key === "departmentId") setData[key] = Number(val);
      else setData[key] = val;
    }
  }

  if (Object.keys(setData).length === 0) {
    res.status(400).json({ error: "無有效的更新欄位" }); return;
  }
  if (setData.status !== undefined && !EMPLOYEE_STATUSES.includes(String(setData.status))) {
    res.status(400).json({ error: "員工狀態無效" }); return;
  }
  if (setData.status === "Inactive") {
    // 批次改成離職：還沒填離職日的補上今天，並停用登入帳號
    await db.update(employeesTable).set({ resignationDate: taipeiToday() })
      .where(and(inArray(employeesTable.id, ids), sql`${employeesTable.resignationDate} IS NULL`));
    await deactivateAccounts(ids.map(Number).filter(Number.isInteger));
  }

  const updated = await db.update(employeesTable)
    .set(setData)
    .where(inArray(employeesTable.id, ids))
    .returning({ id: employeesTable.id });

  await db.insert(activitiesTable).values({
    type: "update",
    title: "批次更新員工",
    description: `批次更新 ${updated.length} 位員工：${Object.keys(setData).join(", ")}`,
    module: "HR",
  });

  res.json({ success: true, updated: updated.length });
});

router.post("/employees/batch-delete", requireRole(...HR_ROLES), async (req, res): Promise<void> => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "請選擇至少一位員工" }); return;
  }

  // 先停用所有關聯的登入帳號
  await db.update(adminUsersTable).set({ isActive: false }).where(inArray(adminUsersTable.employeeId, ids));

  const deletedIds: number[] = [];
  const failed: { id: number; name: string; reason: string }[] = [];

  // 逐筆嘗試刪除以辨識哪些員工有關聯資料無法刪除
  for (const id of ids) {
    try {
      const [emp] = await db.delete(employeesTable).where(eq(employeesTable.id, id)).returning();
      if (emp) deletedIds.push(emp.id);
    } catch (e: unknown) {
      const code = pgErrorCode(e);
      const [emp] = await db.select({ firstName: employeesTable.firstName, lastName: employeesTable.lastName, employeeId: employeesTable.employeeId }).from(employeesTable).where(eq(employeesTable.id, id));
      const name = emp ? `${emp.firstName}${emp.lastName} (${emp.employeeId})` : `ID ${id}`;
      if (code === "23503") {
        failed.push({ id, name, reason: "有關聯資料（出勤／請假／薪資／訂單／資產／工作項目等）" });
      } else {
        failed.push({ id, name, reason: (e as Error)?.message || "未知錯誤" });
        (req as any).log?.error({ err: e, employeeId: id }, "batch-delete employee failed");
      }
    }
  }

  if (deletedIds.length > 0) {
    await db.insert(activitiesTable).values({
      type: "delete",
      title: "批次刪除員工",
      description: `批次刪除 ${deletedIds.length} 位員工${failed.length > 0 ? `，${failed.length} 位因有關聯資料無法刪除` : ""}`,
      module: "HR",
    });
  }

  res.json({ success: failed.length === 0, deleted: deletedIds.length, failedCount: failed.length, failed });
});

router.get("/employees/:id", async (req, res): Promise<void> => {
  const params = GetEmployeeParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [emp] = await db
    .select({
      id: employeesTable.id,
      employeeId: employeesTable.employeeId,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      email: employeesTable.email,
      phone: employeesTable.phone,
      departmentId: employeesTable.departmentId,
      departmentName: departmentsTable.name,
      designation: employeesTable.designation,
      status: employeesTable.status,
      dateOfJoining: employeesTable.dateOfJoining,
      salary: employeesTable.salary,
      shiftTypeId: employeesTable.shiftTypeId,
      resignationDate: employeesTable.resignationDate,
      createdAt: employeesTable.createdAt,
    })
    .from(employeesTable)
    .leftJoin(departmentsTable, eq(employeesTable.departmentId, departmentsTable.id))
    .where(eq(employeesTable.id, params.data.id));

  if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }
  const u2 = req.session?.user;
  const isHr2 = machineOnly(req) || (u2 && (u2.role === "super_admin" || ["owner","admin","hr_admin","finance_admin"].includes(u2.role)));
  res.json({ ...emp, salary: isHr2 ? (emp.salary ? Number(emp.salary) : null) : null });
});

router.patch("/employees/:id", requireRole(...HR_ROLES), async (req, res): Promise<void> => {
  const params = UpdateEmployeeParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateEmployeeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.salary != null) updateData.salary = String(parsed.data.salary);
  // 員工編號、到職日不在產生的驗證定義裡，這裡另外接
  if (req.body.employeeId !== undefined) {
    const employeeId = typeof req.body.employeeId === "string" ? req.body.employeeId.trim() : "";
    if (!employeeId) { res.status(400).json({ error: "請填寫員工編號" }); return; }
    updateData.employeeId = employeeId;
  }
  if (req.body.dateOfJoining !== undefined) {
    const joined = req.body.dateOfJoining;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(joined ?? ""))) {
      res.status(400).json({ error: "請填寫到職日" }); return;
    }
    if (!isDateString(joined)) { res.status(400).json({ error: "到職日不是有效的日期" }); return; }
    updateData.dateOfJoining = joined;
  }
  if (parsed.data.status !== undefined && normalizeEmployeeStatus(parsed.data.status) == null) {
    res.status(400).json({ error: "員工狀態無效" }); return;
  }
  const extras = readEmployeeExtras(req.body);
  if ("error" in extras) { res.status(400).json({ error: extras.error }); return; }
  Object.assign(updateData, extras.values);
  const updateGradeProblem = await gradeProblem(extras.values.gradeId);
  if (updateGradeProblem) { res.status(400).json({ error: updateGradeProblem }); return; }
  const today = taipeiToday();
  // 離職：沒填離職日就用今天；改回在職（回任）：清掉離職日
  if (updateData.status === "Inactive" && updateData.resignationDate == null) {
    const [current] = await db.select({ resignationDate: employeesTable.resignationDate }).from(employeesTable).where(eq(employeesTable.id, params.data.id));
    if (updateData.resignationDate === null || (current && !current.resignationDate)) updateData.resignationDate = today;
  }
  if (updateData.status === "Active" && typeof updateData.resignationDate === "string" && updateData.resignationDate < today) {
    res.status(400).json({ error: "離職日已經過了，狀態不能是在職；要回任請先清掉離職日" }); return;
  }
  // 填了已經過去的離職日，狀態一起改成離職
  if (typeof updateData.resignationDate === "string" && updateData.resignationDate < today && updateData.status === undefined) {
    updateData.status = "Inactive";
  }
  if (typeof updateData.resignationDate === "string" && typeof updateData.dateOfJoining === "string" && updateData.resignationDate < updateData.dateOfJoining) {
    res.status(400).json({ error: "離職日不可早於到職日" }); return;
  }

  let emp;
  try {
    [emp] = await db.update(employeesTable).set(updateData).where(eq(employeesTable.id, params.data.id)).returning();
  } catch (err) {
    if (pgErrorCode(err) === "23505") { res.status(409).json({ error: `員工編號「${updateData.employeeId}」已經有人使用` }); return; }
    throw err;
  }
  if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }
  if (emp.status === "Inactive") await deactivateAccounts([emp.id]);
  res.json({ ...emp, salary: emp.salary ? Number(emp.salary) : null, departmentName: null });
});

router.delete("/employees/:id", requireRole(...HR_ROLES), async (req, res): Promise<void> => {
  const params = DeleteEmployeeParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  // 先停用相關登入帳號（FK ON DELETE SET NULL 會自動解除綁定，但保留密碼以防誤刪）
  await db.update(adminUsersTable).set({ isActive: false }).where(eq(adminUsersTable.employeeId, params.data.id));
  try {
    const [emp] = await db.delete(employeesTable).where(eq(employeesTable.id, params.data.id)).returning();
    if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }
    res.sendStatus(204);
  } catch (e: unknown) {
    const code = pgErrorCode(e);
    if (code === "23503") {
      res.status(409).json({ error: "此員工有關聯資料（出勤／請假／薪資／訂單／資產／工作項目等），無法刪除。建議改為將狀態設為「離職」。" });
      return;
    }
    throw e;
  }
});

// 為員工建立登入帳號
router.post("/employees/:id/account", requireRole("owner", "admin", "super_admin", "hr_admin"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { username, password, role } = req.body;
  if (!password || String(password).length < 6) { res.status(400).json({ error: "密碼至少 6 字元" }); return; }
  // 角色只收系統認得的值；老闆只能由老闆指派，系統管理員只能由老闆或系統管理員指派（人資不能替人升權）
  const actorRole = (req as any).session?.user?.role;
  if (role !== undefined && role !== null && role !== "") {
    if (typeof role !== "string" || !(BUILTIN_ROLES as readonly string[]).includes(role)) { res.status(400).json({ error: "角色不正確" }); return; }
    if (role === "owner" && !["owner", "super_admin"].includes(actorRole)) { res.status(403).json({ error: "只有老闆可以指派老闆角色" }); return; }
    if (role === "admin" && !["owner", "admin", "super_admin"].includes(actorRole)) { res.status(403).json({ error: "只有老闆或系統管理員可以指派系統管理員" }); return; }
  }

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }

  const [existing] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.employeeId, id));
  if (existing) { res.status(409).json({ error: "此員工已綁定登入帳號" }); return; }

  const finalUsername = accountName(username || emp.employeeId || emp.email);
  if (!finalUsername) { res.status(400).json({ error: "請輸入有效帳號" }); return; }
  const displayName = `${emp.firstName}${emp.lastName}`.trim() || finalUsername;

  try {
    const [user] = await db.insert(adminUsersTable).values({
      username: finalUsername,
      tenantId: reqTenantId(req),
      passwordHash: await hashPassword(password),
      displayName,
      role: role || "viewer",
      employeeId: id,
    }).returning();
    await db.insert(activitiesTable).values({
      type: "create",
      title: "員工登入帳號建立",
      description: `為 ${displayName} 建立登入帳號 ${finalUsername}`,
      module: "HR",
    });
    res.status(201).json({ id: user.id, username: user.username, displayName: user.displayName, role: user.role, isActive: user.isActive, employeeId: user.employeeId });
  } catch (e: unknown) {
    if (pgErrorCode(e) === "23505") {
      res.status(409).json({ error: "帳號已存在，請改用其他帳號名稱" });
      return;
    }
    throw e;
  }
});

// 解除/刪除員工登入帳號
router.delete("/employees/:id/account", requireRole("owner", "admin", "super_admin", "hr_admin"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await db.delete(adminUsersTable).where(eq(adminUsersTable.employeeId, id)).returning({ id: adminUsersTable.id });
  if (result.length === 0) { res.status(404).json({ error: "此員工未綁定登入帳號" }); return; }
  for (const account of result) await removeUserFromCustomRoles(reqTenantId(req), account.id);
  res.sendStatus(204);
});

export default router;
