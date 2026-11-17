import { Router, type IRouter } from "express";
import { todayTaipei } from "../lib/inventory-journal";
import { db, pool, currentTenantClient, customersTable, projectsTable, itemsTable } from "@workspace/erp-db";
import { requireRole } from "../middleware/require-auth";
import { AI_SCHEMA_PROMPT, AI_FORBIDDEN_TABLES } from "../lib/ai-schema";
import { resolveAiProvider, temperatureParam } from "../lib/ai-provider";
import { aiFetch } from "../lib/ai-client";

const router: IRouter = Router();
router.use("/ai", requireRole("owner", "admin", "accountant"));

// 供應商與模型由環境設定決定（見 lib/ai-provider.ts）
const PROVIDERS = { strong: resolveAiProvider("strong"), small: resolveAiProvider("small") };
type ChatTier = keyof typeof PROVIDERS;

interface ChatMsg { role: "system" | "user" | "assistant"; content: string }

/** tier：strong 用於把問題轉成 SQL；small 用於意圖判斷這類簡單工作 */
export async function chatJson(messages: ChatMsg[], tier: ChatTier = "strong"): Promise<string> {
  const { baseUrl: OPENAI_BASE, apiKey: OPENAI_KEY, model: MODEL } = PROVIDERS[tier];
  if (!OPENAI_BASE || !OPENAI_KEY) throw new Error("OpenAI integration not configured");
  const res = await aiFetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
      ...temperatureParam(MODEL, 0),
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`);
  }
  const json: any = await res.json();
  return json.choices?.[0]?.message?.content || "";
}

async function chatText(messages: ChatMsg[]): Promise<string> {
  const { baseUrl: OPENAI_BASE, apiKey: OPENAI_KEY, model: MODEL } = PROVIDERS.small;
  if (!OPENAI_BASE || !OPENAI_KEY) throw new Error("OpenAI integration not configured");
  const res = await aiFetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, messages, ...temperatureParam(MODEL, 0.3) }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`);
  }
  const json: any = await res.json();
  return json.choices?.[0]?.message?.content || "";
}

// SQL 安全驗證：必須是純粹的 SELECT 語句
function validateSelectOnly(sql: string): { ok: true } | { ok: false; reason: string } {
  let s = sql.trim();
  if (s.endsWith(";")) s = s.slice(0, -1).trim();
  if (s.includes(";")) return { ok: false, reason: "不允許多個 SQL 敘述" };
  if (!/^(select|with)\s/i.test(s)) return { ok: false, reason: "只允許 SELECT / WITH 查詢" };

  const forbidden = [
    "insert", "update", "delete", "drop", "truncate", "alter", "create",
    "grant", "revoke", "copy", "call", "execute", "merge", "vacuum",
    "reindex", "comment", "lock", "do", "analyze", "checkpoint", "begin",
    "commit", "rollback", "savepoint", "set", "reset", "discard", "show",
    "listen", "notify", "unlisten", "load", "cluster", "refresh",
  ];
  const lc = s.toLowerCase();
  for (const kw of forbidden) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(lc)) return { ok: false, reason: `不允許關鍵字：${kw.toUpperCase()}` };
  }
  for (const t of AI_FORBIDDEN_TABLES) {
    const re = new RegExp(`\\b${t}\\b`, "i");
    if (re.test(lc)) return { ok: false, reason: `不允許查詢資料表：${t}` };
  }
  if (/\b(pg_catalog|pg_user|pg_shadow|pg_authid|pg_roles|information_schema)\b/i.test(s)) {
    return { ok: false, reason: "不允許查詢系統表" };
  }
  return { ok: true };
}

function enforceLimit(sql: string, max = 200): string {
  let s = sql.trim();
  if (s.endsWith(";")) s = s.slice(0, -1).trim();
  if (/\blimit\s+\d+\s*$/i.test(s)) {
    return s.replace(/\blimit\s+(\d+)\s*$/i, (_m, n) => `LIMIT ${Math.min(Number(n), max)}`);
  }
  return `${s} LIMIT ${max}`;
}

