import { Router, type IRouter } from "express";
import { cashLineAccount, isRealDate } from "../lib/cash-accounts";
import { assertPeriodOpen } from "../lib/auto-journal";
import { todayTaipei } from "../lib/inventory-journal";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth } from "../middleware/require-auth";
import {
  db, assetsTable, accountsTable, assetCategoriesTable, assetDepreciationEntriesTable,
  assetMaintenanceTable, assetMovementsTable, assetValueAdjustmentsTable,
  departmentsTable, employeesTable, journalEntriesTable,
  type Asset
} from "@workspace/erp-db";

const router: IRouter = Router();
router.use("/assets", requireAuth);

function generateAssetNumber(): string {
  return "AST-" + String(Date.now()).slice(-8);
}

function numericAsset(a: Asset) {
  return {
    ...a,
    purchaseCost: Number(a.purchaseCost),
    salvageValue: Number(a.salvageValue),
    currentValue: Number(a.currentValue),
    accumulatedDepreciation: Number(a.accumulatedDepreciation),
    disposalAmount: a.disposalAmount ? Number(a.disposalAmount) : null,
  };
}

async function findOrCreateAccount(accountNumber: string, accountName: string, accountType: string): Promise<number> {
  const [existing] = await db.select().from(accountsTable).where(eq(accountsTable.accountNumber, accountNumber));
  if (existing) return existing.id;
  const [created] = await db.insert(accountsTable).values({ accountNumber, accountName, accountType }).returning();
  return created.id;
}

/**
 * 固定資產用到的科目：先在公司自己的科目表裡依名稱找（忽略空白），找不到才建立預設科目。
 * 原本直接用寫死的編號建立科目，會在科目表外面多出一批沒有上層的科目。
 */
async function getAssetAccounts() {
  const all = await db.select().from(accountsTable);
  const normalize = (name: string) => name.replace(/[\s　]/g, "");
  const pick = async (type: string, names: string[], fallback: [string, string]): Promise<number> => {
    for (const name of names) {
      const hit = all.find(a => !a.isGroup && a.accountType === type && normalize(a.accountName) === normalize(name));
      if (hit) return hit.id;
    }
    return findOrCreateAccount(fallback[0], fallback[1], type);
  };
  return {
    fixedAsset: await pick("Asset", ["固定資產", "雜項固定資產", "生財器具", "辦公設備", "其他設備"], ["1600", "固定資產"]),
    accumulatedDep: await pick("Asset", ["累計折舊", "累積折舊-雜項固定資產", "累計折舊-雜項固定資產", "累積折舊-機(器)具"], ["1690", "累計折舊"]),
    depExpense: await pick("Expense", ["折舊費用", "折舊(管)", "折舊(營)", "折舊"], ["6100", "折舊費用"]),
    disposalGain: await pick("Income", ["處分利益", "處分資產利益", "處分資產溢價收入"], ["7100", "處分利益"]),
    disposalLoss: await pick("Expense", ["處分損失", "處分資產損失"], ["7200", "處分損失"]),
    cashBank: await pick("Asset", ["現金/銀行", "庫存現金"], ["1100", "現金/銀行"]),
    payable: await pick("Liability", ["應付帳款"], ["2100", "應付帳款"]),
    revaluationSurplus: await pick("Equity", ["資產重估增值", "資產重估增值準備"], ["3200", "資產重估增值"]),
    impairmentLoss: await pick("Expense", ["資產減損損失", "減損損失"], ["6200", "資產減損損失"]),
  };
}

/** 折舊月份的檢查：格式要是 YYYY-MM、不能是未來、不能早於購入的月份（原本可以提購入以前的折舊） */
function depreciationPeriodProblem(period: string, purchaseDate: string | null): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return "折舊月份格式不正確（例如 2026-11）";
  if (period > todayTaipei().slice(0, 7)) return "不能提未來月份的折舊";
  if (purchaseDate && period < String(purchaseDate).slice(0, 7)) return `這項資產是 ${String(purchaseDate).slice(0, 7)} 購入的，不能提更早月份的折舊`;
  return null;
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  Draft: ["Submitted"],
  Submitted: ["In Use", "Draft"],
  "In Use": ["Scrapped", "Sold"],
};

