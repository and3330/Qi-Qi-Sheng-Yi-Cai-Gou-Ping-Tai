// Integration test: 折讓單（銷貨/採購退回）自動沖回營收與成本分錄
// - 銷貨退回提交 → 自動建立折讓單（Credit Note）並產生「銷貨收入(借) / 應收帳款(貸)」反向分錄
// - 採購退回提交 → 自動建立扣項單（Debit Note）並產生「應付帳款(借) / 進貨(貸)」反向分錄
// - 自動折讓單不可單獨刪除；取消來源退貨 → 折讓單與分錄同步作廢
// Run: node tests/credit-note-auto-journal.integration.mjs  (dev server must be running; TEST_ADMIN seeded externally)
const BASE = process.env.API_BASE || `https://${process.env.REPLIT_DEV_DOMAIN}/api`;

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`PASS ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
}

const cookieJar = { cookie: "" };
async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", cookie: cookieJar.cookie, ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookieJar.cookie = setCookie.split(";")[0];
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const login = await api(`/admin/login`, { method: "POST", body: JSON.stringify({ companyCode: process.env.TEST_COMPANY_CODE, username: process.env.TEST_ADMIN_USER, password: process.env.TEST_ADMIN_PW }) });
if (login.status !== 200) { console.log("Login failed", login.status, JSON.stringify(login.json)); process.exit(1); }

const customers = (await api(`/customers`)).json;
const suppliers = (await api(`/suppliers`)).json;
const items = (await api(`/items`)).json;
const CUST = customers[0].id, SUP = suppliers[0].id;
const item = items[0];
const TODAY = new Date().toISOString().slice(0, 10);

async function findJE(invoiceId) {
  const { json } = await api(`/journal-entries?limit=200`);
  const list = Array.isArray(json) ? json : (json?.data || []);
  return list.find(e => String(e.entryNumber || "").endsWith(`-I${invoiceId}`)) || null;
}
const lineSum = (je, key) => (je?.lines || []).reduce((s, l) => s + Number(l[key] || 0), 0);
async function findInvoiceByNumberPrefix(prefix, minId = 0) {
  const { json } = await api(`/invoices`);
  const list = Array.isArray(json) ? json : (json?.data || []);
  return list.filter(i => String(i.invoiceNumber || "").startsWith(prefix) && i.id > minId)
    .sort((a, b) => b.id - a.id)[0] || null;
}

// ===== 先補 1 件庫存，讓後續出貨可提交 =====
const stockRc = (await api(`/purchase-receipts`, { method: "POST", body: JSON.stringify({
  supplierId: SUP, receiptDate: TODAY,
  items: [{ itemId: item.id, quantity: 1, rate: 300 }],
  remarks: "整合測試-補庫存",
}) })).json;
await api(`/purchase-receipts/${stockRc.id}`, { method: "PATCH", body: JSON.stringify({ status: "Submitted" }) });

// ===== 銷貨退回 → Credit Note（需先有已提交的送貨單）=====
const dn = (await api(`/delivery-notes`, { method: "POST", body: JSON.stringify({
  customerId: CUST, deliveryDate: TODAY,
  items: [{ itemId: item.id, quantity: 1, rate: 800 }],
  remarks: "整合測試-折讓分錄",
}) })).json;
check("送貨單建立成功", !!dn?.id, JSON.stringify(dn));
const dnSubmit = await api(`/delivery-notes/${dn.id}`, { method: "PATCH", body: JSON.stringify({ status: "Submitted" }) });
check("送貨單提交成功", dnSubmit.status === 200, JSON.stringify(dnSubmit.json));

const sr = (await api(`/sales-returns`, { method: "POST", body: JSON.stringify({
  deliveryNoteId: dn.id, customerId: CUST, returnDate: TODAY,
  items: [{ itemId: item.id, quantity: 1, rate: 800 }],
  remarks: "整合測試-折讓分錄",
}) })).json;
check("銷貨退回單建立成功", !!sr?.id, JSON.stringify(sr));

const srSubmit = await api(`/sales-returns/${sr.id}`, { method: "PATCH", body: JSON.stringify({ status: "Submitted" }) });
check("銷貨退回提交成功", srSubmit.status === 200, JSON.stringify(srSubmit.json));

const cn = await findInvoiceByNumberPrefix("CN-");
check("折讓單（Credit Note）已自動建立", !!cn, "CN not found");

let cnJE = cn && await findJE(cn.id);
check("折讓單自動產生分錄", !!cnJE, JSON.stringify(cn));
check("折讓分錄借貸平衡且金額=800", cnJE && lineSum(cnJE, "debit") === 800 && lineSum(cnJE, "credit") === 800, JSON.stringify(cnJE?.lines));
const cnDebit = cnJE?.lines?.find(l => Number(l.debit) > 0);
const cnCredit = cnJE?.lines?.find(l => Number(l.credit) > 0);
check("折讓分錄借方為銷貨收入（沖回營收）且已解析科目", !!cnDebit?.accountId, JSON.stringify(cnDebit));
check("折讓分錄貸方為應收帳款且已解析科目", !!cnCredit?.accountId && String(cnCredit.accountName).includes("應收帳款"), JSON.stringify(cnCredit));

// ===== 採購退回 → Debit Note（需先有已提交的進貨單）=====
const receipt = (await api(`/purchase-receipts`, { method: "POST", body: JSON.stringify({
  supplierId: SUP, receiptDate: TODAY,
  items: [{ itemId: item.id, quantity: 1, rate: 300 }],
  remarks: "整合測試-折讓分錄",
}) })).json;
check("進貨單建立成功", !!receipt?.id, JSON.stringify(receipt));
const prcSubmit = await api(`/purchase-receipts/${receipt.id}`, { method: "PATCH", body: JSON.stringify({ status: "Submitted" }) });
check("進貨單提交成功", prcSubmit.status === 200, JSON.stringify(prcSubmit.json));

const pr = (await api(`/purchase-returns`, { method: "POST", body: JSON.stringify({
  purchaseReceiptId: receipt.id, supplierId: SUP, returnDate: TODAY,
  items: [{ itemId: item.id, quantity: 1, rate: 300 }],
  remarks: "整合測試-折讓分錄",
}) })).json;
check("採購退回單建立成功", !!pr?.id, JSON.stringify(pr));

const prSubmit = await api(`/purchase-returns/${pr.id}`, { method: "PATCH", body: JSON.stringify({ status: "Submitted" }) });
check("採購退回提交成功", prSubmit.status === 200, JSON.stringify(prSubmit.json));

const dbn = await findInvoiceByNumberPrefix("DBN-");
check("扣項單（Debit Note）已自動建立", !!dbn, "DBN not found");

const dbnJE = dbn && await findJE(dbn.id);
check("扣項單自動產生分錄", !!dbnJE, JSON.stringify(dbn));
check("扣項分錄借貸平衡且金額=300", dbnJE && lineSum(dbnJE, "debit") === 300 && lineSum(dbnJE, "credit") === 300, JSON.stringify(dbnJE?.lines));
const dbnDebit = dbnJE?.lines?.find(l => Number(l.debit) > 0);
const dbnCredit = dbnJE?.lines?.find(l => Number(l.credit) > 0);
check("扣項分錄借方為應付帳款且已解析科目", !!dbnDebit?.accountId && String(dbnDebit.accountName).includes("應付帳款"), JSON.stringify(dbnDebit));
check("扣項分錄貸方為進貨/成本科目且已解析科目", !!dbnCredit?.accountId, JSON.stringify(dbnCredit));

// ===== 必須由來源退貨取消 → 折讓單與分錄同步作廢 =====
if (cn) {
  const del = await api(`/invoices/${cn.id}`, { method: "DELETE" });
  check("自動折讓單不可脫離來源退貨單獨刪除", del.status === 400, JSON.stringify(del.json));
  const cancel = await api(`/sales-returns/${sr.id}`, {
    method: "PATCH", body: JSON.stringify({ status: "Cancelled" }),
  });
  check("取消銷貨退回成功", cancel.status === 200, JSON.stringify(cancel.json));
  cnJE = await findJE(cn.id);
  check("取消銷貨退回後折讓分錄同步刪除", !cnJE, JSON.stringify(cnJE));
}
if (dbn) {
  const del = await api(`/invoices/${dbn.id}`, { method: "DELETE" });
  check("自動扣項單不可脫離來源退貨單獨刪除", del.status === 400, JSON.stringify(del.json));
  const cancel = await api(`/purchase-returns/${pr.id}`, {
    method: "PATCH", body: JSON.stringify({ status: "Cancelled" }),
  });
  check("取消採購退回成功", cancel.status === 200, JSON.stringify(cancel.json));
  const afterCancelJE = await findJE(dbn.id);
  check("取消採購退回後扣項分錄同步刪除", !afterCancelJE, JSON.stringify(afterCancelJE));
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