interface AskBody { question: string }

type DocumentProposal = {
  docType: "quotation" | "sales_order" | "delivery_note";
  customerName: string;
  items: Array<{ name: string; qty: number; unitPrice: number }>;
  projectName?: string;
  date?: string;
  notes?: string;
};

export function matchByName<T>(query: string | undefined, rows: T[], getName: (row: T) => string): T | undefined {
  const needle = (query || "").trim().toLocaleLowerCase();
  if (!needle) return undefined;
  const normalized = (s: string) => s.replace(/[\s()（）股份有限公司企業社]/g, "").toLocaleLowerCase();
  const distance = (a: string, b: string) => {
    const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let diagonal = previous[0];
      previous[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const above = previous[j];
        previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
        diagonal = above;
      }
    }
    return previous[b.length];
  };
  const n = normalized(needle);
  return rows
    .map(row => {
      const name = getName(row);
      const candidate = normalized(name);
      const editDistance = distance(candidate, n);
      const similarity = 1 - editDistance / Math.max(candidate.length, n.length, 1);
      const score = candidate === n ? 100
        : candidate.includes(n) || n.includes(candidate) ? 80 - Math.abs(candidate.length - n.length)
        : similarity >= 0.6 ? similarity * 60 : 0;
      return { row, score };
    })
    .sort((a, b) => b.score - a.score)
    .find(x => x.score > 0)?.row;
}

// AI 只產生提案並解析既有主檔；此端點絕不寫入任何資料。
router.post("/ai/document-draft", async (req, res): Promise<void> => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) { res.status(400).json({ error: "請輸入開單內容" }); return; }
  if (text.length > 1000) { res.status(400).json({ error: "內容太長（上限 1000 字）" }); return; }

  let proposal: DocumentProposal;
  try {
    const raw = await chatJson([
      {
        role: "system",
        content: `你是台灣 ERP 開單助理。只回覆 JSON，不可加入其他欄位或文字。

若使用者已提供「客戶名稱」與「至少一個品項及數量」，回覆：
{"docType":"quotation或sales_order或delivery_note","customerName":"客戶名稱","items":[{"name":"品項名稱","qty":數字,"unitPrice":數字}],"projectName":"可省略","date":"YYYY-MM-DD，可省略","notes":"可省略"}

若缺少必要資訊（客戶是誰、要哪些品項、各品項數量），不可臆造，改回覆：
{"needsClarification":true,"questions":["請問客戶是哪一位？","請問要出哪些商品、各幾個？"]}
questions 用繁體中文、一次列出所有還缺的問題（最多 4 題）。單價未提供不算缺（可填 0，系統會帶商品售價）。

規則：報價、報價單用 quotation；銷售訂單、訂單用 sales_order；出貨單、出貨、送貨用 delivery_note。付款方式、收件地址等補充資訊放進 notes。不可臆造未提及的客戶、專案、日期或價格；未提價格填 0；數量未提填 1。`,
      },
      { role: "user", content: text },
    ]);
    const value = JSON.parse(raw);
    if (value?.needsClarification === true && Array.isArray(value.questions) && value.questions.length > 0) {
      res.json({ clarify: { questions: value.questions.slice(0, 4).map((q: any) => String(q)) } });
      return;
    }
    if (!["quotation", "sales_order", "delivery_note"].includes(value?.docType)) throw new Error("無效的單據類型");
    if (typeof value.customerName !== "string") throw new Error("缺少客戶名稱");
    if (!Array.isArray(value.items) || value.items.length === 0) throw new Error("缺少品項");
    proposal = {
      docType: value.docType,
      customerName: value.customerName.trim(),
      items: value.items.slice(0, 50).map((it: any) => ({
        name: String(it?.name || "").trim(),
        qty: Number(it?.qty) > 0 ? Number(it.qty) : 1,
        unitPrice: Number(it?.unitPrice) >= 0 ? Number(it.unitPrice) : 0,
      })).filter((it: any) => it.name),
      projectName: typeof value.projectName === "string" ? value.projectName.trim() : undefined,
      date: typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? value.date : undefined,
      notes: typeof value.notes === "string" ? value.notes.trim() : undefined,
    };
    if (proposal.items.length === 0) throw new Error("缺少有效品項");
  } catch (e: any) {
    (req as any).log?.error({ err: e.message }, "AI document draft failed");
    res.status(502).json({ error: "AI 開單解析失敗：" + e.message }); return;
  }

  const [customers, projects, items] = await Promise.all([
    db.select({ id: customersTable.id, name: customersTable.name }).from(customersTable),
    db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable),
    db.select({ id: itemsTable.id, name: itemsTable.itemName, code: itemsTable.itemCode, unit: itemsTable.unit, sellingPrice: itemsTable.sellingPrice }).from(itemsTable),
  ]);
  const customer = matchByName(proposal.customerName, customers, x => x.name);
  const project = matchByName(proposal.projectName, projects, x => x.name);
  const resolvedItems = proposal.items.map(it => {
    const found = matchByName(it.name, items, x => x.name);
    return {
      ...it,
      itemId: found?.id ?? null,
      itemCode: found?.code ?? null,
      unit: found?.unit ?? "個",
      matchedItemName: found?.name ?? null,
      unitPrice: it.unitPrice || Number(found?.sellingPrice || 0),
    };
  });

  res.json({
    draft: {
      ...proposal,
      customerId: customer?.id ?? null,
      matchedCustomerName: customer?.name ?? null,
      needsNewCustomer: !customer,
      projectId: project?.id ?? null,
      matchedProjectName: project?.name ?? null,
      items: resolvedItems,
      date: proposal.date || todayTaipei(),
      status: "Draft",
    },
  });
});

