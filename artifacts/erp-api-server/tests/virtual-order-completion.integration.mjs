// Integration test: 純虛擬服務銷貨單付款後自動標示完成（Task: 虛擬服務訂單收款完成）
// - 全部品項皆為虛擬服務的銷貨單不經出貨流程
// - 發票開立後，透過「收款單沖銷」或「付款申請付款」等 settlement 路徑收款完成時，訂單應自動變為 Completed
// - 直接 PATCH 發票 status=Paid 亦應觸發完成
// - 分批開票：僅部分發票收款不應完成；全部收款後才完成
// Run: node tests/virtual-order-completion.integration.mjs  (dev server must be running; TEST_ADMIN seeded externally)
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

// --- login (assumes TEST_ADMIN seeded externally) ---
const login = await api(`/admin/login`, { method: "POST", body: JSON.stringify({ companyCode: process.env.TEST_COMPANY_CODE, username: process.env.TEST_ADMIN_USER, password: process.env.TEST_ADMIN_PW }) });
if (login.status !== 200) { console.log("Login failed", login.status, JSON.stringify(login.json)); process.exit(1); }

const suffix = Date.now().toString().slice(-7);
const TODAY = new Date().toISOString().slice(0, 10);

// --- setup: 虛擬服務品項 + 測試客戶 ---
const item = (await api(`/items`, { method: "POST", body: JSON.stringify({ itemCode: `VSVC-${suffix}`, itemName: `測試虛擬服務-${suffix}`, isVirtual: true, sellingPrice: 1000 }) })).json;
check("建立虛擬服務品項", item?.id && item?.isVirtual === true, JSON.stringify(item));
const customer = (await api(`/customers`, { method: "POST", body: JSON.stringify({ name: `虛擬服務測試客戶-${suffix}` }) })).json;
check("建立測試客戶", !!customer?.id, JSON.stringify(customer));

async function orderStatus(id) {
  const { json } = await api(`/sales-orders/${id}`);
  return json?.status;
}
async function createVirtualOrder(qty, rate) {
  const { status, json } = await api(`/sales-orders`, {
    method: "POST",
    body: JSON.stringify({ customerId: customer.id, orderDate: TODAY, items: [{ itemId: item.id, quantity: qty, rate }] }),
  });
  check("建立純虛擬服務銷貨單", status === 201 || status === 200, JSON.stringify(json));
  return json;
}

const cleanup = { orders: [], invoices: [], vouchers: [], paymentRequests: [], stockEntries: [] };

// ===== 情境 1：收款單（voucher settlement）路徑 =====
{
  const order = await createVirtualOrder(1, 1000);
  cleanup.orders.push(order.id);
  const inv = (await api(`/sales-orders/${order.id}/invoices`, { method: "POST", body: JSON.stringify({}) })).json;
  cleanup.invoices.push(inv.id);
  check("S1 全額開立發票", Number(inv.totalAmount) === 1000, JSON.stringify(inv));
  check("S1 開票後訂單尚未完成", (await orderStatus(order.id)) !== "Completed");

  const voucher = (await api(`/vouchers`, {
    method: "POST",
    body: JSON.stringify({
      voucherType: "收款單", voucherDate: TODAY, customerId: customer.id,
      description: `虛擬服務收款測試-${suffix}`,
      items: [{ description: "收款", amount: 1000, invoiceId: inv.id }],
    }),
  })).json;
  cleanup.vouchers.push(voucher?.id);
  check("S1 建立收款單沖銷", !!voucher?.id, JSON.stringify(voucher));

  const invAfter = (await api(`/invoices/${inv.id}`)).json;
  check("S1 發票已收款 Paid", invAfter?.status === "Paid", JSON.stringify(invAfter));
  check("S1 收款後訂單自動完成", (await orderStatus(order.id)) === "Completed");
}

