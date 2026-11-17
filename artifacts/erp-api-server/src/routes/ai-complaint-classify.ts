import { Router, type IRouter } from "express";
import { tenantPool as pool } from "../lib/tenant-db";
import { requireRole } from "../middleware/require-auth";
import { resolveAiProvider, temperatureParam } from "../lib/ai-provider";
import { aiFetch } from "../lib/ai-client";

const router: IRouter = Router();
router.use("/ai", requireRole("owner", "admin", "accountant", "manager"));

// 供應商與模型由環境設定決定（見 lib/ai-provider.ts）
const { baseUrl: OPENAI_BASE, apiKey: OPENAI_KEY, model: AI_MODEL } = resolveAiProvider("small");

async function chatJson(messages: { role: string; content: string }[]): Promise<string> {
  if (!OPENAI_BASE || !OPENAI_KEY) throw new Error("OpenAI integration not configured");
  const res = await aiFetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      response_format: { type: "json_object" },
      ...temperatureParam(AI_MODEL, 0),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

router.post("/ai/classify-complaint", async (req, res): Promise<void> => {
  const text = String(req.body?.text || "").trim();
  if (!text) { res.status(400).json({ error: "請輸入客訴內容" }); return; }
  if (text.length > 4000) { res.status(400).json({ error: "內容過長（上限 4000 字）" }); return; }

  // Load existing categories so AI can pick from real ones
  let categories: { id: number; name: string }[] = [];
  try {
    const r = await pool.query(`SELECT id, name FROM ticket_categories ORDER BY name`);
    categories = r.rows;
  } catch (e: any) {
    (req as any).log?.warn({ err: e.message }, "load categories failed");
  }

  const defaultCats = ["產品品質", "課程內容", "教師服務", "客服態度", "退費爭議", "排課問題", "場地設備", "金流付款", "系統技術", "建議回饋", "其他"];
  const catList = categories.length > 0 ? categories.map(c => c.name) : defaultCats;

  let parsed: any;
  try {
    const out = await chatJson([
      {
        role: "system",
        content: `你是一個資深客服主管。請分析客戶反映內容，回 JSON：
{
  "category": "從清單擇一：${catList.join("、")}",
  "severity": "low|medium|high|critical",
  "sentiment": "positive|neutral|negative|very_negative",
  "summary": "繁體中文 1 句摘要（30 字內）",
  "key_points": ["客訴重點1","重點2","重點3"],
  "suggested_action": "繁體中文建議處理方式（1-2 句）",
  "suggested_assignee_role": "客服|主管|教務|財務|技術|高層",
  "sla_hours": 4,
  "tags": ["標籤1","標籤2"],
  "priority": "Low|Medium|High|Urgent",
  "needs_immediate_attention": true|false
}

判斷規則：
- 涉及金錢/退費 → severity 至少 medium
- 涉及人身安全/重大投訴 → critical + needs_immediate_attention=true + sla_hours <= 2
- 一般詢問或建議 → low
- sla_hours：critical=2、high=8、medium=24、low=72`,
      },
      { role: "user", content: text },
    ]);
    parsed = JSON.parse(out);
  } catch (e: any) {
    (req as any).log?.error({ err: e.message }, "classify failed");
    res.status(502).json({ error: "AI 分類失敗：" + e.message });
    return;
  }

  // Optional: save as ticket
  let createdTicket: any = null;
  if (req.body?.saveAsTicket === true) {
    try {
      const cat = categories.find(c => c.name === parsed.category);
      const ticketNumber = `TKT-${Date.now()}`;
      const subject = parsed.summary || text.slice(0, 80);
      const r = await pool.query(
        `INSERT INTO support_tickets (ticket_number, subject, description, status, priority, category_id)
         VALUES ($1, $2, $3, 'Open', $4, $5) RETURNING id, ticket_number`,
        [ticketNumber, subject, text, parsed.priority || "Medium", cat?.id || null]
      );
      createdTicket = r.rows[0];
    } catch (e: any) {
      (req as any).log?.warn({ err: e.message }, "save ticket failed");
    }
  }

  res.json({ classification: parsed, createdTicket, availableCategories: catList });
});

export default router;
