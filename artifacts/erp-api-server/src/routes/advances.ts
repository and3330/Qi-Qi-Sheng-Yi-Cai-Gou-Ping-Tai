import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, advancesTable, accountsTable, employeesTable, projectsTable, journalEntriesTable, activitiesTable, type Advance, type AdvanceRepayment } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { nextDocNumber } from "../lib/doc-number";
import { postAutoJournal, round2, todayTaipei } from "../lib/inventory-journal";
import { cashLineAccount, isRealDate, leafAccount } from "../lib/cash-accounts";
import { assertPeriodOpen } from "../lib/auto-journal";
import { friendlyCaughtError } from "../lib/friendly-errors";
import { partyLineText, voidLineText } from "../lib/voucher-entry-text";

/**
 * 代墊款與借款：老闆或員工先幫公司出錢，公司之後要還。
 * 借錢給公司（錢進公司帳戶）和代墊（直接幫公司付掉）帳上都是「公司欠這個人的錢」。
 */
const router: IRouter = Router();
router.use("/advances", requireAuth, requireRole("owner", "admin", "finance_admin", "accountant"));

const parseId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const present = (row: Advance, extra: Record<string, unknown> = {}) => {
  const amount = Number(row.amount), repaidAmount = Number(row.repaidAmount);
  return { ...row, amount, taxAmount: Number(row.taxAmount), repaidAmount, outstanding: row.status === "Voided" ? 0 : round2(amount - repaidAmount), ...extra };
};

/** 欠老闆的記在股東往來，欠員工的記在其他應付款；科目表沒有時依序找最接近的負債科目 */
const LIABILITY_CANDIDATES: Record<string, string[]> = {
  owner: ["股東往來", "業主(股東)往來", "短期借款 -業主", "短期借款-業主", "短期借款 -其他", "其他應付款", "應付費用"],
  employee: ["員工代墊款", "其他應付款", "短期借款 -員工", "短期借款-員工", "應付費用", "應付薪資"],
};
async function liabilityAccount(tx: any, partyType: string): Promise<{ accountId: number; accountNumber: string; accountName: string }> {
  const rows: Array<{ id: number; accountNumber: string; accountName: string }> = await tx
    .select({ id: accountsTable.id, accountNumber: accountsTable.accountNumber, accountName: accountsTable.accountName })
    .from(accountsTable).where(sql`${accountsTable.accountType} = 'Liability' AND ${accountsTable.isGroup} = false`);
  const normalize = (name: string) => name.replace(/[\s　]/g, "");
  for (const candidate of LIABILITY_CANDIDATES[partyType]) {
    const hit = rows.find(r => normalize(r.accountName) === normalize(candidate));
    if (hit) return { accountId: hit.id, accountNumber: hit.accountNumber, accountName: hit.accountName };
  }
  throw new Error(`科目表找不到可以記「${partyType === "owner" ? "股東往來" : "員工代墊款"}」的負債科目，請先到會計科目新增`);
}

router.get("/advances", async (req, res): Promise<void> => {
  const rows = await db.select({ advance: advancesTable, projectName: projectsTable.name, counterAccountName: accountsTable.accountName })
    .from(advancesTable)
    .leftJoin(projectsTable, eq(projectsTable.id, advancesTable.projectId))
    .leftJoin(accountsTable, eq(accountsTable.id, advancesTable.counterAccountId))
    .where(req.query.status ? eq(advancesTable.status, String(req.query.status)) : undefined)
    .orderBy(desc(advancesTable.id)).limit(500);
  const list = rows.map(r => present(r.advance, { projectName: r.projectName, counterAccountName: r.counterAccountName }));
  // 每個人還欠多少（只算還沒作廢的）
  const byParty = new Map<string, { partyType: string; partyName: string; employeeId: number | null; total: number; repaid: number; outstanding: number; count: number }>();
  for (const row of list) {
    if (row.status === "Voided") continue;
    const key = `${row.partyType}:${row.employeeId ?? row.partyName}`;
    const current = byParty.get(key) || { partyType: row.partyType, partyName: row.partyName, employeeId: row.employeeId, total: 0, repaid: 0, outstanding: 0, count: 0 };
    current.total = round2(current.total + row.amount); current.repaid = round2(current.repaid + row.repaidAmount);
    current.outstanding = round2(current.outstanding + row.outstanding); current.count++;
    byParty.set(key, current);
  }
  const balances = [...byParty.values()].sort((a, b) => b.outstanding - a.outstanding);
  res.json({ advances: list, balances, totalOutstanding: round2(balances.reduce((sum, b) => sum + b.outstanding, 0)) });
});

