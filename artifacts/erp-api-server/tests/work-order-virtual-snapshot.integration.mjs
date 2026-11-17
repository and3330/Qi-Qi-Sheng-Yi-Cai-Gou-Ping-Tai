// Integration test: 工單虛擬服務快照
// - 建單當下的 isVirtual 快照決定發料/完工是否異動庫存
// - 建單後把實體品改成虛擬：仍照舊扣/加庫存（快照=實體）
// - 建單後把虛擬品改成實體：仍不動庫存（快照=虛擬）
// Run: node tests/work-order-virtual-snapshot.integration.mjs  (dev server must be running; TEST_ADMIN seeded externally)
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

const suffix = String(Date.now()).slice(-6);
async function createItem(name, isVirtual, stock) {
  const { status, json } = await api(`/items`, { method: "POST", body: JSON.stringify({ itemName: name, itemCode: `${name}-${suffix}`, isVirtual, currentStock: String(stock) }) });
  if (status !== 201 && status !== 200) { console.log("createItem failed", status, JSON.stringify(json)); process.exit(1); }
  return json.id;
}
async function stockOf(id) {
  const { json } = await api(`/items/${id}`);
  return Number(json.currentStock || 0);
}
async function setVirtual(id, v) {
  const r = await api(`/items/${id}`, { method: "PATCH", body: JSON.stringify({ isVirtual: v }) });
  if (r.status !== 200) { console.log("setVirtual failed", r.status, JSON.stringify(r.json)); process.exit(1); }
}

// 成品 F 實體、材料 P 實體、材料 V 虛擬
const F = await createItem("WOVS-F", false, 0);
const P = await createItem("WOVS-P", false, 100);
const V = await createItem("WOVS-V", true, 0);

const bom = (await api(`/boms`, { method: "POST", body: JSON.stringify({ itemId: F, quantity: 1, items: [{ itemId: P, quantity: 2, rate: 10 }, { itemId: V, quantity: 1, rate: 5 }] }) })).json;
await api(`/boms/${bom.id}`, { method: "PATCH", body: JSON.stringify({ status: "Active" }) });

const wo = (await api(`/work-orders`, { method: "POST", body: JSON.stringify({ bomId: bom.id, plannedQuantity: 3 }) })).json;
check("工單建立成功", !!wo?.id, JSON.stringify(wo));

// 建單後反向改標記：P 改虛擬、V 改實體、F 改虛擬 — 快照應維持建單當下行為
await setVirtual(P, true);
await setVirtual(V, false);
await setVirtual(F, true);

await api(`/work-orders/${wo.id}`, { method: "PATCH", body: JSON.stringify({ status: "In Progress" }) });

const p0 = await stockOf(P), v0 = await stockOf(V), f0 = await stockOf(F);

const issueP = await api(`/work-orders/${wo.id}/issue-material`, { method: "POST", body: JSON.stringify({ itemId: P, quantity: 6 }) });
check("實體材料（後改虛擬）發料成功", issueP.status === 200, JSON.stringify(issueP.json));
check("實體材料快照：仍扣庫存", (await stockOf(P)) === p0 - 6, `before=${p0} after=${await stockOf(P)}`);

const issueV = await api(`/work-orders/${wo.id}/issue-material`, { method: "POST", body: JSON.stringify({ itemId: V, quantity: 3 }) });
check("虛擬材料（後改實體）發料成功", issueV.status === 200, JSON.stringify(issueV.json));
check("虛擬材料快照：不動庫存", (await stockOf(V)) === v0, `before=${v0} after=${await stockOf(V)}`);

const finish = await api(`/work-orders/${wo.id}/finish`, { method: "POST", body: JSON.stringify({ quantity: 3 }) });
check("完工成功", finish.status === 200, JSON.stringify(finish.json));
check("實體成品快照：完工仍入庫", (await stockOf(F)) === f0 + 3, `before=${f0} after=${await stockOf(F)}`);

// 反向：成品建單時是虛擬，之後改實體 → 完工不入庫
const F2 = await createItem("WOVS-F2", true, 0);
const bom2 = (await api(`/boms`, { method: "POST", body: JSON.stringify({ itemId: F2, quantity: 1, items: [{ itemId: P, quantity: 1, rate: 10 }] }) })).json;
await api(`/boms/${bom2.id}`, { method: "PATCH", body: JSON.stringify({ status: "Active" }) });
const wo2 = (await api(`/work-orders`, { method: "POST", body: JSON.stringify({ bomId: bom2.id, plannedQuantity: 2 }) })).json;
await setVirtual(F2, false);
await api(`/work-orders/${wo2.id}`, { method: "PATCH", body: JSON.stringify({ status: "In Progress" }) });
const f2b = await stockOf(F2);
const finish2 = await api(`/work-orders/${wo2.id}/finish`, { method: "POST", body: JSON.stringify({ quantity: 2 }) });
check("虛擬成品快照：完工不入庫", finish2.status === 200 && (await stockOf(F2)) === f2b, `before=${f2b} after=${await stockOf(F2)}`);

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