// AI 只解析並比對既有客戶提出建檔草稿；此端點絕不寫入任何資料。
router.post("/ai/customer-draft", async (req, res): Promise<void> => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) { res.status(400).json({ error: "請輸入客戶資料" }); return; }
  if (text.length > 1000) { res.status(400).json({ error: "內容太長（上限 1000 字）" }); return; }

  let parsed: { name: string; contactPerson?: string; phone?: string; email?: string; taxId?: string; address?: string };
  try {
    const raw = await chatJson([
      {
        role: "system",
        content: `你是台灣 ERP 客戶建檔助理。只回覆 JSON，不可加入其他欄位或文字。

若使用者已提供客戶名稱，回覆（沒提到的欄位省略，不可臆造）：
{"name":"客戶名稱","contactPerson":"聯絡人","phone":"電話","email":"Email","taxId":"統一編號(8碼數字)","address":"地址"}

若連客戶名稱都沒有，回覆：
{"needsClarification":true,"questions":["請問客戶（公司或個人）的名稱是？"]}`,
      },
      { role: "user", content: text },
    ]);
    const value = JSON.parse(raw);
    if (value?.needsClarification === true && Array.isArray(value.questions) && value.questions.length > 0) {
      res.json({ clarify: { questions: value.questions.slice(0, 4).map((q: any) => String(q)) } });
      return;
    }
    if (typeof value?.name !== "string" || !value.name.trim()) throw new Error("缺少客戶名稱");
    const s = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    parsed = { name: value.name.trim(), contactPerson: s(value.contactPerson), phone: s(value.phone), email: s(value.email), taxId: s(value.taxId), address: s(value.address) };
  } catch (e: any) {
    (req as any).log?.error({ err: e.message }, "AI customer draft failed");
    res.status(502).json({ error: "AI 客戶資料解析失敗：" + e.message }); return;
  }

  const customers = await db.select({ id: customersTable.id, name: customersTable.name, taxId: customersTable.taxId }).from(customersTable);
  const byTaxId = parsed.taxId ? customers.find(c => String(c.taxId || "").trim() === parsed.taxId) : undefined;
  const byName = matchByName(parsed.name, customers, x => x.name);
  const duplicate = byTaxId || byName;

  res.json({
    customerDraft: {
      ...parsed,
      possibleDuplicate: duplicate ? { id: duplicate.id, name: duplicate.name, byTaxId: !!byTaxId } : null,
    },
  });
});

