// Resumable authenticated screenshot capture for the system guide deck.
// Connects to an already-running headless Chromium on port 9224.
// Env: GUIDE_ADMIN_PASSWORD (required), FRESH_AFTER (ms epoch; files newer than this are skipped)
import { writeFile, mkdir, stat, readFile, appendFile } from "node:fs/promises";

const outputDir = "/home/runner/workspace/artifacts/qiqi-system-guide/public/screens";
await mkdir(outputDir, { recursive: true });
const FRESH_AFTER = Number(process.env.FRESH_AFTER || 0);
const pw = process.env.GUIDE_ADMIN_PASSWORD;
if (!pw) throw new Error("GUIDE_ADMIN_PASSWORD required");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SKIP = new Set();
try { (await readFile("/tmp/cap-skip.txt", "utf8")).split("\n").forEach((n) => n && SKIP.add(n)); } catch {}
async function failHard(name) {
  await appendFile("/tmp/cap-fail-count.txt", name + "\n");
  const c = (await readFile("/tmp/cap-fail-count.txt", "utf8")).split("\n").filter((x) => x === name).length;
  if (c >= 3) await appendFile("/tmp/cap-skip.txt", name + "\n");
  process.exit(2);
}

let ready = false;
for (let i = 0; i < 60; i++) {
  try { const r = await fetch("http://127.0.0.1:9224/json/list"); if (r.ok) { ready = true; break; } } catch {}
  await sleep(300);
}
if (!ready) throw new Error("no chromium on 9224");
const tabs = await (await fetch("http://127.0.0.1:9224/json/list")).json();
const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let seq = 0; const pending = new Map();
ws.addEventListener("message", async (ev) => {
  let raw = ev.data;
  if (typeof raw !== "string") raw = Buffer.from(await ev.data.arrayBuffer()).toString("utf8");
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const cdp = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  const t = setTimeout(() => rej(new Error("timeout " + method)), method === "Page.captureScreenshot" ? 45000 : 25000);
  pending.set(id, (m) => { clearTimeout(t); m.error ? rej(new Error(m.error.message)) : res(m.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
await cdp("Page.enable"); await cdp("Runtime.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const evaluate = (expression) => cdp("Runtime.evaluate", { expression, returnByValue: true });
async function nav(url, wait) { await cdp("Page.navigate", { url }); await sleep(wait); }
async function isFresh(p) { try { const st = await stat(p); return st.mtimeMs > FRESH_AFTER; } catch { return false; } }
async function shot(name) {
  const file = `${outputDir}/${name}.jpg`;
  if (await isFresh(file)) return;
  for (let a = 0; a < 3; a++) {
    const t = await evaluate("document.body.innerText.slice(0,300)");
    const text = t?.result?.value || "";
    if (!text.includes("Something went wrong") && !text.includes("hit an error")) break;
    await cdp("Page.reload", {}); await sleep(2200);
  }
  await evaluate("window.scrollTo(0,0);document.querySelectorAll('input[type=password]').forEach(e=>e.value='');(()=>{const st=document.createElement('style');st.textContent='*,*::before,*::after{animation:none!important;transition:none!important;}';document.head.appendChild(st);})()");
  await sleep(300);
  let data;
  try {
    const r = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 82, clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 }, captureBeyondViewport: false, optimizeForSpeed: true });
    data = r.data;
  } catch (err) {
    // Fallback: grab one screencast frame (works when captureScreenshot never resolves)
    data = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error("screencast timeout")); }, 30000);
      const onMsg = async (ev) => {
        let raw = ev.data;
        if (typeof raw !== "string") raw = Buffer.from(await ev.data.arrayBuffer()).toString("utf8");
        const m = JSON.parse(raw);
        if (m.method === "Page.screencastFrame") {
          cleanup();
          cdp("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
          cdp("Page.stopScreencast").catch(() => {});
          resolve(m.params.data);
        }
      };
      const cleanup = () => { clearTimeout(timer); ws.removeEventListener("message", onMsg); };
      ws.addEventListener("message", onMsg);
      cdp("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 }).catch((e) => { cleanup(); reject(e); });
    });
  }
  await writeFile(file, Buffer.from(data, "base64"));
  console.log("shot", name);
}

