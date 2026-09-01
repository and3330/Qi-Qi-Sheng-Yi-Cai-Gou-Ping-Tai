import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const chromePath = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
const password = process.env.GUIDE_ADMIN_PASSWORD;
if (!password) throw new Error("GUIDE_ADMIN_PASSWORD is required");

const outputDir = "artifacts/qiqi-system-guide/public/screens";
await mkdir(outputDir, { recursive: true });

const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--disable-gpu-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--remote-debugging-port=9223", "--window-size=1440,900", "about:blank",
], { stdio: ["ignore", "ignore", "inherit"] });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ready = false;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch("http://127.0.0.1:9223/json/list");
    if (r.ok) { ready = true; break; }
  } catch {}
  await sleep(250);
}
if (!ready) throw new Error("Chromium debugging endpoint did not start");

const tabs = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
let seq = 0;
const pending = new Map();
ws.addEventListener("message", async (event) => {
  const raw = typeof event.data === "string"
    ? event.data
    : Buffer.isBuffer(event.data)
      ? event.data.toString("utf8")
      : Buffer.from(await event.data.arrayBuffer()).toString("utf8");
  const msg = JSON.parse(raw);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
});
function cdp(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 8000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
  });
}

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Emulation.setDeviceMetricsOverride", {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
});

async function navigate(url, wait = 1800) {
  await cdp("Page.navigate", { url });
  await sleep(wait);
}
async function evaluate(expression) {
  return cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
}
async function shot(name) {
  await evaluate(`window.scrollTo(0,0); document.querySelectorAll('input[type=password]').forEach(e=>e.value='')`);
  await sleep(250);
  const result = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 82, captureBeyondViewport: false });
  await writeFile(`${outputDir}/${name}.jpg`, Buffer.from(result.data, "base64"));
}

const shopBase = "http://127.0.0.1:21059/qiqi-biomed";
await navigate(`${shopBase}/sign-in`);
await evaluate(`(() => {
  const inputs = document.querySelectorAll('input');
  const set = (el, value) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})); };
  set(inputs[0], 'admin'); set(inputs[1], ${JSON.stringify(password)});
  document.querySelector('button[type=submit]').click();
})()`);
await sleep(2200);

const shopRoutes = [
  ["shop-dashboard","/admin"],["shop-members","/admin/members"],["shop-products","/admin/products"],
  ["shop-orders","/admin/orders"],["shop-content","/admin/content"],["shop-support","/admin/support"],
  ["shop-ai-assistant","/admin/ai-assistant"],["shop-ai-cmo","/admin/ai-cmo"],
  ["shop-institutions","/admin/institutions"],["shop-social-accounts","/admin/social-accounts"],
  ["shop-social-posts","/admin/social-posts"],["shop-commissions","/admin/commissions"],
  ["shop-profit-sharing","/admin/profit-sharing"],["shop-institution-wallets","/admin/institution-wallets"],
  ["shop-wallets","/admin/wallets"],["shop-linktree","/admin/linktree"],
  ["shop-newsletter-domains","/admin/newsletter/domains"],
  ["shop-newsletter-subscribers","/admin/newsletter/subscribers"],
  ["shop-newsletter-campaigns","/admin/newsletter/campaigns"],
];
for (const [name, route] of shopRoutes) {
  await navigate(`${shopBase}${route}`, 1250);
  await shot(name);
}

const erpRoutes = [
  ["/","erp-dashboard"],["/calendar","erp-calendar"],["/inventory/items","erp-items"],
  ["/inventory/warehouses","erp-warehouses"],["/inventory/movements","erp-movements"],
  ["/inventory/transfers","erp-transfers"],["/sales/quotations","erp-quotations"],
  ["/sales/orders","erp-sales-orders"],["/sales/returns","erp-sales-returns"],
  ["/sales/price-lists","erp-price-lists"],["/purchasing/orders","erp-purchase-orders"],
  ["/purchasing/receiving","erp-receiving"],["/purchasing/returns","erp-purchase-returns"],
  ["/partners/customers","erp-customers"],["/partners/suppliers","erp-suppliers"],
  ["/accounting/accounts","erp-accounts"],["/accounting/journal","erp-journal"],
  ["/accounting/invoices","erp-invoices"],["/accounting/vouchers","erp-vouchers"],
  ["/accounting/payment-requests","erp-payment-requests"],["/accounting/bank-reconciliation","erp-bank"],
  ["/accounting/vat-report","erp-vat"],["/reports/financial","erp-financial"],
  ["/reports/aging","erp-aging"],["/reports/analysis","erp-analysis"],
  ["/hr/employees","erp-employees"],["/hr/attendance","erp-attendance"],["/hr/leaves","erp-leaves"],
  ["/hr/payroll","erp-payroll"],["/hr/settings","erp-hr-settings"],["/crm/leads","erp-leads"],
  ["/crm/opportunities","erp-opportunities"],["/crm/complaints","erp-complaints"],
  ["/crm/tickets","erp-tickets"],["/crm/knowledge-base","erp-kb"],["/projects/list","erp-projects"],
  ["/projects/tasks","erp-tasks"],["/projects/timesheets","erp-timesheets"],["/contracts/list","erp-contracts"],
  ["/assets/list","erp-assets"],["/assets/depreciation","erp-depreciation"],
  ["/manufacturing/boms","erp-boms"],["/manufacturing/work-orders","erp-work-orders"],
  ["/manufacturing/workstations","erp-workstations"],["/manufacturing/plans","erp-plans"],
  ["/quality/inspections","erp-inspections"],["/quality/nonconformances","erp-nonconformances"],
  ["/quality/settings","erp-quality-settings"],["/settings/users","erp-users"],
  ["/settings/permissions","erp-permissions"],["/settings/audit-logs","erp-audit"],
  ["/settings/company","erp-company"],["/settings/system","erp-system"],
];
const erpBase = "http://127.0.0.1:18996/erp";
for (const [route, name] of erpRoutes) {
  await navigate(`${erpBase}${route}`, 1100);
  await shot(name);
}

ws.close();
chrome.kill("SIGTERM");
console.log(`Captured ${shopRoutes.length + erpRoutes.length} screens.`);