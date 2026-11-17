// Integration test: 品項切換虛擬服務前的庫存/單據防呆（Task 65）
// - 有庫存的實體品項不可切換為虛擬服務（409）
// - 有未完成單據（銷售訂單、工單成品、工單物料）引用時不可切換（409）
// - 庫存為 0 且無未完成單據時可成功切換
// Run: node tests/item-virtual-switch.integration.mjs  (dev server must be running; TEST_ADMIN seeded externally)
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

const suffix = Date.now().toString().slice(-7);
const TODAY = new Date().toISOString().slice(0, 10);
const cleanup = { items: [], orders: [], stockEntries: [], workOrders: [], boms: [], customers: [] };

// --- setup: 實體品項 + 客戶 ---
const item = (await api(`/items`, { method: "POST", body: JSON.stringify({ itemCode: `PHYS-${suffix}`, itemName: `測試實體品項-${suffix}`, sellingPrice: 100 }) })).json;
check("建立實體品項", !!item?.id && item?.isVirtual === false, JSON.stringify(item));
cleanup.items.push(item.id);
const customer = (await api(`/customers`, { method: "POST", body: JSON.stringify({ name: `虛擬切換測試客戶-${suffix}` }) })).json;
check("建立測試客戶", !!customer?.id, JSON.stringify(customer));
cleanup.customers.push(customer.id);

// ===== 情境 1：庫存為 0、無單據 → 可切換，再切回 =====
{
  const r = await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ isVirtual: true }) });
  check("零庫存無單據可切換為虛擬", r.status === 200 && r.json?.isVirtual === true, `${r.status} ${JSON.stringify(r.json)}`);
  const back = await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ isVirtual: false }) });
  check("可切回實體", back.status === 200 && back.json?.isVirtual === false, `${back.status}`);
}

// ===== 情境 2：有庫存 → 409 =====
{
  let wh = (await api(`/warehouses`)).json?.[0];
  if (!wh?.id) wh = (await api(`/warehouses`, { method: "POST", body: JSON.stringify({ name: `測試倉-${suffix}` }) })).json;
  const se = (await api(`/stock-entries`, { method: "POST", body: JSON.stringify({ itemId: item.id, warehouseId: wh.id, entryType: "Receipt", quantity: 5, rate: 10 }) })).json;
  if (se?.id) cleanup.stockEntries.push(se.id);
  const cur = (await api(`/items/${item.id}`)).json;
  check("庫存已增加", Number(cur?.currentStock) > 0, JSON.stringify(cur?.currentStock));
  const r = await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ isVirtual: true }) });
  check("有庫存切換被擋 409", r.status === 409 && Array.isArray(r.json?.blockers) && r.json.blockers.some((b) => b.includes("庫存")), `${r.status} ${JSON.stringify(r.json)}`);
  // 清庫存（出庫）
  const out = (await api(`/stock-entries`, { method: "POST", body: JSON.stringify({ itemId: item.id, warehouseId: wh.id, entryType: "Issue", quantity: Number(cur.currentStock), rate: 10 }) })).json;
  if (out?.id) cleanup.stockEntries.push(out.id);
  const after = (await api(`/items/${item.id}`)).json;
  check("庫存已歸零", Number(after?.currentStock) === 0, JSON.stringify(after?.currentStock));
}

// ===== 情境 3：未完成銷售訂單引用 → 409；訂單取消後可切換 =====
{
  const order = (await api(`/sales-orders`, { method: "POST", body: JSON.stringify({ customerId: customer.id, orderDate: TODAY, items: [{ itemId: item.id, quantity: 1, rate: 100 }] }) })).json;
  check("建立草稿銷售訂單", !!order?.id, JSON.stringify(order));
  cleanup.orders.push(order.id);
  const r = await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ isVirtual: true }) });
  check("未完成銷售訂單引用被擋 409", r.status === 409 && r.json?.blockers?.some((b) => b.includes("銷售訂單")), `${r.status} ${JSON.stringify(r.json)}`);
  await api(`/sales-orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ status: "Cancelled" }) });
  const r2 = await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ isVirtual: true }) });
  check("訂單取消後可切換", r2.status === 200 && r2.json?.isVirtual === true, `${r2.status} ${JSON.stringify(r2.json)}`);
  await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ isVirtual: false }) });
}

// ===== 情境 4：工單成品 / 工單物料引用 → 409 =====
{
  // 成品品項與物料品項
  const outItem = (await api(`/items`, { method: "POST", body: JSON.stringify({ itemCode: `WOOUT-${suffix}`, itemName: `工單成品-${suffix}` }) })).json;
  cleanup.items.push(outItem.id);
  const bom = (await api(`/boms`, { method: "POST", body: JSON.stringify({ itemId: outItem.id, quantity: 1, items: [{ itemId: item.id, quantity: 1 }] }) })).json;
  if (bom?.id) cleanup.boms.push(bom.id);
  await api(`/boms/${bom.id}`, { method: "PATCH", body: JSON.stringify({ status: "Active" }) });
  const wo = (await api(`/work-orders`, { method: "POST", body: JSON.stringify({ bomId: bom?.id, plannedQuantity: 1 }) })).json;
  if (wo?.id) {
    cleanup.workOrders.push(wo.id);
    const rOut = await api(`/items/${outItem.id}`, { method: "PATCH", body: JSON.stringify({ isVirtual: true }) });
    check("工單成品引用被擋 409", rOut.status === 409 && rOut.json?.blockers?.some((b) => b.includes("工單")), `${rOut.status} ${JSON.stringify(rOut.json)}`);
    const rMat = await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ isVirtual: true }) });
    check("工單物料引用被擋 409", rMat.status === 409 && rMat.json?.blockers?.some((b) => b.includes("工單")), `${rMat.status} ${JSON.stringify(rMat.json)}`);
    // Draft → In Progress → Cancelled（狀態機限制）
    await api(`/work-orders/${wo.id}`, { method: "PATCH", body: JSON.stringify({ status: "In Progress" }) });
    await api(`/work-orders/${wo.id}`, { method: "PATCH", body: JSON.stringify({ status: "Cancelled" }) });
    const rAfter = await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ isVirtual: true }) });
    check("工單取消後物料可切換", rAfter.status === 200, `${rAfter.status} ${JSON.stringify(rAfter.json)}`);
    await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ isVirtual: false }) });
  } else {
    check("建立工單", false, JSON.stringify(wo));
  }
}

// --- cleanup ---
for (const id of cleanup.workOrders) await api(`/work-orders/${id}`, { method: "DELETE" });
for (const id of cleanup.boms) await api(`/boms/${id}`, { method: "DELETE" });
for (const id of cleanup.orders) await api(`/sales-orders/${id}`, { method: "DELETE" });
for (const id of cleanup.stockEntries) await api(`/stock-entries/${id}`, { method: "DELETE" });
for (const id of cleanup.items) await api(`/items/${id}`, { method: "DELETE" });
for (const id of cleanup.customers) await api(`/customers/${id}`, { method: "DELETE" });

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
