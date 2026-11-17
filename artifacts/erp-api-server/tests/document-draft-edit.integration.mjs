// Integration test: 草稿限定編輯（採購訂單 / 進貨單 / 送貨單）
// - 草稿可編輯品項與表頭並重算 totalAmount
// - 非草稿狀態拒絕任何內容欄位修改（含 expectedDate/templateId/extraFields）
// - 內容編輯不可與狀態轉換同一請求（避免庫存與單據不一致）
// - 草稿改品項後提交，庫存以「新品項」調整
// Run: node tests/document-draft-edit.integration.mjs  (dev server must be running; TEST_ADMIN seeded externally)
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

// --- login ---
const login = await api(`/admin/login`, { method: "POST", body: JSON.stringify({ companyCode: process.env.TEST_COMPANY_CODE, username: process.env.TEST_ADMIN_USER, password: process.env.TEST_ADMIN_PW }) });
if (login.status !== 200) { console.log("Login failed", login.status, JSON.stringify(login.json)); process.exit(1); }

// --- reference data ---
const suppliers = (await api(`/suppliers`)).json;
const customers = (await api(`/customers`)).json;
const items = (await api(`/items`)).json;
const depts = (await api(`/departments`)).json;
const projs = (await api(`/projects`)).json;
const SUP = suppliers[0].id, CUST = customers[0].id, I1 = items[0].id, I2 = items[1].id, DEPT = depts[0].id, PROJ = projs[0].id;

async function itemStock(id) {
  const { json } = await api(`/items`);
  return Number(json.find(i => i.id === id).currentStock || 0);
}

// ===== 採購訂單 =====
const po = (await api(`/purchase-orders`, { method: "POST", body: JSON.stringify({ supplierId: SUP, orderDate: "2026-08-31", departmentId: DEPT, projectId: PROJ, items: [{ itemId: I1, quantity: 2, rate: 10 }] }) })).json;
const poEdit = await api(`/purchase-orders/${po.id}`, { method: "PATCH", body: JSON.stringify({ orderDate: "2026-08-30", items: [{ itemId: I2, quantity: 3, rate: 5 }] }) });
check("PO 草稿可編輯並重算總額", poEdit.status === 200 && Number(poEdit.json.totalAmount) === 15 && poEdit.json.items[0].itemId === I2, JSON.stringify(poEdit.json));

const poCombo = await api(`/purchase-orders/${po.id}`, { method: "PATCH", body: JSON.stringify({ status: "To Receive", items: [{ itemId: I1, quantity: 1, rate: 1 }] }) });
check("PO 內容編輯不可與狀態轉換同請求", poCombo.status === 400, JSON.stringify(poCombo.json));
const poCombo2 = await api(`/purchase-orders/${po.id}`, { method: "PATCH", body: JSON.stringify({ status: "To Receive", expectedDate: "2026-09-01" }) });
check("PO expectedDate 不可與狀態轉換同請求", poCombo2.status === 400, JSON.stringify(poCombo2.json));

await api(`/purchase-orders/${po.id}`, { method: "PATCH", body: JSON.stringify({ status: "To Receive" }) });
for (const body of [
  { items: [{ itemId: I1, quantity: 1, rate: 1 }] },
  { expectedDate: "2026-09-15" },
  { templateId: null },
  { extraFields: { hacked: true } },
  { supplierId: SUP },
  { orderDate: "2026-01-01" },
]) {
  const r = await api(`/purchase-orders/${po.id}`, { method: "PATCH", body: JSON.stringify(body) });
  check(`PO 非草稿拒絕內容修改 ${Object.keys(body)[0]}`, r.status === 400, JSON.stringify(r.json));
}
await api(`/purchase-orders/${po.id}`, { method: "PATCH", body: JSON.stringify({ status: "Cancelled" }) });

// ===== 進貨單 =====
const pr = (await api(`/purchase-receipts`, { method: "POST", body: JSON.stringify({ supplierId: SUP, receiptDate: "2026-08-31", departmentId: DEPT, projectId: PROJ, items: [{ itemId: I1, quantity: 2, rate: 10 }] }) })).json;
const prEdit = await api(`/purchase-receipts/${pr.id}`, { method: "PATCH", body: JSON.stringify({ receiptDate: "2026-08-29", items: [{ itemId: I1, quantity: 5, rate: 4 }] }) });
check("PR 草稿可編輯並重算總額", prEdit.status === 200 && Number(prEdit.json.totalAmount) === 20, JSON.stringify(prEdit.json));

