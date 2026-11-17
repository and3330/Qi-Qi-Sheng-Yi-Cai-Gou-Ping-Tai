import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, contractsTable, employeesTable, teachersTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";

/**
 * 人事合約：跟「人」簽的合約（員工、老師、臨時人員），放在人事管理底下。
 * 跟客戶／供應商的合約共用同一張 contracts 資料表，用 partyType 區分：
 *   Employee＝員工、Teacher＝老師、Person＝名單外的人（臨時工、還沒建檔的新人）。
 * 內容含報酬，只有老闆、管理員、人事可以看；一般的「合約管理」不會列出這些合約。
 */
const router: IRouter = Router();
const HR_ROLES = ["owner", "admin", "hr_admin"] as const;
router.use("/hr-contracts", requireAuth, requireRole(...HR_ROLES));

export const HR_PARTY_TYPES = ["Employee", "Teacher", "Person"] as const;
export const HR_CONTRACT_TYPES: { key: string; label: string; hint: string }[] = [
  { key: "onboarding", label: "新進人員合約", hint: "新人到職簽的勞動契約（試用期、職稱、薪資）" },
  { key: "labor_service", label: "勞務合約", hint: "承攬／委任，例如外聘講師、接案人員" },
  { key: "labor_fee", label: "勞務報酬單", hint: "單次或單期的勞務報酬（領據）" },
  { key: "labor_form", label: "勞務表單", hint: "勞務提供人的基本資料表、扣繳與二代健保資料" },
  { key: "temporary", label: "臨時工作合約", hint: "短期、臨時人員，按時或按日計酬" },
  { key: "other", label: "其他", hint: "保密、競業、其他約定" },
];
const PAY_BASES = ["monthly", "hourly", "daily", "per_session", "per_case", "lump_sum"];
const STATUSES = ["Draft", "Active", "Expired", "Renewed", "Cancelled"];
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const text = (v: unknown, max = 4000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

const columns = {
  id: contractsTable.id, contractNumber: contractsTable.contractNumber, title: contractsTable.title,
  partyType: contractsTable.partyType, contractType: contractsTable.contractType,
  employeeId: contractsTable.employeeId, teacherId: contractsTable.teacherId, personName: contractsTable.contactPerson,
  status: contractsTable.status, signedDate: contractsTable.signedDate, startDate: contractsTable.startDate, endDate: contractsTable.endDate,
  payBasis: contractsTable.payBasis, payAmount: contractsTable.contractValue,
  terms: contractsTable.terms, description: contractsTable.description, createdAt: contractsTable.createdAt,
  employeeName: sql<string | null>`(SELECT first_name || COALESCE(last_name, '') FROM employees WHERE id = "contracts"."employee_id")`,
  employeeCode: sql<string | null>`(SELECT employee_id FROM employees WHERE id = "contracts"."employee_id")`,
  teacherName: sql<string | null>`(SELECT name FROM teachers WHERE id = "contracts"."teacher_id")`,
};
const shape = (r: any) => ({
  ...r,
  payAmount: r.payAmount == null ? null : Number(r.payAmount),
  partyName: r.partyType === "Employee" ? r.employeeName : r.partyType === "Teacher" ? r.teacherName : r.personName,
});

/** 檢查並整理送進來的欄位；partial＝只處理有帶的欄位（編輯用） */
async function readBody(body: any, partial: boolean): Promise<{ error: string } | { data: Record<string, any> }> {
  const data: Record<string, any> = {};
  const has = (k: string) => !partial || k in body;
  if (has("title")) { const title = text(body.title, 200); if (!title) return { error: "請填寫合約名稱" }; data.title = title; }
  if (has("contractType")) {
    if (!HR_CONTRACT_TYPES.some(t => t.key === body.contractType)) return { error: "請選擇合約類型" };
    data.contractType = body.contractType;
  }
  if (has("partyType") || "employeeId" in body || "teacherId" in body || "personName" in body) {
    const partyType = body.partyType;
    if (!HR_PARTY_TYPES.includes(partyType)) return { error: "請選擇簽約對象是員工、老師，還是名單外的人" };
    data.partyType = partyType; data.employeeId = null; data.teacherId = null; data.contactPerson = null;
    if (partyType === "Employee") {
      const id = Number(body.employeeId);
      const [row] = Number.isInteger(id) && id > 0 ? await db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.id, id)) : [];
      if (!row) return { error: "請選擇員工" };
      data.employeeId = id;
    } else if (partyType === "Teacher") {
      const id = Number(body.teacherId);
      const [row] = Number.isInteger(id) && id > 0 ? await db.select({ id: teachersTable.id }).from(teachersTable).where(eq(teachersTable.id, id)) : [];
      if (!row) return { error: "請選擇老師" };
      data.teacherId = id;
    } else {
      const name = text(body.personName, 80);
      if (!name) return { error: "請填寫簽約人姓名" };
      data.contactPerson = name;
    }
  }
  if (has("status")) { const status = body.status || "Draft"; if (!STATUSES.includes(status)) return { error: "狀態不正確" }; data.status = status; }
  for (const key of ["signedDate", "startDate", "endDate"]) {
    if (!has(key)) continue;
    if (body[key] == null || body[key] === "") data[key] = null;
    else if (!isDate(body[key])) return { error: "日期格式不正確" };
    else data[key] = body[key];
  }
  const start = "startDate" in data ? data.startDate : undefined, end = "endDate" in data ? data.endDate : undefined;
  if (start && end && end < start) return { error: "到期日不能早於起始日" };
  if (has("payBasis")) { if (body.payBasis && !PAY_BASES.includes(body.payBasis)) return { error: "計酬方式不正確" }; data.payBasis = body.payBasis || null; }
  if (has("payAmount")) {
    if (body.payAmount == null || body.payAmount === "") data.contractValue = null;
    else { const n = Number(body.payAmount); if (!Number.isFinite(n) || n < 0) return { error: "報酬金額不正確" }; data.contractValue = String(n); }
  }
  if (has("terms")) data.terms = text(body.terms, 20000);
  if (has("description")) data.description = text(body.description);
  return { data };
}

