// Integration test: 銷貨/採購發票自動過帳
// - 建立應稅銷貨發票 → 自動產生「應收帳款 / 銷貨收入 + 銷項稅額」分錄
// - 建立應稅採購發票 → 自動產生「進貨 + 進項稅額 / 應付帳款」分錄
// - 稅設定變更（外加稅）導致總額變動 → 分錄金額同步重建
// - 發票取消 → 分錄刪除
// - 發票刪除 → 分錄刪除
// Run: node tests/invoice-auto-journal.integration.mjs  (dev server must be running; TEST_ADMIN seeded externally)
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
const CUST = customers[0].id, SUP = suppliers[0].id, ITEM = items[0].id;
const TODAY = new Date().toISOString().slice(0, 10);

// 自動分錄的 entryNumber 以 -I<invoiceId> 結尾
async function findJE(invoiceId) {
  const { json } = await api(`/journal-entries?limit=200`);
  const list = Array.isArray(json) ? json : (json?.data || []);
  return list.find(e => String(e.entryNumber || "").endsWith(`-I${invoiceId}`)) || null;
}
const lineSum = (je, key) => (je?.lines || []).reduce((s, l) => s + Number(l[key] || 0), 0);

// ===== 銷貨發票（含稅 5%，總額 1000）=====
const sinv = (await api(`/invoices`, { method: "POST", body: JSON.stringify({
  invoiceType: "Sales", customerId: CUST, invoiceDate: TODAY,
  items: [{ itemId: ITEM, quantity: 2, rate: 500 }],
  taxType: "taxable", taxRate: 5, taxIncluded: true,
}) })).json;
check("銷貨發票建立成功", !!sinv?.id, JSON.stringify(sinv));

let je = await findJE(sinv.id);
check("銷貨發票自動產生分錄", !!je, `invoice ${sinv.id}`);
check("銷貨分錄借貸平衡且金額=含稅總額 1000", je && lineSum(je, "debit") === 1000 && lineSum(je, "credit") === 1000, JSON.stringify(je?.lines));
const arLine = je?.lines?.find(l => Number(l.debit) > 0);
const revLine = je?.lines?.find(l => String(l.accountName).includes("收入"));
const outputTaxLine = je?.lines?.find(l => String(l.accountName).includes("銷項稅額"));
check("銷貨分錄借方為應收帳款且已解析科目", !!arLine?.accountId && String(arLine.accountName).includes("應收帳款"), JSON.stringify(arLine));
check("銷貨收入只入未稅金額 952.38", !!revLine?.accountId && Number(revLine.credit) === 952.38, JSON.stringify(revLine));
check("銷項稅額 47.62 入專用負債科目", !!outputTaxLine?.accountId && Number(outputTaxLine.credit) === 47.62, JSON.stringify(outputTaxLine));

// ===== 稅設定變更（外加 5%）→ 總額 1050，分錄同步重建 =====
const upd = await api(`/invoices/${sinv.id}`, { method: "PATCH", body: JSON.stringify({ taxIncluded: false, taxType: "taxable", taxRate: 5 }) });
check("外加稅更新成功且總額 1050", upd.status === 200 && Number(upd.json.totalAmount) === 1050, JSON.stringify(upd.json));
const oldJeId = je?.id;
je = await findJE(sinv.id);
check("總額變動後分錄重建且金額=1050", je && je.id !== oldJeId && lineSum(je, "debit") === 1050 && lineSum(je, "credit") === 1050, JSON.stringify(je?.lines));

// ===== 發票取消 → 分錄刪除 =====
const cancel = await api(`/invoices/${sinv.id}`, { method: "PATCH", body: JSON.stringify({ status: "Cancelled" }) });
check("發票取消成功", cancel.status === 200 && cancel.json.status === "Cancelled", JSON.stringify(cancel.json));
check("取消後分錄已刪除", !(await findJE(sinv.id)));

// ===== 採購發票 =====
const pinv = (await api(`/invoices`, { method: "POST", body: JSON.stringify({
  invoiceType: "Purchase", supplierId: SUP, invoiceDate: TODAY,
  items: [{ itemId: ITEM, quantity: 1, rate: 300 }],
  taxType: "taxable", taxRate: 5, taxIncluded: true,
}) })).json;
check("採購發票建立成功", !!pinv?.id, JSON.stringify(pinv));
const pje = await findJE(pinv.id);
check("採購發票自動產生分錄且金額=300", pje && lineSum(pje, "debit") === 300 && lineSum(pje, "credit") === 300, JSON.stringify(pje?.lines));
const apLine = pje?.lines?.find(l => Number(l.credit) > 0);
const inputTaxLine = pje?.lines?.find(l => String(l.accountName).includes("進項稅額"));
const COST_NAMES = ["進貨", "進貨成本", "銷貨成本", "商品業務成本", "其他營業成本", "營業成本"];
const purchaseLine = pje?.lines?.find(l => Number(l.debit) > 0 && COST_NAMES.some(n => String(l.accountName).includes(n)));
check("採購分錄貸方為應付帳款且已解析科目", !!apLine?.accountId && String(apLine.accountName).includes("應付帳款"), JSON.stringify(apLine));
check("進貨只入未稅金額 285.71", !!purchaseLine?.accountId && Number(purchaseLine.debit) === 285.71, JSON.stringify(purchaseLine));
check("進項稅額 14.29 入專用資產科目", !!inputTaxLine?.accountId && Number(inputTaxLine.debit) === 14.29, JSON.stringify(inputTaxLine));

// ===== 發票刪除 → 分錄刪除 =====
const del = await api(`/invoices/${pinv.id}`, { method: "DELETE" });
check("採購發票刪除成功", del.status === 204, JSON.stringify(del.json));
check("刪除後分錄已刪除", !(await findJE(pinv.id)));

// 清理：取消的銷貨發票留在資料庫沒有分錄影響，但仍移除避免殘留測試資料
// （Cancelled 無法直接刪，僅嘗試；失敗不視為測試失敗）
await api(`/invoices/${sinv.id}`, { method: "DELETE" });

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