// ===== 情境 2：付款申請（payment request）路徑 =====
{
  const order = await createVirtualOrder(2, 500);
  cleanup.orders.push(order.id);
  const inv = (await api(`/sales-orders/${order.id}/invoices`, { method: "POST", body: JSON.stringify({}) })).json;
  cleanup.invoices.push(inv.id);

  const pr = (await api(`/payment-requests`, {
    method: "POST",
    body: JSON.stringify({ partyType: "Customer", customerId: customer.id, invoiceId: inv.id, requestDate: TODAY, amount: 1000 }),
  })).json;
  cleanup.paymentRequests.push(pr?.id);
  check("S2 建立付款申請", !!pr?.id, JSON.stringify(pr));
  // 走完狀態流程 → Paid
  for (const s of ["Pending", "Approved", "Paid"]) {
    const r = await api(`/payment-requests/${pr.id}`, { method: "PATCH", body: JSON.stringify({ status: s }) });
    check(`S2 付款申請轉 ${s}`, r.status === 200, JSON.stringify(r.json));
  }
  const invAfter = (await api(`/invoices/${inv.id}`)).json;
  check("S2 發票已收款 Paid", invAfter?.status === "Paid", JSON.stringify(invAfter));
  check("S2 付款後訂單自動完成", (await orderStatus(order.id)) === "Completed");
}

// ===== 情境 3：分批開票 — 部分收款不完成，全部收款才完成 =====
{
  const order = await createVirtualOrder(1, 2000);
  cleanup.orders.push(order.id);
  const inv1 = (await api(`/sales-orders/${order.id}/invoices`, {
    method: "POST",
    body: JSON.stringify({ items: [{ itemName: "虛擬服務-前期", quantity: 1, rate: 800 }] }),
  })).json;
  const inv2 = (await api(`/sales-orders/${order.id}/invoices`, {
    method: "POST",
    body: JSON.stringify({ items: [{ itemName: "虛擬服務-尾款", quantity: 1, rate: 1200 }] }),
  })).json;
  cleanup.invoices.push(inv1.id, inv2.id);
  check("S3 分批開立兩張發票", Number(inv1.totalAmount) === 800 && Number(inv2.totalAmount) === 1200, JSON.stringify({ inv1, inv2 }));

  const v1 = (await api(`/vouchers`, {
    method: "POST",
    body: JSON.stringify({ voucherType: "收款單", voucherDate: TODAY, customerId: customer.id, description: `分批收款1-${suffix}`, items: [{ description: "前期收款", amount: 800, invoiceId: inv1.id }] }),
  })).json;
  cleanup.vouchers.push(v1?.id);
  check("S3 僅收第一筆時訂單未完成", (await orderStatus(order.id)) !== "Completed");

  const v2 = (await api(`/vouchers`, {
    method: "POST",
    body: JSON.stringify({ voucherType: "收款單", voucherDate: TODAY, customerId: customer.id, description: `分批收款2-${suffix}`, items: [{ description: "尾款收款", amount: 1200, invoiceId: inv2.id }] }),
  })).json;
  cleanup.vouchers.push(v2?.id);
  check("S3 全部收款後訂單自動完成", (await orderStatus(order.id)) === "Completed");
}

// ===== 情境 4：直接 PATCH 發票 status=Paid 亦觸發完成 =====
{
  const order = await createVirtualOrder(1, 300);
  cleanup.orders.push(order.id);
  const inv = (await api(`/sales-orders/${order.id}/invoices`, { method: "POST", body: JSON.stringify({}) })).json;
  cleanup.invoices.push(inv.id);
  const r = await api(`/invoices/${inv.id}`, { method: "PATCH", body: JSON.stringify({ status: "Paid", paidAmount: 300 }) });
  check("S4 PATCH 發票為 Paid", r.status === 200, JSON.stringify(r.json));
  check("S4 訂單自動完成", (await orderStatus(order.id)) === "Completed");
}