router.get("/assets", async (_req, res): Promise<void> => {
  const rows = await db.select({
    asset: assetsTable,
    categoryName: assetCategoriesTable.name,
    departmentName: departmentsTable.name,
  })
    .from(assetsTable)
    .leftJoin(assetCategoriesTable, eq(assetsTable.categoryId, assetCategoriesTable.id))
    .leftJoin(departmentsTable, eq(assetsTable.departmentId, departmentsTable.id))
    .orderBy(desc(assetsTable.createdAt));

  res.json(rows.map(r => ({
    ...numericAsset(r.asset),
    categoryName: r.categoryName || "",
    departmentName: r.departmentName || "",
  })));
});

router.get("/assets/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [row] = await db.select({
    asset: assetsTable,
    categoryName: assetCategoriesTable.name,
    departmentName: departmentsTable.name,
  })
    .from(assetsTable)
    .leftJoin(assetCategoriesTable, eq(assetsTable.categoryId, assetCategoriesTable.id))
    .leftJoin(departmentsTable, eq(assetsTable.departmentId, departmentsTable.id))
    .where(eq(assetsTable.id, id));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const depEntries = await db.select().from(assetDepreciationEntriesTable)
    .where(eq(assetDepreciationEntriesTable.assetId, id))
    .orderBy(assetDepreciationEntriesTable.depreciationDate);

  const maintenance = await db.select().from(assetMaintenanceTable)
    .where(eq(assetMaintenanceTable.assetId, id))
    .orderBy(desc(assetMaintenanceTable.scheduledDate));

  const movements = await db.select({
    movement: assetMovementsTable,
    fromDeptName: departmentsTable.name,
  })
    .from(assetMovementsTable)
    .leftJoin(departmentsTable, eq(assetMovementsTable.fromDepartmentId, departmentsTable.id))
    .where(eq(assetMovementsTable.assetId, id))
    .orderBy(desc(assetMovementsTable.createdAt));

  const movementsEnriched = [];
  for (const m of movements) {
    let toDeptName = "";
    if (m.movement.toDepartmentId) {
      const [td] = await db.select({ name: departmentsTable.name }).from(departmentsTable).where(eq(departmentsTable.id, m.movement.toDepartmentId));
      toDeptName = td?.name || "";
    }
    movementsEnriched.push({ ...m.movement, fromDeptName: m.fromDeptName || "", toDeptName });
  }

  const adjustments = await db.select().from(assetValueAdjustmentsTable)
    .where(eq(assetValueAdjustmentsTable.assetId, id))
    .orderBy(desc(assetValueAdjustmentsTable.createdAt));

  let assignedToName = "";
  if (row.asset.assignedTo) {
    const [emp] = await db.select({ firstName: employeesTable.firstName, lastName: employeesTable.lastName }).from(employeesTable).where(eq(employeesTable.id, row.asset.assignedTo));
    assignedToName = emp ? `${emp.firstName}${emp.lastName}`.trim() : "";
  }

  res.json({
    ...numericAsset(row.asset),
    categoryName: row.categoryName || "",
    departmentName: row.departmentName || "",
    assignedToName,
    depreciationEntries: depEntries.map(e => ({
      ...e,
      depreciationAmount: Number(e.depreciationAmount),
      accumulatedAmount: Number(e.accumulatedAmount),
      bookValue: Number(e.bookValue),
    })),
    maintenance: maintenance.map(m => ({ ...m, cost: Number(m.cost) })),
    movements: movementsEnriched,
    adjustments: adjustments.map(a => ({
      ...a,
      previousValue: Number(a.previousValue),
      newValue: Number(a.newValue),
      adjustmentAmount: Number(a.adjustmentAmount),
    })),
  });
});