router.post("/ai/ask", async (req, res): Promise<void> => {
  const { question } = req.body as AskBody;
  if (!question || typeof question !== "string" || question.trim().length === 0) {
    res.status(400).json({ error: "請輸入問題" }); return;
  }
  if (question.length > 500) {
    res.status(400).json({ error: "問題太長（上限 500 字）" }); return;
  }

  // Step 1: AI 產生 SQL（JSON 模式）
  let sqlPlan: { sql: string; intent: string; chartType?: string };
  try {
    const planText = await chatJson([
      {
        role: "system",
        content: `你是一個 ERP 系統的 SQL 助理。請只回覆 JSON，欄位：
- intent: 一句中文描述你打算查什麼
- sql: 一條 SELECT 語句（PostgreSQL 方言、必須在最外層 LIMIT 200）
- chartType: 從 [table, bar, line, pie, none] 選一個（純清單用 table，趨勢用 line，分類比較用 bar，比例用 pie，單一數字用 none）

${AI_SCHEMA_PROMPT}`,
      },
      { role: "user", content: question },
    ]);
    sqlPlan = JSON.parse(planText);
  } catch (e: any) {
    (req as any).log?.error({ err: e.message }, "AI plan failed");
    res.status(502).json({ error: "AI 規劃失敗：" + e.message }); return;
  }

  if (!sqlPlan?.sql) {
    res.status(502).json({ error: "AI 沒有產生 SQL" }); return;
  }

  // Step 2: 驗證 SQL
  const check = validateSelectOnly(sqlPlan.sql);
  if (!check.ok) {
    res.status(400).json({ error: `SQL 安全檢查失敗：${check.reason}`, sql: sqlPlan.sql, intent: sqlPlan.intent });
    return;
  }
  const safeSql = enforceLimit(sqlPlan.sql);

  // Step 3: 唯讀交易執行（5 秒 timeout）；必須用租戶連線，RLS 才會隔離資料
  const tenantClient = currentTenantClient();
  const client = tenantClient ?? await pool.connect();
  let rows: any[] = [];
  let columns: string[] = [];
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const result = await client.query(safeSql);
    await client.query("COMMIT");
    rows = result.rows;
    columns = result.fields.map((f) => f.name);
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    (req as any).log?.warn({ err: e.message, sql: safeSql }, "AI SQL execution failed");
    res.status(400).json({ error: "查詢執行失敗：" + (e.message || "Unknown"), sql: safeSql, intent: sqlPlan.intent });
    return;
  } finally {
    if (!tenantClient) client.release();
  }

  // Step 4: AI 用中文摘要結果
  let summary = "";
  try {
    const sample = rows.slice(0, 30);
    summary = (await chatText([
      {
        role: "system",
        content: "你是一個 ERP 資料分析助理。請用 2-4 句繁體中文摘要查詢結果（金額用千分位、單位 NT$，不要重複欄位名）。如果結果是空的就說明沒有符合的資料。不要建議下一步、不要附上 SQL。",
      },
      {
        role: "user",
        content: `使用者問題：「${question}」
查詢意圖：${sqlPlan.intent}
共回傳 ${rows.length} 筆，欄位：${columns.join(", ")}
前 30 筆資料 JSON：
${JSON.stringify(sample, null, 2)}`,
      },
    ])).trim();
  } catch (e: any) {
    (req as any).log?.warn({ err: e.message }, "AI summary failed");
    summary = `共 ${rows.length} 筆資料。`;
  }

  res.json({
    question,
    intent: sqlPlan.intent,
    sql: safeSql,
    chartType: sqlPlan.chartType || "table",
    columns,
    rows,
    rowCount: rows.length,
    summary,
  });
});

export default router;