// ===== 情境 5：實體商品訂單付清後「不會」被 settlement 路徑標完成（仍待出貨） =====
const physItem = (await api(`/items`, { method: "POST", body: JSON.stringify({ itemCode: `PHYS-${suffix}`, itemName: `測試實體商品-${suffix}`, isVirtual: false, sellingPrice: 500 }) })).json;
check("建立實體商品品項", physItem?.id && physItem?.isVirtual === false, JSON.stringify(physItem));
{
  const order = (await api(`/sales-orders`, {
    method: "POST",
    body: JSON.stringify({ customerId: customer.id, orderDate: TODAY, items: [{ itemId: physItem.id, quantity: 1, rate: 500 }] }),
  })).json;
  cleanup.orders.push(order.id);
  const inv = (await api(`/sales-orders/${order.id}/invoices`, { method: "POST", body: JSON.stringify({}) })).json;
  cleanup.invoices.push(inv.id);
  const v = (await api(`/vouchers`, {
    method: "POST",
    body: JSON.stringify({ voucherType: "收款單", voucherDate: TODAY, customerId: customer.id, description: `實體訂單收款-${suffix}`, items: [{ description: "收款", amount: 500, invoiceId: inv.id }] }),
  })).json;
  cleanup.vouchers.push(v?.id);
  const invAfter = (await api(`/invoices/${inv.id}`)).json;
  check("S5 實體訂單發票已收款 Paid", invAfter?.status === "Paid", JSON.stringify(invAfter));
  check("S5 實體訂單付清後仍不標完成（待出貨）", (await orderStatus(order.id)) !== "Completed");
}

// ===== 情境 6：混合訂單（實體 + 虛擬）付清後也不由收款路徑標完成 =====
{
  const order = (await api(`/sales-orders`, {
    method: "POST",
    body: JSON.stringify({ customerId: customer.id, orderDate: TODAY, items: [{ itemId: physItem.id, quantity: 1, rate: 500 }, { itemId: item.id, quantity: 1, rate: 500 }] }),
  })).json;
  cleanup.orders.push(order.id);
  const inv = (await api(`/sales-orders/${order.id}/invoices`, { method: "POST", body: JSON.stringify({}) })).json;
  cleanup.invoices.push(inv.id);
  const v = (await api(`/vouchers`, {
    method: "POST",
    body: JSON.stringify({ voucherType: "收款單", voucherDate: TODAY, customerId: customer.id, description: `混合訂單收款-${suffix}`, items: [{ description: "收款", amount: 1000, invoiceId: inv.id }] }),
  })).json;
  cleanup.vouchers.push(v?.id);
  const invAfter = (await api(`/invoices/${inv.id}`)).json;
  check("S6 混合訂單發票已收款 Paid", invAfter?.status === "Paid", JSON.stringify(invAfter));
  check("S6 混合訂單付清後不由收款路徑標完成", (await orderStatus(order.id)) !== "Completed");
}

// ===== 情境 7：刪除收款單 → 因收款而完成的訂單自動退回 =====
{
  const order = await createVirtualOrder(1, 600);
  cleanup.orders.push(order.id);
  const inv = (await api(`/sales-orders/${order.id}/invoices`, { method: "POST", body: JSON.stringify({}) })).json;
  cleanup.invoices.push(inv.id);
  const v = (await api(`/vouchers`, {
    method: "POST",
    body: JSON.stringify({ voucherType: "收款單", voucherDate: TODAY, customerId: customer.id, description: `回沖測試收款-${suffix}`, items: [{ description: "收款", amount: 600, invoiceId: inv.id }] }),
  })).json;
  check("S7 收款後訂單完成", (await orderStatus(order.id)) === "Completed");

  const del = await api(`/vouchers/${v.id}`, { method: "DELETE" });
  check("S7 刪除收款單成功", del.status === 204, JSON.stringify(del.json));
  const invAfter = (await api(`/invoices/${inv.id}`)).json;
  check("S7 發票退回 Unpaid", invAfter?.status === "Unpaid", JSON.stringify(invAfter));
  check("S7 訂單狀態自動退回（非 Completed）", (await orderStatus(order.id)) !== "Completed");
}

// ===== 情境 8：手動調降發票已付金額 → 訂單自動退回 =====
{
  const order = await createVirtualOrder(1, 900);
  cleanup.orders.push(order.id);
  const inv = (await api(`/sales-orders/${order.id}/invoices`, { method: "POST", body: JSON.stringify({}) })).json;
  cleanup.invoices.push(inv.id);
  const v = (await api(`/vouchers`, {
    method: "POST",
    body: JSON.stringify({ voucherType: "收款單", voucherDate: TODAY, customerId: customer.id, description: `調降測試收款-${suffix}`, items: [{ description: "收款", amount: 900, invoiceId: inv.id }] }),
  })).json;
  cleanup.vouchers.push(v?.id);
  check("S8 收款後訂單完成", (await orderStatus(order.id)) === "Completed");

  const patch = await api(`/invoices/${inv.id}`, { method: "PATCH", body: JSON.stringify({ paidAmount: 400 }) });
  check("S8 手動調降已付金額成功", patch.status === 200, JSON.stringify(patch.json));
  const invAfter = (await api(`/invoices/${inv.id}`)).json;
  check("S8 發票退回 Unpaid", invAfter?.status === "Unpaid", JSON.stringify(invAfter));
  check("S8 訂單狀態自動退回（非 Completed）", (await orderStatus(order.id)) !== "Completed");
}