router.post("/assets", async (req, res): Promise<void> => {
  const {
    name, categoryId, purchaseDate, purchaseCost, depreciationMethod,
    usefulLifeYears, salvageValue, departmentId, assignedTo, location,
    serialNumber, warrantyExpiry, remarks,
  } = req.body;

  if (!name || !categoryId || !purchaseDate || purchaseCost === undefined || !usefulLifeYears) {
    res.status(400).json({ error: "必填欄位：名稱、類別、購入日期、購入成本、使用年限" }); return;
  }

  const cost = Number(purchaseCost);
  if (cost <= 0) { res.status(400).json({ error: "購入成本必須大於 0" }); return; }

  const [asset] = await db.insert(assetsTable).values({
    assetNumber: generateAssetNumber(),
    name, categoryId: Number(categoryId), purchaseDate, purchaseCost: String(cost),
    depreciationMethod: depreciationMethod || "straight-line",
    usefulLifeYears: Number(usefulLifeYears),
    salvageValue: String(Number(salvageValue) || 0),
    currentValue: String(cost),
    departmentId: departmentId ? Number(departmentId) : null,
    assignedTo: assignedTo ? Number(assignedTo) : null,
    location: location || null, serialNumber: serialNumber || null,
    warrantyExpiry: warrantyExpiry || null, remarks: remarks || null,
  }).returning();

  res.status(201).json(numericAsset(asset));
});

