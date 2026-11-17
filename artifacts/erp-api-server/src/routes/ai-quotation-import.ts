import { Router, type IRouter } from "express";
import { todayTaipei } from "../lib/inventory-journal";
import multer from "multer";
import { db, customersTable, projectsTable, itemsTable } from "@workspace/erp-db";
import { requireRole } from "../middleware/require-auth";
import { matchByName } from "./ai-assistant";
import { resolveAiProvider, temperatureParam } from "../lib/ai-provider";
import { aiFetch } from "../lib/ai-client";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.use("/ai", requireRole("owner", "admin", "accountant"));

// 供應商與模型由環境設定決定（見 lib/ai-provider.ts）
const { baseUrl: OPENAI_BASE, apiKey: OPENAI_KEY, model: AI_MODEL } = resolveAiProvider("vision");

const IMAGE_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);

const EXTRACT_PROMPT = `你是台灣 ERP 的報價單匯入助理。使用者上傳「自家公司開給客戶」的報價單，請萃取結構化資料。只回覆 JSON，格式嚴格如下：
{
  "quoteNumber": "報價單號（可空字串）",
  "quoteDate": "YYYY-MM-DD（建立日期，可空）",
  "validUntil": "YYYY-MM-DD（有效期限，可空）",
  "customer": {
    "name": "客戶公司名稱（「給客戶」的對象，不是開報價單的公司）",
    "contactPerson": "聯絡人姓名（去掉先生/女士等稱謂，可空）",
    "email": "可空",
    "phone": "可空",
    "taxId": "統編（可空）"
  },
  "projectName": "專案名稱／專案內容（可空）",
  "items": [
    { "name": "品項名稱", "qty": 1, "unit": "式", "unitPrice": 0, "amount": 0 }
  ],
  "subtotal": 0,
  "taxAmount": 0,
  "grandTotal": 0,
  "notes": "備註（可空）",
  "confidence": "high|medium|low"
}
規則：
- 分類標題（如「網站製作」「系統建置」等沒有數量與金額的列）不要當成品項
- 金額不要帶逗號或貨幣符號；找不到的數字填 0、文字填空字串
- 日期一律 YYYY-MM-DD
- 不可臆造文件中沒有的資料`;