const shopBase = "http://127.0.0.1:80";
await nav(`${shopBase}/sign-in`, 2500);
await evaluate(`(()=>{const i=[document.querySelector('input[placeholder=\"請輸入帳號\"]'),document.querySelector('input[placeholder=\"請輸入密碼\"]')];const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;const set=(e,v)=>{s.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}))};set(i[0],'admin');set(i[1],${JSON.stringify(pw)});document.querySelector('button[type=submit]').click();})()`);
await sleep(2800);
const shopRoutes = [["shop-dashboard","/admin"],["shop-members","/admin/members"],["shop-products","/admin/products"],["shop-orders","/admin/orders"],["shop-content","/admin/content"],["shop-support","/admin/support"],["shop-ai-assistant","/admin/ai-assistant"],["shop-ai-cmo","/admin/ai-cmo"],["shop-institutions","/admin/institutions"],["shop-social-accounts","/admin/social-accounts"],["shop-social-posts","/admin/social-posts"],["shop-commissions","/admin/commissions"],["shop-profit-sharing","/admin/profit-sharing"],["shop-institution-wallets","/admin/institution-wallets"],["shop-wallets","/admin/wallets"],["shop-linktree","/admin/linktree"],["shop-newsletter-domains","/admin/newsletter/domains"],["shop-newsletter-subscribers","/admin/newsletter/subscribers"],["shop-newsletter-campaigns","/admin/newsletter/campaigns"]];
for (const [name, route] of shopRoutes) {
  if (SKIP.has(name)) continue;
  if (await isFresh(`${outputDir}/${name}.jpg`)) continue;
  await nav(`${shopBase}${route}`, 1400);
  try { await shot(name); } catch (e) { console.log("FAIL", name, e.message); await failHard(name); }
}
const erpRoutes = [["/","erp-dashboard"],["/calendar","erp-calendar"],["/inventory/items","erp-items"],["/inventory/warehouses","erp-warehouses"],["/inventory/movements","erp-movements"],["/inventory/transfers","erp-transfers"],["/sales/quotations","erp-quotations"],["/sales/orders","erp-sales-orders"],["/sales/returns","erp-sales-returns"],["/sales/price-lists","erp-price-lists"],["/purchasing/orders","erp-purchase-orders"],["/purchasing/receiving","erp-receiving"],["/purchasing/returns","erp-purchase-returns"],["/partners/customers","erp-customers"],["/partners/suppliers","erp-suppliers"],["/accounting/accounts","erp-accounts"],["/accounting/journal","erp-journal"],["/accounting/invoices","erp-invoices"],["/accounting/vouchers","erp-vouchers"],["/accounting/payment-requests","erp-payment-requests"],["/accounting/bank-reconciliation","erp-bank"],["/accounting/vat-report","erp-vat"],["/reports/financial","erp-financial"],["/reports/aging","erp-aging"],["/reports/analysis","erp-analysis"],["/hr/employees","erp-employees"],["/hr/attendance","erp-attendance"],["/hr/leaves","erp-leaves"],["/hr/payroll","erp-payroll"],["/hr/settings","erp-hr-settings"],["/crm/leads","erp-leads"],["/crm/opportunities","erp-opportunities"],["/crm/complaints","erp-complaints"],["/crm/tickets","erp-tickets"],["/crm/knowledge-base","erp-kb"],["/projects/list","erp-projects"],["/projects/tasks","erp-tasks"],["/projects/timesheets","erp-timesheets"],["/contracts/list","erp-contracts"],["/assets/list","erp-assets"],["/assets/depreciation","erp-depreciation"],["/manufacturing/boms","erp-boms"],["/manufacturing/work-orders","erp-work-orders"],["/manufacturing/workstations","erp-workstations"],["/manufacturing/plans","erp-plans"],["/quality/inspections","erp-inspections"],["/quality/nonconformances","erp-nonconformances"],["/quality/settings","erp-quality-settings"],["/settings/users","erp-users"],["/settings/permissions","erp-permissions"],["/settings/audit-logs","erp-audit"],["/settings/company","erp-company"],["/settings/system","erp-system"]];
const erpBase = "http://127.0.0.1:80/erp";
for (const [route, name] of erpRoutes) {
  if (SKIP.has(name)) continue;
  if (await isFresh(`${outputDir}/${name}.jpg`)) continue;
  await nav(`${erpBase}${route}`, 1250);
  try { await shot(name); } catch (e) { console.log("FAIL", name, e.message); await failHard(name); }
}
console.log("DONE");
ws.close();