router.patch("/assets/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [existing] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (req.body.status) {
    const newStatus = req.body.status as string;
    const allowed = VALID_TRANSITIONS[existing.status];
    if (!allowed || !allowed.includes(newStatus)) {
      res.status(400).json({ error: `無法從 ${existing.status} 轉為 ${newStatus}` }); return;
    }

    if (newStatus === "Scrapped" || newStatus === "Sold") {
      const accounts = await getAssetAccounts();
      const disposalDate = (req.body.disposalDate as string) || todayTaipei();
      const disposalAmount = Number(req.body.disposalAmount) || 0;
      if (!isRealDate(disposalDate)) { res.status(400).json({ error: "處分日期格式不正確" }); return; }
      if (disposalAmount < 0) { res.status(400).json({ error: "處分金額不可為負數" }); return; }
      // 出售收到的錢進哪個帳戶
      let saleCash: { accountId?: number; accountName: string };
      try {
        await assertPeriodOpen(db, disposalDate, "處分資產");
        saleCash = await cashLineAccount(db, req.body.cashAccountId);
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "處分失敗" }); return;
      }
      const purchaseCost = Number(existing.purchaseCost);
      const accDep = Number(existing.accumulatedDepreciation);
      const bookValue = Number(existing.currentValue);

      await db.transaction(async (tx) => {
        await tx.update(assetsTable).set({
          status: newStatus, disposalDate, disposalAmount: String(disposalAmount), currentValue: "0",
        }).where(eq(assetsTable.id, id));

        const entryNumber = "JE-AST-" + String(Date.now()).slice(-8);
        const lines: { accountId: number; accountName: string; debit: number; credit: number }[] = [];

        if (newStatus === "Sold") {
          lines.push({ accountId: saleCash.accountId ?? accounts.cashBank, accountName: saleCash.accountId ? saleCash.accountName : "現金/銀行", debit: disposalAmount, credit: 0 });
          lines.push({ accountId: accounts.accumulatedDep, accountName: "累計折舊", debit: accDep, credit: 0 });
          lines.push({ accountId: accounts.fixedAsset, accountName: "固定資產", debit: 0, credit: purchaseCost });
          const gainLoss = disposalAmount - bookValue;
          if (gainLoss > 0) {
            lines.push({ accountId: accounts.disposalGain, accountName: "處分利益", debit: 0, credit: gainLoss });
          } else if (gainLoss < 0) {
            lines.push({ accountId: accounts.disposalLoss, accountName: "處分損失", debit: Math.abs(gainLoss), credit: 0 });
          }
        } else {
          lines.push({ accountId: accounts.accumulatedDep, accountName: "累計折舊", debit: accDep, credit: 0 });
          lines.push({ accountId: accounts.disposalLoss, accountName: "處分損失", debit: bookValue, credit: 0 });
          lines.push({ accountId: accounts.fixedAsset, accountName: "固定資產", debit: 0, credit: purchaseCost });
        }

        const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
        const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

        await tx.insert(journalEntriesTable).values({
          entryNumber, entryDate: disposalDate,
          description: `資產${newStatus === "Sold" ? "出售" : "報廢"} ${existing.name}`,
          // 處分損益要算進資產所屬部門的損益
          departmentId: existing.departmentId ?? null,
          lines: lines.map(l => ({ description: `資產${newStatus === "Sold" ? "出售" : "報廢"} ${existing.name}`, ...l })), totalDebit: String(totalDebit), totalCredit: String(totalCredit), status: "Posted",
        });
      });

      const [updated] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
      res.json(numericAsset(updated));
      return;
    }

    // 資產啟用：把購入成本記到帳上（借 固定資產／貸 銀行或應付帳款）。
    // 原本建立資產不會記帳，但折舊與處分都會動到固定資產科目，帳上的固定資產會變成負數。
    if (newStatus === "In Use") {
      const cost = Number(existing.purchaseCost);
      try {
        await db.transaction(async (tx) => {
          const accounts = await getAssetAccounts();
          // 已經付錢的選付款帳戶；沒選就記成應付帳款，之後用付款單付掉
          const paidFrom = req.body.paymentAccountId ? await cashLineAccount(tx, req.body.paymentAccountId) : null;
          const entryDate = isRealDate(existing.purchaseDate) ? existing.purchaseDate : todayTaipei();
          await assertPeriodOpen(tx, entryDate, "資產入帳");
          await tx.update(assetsTable).set({ status: newStatus }).where(eq(assetsTable.id, id));
          if (cost > 0) {
            await tx.insert(journalEntriesTable).values({
              entryNumber: `JE-AST${id}-${String(Date.now()).slice(-6)}-P`,
              entryDate,
              description: `購入資產 ${existing.name}`,
              lines: [
                { accountId: accounts.fixedAsset, accountName: "固定資產", debit: cost, credit: 0, description: `購入資產 ${existing.name}` },
                paidFrom
                  ? { accountId: paidFrom.accountId, accountName: paidFrom.accountName, debit: 0, credit: cost, description: `購入資產 ${existing.name}` }
                  : { accountId: accounts.payable, accountName: "應付帳款", debit: 0, credit: cost, description: `購入資產 ${existing.name}` },
              ],
              totalDebit: String(cost), totalCredit: String(cost), status: "Posted",
              departmentId: existing.departmentId ?? null,
              projectId: Number(req.body.projectId) > 0 ? Number(req.body.projectId) : null,
            });
          }
        });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "資產啟用失敗" }); return;
      }
      const [activated] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
      res.json(numericAsset(activated)); return;
    }
    await db.update(assetsTable).set({ status: newStatus }).where(eq(assetsTable.id, id));
    const [updated] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
    res.json(numericAsset(updated));
    return;
  }

  const updates: Record<string, unknown> = {};
  const fields = ["name", "categoryId", "purchaseDate", "depreciationMethod", "usefulLifeYears",
    "departmentId", "assignedTo", "location", "serialNumber", "warrantyExpiry", "remarks"];
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f] || null;
  }
  if (req.body.purchaseCost !== undefined) updates.purchaseCost = String(Number(req.body.purchaseCost));
  if (req.body.salvageValue !== undefined) updates.salvageValue = String(Number(req.body.salvageValue));

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No updates" }); return; }

  const [updated] = await db.update(assetsTable).set(updates).where(eq(assetsTable.id, id)).returning();
  res.json(numericAsset(updated));
});

router.delete("/assets/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [existing] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status !== "Draft") { res.status(400).json({ error: "只能刪除草稿狀態的資產" }); return; }

  await db.transaction(async (tx) => {
    await tx.delete(assetDepreciationEntriesTable).where(eq(assetDepreciationEntriesTable.assetId, id));
    await tx.delete(assetMaintenanceTable).where(eq(assetMaintenanceTable.assetId, id));
    await tx.delete(assetMovementsTable).where(eq(assetMovementsTable.assetId, id));
    await tx.delete(assetValueAdjustmentsTable).where(eq(assetValueAdjustmentsTable.assetId, id));
    await tx.delete(assetsTable).where(eq(assetsTable.id, id));
  });

  res.json({ success: true });
});