const prCombo = await api(`/purchase-receipts/${pr.id}`, { method: "PATCH", body: JSON.stringify({ status: "Submitted", items: [{ itemId: I1, quantity: 9, rate: 1 }] }) });
check("PR 內容編輯不可與狀態轉換同請求", prCombo.status === 400, JSON.stringify(prCombo.json));
const prCombo2 = await api(`/purchase-receipts/${pr.id}`, { method: "PATCH", body: JSON.stringify({ status: "Submitted", remarks: "x" }) });
check("PR 備註不可與狀態轉換同請求", prCombo2.status === 400, JSON.stringify(prCombo2.json));
const prCombo3 = await api(`/purchase-receipts/${pr.id}`, { method: "PATCH", body: JSON.stringify({ status: "Submitted", receiptDate: "2026-08-01" }) });
check("PR 日期不可與狀態轉換同請求", prCombo3.status === 400, JSON.stringify(prCombo3.json));

// 提交後庫存應以「編輯後」的品項數量調整（+5）
const stockBefore = await itemStock(I1);
const prSubmit = await api(`/purchase-receipts/${pr.id}`, { method: "PATCH", body: JSON.stringify({ status: "Submitted" }) });
const stockAfter = await itemStock(I1);
check("PR 提交後庫存依編輯後的品項調整", prSubmit.status === 200 && stockAfter - stockBefore === 5, `before=${stockBefore} after=${stockAfter}`);

const prLocked = await api(`/purchase-receipts/${pr.id}`, { method: "PATCH", body: JSON.stringify({ items: [{ itemId: I1, quantity: 1, rate: 1 }] }) });
check("PR 已確認拒絕內容修改", prLocked.status === 400, JSON.stringify(prLocked.json));
const prLockedRemarks = await api(`/purchase-receipts/${pr.id}`, { method: "PATCH", body: JSON.stringify({ remarks: "改備註" }) });
check("PR 已確認拒絕修改備註", prLockedRemarks.status === 400, JSON.stringify(prLockedRemarks.json));
const prLockedDate = await api(`/purchase-receipts/${pr.id}`, { method: "PATCH", body: JSON.stringify({ receiptDate: "2026-08-01" }) });
check("PR 已確認拒絕修改日期", prLockedDate.status === 400, JSON.stringify(prLockedDate.json));

await api(`/purchase-receipts/${pr.id}`, { method: "PATCH", body: JSON.stringify({ status: "Cancelled" }) }); // 回沖庫存

// ===== 送貨單 =====
const dn = (await api(`/delivery-notes`, { method: "POST", body: JSON.stringify({ customerId: CUST, deliveryDate: "2026-08-31", departmentId: DEPT, projectId: PROJ, items: [{ itemId: I1, quantity: 2, rate: 10 }] }) })).json;
const dnEdit = await api(`/delivery-notes/${dn.id}`, { method: "PATCH", body: JSON.stringify({ deliveryDate: "2026-08-28", items: [{ itemId: I2, quantity: 1, rate: 100 }] }) });
check("DN 草稿可編輯並重算總額", dnEdit.status === 200 && Number(dnEdit.json.totalAmount) === 100, JSON.stringify(dnEdit.json));

const dnCombo = await api(`/delivery-notes/${dn.id}`, { method: "PATCH", body: JSON.stringify({ status: "Submitted", items: [{ itemId: I2, quantity: 1, rate: 1 }] }) });
check("DN 內容編輯不可與狀態轉換同請求", dnCombo.status === 400, JSON.stringify(dnCombo.json));
const dnCombo2 = await api(`/delivery-notes/${dn.id}`, { method: "PATCH", body: JSON.stringify({ status: "Submitted", remarks: "x" }) });
check("DN 備註不可與狀態轉換同請求", dnCombo2.status === 400, JSON.stringify(dnCombo2.json));
const dnCombo3 = await api(`/delivery-notes/${dn.id}`, { method: "PATCH", body: JSON.stringify({ status: "Submitted", deliveryDate: "2026-08-01" }) });
check("DN 日期不可與狀態轉換同請求", dnCombo3.status === 400, JSON.stringify(dnCombo3.json));

await api(`/delivery-notes/${dn.id}`, { method: "PATCH", body: JSON.stringify({ status: "Cancelled" }) });
const dnLocked = await api(`/delivery-notes/${dn.id}`, { method: "PATCH", body: JSON.stringify({ customerId: CUST }) });
check("DN 已取消拒絕內容修改", dnLocked.status === 400, JSON.stringify(dnLocked.json));
const dnLockedRemarks = await api(`/delivery-notes/${dn.id}`, { method: "PATCH", body: JSON.stringify({ remarks: "改備註" }) });
check("DN 已取消拒絕修改備註", dnLockedRemarks.status === 400, JSON.stringify(dnLockedRemarks.json));
const dnLockedDate = await api(`/delivery-notes/${dn.id}`, { method: "PATCH", body: JSON.stringify({ deliveryDate: "2026-08-01" }) });
check("DN 已取消拒絕修改日期", dnLockedDate.status === 400, JSON.stringify(dnLockedDate.json));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