router.post("/advances", async (req, res): Promise<void> => {
  const body = req.body || {};
  const partyType = body.partyType === "owner" || body.partyType === "employee" ? body.partyType : null;
  const kind = body.kind === "loan" || body.kind === "expense" ? body.kind : null;
  if (!partyType) { res.status(400).json({ error: "請選擇是老闆（股東）還是員工" }); return; }
  if (!kind) { res.status(400).json({ error: "請選擇是「借錢給公司」還是「代墊」" }); return; }
  const amount = round2(Number(body.amount)), taxAmount = round2(Number(body.taxAmount ?? 0));
  if (!(amount > 0)) { res.status(400).json({ error: "金額必須大於 0" }); return; }
  if (kind === "loan" && taxAmount !== 0) { res.status(400).json({ error: "借款沒有稅額" }); return; }
  if (taxAmount < 0 || taxAmount >= amount) { res.status(400).json({ error: "進項稅額不能是負數，也不能大於或等於金額" }); return; }
  const entryDate = body.entryDate || todayTaipei();
  if (!isRealDate(entryDate) || entryDate > todayTaipei()) { res.status(400).json({ error: "日期格式不正確，或填在未來" }); return; }
  const employeeId = partyType === "employee" ? parseId(body.employeeId) : null;
  if (partyType === "employee" && !employeeId) { res.status(400).json({ error: "請選擇員工" }); return; }
  const ownerName = typeof body.partyName === "string" ? body.partyName.trim().slice(0, 50) : "";
  if (partyType === "owner" && !ownerName) { res.status(400).json({ error: "請填寫老闆（股東）的姓名" }); return; }
  const projectId = parseId(body.projectId), departmentId = parseId(body.departmentId);
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 300) : "";
  try {
    const created = await db.transaction(async (tx) => {
      let partyName = ownerName;
      if (employeeId) {
        const [employee] = await tx.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
        if (!employee) throw new Error("找不到這位員工");
        partyName = `${employee.firstName}${employee.lastName}`;
      }
      if (projectId) {
        const [project] = await tx.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId));
        if (!project) throw new Error("找不到這個專案");
      }
      const liability = await liabilityAccount(tx, partyType);
      // 借款：錢進公司的現金或銀行帳戶；代墊：錢花在某個科目上（費用、存貨、應付帳款…）
      const counter = kind === "loan" ? await cashLineAccount(tx, body.cashAccountId) : await leafAccount(tx, body.accountId, "代墊的錢花在哪個科目");
      if (kind === "loan" && !counter.accountId) throw new Error("請選擇錢進到公司的哪個帳戶");
      const counterType = "accountType" in counter ? (counter as { accountType: string }).accountType : "Asset";
      if (kind === "expense" && (counterType === "Income" || counterType === "Equity")) throw new Error("代墊的科目不能是收入或權益科目");
      if (kind === "expense" && counterType === "Expense" && !projectId) throw new Error("請選擇專案：每一筆支出都必須歸屬到專案");
      if (counter.accountId === liability.accountId) throw new Error("代墊的科目不能和記欠款的科目相同");

      const advanceNumber = await nextDocNumber(tx, "advances", "advance_number", "ADV", () => `ADV-${String(Date.now()).slice(-8)}`, entryDate);
      const [row] = await tx.insert(advancesTable).values({
        advanceNumber, partyType, employeeId, partyName, kind, amount: String(amount), taxAmount: String(taxAmount), entryDate,
        description: description || null, projectId, departmentId, counterAccountId: counter.accountId!, liabilityAccountId: liability.accountId,
        createdBy: req.session?.user?.username || "api",
      }).returning();
      const label = kind === "loan" ? "借款給公司" : "代墊";
      const journal = await postAutoJournal(tx, {
        key: `ADV${row.id}`, entryDate, action: kind === "loan" ? "登錄借款" : "登錄代墊款", projectId, departmentId,
        // 摘要寫「對象｜代墊：說明」，不寫單號（單號在分錄編號尾巴 -ADV，總分類帳會顯示）
        description: `${label}${description ? `：${description}` : ""}`.slice(0, 300),
        lines: [
          { accountId: counter.accountId, accountNumber: counter.accountNumber, accountName: counter.accountName, debit: round2(amount - taxAmount), credit: 0, description: partyLineText(partyName, description, label) },
          ...(taxAmount > 0 ? [{ accountName: "進項稅額", debit: taxAmount, credit: 0, description: partyLineText(partyName, `${label} 進項稅額`, "進項稅額") }] : []),
          { ...liability, debit: 0, credit: amount, description: partyLineText(partyName, `${label}${description ? `：${description}` : ""}`, label) },
        ],
      });
      const [updated] = await tx.update(advancesTable).set({ journalEntryId: journal?.id ?? null }).where(eq(advancesTable.id, row.id)).returning();
      await tx.insert(activitiesTable).values({ type: "create", title: kind === "loan" ? "借款" : "代墊款", description: `${advanceNumber} ${partyName} ${amount}`, module: "Accounting" });
      return updated;
    });
    res.status(201).json(present(created));
  } catch (err: any) {
    res.status(400).json({ error: friendlyCaughtError(err, "登錄失敗，請確認資料後再試") });
  }
});

