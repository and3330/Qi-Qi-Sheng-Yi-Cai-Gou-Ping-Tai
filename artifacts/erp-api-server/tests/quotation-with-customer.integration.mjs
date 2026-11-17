// Integration test: POST /api/quotations/with-customer (transactional customer+quotation)
// Run: node tests/quotation-with-customer.integration.mjs  (dev server must be running)
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

const suffix = Date.now().toString().slice(-7);
const NAME_A = `測試交易客戶A-${suffix}`;
const NAME_B = `測試交易客戶B-${suffix}`;

async function countCustomers(name) {
  const { json } = await api(`/customers?search=${encodeURIComponent(name)}`);
  return Array.isArray(json) ? json.filter(c => c.name === name).length : -1;
}

// --- login (assumes TEST_ADMIN seeded externally) ---
const login = await api(`/admin/login`, { method: "POST", body: JSON.stringify({ companyCode: process.env.TEST_COMPANY_CODE, username: process.env.TEST_ADMIN_USER, password: process.env.TEST_ADMIN_PW }) });
if (login.status !== 200) { console.log("Login failed", login.status, JSON.stringify(login.json)); process.exit(1); }

const goodQuotation = {
  quotationDate: "2026-08-31",
  totalAmount: 1000, taxAmount: 50, grandTotal: 1050,
  items: [{ code: "", name: "測試品項", qty: 1, unit: "式", unitPrice: 1000, amount: 1000 }],
};

// 1) Success: new customer + quotation created together
const r1 = await api(`/quotations/with-customer`, { method: "POST", body: JSON.stringify({ newCustomer: { name: NAME_A, phone: "0912345678" }, quotation: goodQuotation }) });
check("success creates customer+quotation", r1.status === 201 && r1.json?.customerCreated === true && r1.json?.quotation?.quotationNumber, JSON.stringify(r1.json));
check("quotation linked to created customer", r1.json?.quotation?.customerId === r1.json?.customer?.id);
check("customer exists after success", (await countCustomers(NAME_A)) === 1);

// 2) Duplicate customer name: reuse, no second customer
const r2 = await api(`/quotations/with-customer`, { method: "POST", body: JSON.stringify({ newCustomer: { name: NAME_A }, quotation: goodQuotation }) });
check("duplicate name reuses customer", r2.status === 201 && r2.json?.customerCreated === false && r2.json?.customer?.id === r1.json?.customer?.id, JSON.stringify(r2.json));
check("no duplicate customer row", (await countCustomers(NAME_A)) === 1);

// 3) Quotation validation failure: no items -> 400, no orphan customer
const r3 = await api(`/quotations/with-customer`, { method: "POST", body: JSON.stringify({ newCustomer: { name: NAME_B }, quotation: { ...goodQuotation, items: [] } }) });
check("empty items rejected", r3.status === 400, JSON.stringify(r3.json));
check("no orphan customer on items failure", (await countCustomers(NAME_B)) === 0);

// 4) Invalid item -> 400, no orphan customer
const r4 = await api(`/quotations/with-customer`, { method: "POST", body: JSON.stringify({ newCustomer: { name: NAME_B }, quotation: { ...goodQuotation, items: [{ name: "", qty: 0, unitPrice: -1 }] } }) });
check("invalid item rejected", r4.status === 400, JSON.stringify(r4.json));
check("no orphan customer on invalid item", (await countCustomers(NAME_B)) === 0);

// 5) Bad date -> 400, no orphan customer
const r5 = await api(`/quotations/with-customer`, { method: "POST", body: JSON.stringify({ newCustomer: { name: NAME_B }, quotation: { ...goodQuotation, quotationDate: "31/08/2026" } }) });
check("bad date rejected", r5.status === 400, JSON.stringify(r5.json));
check("no orphan customer on bad date", (await countCustomers(NAME_B)) === 0);

// 6) Nonexistent customerId -> 400 (transaction rollback path)
const r6 = await api(`/quotations/with-customer`, { method: "POST", body: JSON.stringify({ customerId: 99999999, quotation: goodQuotation }) });
check("nonexistent customerId rejected", r6.status === 400, JSON.stringify(r6.json));

// 7) Missing customer info entirely -> 400
const r7 = await api(`/quotations/with-customer`, { method: "POST", body: JSON.stringify({ quotation: goodQuotation }) });
check("missing customer rejected", r7.status === 400, JSON.stringify(r7.json));

// 8) Existing customerId works
const r8 = await api(`/quotations/with-customer`, { method: "POST", body: JSON.stringify({ customerId: r1.json?.customer?.id, quotation: goodQuotation }) });
check("existing customerId works", r8.status === 201 && r8.json?.customerCreated === false, JSON.stringify(r8.json));

// 9) Unauthenticated -> 401
const noAuth = await fetch(`${BASE}/quotations/with-customer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newCustomer: { name: "x" }, quotation: goodQuotation }) });
check("unauthenticated rejected", noAuth.status === 401, String(noAuth.status));

// cleanup created quotations + customer
for (const r of [r1, r2, r8]) {
  if (r.json?.quotation?.id) await api(`/quotations/${r.json.quotation.id}`, { method: "DELETE" });
}
if (r1.json?.customer?.id) await api(`/customers/${r1.json.customer.id}`, { method: "DELETE" });

console.log(failures === 0 ? "ALL TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
