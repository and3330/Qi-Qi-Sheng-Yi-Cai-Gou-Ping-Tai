import { Router, type IRouter } from "express";
import multer from "multer";
import { requireRole } from "../middleware/require-auth";
import { resolveAiProvider, temperatureParam } from "../lib/ai-provider";
import { aiFetch } from "../lib/ai-client";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.use("/ai", requireRole("owner", "admin", "accountant", "manager"));

// 供應商與模型由環境設定決定（見 lib/ai-provider.ts）
const { baseUrl: OPENAI_BASE, apiKey: OPENAI_KEY, model: AI_MODEL } = resolveAiProvider("vision");

const ALLOWED_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);

type DocType = "purchase_order" | "contract" | "quotation";

const PROMPTS: Record<DocType, { systemRole: string; jsonShape: string; }> = {
  purchase_order: {
    systemRole: "你是一個資深採購助理，從採購單照片中萃取結構化資料。",
    jsonShape: `{
  "doc_type": "採購單",
  "supplier_name": "供應商名稱",
  "supplier_tax_id": "統編（沒有就空字串）",
  "po_number": "採購單號",
  "order_date": "YYYY-MM-DD",
  "expected_delivery_date": "YYYY-MM-DD（沒有就空字串）",
  "currency": "TWD",
  "items": [
    { "item_name": "品名", "specification": "規格（可空）", "quantity": 1, "unit": "個", "unit_price": 0, "amount": 0 }
  ],
  "subtotal_amount": 0,
  "tax_amount": 0,
  "total_amount": 0,
  "payment_terms": "付款條件（沒有就空字串）",
  "notes": "備註（沒有就空字串）",
  "confidence": "high|medium|low"
}`,
  },
  contract: {
    systemRole: "你是一個資深法務助理，從合約照片中萃取關鍵條款。",
    jsonShape: `{
  "doc_type": "合約",
  "title": "合約標題",
  "party_a": "甲方名稱",
  "party_a_tax_id": "甲方統編（可空）",
  "party_b": "乙方名稱",
  "party_b_tax_id": "乙方統編（可空）",
  "contract_number": "合約編號（可空）",
  "sign_date": "YYYY-MM-DD（簽訂日期）",
  "effective_date": "YYYY-MM-DD（生效日）",
  "expiry_date": "YYYY-MM-DD（到期日）",
  "total_value": 0,
  "currency": "TWD",
  "payment_terms": "付款條件",
  "scope_of_work": "服務/工作範圍（一段文字摘要）",
  "key_obligations": ["關鍵義務1","關鍵義務2"],
  "termination_clause": "終止條款摘要（可空）",
  "penalty_clause": "違約罰則摘要（可空）",
  "notes": "其他重要備註（可空）",
  "confidence": "high|medium|low"
}`,
  },
  quotation: {
    systemRole: "你是一個資深業務助理，從報價單照片中萃取結構化資料。",
    jsonShape: `{
  "doc_type": "報價單",
  "vendor_name": "報價方",
  "vendor_tax_id": "統編（可空）",
  "quote_number": "報價單號",
  "quote_date": "YYYY-MM-DD",
  "valid_until": "YYYY-MM-DD（報價有效期）",
  "currency": "TWD",
  "items": [
    { "item_name": "品名", "specification": "規格（可空）", "quantity": 1, "unit": "個", "unit_price": 0, "amount": 0 }
  ],
  "subtotal_amount": 0,
  "tax_amount": 0,
  "total_amount": 0,
  "payment_terms": "付款條件（可空）",
  "delivery_terms": "交期條件（可空）",
  "notes": "備註（可空）",
  "confidence": "high|medium|low"
}`,
  },
};

router.post("/ai/document-ocr", upload.single("file"), async (req, res): Promise<void> => {
  if (!OPENAI_BASE || !OPENAI_KEY) {
    res.status(500).json({ error: "OpenAI integration not configured" }); return;
  }

  const docType = (req.body.docType || req.query.docType) as DocType;
  if (!docType || !PROMPTS[docType]) {
    res.status(400).json({ error: "請指定 docType: purchase_order | contract | quotation" }); return;
  }

  const file = req.file;
  if (!file) { res.status(400).json({ error: "請上傳檔案" }); return; }
  if (!ALLOWED_MIMES.has((file.mimetype || "").toLowerCase())) {
    res.status(400).json({ error: `不支援的格式：${file.mimetype}（請用 JPG/PNG/WEBP/HEIC）` }); return;
  }
  // Magic-byte check (defend against forged Content-Type)
  const buf = file.buffer;
  const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isWebp = buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
  const isHeif = buf.length > 12 && buf.toString("ascii", 4, 8) === "ftyp"; // heic/heif container
  if (!isJpeg && !isPng && !isWebp && !isHeif) {
    res.status(400).json({ error: "檔案內容與宣告格式不符（拒絕偽造圖片）" }); return;
  }

  const cfg = PROMPTS[docType];
  const b64 = file.buffer.toString("base64");
  const dataUrl = `data:${file.mimetype};base64,${b64}`;

  try {
    const upstream = await aiFetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content: `${cfg.systemRole}\n請只回 JSON，欄位結構如下：\n${cfg.jsonShape}\n\n規則：\n- 找不到的數字填 0，找不到的文字填空字串\n- 日期一律 YYYY-MM-DD；模糊或缺失填空字串\n- 金額不要帶逗號或貨幣符號\n- 如果照片不是該類型文件，confidence 給 "low" 並盡量填寫 doc_type`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: `請萃取此${cfg.jsonShape.includes("採購") ? "採購單" : cfg.jsonShape.includes("合約") ? "合約" : "報價單"}的結構化資料。` },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        ...temperatureParam(AI_MODEL, 0),
        max_completion_tokens: 2048,
      }),
    });

    if (!upstream.ok) {
      const t = await upstream.text().catch(() => "");
      (req as any).log?.error({ status: upstream.status, body: t.slice(0, 300) }, "OpenAI vision failed");
      res.status(502).json({ error: `AI 失敗 (${upstream.status})：${t.slice(0, 200)}` });
      return;
    }

    const json: any = await upstream.json();
    const text = json.choices?.[0]?.message?.content || "";
    let parsed: any;
    try { parsed = JSON.parse(text); }
    catch { res.status(502).json({ error: "AI 回傳非 JSON", raw: text.slice(0, 500) }); return; }

    res.json({
      docType,
      file: { name: file.originalname, mime: file.mimetype, size: file.size },
      data: parsed,
    });
  } catch (e: any) {
    (req as any).log?.error({ err: e.message }, "OCR failed");
    res.status(500).json({ error: "OCR 失敗：" + e.message });
  }
});

export default router;