/** 還款：公司把錢還給老闆或員工，可以分次還 */
router.post("/advances/:id/repay", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "編號格式不正確" }); return; }
  const amount = round2(Number(req.body?.amount));
  if (!(amount > 0)) { res.status(400).json({ error: "還款金額必須大於 0" }); return; }
  const date = req.body?.date || todayTaipei();
  if (!isRealDate(date) || date > todayTaipei()) { res.status(400).json({ error: "日期格式不正確，或填在未來" }); return; }
  try {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(advancesTable).where(eq(advancesTable.id, id)).for("update");
      if (!row) throw Object.assign(new Error("找不到這筆代墊款"), { status: 404 });
      if (row.status !== "Open") throw new Error(row.status === "Settled" ? "這筆已經還清了" : "這筆已經作廢");
      if (date < row.entryDate) throw new Error("還款日期不能早於借款或代墊的日期");
      const outstanding = round2(Number(row.amount) - Number(row.repaidAmount));
      if (amount > outstanding + 0.001) throw new Error(`還欠 ${outstanding}，不能還 ${amount}`);
      const cash = await cashLineAccount(tx, req.body?.cashAccountId);
      if (!cash.accountId) throw new Error("請選擇從哪個帳戶還款");
      const [liability] = await tx.select({ id: accountsTable.id, accountNumber: accountsTable.accountNumber, accountName: accountsTable.accountName }).from(accountsTable).where(eq(accountsTable.id, row.liabilityAccountId));
      if (!liability) throw new Error("當初記欠款的科目已經不存在");
      const journal = await postAutoJournal(tx, {
        key: `ADV${row.id}-R${row.repayments.length + 1}`, entryDate: date, action: "代墊款還款", projectId: row.projectId, departmentId: row.departmentId,
        description: `還款${row.description ? `：${row.description}` : ""}`.slice(0, 300),
        lines: [
          { accountId: liability.id, accountNumber: liability.accountNumber, accountName: liability.accountName, debit: amount, credit: 0, description: partyLineText(row.partyName, `還款${row.description ? `：${row.description}` : ""}`, "還款") },
          { ...cash, debit: 0, credit: amount, description: partyLineText(row.partyName, `還款${row.description ? `：${row.description}` : ""}`, "還款") },
        ],
      });
      const repayments: AdvanceRepayment[] = [...row.repayments, { date, amount, cashAccountName: cash.accountName, journalEntryNumber: journal?.entryNumber ?? null, by: req.session?.user?.username || "api" }];
      const repaid = round2(Number(row.repaidAmount) + amount);
      const [saved] = await tx.update(advancesTable).set({
        repaidAmount: String(repaid), repayments, status: repaid >= Number(row.amount) - 0.001 ? "Settled" : "Open",
      }).where(eq(advancesTable.id, id)).returning();
      return saved;
    });
    res.json(present(updated));
  } catch (err: any) {
    res.status(Number(err?.status) || 400).json({ error: friendlyCaughtError(err, "還款失敗，請稍後再試") });
  }
});

/** 作廢：登錄錯了、還沒還過款的才能作廢，會開一張相反的分錄 */
router.post("/advances/:id/void", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "編號格式不正確" }); return; }
  try {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(advancesTable).where(eq(advancesTable.id, id)).for("update");
      if (!row) throw Object.assign(new Error("找不到這筆代墊款"), { status: 404 });
      if (row.status === "Voided") throw new Error("這筆已經作廢");
      if (Number(row.repaidAmount) > 0) throw new Error("已經還過款的不能作廢");
      const today = todayTaipei();
      await assertPeriodOpen(tx, today, "作廢代墊款");
      if (row.journalEntryId) {
        const [original] = await tx.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, row.journalEntryId));
        if (original) {
          const lines = (Array.isArray(original.lines) ? (original.lines as any[]) : []).map(line => ({ ...line, debit: Number(line.credit) || 0, credit: Number(line.debit) || 0, description: voidLineText(line.description) }));
          await tx.insert(journalEntriesTable).values({
            entryNumber: `JE-ADV${row.id}-V${String(Date.now()).slice(-6)}`, entryDate: today, description: `作廢 ${original.description || ""}`.trim().slice(0, 300),
            totalDebit: original.totalCredit, totalCredit: original.totalDebit, status: "Posted", lines,
            projectId: original.projectId, departmentId: original.departmentId,
          });
          await tx.update(journalEntriesTable).set({ status: "Reversed" }).where(eq(journalEntriesTable.id, original.id));
        }
      }
      const [saved] = await tx.update(advancesTable).set({ status: "Voided" }).where(eq(advancesTable.id, id)).returning();
      return saved;
    });
    res.json(present(updated));
  } catch (err: any) {
    res.status(Number(err?.status) || 400).json({ error: friendlyCaughtError(err, "作廢失敗，請稍後再試") });
  }
});

export default router;