// ===== 情境 9：由出貨覆蓋率完成的實體訂單，收款回沖不影響 Completed =====
{
  // 備妥庫存
  let wh = (await api(`/warehouses`)).json?.[0];
  if (!wh?.id) wh = (await api(`/warehouses`, { method: "POST", body: JSON.stringify({ name: `測試倉-${suffix}` }) })).json;
  const se = (await api(`/stock-entries`, { method: "POST", body: JSON.stringify({ itemId: physItem.id, warehouseId: wh.id, entryType: "Receipt", quantity: 3, rate: 100 }) })).json;

  const order = (await api(`/sales-orders`, {
    method: "POST",
    body: JSON.stringify({ customerId: customer.id, orderDate: TODAY, items: [{ itemId: physItem.id, quantity: 1, rate: 500 }] }),
  })).json;
  cleanup.orders.push(order.id);

  const dn = (await api(`/delivery-notes`, {
    method: "POST",
    body: JSON.stringify({ salesOrderId: order.id, customerId: customer.id, warehouseId: wh.id, deliveryDate: TODAY, items: [{ itemId: physItem.id, quantity: 1, rate: 500 }] }),
  })).json;
  const dnSubmit = await api(`/delivery-notes/${dn.id}`, { method: "PATCH", body: JSON.stringify({ status: "Submitted" }) });
  check("S9 出貨單提交成功", dnSubmit.status === 200, JSON.stringify(dnSubmit.json));
  check("S9 全量出貨後訂單完成", (await orderStatus(order.id)) === "Completed");

  const inv = (await api(`/sales-orders/${order.id}/invoices`, { method: "POST", body: JSON.stringify({}) })).json;
  cleanup.invoices.push(inv.id);
  const v = (await api(`/vouchers`, {
    method: "POST",
    body: JSON.stringify({ voucherType: "收款單", voucherDate: TODAY, customerId: customer.id, description: `出貨完成訂單收款-${suffix}`, items: [{ description: "收款", amount: Number(inv.totalAmount), invoiceId: inv.id }] }),
  })).json;
  const del = await api(`/vouchers/${v.id}`, { method: "DELETE" });
  check("S9 刪除收款單成功", del.status === 204, JSON.stringify(del.json));
  const invAfter = (await api(`/invoices/${inv.id}`)).json;
  check("S9 發票退回 Unpaid", invAfter?.status === "Unpaid", JSON.stringify(invAfter));
  check("S9 出貨完成的訂單不因收款回沖退回", (await orderStatus(order.id)) === "Completed", await orderStatus(order.id));
  if (se?.id) cleanup.stockEntries = [...(cleanup.stockEntries || []), se.id];
}

// --- cleanup（盡力而為；失敗不影響測試結果） ---
for (const id of cleanup.paymentRequests.filter(Boolean)) await api(`/payment-requests/${id}`, { method: "DELETE" });
for (const id of cleanup.vouchers.filter(Boolean)) await api(`/vouchers/${id}`, { method: "DELETE" });
for (const id of cleanup.invoices.filter(Boolean)) await api(`/invoices/${id}`, { method: "DELETE" });
for (const id of cleanup.orders.filter(Boolean)) await api(`/sales-orders/${id}`, { method: "DELETE" });
for (const id of (cleanup.stockEntries || []).filter(Boolean)) await api(`/stock-entries/${id}`, { method: "DELETE" });
await api(`/items/${item.id}`, { method: "DELETE" });
if (physItem?.id) await api(`/items/${physItem.id}`, { method: "DELETE" });
await api(`/customers/${customer.id}`, { method: "DELETE" });

console.log(failures === 0 ? "ALL TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
