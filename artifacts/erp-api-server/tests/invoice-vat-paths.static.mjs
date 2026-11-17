// Static contract test for paths that require externally seeded sales/delivery/
// purchase documents. The ECPay assertion specifically protects the preflight
// ordering: VAT-account setup must happen before its irreversible API request.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const invoices = fs.readFileSync(path.join(here, "../src/routes/invoices.ts"), "utf8");
const receipts = fs.readFileSync(path.join(here, "../src/routes/purchase-receipts.ts"), "utf8");
const autoJournal = fs.readFileSync(path.join(here, "../src/lib/auto-journal.ts"), "utf8");
const reimbursement = fs.readFileSync(path.join(here, "../src/routes/reimbursement-ai.ts"), "utf8");
let failures = 0;
function check(name, condition) {
  if (condition) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`); }
}

const taxableFields = /taxType:\s*"taxable",\s*\n\s*taxRate:\s*"5",\s*\n\s*netAmount:\s*String\(tax\.netAmount\),\s*\n\s*taxAmount:\s*String\(tax\.taxAmount\)/g;
check("sales-order and delivery-note invoices persist taxable VAT fields", (invoices.match(taxableFields) || []).length >= 2);
check("sales-order and delivery-note calculate tax before journal creation",
  invoices.indexOf('const tax = taxFields(totalAmount, 1, "taxable", 5, true);') < invoices.indexOf("await createInvoiceJournalEntry(tx, created)"));
check("purchase-receipt invoices persist taxable input VAT fields",
  /taxType:\s*"taxable",\s*\n\s*taxRate:\s*"5",\s*\n\s*netAmount:\s*String\(netAmount\),\s*\n\s*taxAmount:\s*String\(taxAmount\)/.test(receipts));

const ecpayPreflight = invoices.indexOf("await assertVatAccountsReady(tx)");
const ecpayIssue = invoices.indexOf("const result = await issueInvoice");
const ecpayTax = invoices.indexOf('const tax = taxFields(salesAmount, 1, "taxable", 5, true);');
check("ECPay VAT accounts are preflighted before issueInvoice", ecpayPreflight >= 0 && ecpayPreflight < ecpayIssue);
check("ECPay TaxType=1 amount persists tax-included VAT fields", ecpayTax > ecpayIssue && invoices.indexOf('taxType: "taxable",', ecpayTax) > ecpayTax);
const centralLock = autoJournal.indexOf('await assertPeriodOpen(tx, inv.invoiceDate, "建立發票自動分錄");');
const journalInsert = autoJournal.indexOf("await tx.insert(journalEntriesTable)");
check("central invoice journal lock check occurs before JE insertion", centralLock >= 0 && centralLock < journalInsert);
const ecpayDate = invoices.indexOf("const ecpayInvoiceDate = new Date().toISOString().slice(0, 10);");
const ecpayLock = invoices.indexOf('await assertPeriodOpen(tx, ecpayInvoiceDate, "開立綠界發票");');
check("ECPay lock preflight occurs before issueInvoice on persisted date",
  ecpayDate >= 0 && ecpayLock > ecpayDate && ecpayLock < ecpayIssue &&
  invoices.indexOf("invoiceDate: ecpayInvoiceDate", ecpayIssue) > ecpayIssue);
const reimbursementLock = reimbursement.indexOf('await assertPeriodOpen(tx, meta.date, "憑證一鍵入帳")');
const reimbursementVatReady = reimbursement.indexOf("if (meta.tax > 0) await assertVatAccountsReady(tx)");
const reimbursementInsert = reimbursement.indexOf("tx.insert(journalEntriesTable)");
check("reimbursement checks lock date and VAT accounts before posting",
  reimbursementLock >= 0 && reimbursementVatReady > reimbursementLock && reimbursementVatReady < reimbursementInsert);
check("reimbursement input VAT must resolve to a concrete account",
  reimbursement.includes("meta.tax > 0 && !inputTaxLine?.accountId"));

process.exitCode = failures ? 1 : 0;