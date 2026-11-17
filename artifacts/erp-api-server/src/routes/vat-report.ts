import { Router, type IRouter } from "express";
import { and, gte, lte, ne, sql } from "drizzle-orm";
import { db, invoicesTable, customersTable, suppliersTable, advancesTable } from "@workspace/erp-db";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { ensureVatAccounts, getVatAccountStatuses } from "../lib/auto-journal";

const router: IRouter = Router();
router.use("/vat-report", requireAuth);

router.get("/vat-report", async (req, res): Promise<void> => {
  try {
  const startDate = String(req.query.startDate || "");
  const endDate = String(req.query.endDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
    res.status(400).json({ error: "請提供有效的起訖日期" });
    return;
  }

  const [rows, taxAccountStatuses] = await Promise.all([
    db.select({
    id: invoicesTable.id,
    invoiceNumber: invoicesTable.invoiceNumber,
    govInvoiceNumber: invoicesTable.govInvoiceNumber,
    ecpayInvoiceNumber: invoicesTable.ecpayInvoiceNumber,
    invoiceType: invoicesTable.invoiceType,
    invoiceDate: invoicesTable.invoiceDate,
    taxType: invoicesTable.taxType,
    netAmount: invoicesTable.netAmount,
    taxAmount: invoicesTable.taxAmount,
    customerName: customersTable.name,
    supplierName: suppliersTable.name,
    })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .leftJoin(suppliersTable, eq(invoicesTable.supplierId, suppliersTable.id))
    .where(and(
      gte(invoicesTable.invoiceDate, startDate),
      lte(invoicesTable.invoiceDate, endDate),
      ne(invoicesTable.status, "Cancelled"),
    ))
    .orderBy(invoicesTable.invoiceDate),
    getVatAccountStatuses(db),
  ]);

  // 異常資料（NULL/非數字）以 0 計，避免 NaN 污染整份報表
  const safeNum = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const round2 = (n: number) => Math.round(n * 100) / 100;
  // 折讓單（銷貨退回、進貨退出）要從當期的銷項、進項扣掉，所以金額記成負的
  const isAllowance = (type: string | null) => type === "Credit Note" || type === "Debit Note";
  const format = (row: typeof rows[number]) => {
    const sign = isAllowance(row.invoiceType) ? -1 : 1;
    const number = row.invoiceType === "Sales" || row.invoiceType === "Credit Note"
      ? (row.ecpayInvoiceNumber || row.invoiceNumber)
      : (row.govInvoiceNumber || row.invoiceNumber);
    return {
      ...row,
      kind: isAllowance(row.invoiceType) ? "allowance" : "invoice",
      displayInvoiceNumber: isAllowance(row.invoiceType) ? `${number}（折讓）` : number,
      partyName: row.customerName || row.supplierName || "—",
      netAmount: sign * safeNum(row.netAmount),
      taxAmount: sign * safeNum(row.taxAmount),
    };
  };
  type ReportRow = ReturnType<typeof format>;
  const outputInvoices: ReportRow[] = rows
    .filter(row => (row.invoiceType === "Sales" || row.invoiceType === "Credit Note") && (row.taxType === "taxable" || row.taxType === "zero_rated"))
    .map(format);
  const inputInvoices: ReportRow[] = rows
    .filter(row => (row.invoiceType === "Purchase" || row.invoiceType === "Debit Note") && row.taxType === "taxable")
    .map(format);

  // 沒有開成採購發票、但帳上有進項稅額的支出，也要算進可扣抵的進項：
  // 1) 老闆或員工代墊的費用（有填稅額）
  const advanceRows = await db.select().from(advancesTable).where(and(
    gte(advancesTable.entryDate, startDate), lte(advancesTable.entryDate, endDate),
    ne(advancesTable.status, "Voided"), eq(advancesTable.kind, "expense"), sql`${advancesTable.taxAmount} > 0`,
  ));
  const blank = { govInvoiceNumber: null, ecpayInvoiceNumber: null, taxType: "taxable", customerName: null, supplierName: null };
  for (const advance of advanceRows) {
    const tax = safeNum(advance.taxAmount);
    inputInvoices.push({
      ...blank, id: 1_000_000_000 + advance.id, invoiceNumber: advance.advanceNumber, invoiceType: "Purchase", invoiceDate: advance.entryDate,
      kind: "advance", displayInvoiceNumber: `${advance.advanceNumber}（代墊）`,
      partyName: `${advance.partyName} 代墊${advance.description ? "：" + advance.description : ""}`.slice(0, 60),
      netAmount: round2(safeNum(advance.amount) - tax), taxAmount: tax,
    });
  }
  // 2) 已經直接付掉的運費、集運費（沒有開應付發票，只有分錄）
  const inputAccountId = taxAccountStatuses.find(status => status.key === "input")?.account?.id;
  if (inputAccountId) {
    const landed: Array<{ id: number; entryNumber: string; entryDate: string; description: string; total: number; tax: number }> = await db.execute(sql`
      SELECT je.id, je.entry_number AS "entryNumber", je.entry_date AS "entryDate", je.description,
        je.total_debit::float AS total,
        SUM(CASE WHEN line->>'debit' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (line->>'debit')::numeric ELSE 0 END)::float AS tax
      FROM journal_entries je
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(je.lines) = 'array' THEN je.lines ELSE '[]'::jsonb END) line
      WHERE je.entry_date BETWEEN ${startDate} AND ${endDate}
        AND je.status = 'Posted'
        AND je.description LIKE '%攤進商品成本%'
        AND line->>'accountId' = ${String(inputAccountId)}
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.journal_entry_id = je.id AND i.status <> 'Cancelled')
      GROUP BY je.id, je.entry_number, je.entry_date, je.description, je.total_debit
      HAVING SUM(CASE WHEN line->>'debit' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (line->>'debit')::numeric ELSE 0 END) > 0
    `).then(result => ((result as any).rows ?? result));
    for (const entry of landed) {
      inputInvoices.push({
        ...blank, id: 2_000_000_000 + Number(entry.id), invoiceNumber: entry.entryNumber, invoiceType: "Purchase", invoiceDate: String(entry.entryDate),
        kind: "landed_cost", displayInvoiceNumber: `${entry.entryNumber}（運費）`,
        partyName: String(entry.description || "").replace(/^自動分錄 - /, "").slice(0, 60),
        netAmount: round2(Number(entry.total) - Number(entry.tax)), taxAmount: round2(Number(entry.tax)),
      });
    }
  }
  inputInvoices.sort((a, b) => String(a.invoiceDate).localeCompare(String(b.invoiceDate)));

  const sum = (list: ReportRow[], field: "netAmount" | "taxAmount") =>
    round2(list.reduce((total, row) => total + row[field], 0));
  const outputTax = sum(outputInvoices, "taxAmount");
  const inputTax = sum(inputInvoices, "taxAmount");

  const taxAccountIds = taxAccountStatuses
    .filter(status => status.account)
    .map(status => status.account!.id);
  const ledgerRows: Array<{ accountId: number; accountName: string; accountType: string; debit: number; credit: number }> =
    taxAccountIds.length === 0
      ? []
      : await db.execute(sql`
        SELECT
          a.id AS "accountId",
          a.account_name AS "accountName",
          a.account_type AS "accountType",
          COALESCE(SUM(CASE WHEN line->>'debit' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (line->>'debit')::numeric ELSE 0 END), 0)::float AS debit,
          COALESCE(SUM(CASE WHEN line->>'credit' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (line->>'credit')::numeric ELSE 0 END), 0)::float AS credit
        FROM journal_entries je
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(je.lines) = 'array' THEN je.lines ELSE '[]'::jsonb END
        ) line
        JOIN accounts a ON (
          jsonb_typeof(line) = 'object' AND (
          a.id::text = line->>'accountId'
          OR (
            COALESCE(line->>'accountId', '') = ''
            AND a.account_name = line->>'accountName'
          )
        ))
        WHERE je.entry_date BETWEEN ${startDate} AND ${endDate}
          AND je.status <> 'Draft'
          AND a.id IN (${sql.join(taxAccountIds.map(id => sql`${id}`), sql`, `)})
        GROUP BY a.id, a.account_name, a.account_type
      `).then(result => (result.rows ?? result) as Array<{ accountId: number; accountName: string; accountType: string; debit: number; credit: number }>);

  const ledgerById = new Map(ledgerRows.map(row => [Number(row.accountId), row]));
  const ledgerTax = (key: "output" | "input") => {
    const status = taxAccountStatuses.find(item => item.key === key);
    if (!status?.account) return 0;
    const row = ledgerById.get(status.account.id);
    if (!row) return 0;
    // 銷項稅額是負債（貸方增加），進項稅額是資產（借方增加）。
    return Math.round((status.account.accountType === "Liability"
      ? Number(row.credit) - Number(row.debit)
      : Number(row.debit) - Number(row.credit)) * 100) / 100;
  };
  const ledgerOutputTax = ledgerTax("output");
  const ledgerInputTax = ledgerTax("input");
  const taxReconciliation = {
    output: {
      invoiceTax: outputTax,
      ledgerTax: ledgerOutputTax,
      difference: Math.round((outputTax - ledgerOutputTax) * 100) / 100,
    },
    input: {
      invoiceTax: inputTax,
      ledgerTax: ledgerInputTax,
      difference: Math.round((inputTax - ledgerInputTax) * 100) / 100,
    },
    isReconciled: Math.abs(outputTax - ledgerOutputTax) <= 0.01 && Math.abs(inputTax - ledgerInputTax) <= 0.01,
  };

  res.json({
    outputTax,
    inputTax,
    payableTax: round2(outputTax - inputTax),
    salesTotal: sum(outputInvoices, "netAmount"),
    purchasesTotal: sum(inputInvoices, "netAmount"),
    outputInvoices,
    inputInvoices,
    unclassifiedCount: rows.filter(row => row.taxType === "unclassified").length,
    taxAccounts: {
      ready: taxAccountStatuses.every(status => Boolean(status.account)),
      missing: taxAccountStatuses.filter(status => !status.account).map(status => status.accountName),
      statuses: taxAccountStatuses,
    },
    ledgerOutputTax,
    ledgerInputTax,
    taxReconciliation,
  });
  } catch (err: any) {
    console.error("[vat-report] 產生報表失敗:", err);
    res.status(500).json({ error: `營業稅報表產生失敗：${err?.message || "未知錯誤"}。可能有異常的歷史分錄資料，請聯絡管理員檢查。` });
  }
});

router.post("/vat-report/ensure-accounts", requireRole("owner", "admin", "finance_admin", "accountant"), async (_req, res): Promise<void> => {
  try {
    const statuses = await db.transaction(tx => ensureVatAccounts(tx));
    res.json({
      ready: statuses.every(status => Boolean(status.account)),
      missing: statuses.filter(status => !status.account).map(status => status.accountName),
      statuses,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "營業稅科目建立失敗" });
  }
});

export default router;