async function callOpenAI(body: Record<string, unknown>): Promise<any> {
  const res = await aiFetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI 服務錯誤 (${res.status})：${t.slice(0, 200)}`);
  }
  const json: any = await res.json();
  const text = json.choices?.[0]?.message?.content || "";
  return JSON.parse(text);
}

router.post("/ai/quotation-import", upload.single("file"), async (req, res): Promise<void> => {
  if (!OPENAI_BASE || !OPENAI_KEY) { res.status(500).json({ error: "OpenAI integration not configured" }); return; }
  const file = req.file;
  if (!file) { res.status(400).json({ error: "請上傳報價單檔案（PDF 或圖片）" }); return; }

  const buf = file.buffer;
  const isPdf = buf.length > 4 && buf.toString("ascii", 0, 5) === "%PDF-";
  const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isWebp = buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
  const isHeif = buf.length > 12 && buf.toString("ascii", 4, 8) === "ftyp";
  const isImage = (isJpeg || isPng || isWebp || isHeif) && IMAGE_MIMES.has((file.mimetype || "").toLowerCase());

  if (!isPdf && !isImage) {
    res.status(400).json({ error: "只支援 PDF 或 JPG/PNG/WEBP/HEIC 圖片" }); return;
  }

  let extracted: any;
  try {
    if (isPdf) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      const pdfText = String(text || "").trim();
      if (pdfText.length < 20) {
        res.status(400).json({ error: "這份 PDF 沒有可讀取的文字（可能是掃描圖檔），請改上傳清晰的照片（JPG/PNG）" });
        return;
      }
      extracted = await callOpenAI({
        model: AI_MODEL,
        messages: [
          { role: "system", content: EXTRACT_PROMPT },
          { role: "user", content: `以下是報價單 PDF 的文字內容：\n\n${pdfText.slice(0, 12000)}` },
        ],
        response_format: { type: "json_object" },
        ...temperatureParam(AI_MODEL, 0),
        max_completion_tokens: 3000,
      });
    } else {
      const dataUrl = `data:${file.mimetype};base64,${buf.toString("base64")}`;
      extracted = await callOpenAI({
        model: AI_MODEL,
        messages: [
          { role: "system", content: EXTRACT_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "請萃取此報價單的結構化資料。" },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        ...temperatureParam(AI_MODEL, 0),
        max_completion_tokens: 3000,
      });
    }
  } catch (e: any) {
    (req as any).log?.error({ err: e.message }, "quotation import extraction failed");
    res.status(502).json({ error: "報價單辨識失敗：" + e.message }); return;
  }

  // 正規化
  const customerName = String(extracted?.customer?.name || "").trim();
  const rawItems = Array.isArray(extracted?.items) ? extracted.items : [];
  const items = rawItems.slice(0, 100).map((it: any) => ({
    name: String(it?.name || "").trim(),
    qty: Number(it?.qty) > 0 ? Number(it.qty) : 1,
    unit: String(it?.unit || "式").trim() || "式",
    unitPrice: Number(it?.unitPrice) >= 0 ? Number(it.unitPrice) : 0,
  })).filter((it: any) => it.name);
  if (!customerName || items.length === 0) {
    res.status(422).json({ error: "辨識結果不完整（缺少客戶名稱或品項），請確認檔案是報價單" }); return;
  }

  // 比對既有主檔
  const [customers, projects, dbItems] = await Promise.all([
    db.select({ id: customersTable.id, name: customersTable.name }).from(customersTable),
    db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable),
    db.select({ id: itemsTable.id, name: itemsTable.itemName, code: itemsTable.itemCode, unit: itemsTable.unit, sellingPrice: itemsTable.sellingPrice }).from(itemsTable),
  ]);
  const projectName = typeof extracted?.projectName === "string" ? extracted.projectName.trim() : "";
  const customer = matchByName(customerName, customers, x => x.name);
  const project = matchByName(projectName, projects, x => x.name);
  const resolvedItems = items.map((it: any) => {
    const found = matchByName(it.name, dbItems, x => x.name);
    return {
      ...it,
      itemId: found?.id ?? null,
      itemCode: found?.code ?? null,
      matchedItemName: found?.name ?? null,
    };
  });

  const dateOk = (s: any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
  const subtotal = resolvedItems.reduce((sum: number, it: any) => sum + it.qty * it.unitPrice, 0);
  const taxAmount = Number(extracted?.taxAmount) >= 0 ? Number(extracted.taxAmount) : 0;

  res.json({
    draft: {
      docType: "quotation" as const,
      source: "import",
      quoteNumber: String(extracted?.quoteNumber || "").trim() || undefined,
      customerName,
      customerId: customer?.id ?? null,
      matchedCustomerName: customer?.name ?? null,
      needsNewCustomer: !customer,
      newCustomer: {
        name: customerName,
        contactPerson: String(extracted?.customer?.contactPerson || "").trim() || undefined,
        email: String(extracted?.customer?.email || "").trim() || undefined,
        phone: String(extracted?.customer?.phone || "").trim() || undefined,
        taxId: String(extracted?.customer?.taxId || "").trim() || undefined,
      },
      projectName: projectName || undefined,
      projectId: project?.id ?? null,
      matchedProjectName: project?.name ?? null,
      date: dateOk(extracted?.quoteDate) || todayTaipei(),
      validUntil: dateOk(extracted?.validUntil),
      items: resolvedItems,
      subtotal,
      taxAmount,
      grandTotal: subtotal + taxAmount,
      notes: String(extracted?.notes || "").trim() || undefined,
      confidence: ["high", "medium", "low"].includes(extracted?.confidence) ? extracted.confidence : "medium",
      status: "Draft",
    },
    file: { name: file.originalname, size: file.size, type: isPdf ? "pdf" : "image" },
  });
});

export default router;