router.post("/assets/:id/transfer", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!asset) { res.status(404).json({ error: "Not found" }); return; }
  if (asset.status !== "In Use" && asset.status !== "Submitted") {
    res.status(400).json({ error: "只有已確認或使用中的資產可以調撥" }); return;
  }

  const { toDepartmentId, toLocation, reason, performedBy } = req.body;
  if (!toDepartmentId && !toLocation) {
    res.status(400).json({ error: "必須指定目標部門或位置" }); return;
  }

  let movement;
  await db.transaction(async (tx) => {
    [movement] = await tx.insert(assetMovementsTable).values({
      assetId: id,
      fromDepartmentId: asset.departmentId,
      toDepartmentId: toDepartmentId ? Number(toDepartmentId) : null,
      fromLocation: asset.location,
      toLocation: toLocation || null,
      movementDate: (req.body.movementDate as string) || todayTaipei(),
      reason: reason || null,
      performedBy: performedBy || null,
    }).returning();

    const assetUpdates: Record<string, unknown> = {};
    if (toDepartmentId) assetUpdates.departmentId = Number(toDepartmentId);
    if (toLocation) assetUpdates.location = toLocation;
    await tx.update(assetsTable).set(assetUpdates).where(eq(assetsTable.id, id));
  });

  res.status(201).json(movement);
});

router.post("/assets/:id/adjust-value", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!asset) { res.status(404).json({ error: "Not found" }); return; }
  if (asset.status !== "In Use") {
    res.status(400).json({ error: "只有使用中的資產可以調整價值" }); return;
  }

  const { newValue, reason } = req.body;
  if (newValue === undefined || !reason) {
    res.status(400).json({ error: "必填：新價值、調整原因" }); return;
  }

  const prevValue = Number(asset.currentValue);
  const adjAmount = Number(newValue) - prevValue;
  if (adjAmount === 0) { res.status(400).json({ error: "新價值與目前相同" }); return; }

  const accounts = await getAssetAccounts();
  const adjDate = (req.body.adjustmentDate as string) || todayTaipei();

  let adjustment;
  await db.transaction(async (tx) => {
    const entryNumber = "JE-ADJ-" + String(Date.now()).slice(-8);
    const lines: { accountId: number; accountName: string; debit: number; credit: number }[] = [];
    if (adjAmount > 0) {
      lines.push(
        { accountId: accounts.fixedAsset, accountName: "固定資產", debit: adjAmount, credit: 0 },
        { accountId: accounts.revaluationSurplus, accountName: "資產重估增值", debit: 0, credit: adjAmount },
      );
    } else {
      lines.push(
        { accountId: accounts.impairmentLoss, accountName: "資產減損損失", debit: Math.abs(adjAmount), credit: 0 },
        { accountId: accounts.fixedAsset, accountName: "固定資產", debit: 0, credit: Math.abs(adjAmount) },
      );
    }

    const [je] = await tx.insert(journalEntriesTable).values({
      entryNumber, entryDate: adjDate,
      description: `資產價值調整 ${asset.name}`,
      departmentId: asset.departmentId ?? null,
      lines: lines.map((l: any) => ({ description: `資產價值調整 ${asset.name}`, ...l })), totalDebit: String(Math.abs(adjAmount)), totalCredit: String(Math.abs(adjAmount)),
      status: "Posted",
    }).returning();

    [adjustment] = await tx.insert(assetValueAdjustmentsTable).values({
      assetId: id, adjustmentDate: adjDate,
      previousValue: String(prevValue), newValue: String(Number(newValue)),
      adjustmentAmount: String(adjAmount), reason, journalEntryId: je.id,
    }).returning();

    await tx.update(assetsTable).set({ currentValue: String(Number(newValue)) }).where(eq(assetsTable.id, id));
  });

  res.status(201).json({
    ...adjustment!,
    previousValue: Number((adjustment! as Record<string, unknown>).previousValue),
    newValue: Number((adjustment! as Record<string, unknown>).newValue),
    adjustmentAmount: Number((adjustment! as Record<string, unknown>).adjustmentAmount),
  });
});

