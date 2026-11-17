// Integration test: 平台停用模組的伺服器端強制封鎖
// - 平台 super_admin 可列出租戶並更新模組設定（含基礎功能頁哨兵被剝除）
// - 被停用模組對應的 API 對該租戶回 403（module_disabled）
// - 共用前綴只在全部對應頁面停用時才擋；平台方 tenant 1 不受影響
// Run: node tests/module-disable.integration.mjs  (dev server must be running)
import { pool } from "@workspace/erp-db";
import { hashPassword } from "../src/lib/auth";

const BASE = process.env.API_BASE || "http://localhost:80/api";
const platformCode = process.env.TEST_COMPANY_CODE?.trim();
const tenantCode = process.env.TEST_TENANT_COMPANY_CODE?.trim();
if (!/^[0-9]{8}$/.test(platformCode || "") || !/^[0-9]{8}$/.test(tenantCode || "") || platformCode === tenantCode) {
  throw new Error("Explicit distinct TEST_COMPANY_CODE and TEST_TENANT_COMPANY_CODE are required");
}

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`PASS ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
}

function makeClient() {
  const jar = { cookie: "" };
  return async function api(path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", cookie: jar.cookie, ...(opts.headers || {}) },
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) jar.cookie = setCookie.split(";")[0];
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
  };
}

// ===== 準備測試資料：測試租戶 + 平台/租戶管理員 =====
const PW = "modtest-pw-1";
const hash = await hashPassword(PW);
const { rows: [{ id: TENANT }] } = await pool.query(
  `INSERT INTO tenants (name, company_code, status, is_exempt, ai_credits) VALUES ('__模組封鎖測試__',$1,'active',false,0) RETURNING id`, [tenantCode]);
await pool.query(`DELETE FROM admin_users WHERE username IN ('__modtest_t__','__modtest_p__')`);
await pool.query(
  `INSERT INTO admin_users (tenant_id, username, password_hash, display_name, role, is_active)
   VALUES ($1,'__modtest_t__',$2,'T','owner',true), (1,'__modtest_p__',$2,'P','super_admin',true)`, [TENANT, hash]);

try {
  const platform = makeClient();
  const tenant = makeClient();
  const pLogin = await platform(`/admin/login`, { method: "POST", body: JSON.stringify({ companyCode: platformCode, username: "__modtest_p__", password: PW }) });
  const tLogin = await tenant(`/admin/login`, { method: "POST", body: JSON.stringify({ companyCode: tenantCode, username: "__modtest_t__", password: PW }) });
  check("平台/租戶管理員登入", pLogin.status === 200 && tLogin.status === 200, `${pLogin.status}/${tLogin.status}`);

  // ===== 平台端：列出租戶 =====
  const list = await platform(`/platform/tenants`);
  check("GET /platform/tenants 回傳租戶清單", list.status === 200 && Array.isArray(list.json) && list.json.some((t) => t.id === TENANT), `status=${list.status}`);

  // ===== 平台端：停用模組（含共用前綴單頁、全部頁、與基礎功能頁哨兵） =====
  const overrides = {
    "/hr/leaves": ["__disabled__"],
    "/reports/inventory-status": ["__disabled__"],
    "/reports/bu": ["__disabled__"],
    "/sales/invoices": ["__disabled__"],           // /invoices 共用前綴：僅停用一頁
    "/assets/depreciation": ["__disabled__"],      // 共用前綴但有專屬操作端點
    "/sales/quick-entry": ["__disabled__"],        // 共用前綴但有專屬建單端點
    "/hr/clock-in": ["__disabled__"],              // 打卡操作端點（POST/PATCH /attendance）
    "/ai/assistant": ["__disabled__"],             // AI 各頁精準封鎖
    "/billing": ["__disabled__"],                  // 基礎功能頁：哨兵應被剝除
  };
  const put = await platform(`/platform/tenants/${TENANT}/modules`, { method: "PUT", body: JSON.stringify({ overrides }) });
  check("PUT /platform/tenants/:id/modules", put.status === 200, `status=${put.status}`);
  const mods = await platform(`/platform/tenants/${TENANT}/modules`);
  check("基礎功能頁 /billing 哨兵被剝除", !(mods.json?.["/billing"] || []).includes("__disabled__"), JSON.stringify(mods.json?.["/billing"]));
  check("/hr/leaves 哨兵已寫入", (mods.json?.["/hr/leaves"] || []).includes("__disabled__"));

  // 等待中介層快取過期（新租戶第一次請求才建快取，這裡直接請求即可）
  // ===== 租戶端：被停用模組的 API 回 403 =====
  const leaves = await tenant(`/leaves`);
  check("停用 /hr/leaves → GET /leaves 403", leaves.status === 403 && leaves.json?.code === "module_disabled", `status=${leaves.status}`);
  const inv1 = await tenant(`/reports/inventory`);
  const inv2 = await tenant(`/reports/inventory/warehouse-summary`);
  check("停用庫存狀況 → /reports/inventory 403", inv1.status === 403, `status=${inv1.status}`);
  check("停用庫存狀況 → /reports/inventory/warehouse-summary 403", inv2.status === 403, `status=${inv2.status}`);
  const bu = await tenant(`/reports/bu`);
  check("停用 BU 報表 → /reports/bu 403", bu.status === 403, `status=${bu.status}`);

  // 頁面專屬操作（共用前綴下的寫入端點）：單頁停用即擋
  const batchDep = await tenant(`/assets/batch-depreciate`, { method: "POST", body: JSON.stringify({}) });
  check("停用折舊排程 → POST /assets/batch-depreciate 403", batchDep.status === 403 && batchDep.json?.code === "module_disabled", `status=${batchDep.status}`);
  const depOne = await tenant(`/assets/1/depreciate`, { method: "POST", body: JSON.stringify({}) });
  check("停用折舊排程 → POST /assets/:id/depreciate 403", depOne.status === 403, `status=${depOne.status}`);
  const assetsList = await tenant(`/assets`);
  check("資產登記冊仍開放 → GET /assets 正常", assetsList.status === 200, `status=${assetsList.status}`);
  const quick = await tenant(`/create-sales-order`, { method: "POST", body: JSON.stringify({}) });
  check("停用快速下單 → POST /create-sales-order 403", quick.status === 403, `status=${quick.status}`);
  const soList = await tenant(`/sales-orders`);
  check("一般訂單頁仍開放 → GET /sales-orders 正常", soList.status === 200, `status=${soList.status}`);
  // 打卡頁停用 → 打卡寫入被擋、出勤讀取仍可
  const punchIn = await tenant(`/attendance`, { method: "POST", body: JSON.stringify({}) });
  check("停用打卡 → POST /attendance 403", punchIn.status === 403, `status=${punchIn.status}`);
  const punchOut = await tenant(`/attendance/1`, { method: "PATCH", body: JSON.stringify({}) });
  check("停用打卡 → PATCH /attendance/:id 403", punchOut.status === 403, `status=${punchOut.status}`);
  const attList = await tenant(`/attendance`);
  check("出勤管理仍開放 → GET /attendance 正常", attList.status === 200, `status=${attList.status}`);
  // AI 助理停用 → /ai/ask 被擋，其他 AI 頁端點不受影響
  const aiAsk = await tenant(`/ai/ask`, { method: "POST", body: JSON.stringify({ question: "hi" }) });
  check("停用 AI 助理 → POST /ai/ask 403", aiAsk.status === 403, `status=${aiAsk.status}`);
  const aiMonthly = await tenant(`/ai/monthly-report?year=2026&month=1`);
  check("AI 月報頁未停用 → /ai/monthly-report 非 403", aiMonthly.status !== 403, `status=${aiMonthly.status}`);

  // 共用前綴：只停用銷貨發票頁，/invoices 不應被擋（採購/會計發票仍開放）
  // （銷貨/採購/會計發票是同一模組資料的不同檢視、無專屬端點；仍開放的頁面本就能
  //   存取相同資料，故共用前綴僅在整組停用時才擋 —— 這是明確定義的停用語義）
  const invoices = await tenant(`/invoices`);
  check("共用前綴 /invoices 僅停一頁 → 不擋", invoices.status === 200, `status=${invoices.status}`);
  // 未停用模組不受影響
  const customers = await tenant(`/customers`);
  check("未停用模組 /customers 正常", customers.status === 200, `status=${customers.status}`);
  // 基礎功能不受影響
  const notif = await tenant(`/notifications`);
  check("基礎功能 /notifications 不擋", notif.status === 200, `status=${notif.status}`);

  // ===== 平台方 tenant 1 不受影響 =====
  const pLeaves = await platform(`/leaves`);
  check("tenant 1 不受停用影響（/leaves 非 403）", pLeaves.status !== 403, `status=${pLeaves.status}`);
} finally {
  // ===== 清理 =====
  await pool.query(`DELETE FROM menu_permissions WHERE tenant_id = $1`, [TENANT]);
  await pool.query(`DELETE FROM admin_users WHERE username IN ('__modtest_t__','__modtest_p__')`);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [TENANT]);
  await pool.end();
}

console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
process.exit(failures ? 1 : 0);
