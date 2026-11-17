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
      ...temperatureParam(AI_MODEL, 0.7),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

router.post("/ai/product-description", async (req, res): Promise<void> => {
  const itemId = req.body?.itemId ? Number(req.body.itemId) : null;
  let context: any = {
    item_name: String(req.body?.item_name || "").trim(),
    item_group: String(req.body?.item_group || "").trim(),
    specification: String(req.body?.specification || "").trim(),
    selling_price: req.body?.selling_price,
    key_features: Array.isArray(req.body?.key_features) ? req.body.key_features.slice(0, 10).map(String) : [],
    target_audience: String(req.body?.target_audience || "").trim(),
    tone: String(req.body?.tone || "professional").trim(),  // professional | friendly | playful | luxury
  };

  if (itemId) {
    try {
      const r = await pool.query(
        `SELECT id, item_code, item_name, item_group, specification, selling_price, summary, description FROM items WHERE id = $1`,
        [itemId]
      );
      if (r.rows.length === 0) { res.status(404).json({ error: "找不到商品" }); return; }
      const it = r.rows[0];
      context.item_name = context.item_name || it.item_name;
      context.item_group = context.item_group || it.item_group;
      context.specification = context.specification || it.specification;
      context.selling_price = context.selling_price ?? Number(it.selling_price);
      context.existing_summary = it.summary;
    } catch (e: any) {
      res.status(500).json({ error: "讀取商品失敗：" + e.message });
      return;
    }
  }

  if (!context.item_name) { res.status(400).json({ error: "請提供 item_name 或 itemId" }); return; }
  if (context.item_name.length > 200) { res.status(400).json({ error: "商品名稱過長" }); return; }

  const toneMap: Record<string, string> = {
    professional: "專業、可信、條理清晰",
    friendly: "親切、易懂、像朋友推薦",
    playful: "活潑、有趣、適合家長與兒童",
    luxury: "高端、精緻、強調品質與獨特性",
  };
  const toneDesc = toneMap[context.tone] || toneMap.professional;

  let parsed: any;
  try {
    const out = await chatJson([
      {
        role: "system",
        content: `你是一個資深行銷文案，幫教育產業公司寫商品/課程描述。風格：${toneDesc}。
只回 JSON：
{
  "short_description": "繁體中文 1 句（40 字內），抓住核心賣點",
  "long_description": "繁體中文 2-3 段（每段 60-100 字），完整介紹特色、適用對象、價值",
  "marketing_copy": "適合放在電商或 LINE 推播的行銷短文（80 字內），有 call-to-action",
  "social_post": "適合 FB/IG 的貼文（含 1-2 個 emoji 與 3-5 個 hashtag）",
  "seo_keywords": ["關鍵字1","關鍵字2","關鍵字3","關鍵字4","關鍵字5"],
  "feature_bullets": ["特色1","特色2","特色3","特色4"]
}`,
      },
      { role: "user", content: `商品資訊：\n${JSON.stringify(context, null, 2)}` },
    ]);
    parsed = JSON.parse(out);
  } catch (e: any) {
    (req as any).log?.error({ err: e.message }, "product description failed");
    res.status(502).json({ error: "AI 撰寫失敗：" + e.message });
    return;
  }

  // Optional: save back to items.description
  let updated = false;
  if (itemId && req.body?.saveToItem === true) {
    try {
      await pool.query(`UPDATE items SET description = $1, updated_at = NOW() WHERE id = $2`,
        [parsed.long_description, itemId]);
      updated = true;
    } catch (e: any) {
      (req as any).log?.warn({ err: e.message }, "save item description failed");
    }
  }

  res.json({ context, generated: parsed, savedToItem: updated });
});

router.get("/ai/product-description/items", async (req, res): Promise<void> => {
  const q = String(req.query.q || "").trim();
  try {
    const r = q
      ? await pool.query(
          `SELECT id, item_code, item_name, item_group, selling_price FROM items
           WHERE item_name ILIKE $1 OR item_code ILIKE $1 ORDER BY item_name LIMIT 30`,
          [`%${q}%`]
        )
      : await pool.query(
          `SELECT id, item_code, item_name, item_group, selling_price FROM items ORDER BY id DESC LIMIT 30`
        );
    res.json({ items: r.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