router.post("/assets/:id/depreciate", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, id));
  if (!asset) { res.status(404).json({ error: "Not found" }); return; }
  if (asset.status !== "In Use") { res.status(400).json({ error: "只有使用中的資產可以提折舊" }); return; }

  const cost = Number(asset.purchaseCost);
  const salvage = Number(asset.salvageValue);
  const accumulated = Number(asset.accumulatedDepreciation);
  const currentVal = Number(asset.currentValue);
  const usefulLife = asset.usefulLifeYears;
  const period = (req.body.period as string) || todayTaipei().slice(0, 7);
  const periodError = depreciationPeriodProblem(period, asset.purchaseDate);
  if (periodError) { res.status(400).json({ error: periodError }); return; }
  const projectId = Number(req.body?.projectId) > 0 ? Number(req.body.projectId) : null;

  const existingEntry = await db.select().from(assetDepreciationEntriesTable)
    .where(and(eq(assetDepreciationEntriesTable.assetId, id), eq(assetDepreciationEntriesTable.period, period)));
  if (existingEntry.length > 0) {
    res.status(400).json({ error: `${period} 已提過折舊` }); return;
  }

  let depAmount: number;
  if (asset.depreciationMethod === "declining") {
    const rate = 2 / usefulLife;
    depAmount = Math.round(currentVal * rate / 12 * 100) / 100;
    if (currentVal - depAmount < salvage) depAmount = currentVal - salvage;
  } else {
    depAmount = Math.round((cost - salvage) / usefulLife / 12 * 100) / 100;
  }
  if (depAmount <= 0 || currentVal <= salvage) {
    res.status(400).json({ error: "資產已折舊完畢" }); return;
  }

  const newAccumulated = accumulated + depAmount;
  const newBookValue = Math.max(cost - newAccumulated, salvage);
  const depDate = period + "-01";
  const accounts = await getAssetAccounts();

  let entry;
  try {
  await db.transaction(async (tx) => {
    await assertPeriodOpen(tx, depDate, "提列折舊");
    await tx.update(assetsTable).set({
      accumulatedDepreciation: String(newAccumulated),
      currentValue: String(newBookValue),
    }).where(eq(assetsTable.id, id));

    const entryNumber = "JE-DEP-" + String(Date.now()).slice(-8);
    const [je] = await tx.insert(journalEntriesTable).values({
      entryNumber, entryDate: depDate,
      description: `折舊 ${asset.name} ${period}`,
      lines: [
        { accountId: accounts.depExpense, accountName: "折舊費用", debit: depAmount, credit: 0, description: `折舊 ${asset.name} ${period}` },
        { accountId: accounts.accumulatedDep, accountName: "累計折舊", debit: 0, credit: depAmount, description: `折舊 ${asset.name} ${period}` },
      ],
      totalDebit: String(depAmount), totalCredit: String(depAmount), status: "Posted",
      // 折舊是費用：歸到資產所屬的部門（有指定專案就一併記），部門與專案損益才看得到
      departmentId: asset.departmentId ?? null, projectId,
    }).returning();

    [entry] = await tx.insert(assetDepreciationEntriesTable).values({
      assetId: id, depreciationDate: depDate, depreciationAmount: String(depAmount),
      accumulatedAmount: String(newAccumulated), bookValue: String(newBookValue),
      period, journalEntryId: je.id,
    }).returning();
  });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "提列折舊失敗" }); return;
  }

  res.json({
    ...entry!,
    depreciationAmount: Number((entry! as Record<string, unknown>).depreciationAmount),
    accumulatedAmount: Number((entry! as Record<string, unknown>).accumulatedAmount),
    bookValue: Number((entry! as Record<string, unknown>).bookValue),
  });
});