router.get("/hr-contracts/options", (_req, res): void => {
  res.json({ contractTypes: HR_CONTRACT_TYPES, payBases: PAY_BASES, statuses: STATUSES });
});

router.get("/hr-contracts", async (req, res): Promise<void> => {
  const conditions: any[] = [inArray(contractsTable.partyType, [...HR_PARTY_TYPES])];
  const { status, contractType, employeeId, teacherId } = req.query;
  if (status) conditions.push(eq(contractsTable.status, String(status)));
  if (contractType) conditions.push(eq(contractsTable.contractType, String(contractType)));
  if (employeeId && Number.isInteger(Number(employeeId))) conditions.push(eq(contractsTable.employeeId, Number(employeeId)));
  if (teacherId && Number.isInteger(Number(teacherId))) conditions.push(eq(contractsTable.teacherId, Number(teacherId)));
  const rows = await db.select(columns).from(contractsTable).where(and(...conditions)).orderBy(desc(contractsTable.createdAt));
  res.json(rows.map(shape));
});

router.get("/hr-contracts/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "編號不正確" }); return; }
  const [row] = await db.select(columns).from(contractsTable).where(and(eq(contractsTable.id, id), inArray(contractsTable.partyType, [...HR_PARTY_TYPES])));
  if (!row) { res.status(404).json({ error: "找不到這份合約" }); return; }
  res.json(shape(row));
});

router.post("/hr-contracts", async (req, res): Promise<void> => {
  const parsed = await readBody(req.body || {}, false);
  if ("error" in parsed) { res.status(400).json({ error: parsed.error }); return; }
  // 人事合約自己一組編號：HC-00001
  const [{ max }] = await db.select({ max: sql<number>`COALESCE(MAX(NULLIF(regexp_replace(contract_number, '^HC-', ''), contract_number)::int), 0)` }).from(contractsTable).where(sql`contract_number ~ '^HC-[0-9]+$'`);
  const contractNumber = `HC-${String(Number(max) + 1).padStart(5, "0")}`;
  const [row] = await db.insert(contractsTable).values({ ...(parsed.data as any), contractNumber }).returning({ id: contractsTable.id });
  const [full] = await db.select(columns).from(contractsTable).where(eq(contractsTable.id, row.id));
  res.status(201).json(shape(full));
});

router.patch("/hr-contracts/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "編號不正確" }); return; }
  const scope = and(eq(contractsTable.id, id), inArray(contractsTable.partyType, [...HR_PARTY_TYPES]));
  const [existing] = await db.select({ id: contractsTable.id, startDate: contractsTable.startDate, endDate: contractsTable.endDate }).from(contractsTable).where(scope);
  if (!existing) { res.status(404).json({ error: "找不到這份合約" }); return; }
  const parsed = await readBody(req.body || {}, true);
  if ("error" in parsed) { res.status(400).json({ error: parsed.error }); return; }
  const start = "startDate" in parsed.data ? parsed.data.startDate : existing.startDate;
  const end = "endDate" in parsed.data ? parsed.data.endDate : existing.endDate;
  if (start && end && end < start) { res.status(400).json({ error: "到期日不能早於起始日" }); return; }
  if (Object.keys(parsed.data).length === 0) { res.status(400).json({ error: "沒有要更新的內容" }); return; }
  await db.update(contractsTable).set(parsed.data).where(scope);
  const [full] = await db.select(columns).from(contractsTable).where(eq(contractsTable.id, id));
  res.json(shape(full));
});

/** 批次：一次改多份合約的狀態、類型或日期 */
router.post("/hr-contracts/batch-update", async (req, res): Promise<void> => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
  if (ids.length === 0) { res.status(400).json({ error: "請先勾選合約" }); return; }
  const updates = req.body?.updates && typeof req.body.updates === "object" ? req.body.updates : {};
  const allowed = ["status", "contractType", "signedDate", "startDate", "endDate", "payBasis"];
  const body = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
  if (Object.keys(body).length === 0) { res.status(400).json({ error: "請選擇要修改的欄位" }); return; }
  const parsed = await readBody(body, true);
  if ("error" in parsed) { res.status(400).json({ error: parsed.error }); return; }
  const rows = await db.update(contractsTable).set(parsed.data).where(and(inArray(contractsTable.id, ids), inArray(contractsTable.partyType, [...HR_PARTY_TYPES]))).returning({ id: contractsTable.id });
  res.json({ success: true, updated: rows.length });
});

router.delete("/hr-contracts/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "編號不正確" }); return; }
  const scope = and(eq(contractsTable.id, id), inArray(contractsTable.partyType, [...HR_PARTY_TYPES]));
  const [existing] = await db.select({ status: contractsTable.status }).from(contractsTable).where(scope);
  if (!existing) { res.status(404).json({ error: "找不到這份合約" }); return; }
  // 生效過的合約是人事紀錄，不刪；改成「已取消」或「已到期」留底
  if (existing.status !== "Draft") { res.status(400).json({ error: "只有草稿可以刪除；已生效的合約請改成「已取消」或「已到期」，紀錄會留著" }); return; }
  await db.delete(contractsTable).where(scope);
  res.sendStatus(204);
});

export default router;