router.post("/assets/batch-depreciate", async (req, res): Promise<void> => {
  const period = (req.body.period as string) || todayTaipei().slice(0, 7);
  const batchPeriodError = depreciationPeriodProblem(period, null);
  if (batchPeriodError) { res.status(400).json({ error: batchPeriodError }); return; }
  const batchProjectId = Number(req.body?.projectId) > 0 ? Number(req.body.projectId) : null;
  const accounts = await getAssetAccounts();

  const inUseAssets = await db.select().from(assetsTable).where(eq(assetsTable.status, "In Use"));
  const results: { assetId: number; assetNumber: string; amount: number; error?: string }[] = [];

  for (const asset of inUseAssets) {
    const cost = Number(asset.purchaseCost);
    const salvage = Number(asset.salvageValue);
    const accumulated = Number(asset.accumulatedDepreciation);
    const currentVal = Number(asset.currentValue);

    if (period < String(asset.purchaseDate).slice(0, 7)) {
      results.push({ assetId: asset.id, assetNumber: asset.assetNumber, amount: 0, error: "還沒購入" });
      continue;
    }
    const existingEntry = await db.select().from(assetDepreciationEntriesTable)
      .where(and(eq(assetDepreciationEntriesTable.assetId, asset.id), eq(assetDepreciationEntriesTable.period, period)));
    if (existingEntry.length > 0) {
      results.push({ assetId: asset.id, assetNumber: asset.assetNumber, amount: 0, error: "已提過" });
      continue;
    }

    if (currentVal <= salvage) {
      results.push({ assetId: asset.id, assetNumber: asset.assetNumber, amount: 0, error: "已折舊完畢" });
      continue;
    }

    let depAmount: number;
    if (asset.depreciationMethod === "declining") {
      const rate = 2 / asset.usefulLifeYears;
      depAmount = Math.round(currentVal * rate / 12 * 100) / 100;
      if (currentVal - depAmount < salvage) depAmount = currentVal - salvage;
    } else {
      depAmount = Math.round((cost - salvage) / asset.usefulLifeYears / 12 * 100) / 100;
    }

    if (depAmount <= 0) {
      results.push({ assetId: asset.id, assetNumber: asset.assetNumber, amount: 0, error: "折舊金額為零" });
      continue;
    }

    const newAccumulated = accumulated + depAmount;
    const newBookValue = Math.max(cost - newAccumulated, salvage);
    const depDate = period + "-01";

    try {
      await db.transaction(async (tx) => {
        await assertPeriodOpen(tx, depDate, "提列折舊");
        await tx.update(assetsTable).set({
          accumulatedDepreciation: String(newAccumulated), currentValue: String(newBookValue),
        }).where(eq(assetsTable.id, asset.id));

        const entryNumber = "JE-DEP-" + String(Date.now()).slice(-6) + "-" + asset.id;
        const [batchJe] = await tx.insert(journalEntriesTable).values({
          entryNumber, entryDate: depDate,
          description: `折舊 ${asset.name} ${period}`,
          lines: [
            { accountId: accounts.depExpense, accountName: "折舊費用", debit: depAmount, credit: 0, description: `折舊 ${asset.name} ${period}` },
            { accountId: accounts.accumulatedDep, accountName: "累計折舊", debit: 0, credit: depAmount, description: `折舊 ${asset.name} ${period}` },
          ],
          totalDebit: String(depAmount), totalCredit: String(depAmount), status: "Posted",
          departmentId: asset.departmentId ?? null, projectId: batchProjectId,
        }).returning();

        await tx.insert(assetDepreciationEntriesTable).values({
          assetId: asset.id, depreciationDate: depDate, depreciationAmount: String(depAmount),
          accumulatedAmount: String(newAccumulated), bookValue: String(newBookValue),
          period, journalEntryId: batchJe.id,
        });
      });

      results.push({ assetId: asset.id, assetNumber: asset.assetNumber, amount: depAmount });
    } catch (err: any) {
      results.push({ assetId: asset.id, assetNumber: asset.assetNumber, amount: 0, error: /已關帳/.test(err?.message || "") ? "這個月已關帳" : "交易失敗" });
    }
  }

  res.json({ period, results });
});

export default router;
