import { Router, type IRouter } from "express";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import { objectStorageClient as gcs, objectStorageBucketId as bucketId, privateObjectDir as privateDir } from "../lib/object-storage";
import {
  db, attachmentsTable, vouchersTable, journalEntriesTable, activitiesTable,
  paymentRequestsTable, invoicesTable, suppliersTable, notificationsTable,
} from "@workspace/erp-db";
import { sql, inArray, eq, and } from "drizzle-orm";
import {
  EXPENSE_CATEGORIES,
  FALLBACK_CATEGORY,
  findCategoryByCode,
  categoriesForPrompt,
  type ExpenseCategory,
} from "../lib/expense-categories";
import { requireAuth, sessionEmployeeScope } from "../middleware/require-auth";
import { assertPeriodOpen, assertVatAccountsReady, resolveJournalLines } from "../lib/auto-journal";
import { departmentsTable, projectsTable } from "@workspace/erp-db";
import { createApprovalRequest } from "../utils/approval-helper";
import { resolveAiProvider, temperatureParam } from "../lib/ai-provider";
import { aiFetch } from "../lib/ai-client";
import { entrySummary, partyLineText } from "../lib/voucher-entry-text";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const router: IRouter = Router();
router.use("/reimbursement", requireAuth);


function gemini(): GoogleGenAI {
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("Gemini integration not configured");
  return new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
}

const geminiConfigured = (): boolean => !!(process.env.AI_INTEGRATIONS_GEMINI_BASE_URL && process.env.AI_INTEGRATIONS_GEMINI_API_KEY);

const RECEIPT_JSON_SHAPE = '{"merchant":"商家或開立公司名稱","tax_id":"賣方統一編號，沒有就空字串","invoice_number":"發票號碼","invoice_type":"三聯式／二聯式／電子發票／收據","date":"YYYY-MM-DD","currency":"TWD","subtotal_amount":0,"tax_amount":0,"total_amount":0,"items":[{"description":"品項","quantity":1,"unit_price":0,"amount":0}],"category_code":"分類 code","category_reason":"一句話","confidence":0.9,"notes":"","multi_receipt":false}';

/** 用 OpenAI 相容介面的看圖模型讀收據，回傳 JSON 文字 */
async function readReceiptWithVisionModel(prompt: string, files: Express.Multer.File[]): Promise<string> {
  const { baseUrl, apiKey, model } = resolveAiProvider("vision");
  if (!baseUrl || !apiKey) throw new Error("還沒有設定可以看圖的 AI 模型");
  if (files.some(f => /hei[cf]/i.test(f.mimetype || ""))) throw new Error("目前的看圖模型讀不了 HEIC 照片，請改用 JPG 或 PNG");
  const response = await aiFetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${prompt}\n\n只回覆一個 JSON 物件，欄位如下（看不到的數字填 0、看不到的文字填空字串，不要猜）：\n${RECEIPT_JSON_SHAPE}` },
        { role: "user", content: files.map(f => ({ type: "image_url", image_url: { url: `data:${f.mimetype || "image/jpeg"};base64,${f.buffer.toString("base64")}` } })) },
      ],
      ...temperatureParam(model, 0),
    }),
  });
  if (!response.ok) throw new Error("看圖的 AI 模型沒有成功回應");
  const json: any = await response.json();
  return String(json?.choices?.[0]?.message?.content || "");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, "_").slice(0, 200);
}

router.get("/reimbursement/categories", (_req, res) => {
  res.json(EXPENSE_CATEGORIES);
});

export interface ReimbursementLedgerMeta {
  voucherId: number;
  voucherNumber: string;
  voucherDescription: string;
  date: string;
  total: number;
  tax: number;
  categoryCode: string;
  invoiceNumber: string | null;
  supplierId: number;
  projectId: number | null;
  departmentId: number | null;
  items: Array<{ description: string; amount: number }>;
}

/**
 * 找出費用分類在「這家公司」科目表裡對應的科目：先比科目編號，再比科目名稱。
 * 找不到就中止，請使用者先補科目，不把費用記到別的科目去。
 */
export async function resolveCategoryAccount(tx: any, category: ExpenseCategory): Promise<{ id: number; accountNumber: string; accountName: string }> {
  const rows: Array<{ id: number; accountNumber: string; accountName: string }> = await tx.execute(sql`
    SELECT id, account_number AS "accountNumber", account_name AS "accountName"
    FROM accounts
    WHERE is_group = false AND (account_number = ${category.accountNumber} OR account_name = ${category.accountName})
    ORDER BY (account_number = ${category.accountNumber}) DESC, id
    LIMIT 1
  `).then((r: any) => r.rows ?? r);
  if (!rows[0]) throw new Error(`會計科目表缺少「${category.accountNumber} ${category.accountName}」（費用分類「${category.name}」要用），請先到會計科目建立`);
  return rows[0];
}

/** 建立報銷的 Posted 分錄與採購發票（直接過帳，或簽核通過時由審批路由呼叫） */
export async function postReimbursementLedger(tx: any, meta: ReimbursementLedgerMeta) {
  const category = findCategoryByCode(meta.categoryCode);
  const net = Math.round((meta.total - meta.tax) * 100) / 100;
  // 尾巴 -RB 是請款單的編號，總分類帳靠它顯示來源單號、點過去
  const entryNumber = `JE-${Date.now().toString().slice(-8)}-RB${meta.voucherId}`;
  // 過帳前守門：關帳期間禁止入帳；有稅額時必須已設定進/銷項稅額科目
  await assertPeriodOpen(tx, meta.date, "憑證一鍵入帳");
  if (meta.tax > 0) await assertVatAccountsReady(tx);
  // 費用科目用「科目編號」在這家公司自己的科目表裡找（每家公司的科目 id 都不一樣，不能寫死）；
  // 稅額與應付帳款透過 resolveJournalLines 解析成實際科目
  const expenseAccount = await resolveCategoryAccount(tx, category);
  // 摘要跟收付款單一樣：「店家｜品項摘要」，不再寫「憑證一鍵入帳 - 單號」
  const [supplier] = await tx.select({ name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, meta.supplierId));
  const summary = entrySummary(meta.items.map(i => i.description), meta.voucherDescription, category.name);
  const lineText = partyLineText(supplier?.name, summary, category.name);
  const lines = await resolveJournalLines(tx, [
    { accountId: expenseAccount.id, accountNumber: expenseAccount.accountNumber, accountName: expenseAccount.accountName, debit: net, credit: 0, description: lineText },
    ...(meta.tax > 0 ? [{ accountName: "進項稅額", debit: meta.tax, credit: 0, description: partyLineText(supplier?.name, `進項稅額${meta.invoiceNumber ? ` 發票 ${meta.invoiceNumber}` : ""}`, "進項稅額") }] : []),
    { accountName: "應付帳款", debit: 0, credit: meta.total, description: lineText },
  ]);
  // 進項稅額必須解析到實際科目，否則稅額會掉進未分類科目、營業稅報表抓不到
  const inputTaxLine = lines.find((l: any) => l.accountName === "進項稅額");
  if (meta.tax > 0 && !inputTaxLine?.accountId) {
    throw new Error("進項稅額科目尚未設定，請先在會計科目中建立「進項稅額」");
  }
  const [journalEntry] = await tx.insert(journalEntriesTable).values({
    entryNumber, entryDate: meta.date, description: summary,
    totalDebit: String(meta.total), totalCredit: String(meta.total), status: "Posted", lines,
    projectId: meta.projectId,
    departmentId: meta.departmentId,
  }).returning();
  // 建立採購發票，但不直接寫 paidAmount；日後付款申請轉為 Paid 時，
  // 由 invoice_settlements 與 recomputeInvoices 統一更新已付及未付金額。
  const [invoice] = await tx.insert(invoicesTable).values({
    invoiceNumber: `PINV-${meta.voucherNumber}`,
    invoiceType: "Purchase",
    supplierId: meta.supplierId,
    invoiceDate: meta.date,
    status: "Unpaid",
    totalAmount: String(meta.total),
    outstandingAmount: String(meta.total),
    taxType: "taxable",
    taxRate: "5",
    netAmount: String(net),
    taxAmount: String(meta.tax),
    govInvoiceNumber: meta.invoiceNumber,
    items: meta.items.map((it) => ({ ...it, categoryCode: category.code, accountNumber: category.accountNumber })),
  }).returning();
  return { journalEntry, invoice };
}

// 報銷表單用的精簡主檔（僅 id/name 等必要欄位，員工帳號也可安全使用）
router.get("/reimbursement/masters", async (_req, res): Promise<void> => {
  try {
    const [departments, projects, suppliers] = await Promise.all([
      db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable),
      db.select({ id: projectsTable.id, name: projectsTable.name, isActive: projectsTable.isActive }).from(projectsTable),
      db.select({ id: suppliersTable.id, name: suppliersTable.name, taxId: suppliersTable.taxId }).from(suppliersTable),
    ]);
    res.json({ departments, projects, suppliers });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

// 所有登入者（含員工自助帳號）都能報銷：建立的是 Draft 請款單 + Draft 付款申請，
// 後續仍需走簽核流程；員工帳號的「報銷人」強制綁定自己的員工資料。
router.post("/reimbursement/confirm", async (req, res): Promise<void> => {
  const body = req.body || {};
  const empScope = sessionEmployeeScope(req);
  if (empScope.isEmployee) {
    if (!empScope.employeeId) { res.status(403).json({ error: "您的帳號尚未綁定員工資料，請聯絡管理員" }); return; }
    body.employeeId = empScope.employeeId;
  }
  const total = Number(body.totalAmount);
  const tax = Number(body.taxAmount || 0);
  const category = findCategoryByCode(String(body.categoryCode || "19"));
  if (!Array.isArray(body.items) || body.items.length === 0) {
    res.status(400).json({ error: "請至少提供一筆費用明細" }); return;
  }
  const items = body.items.map((it: any) => ({
    description: String(it?.description || "").trim(),
    amount: Number(it?.amount),
  }));
  if (!Number.isFinite(total) || total <= 0) { res.status(400).json({ error: "金額必須大於 0" }); return; }
  if (!Number.isFinite(tax) || tax < 0 || tax > total) { res.status(400).json({ error: "稅額不正確" }); return; }
  if (items.some((it: any) => !it.description || !Number.isFinite(it.amount) || it.amount <= 0)) {
    res.status(400).json({ error: "每筆費用明細都必須有說明，且金額須為有限的正數" }); return;
  }
  const roundedTotal = Math.round(total * 100);
  const roundedItemSum = Math.round(items.reduce((sum: number, it: any) => sum + it.amount, 0) * 100);
  if (roundedItemSum !== roundedTotal) {
    res.status(400).json({
      error: `明細合計 NT$ ${(roundedItemSum / 100).toFixed(2)} 與總金額 NT$ ${(roundedTotal / 100).toFixed(2)} 不一致`,
    }); return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ""))) { res.status(400).json({ error: "日期格式不正確" }); return; }
  const supplierId = Number(body.supplierId);
  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    res.status(400).json({ error: "請選擇供應商，才能建立採購發票與付款申請" }); return;
  }
  const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.map(Number).filter(Number.isInteger) : [];
  const uploader = String((req as any).session?.user?.username || "API");

  // 只有會計相關角色（session 登入）可以「直接過帳」；
  // 其他登入者（員工自助、API key）走延後過帳：簽核通過時才建立分錄與發票。
  const sessionRole = String((req as any).session?.user?.role || "");
  const directPost = !((req as any).apiKeyAuth) &&
    ["owner", "admin", "accountant", "super_admin"].includes(sessionRole);

  try {
    await assertPeriodOpen(db, String(body.date), "報銷入帳");
    if (tax > 0) await assertVatAccountsReady(db);
    const result = await db.transaction(async tx => {
      const [supplier] = await tx.select({ id: suppliersTable.id, name: suppliersTable.name })
        .from(suppliersTable).where(eq(suppliersTable.id, supplierId));
      if (!supplier) throw new Error("供應商不存在");
      const [{ count }] = await tx.select({ count: sql<number>`COUNT(*)::int` }).from(vouchersTable);
      const voucherNumber = `RQ-${String((count || 0) + 1).padStart(5, "0")}`;
      const [voucher] = await tx.insert(vouchersTable).values({
        voucherNumber,
        voucherType: "Journal",
        voucherDate: body.date,
        description: String(body.description || `${body.merchant || "憑證"} / ${body.invoiceNumber || ""}`).trim(),
        totalAmount: String(total),
        status: "Draft",
        projectId: body.projectId ? Number(body.projectId) : null,
        departmentId: body.departmentId ? Number(body.departmentId) : null,
        employeeId: body.employeeId ? Number(body.employeeId) : null,
        items: items.map((it: any) => ({ ...it, categoryCode: category.code, accountNumber: category.accountNumber })),
      }).returning();

      let journalEntry: any = null;
      let invoice: any = null;
      if (directPost) {
        const posted = await postReimbursementLedger(tx, {
          voucherId: voucher.id,
          voucherNumber,
          voucherDescription: voucher.description || "",
          date: String(body.date),
          total, tax,
          categoryCode: category.code,
          invoiceNumber: body.invoiceNumber ? String(body.invoiceNumber).trim() : null,
          supplierId,
          projectId: body.projectId ? Number(body.projectId) : null,
          departmentId: body.departmentId ? Number(body.departmentId) : null,
          items,
        });
        journalEntry = posted.journalEntry;
        invoice = posted.invoice;
      }

      const [paymentRequest] = await tx.insert(paymentRequestsTable).values({
        requestNumber: `PRQ-AI-${voucher.id}`,
        invoiceId: invoice ? invoice.id : null,
        partyType: "Supplier",
        supplierId,
        requestDate: body.date,
        amount: String(total),
        status: "Draft",
        departmentId: body.departmentId ? Number(body.departmentId) : null,
        projectId: body.projectId ? Number(body.projectId) : null,
        remarks: `憑證一鍵入帳 ${voucherNumber} / ${supplier.name}`,
        metadata: directPost ? null : {
          aiReimbursement: true,
          voucherId: voucher.id,
          voucherNumber,
          voucherDescription: voucher.description || "",
          date: String(body.date),
          total, tax,
          categoryCode: category.code,
          invoiceNumber: body.invoiceNumber ? String(body.invoiceNumber).trim() : null,
          supplierId,
          projectId: body.projectId ? Number(body.projectId) : null,
          departmentId: body.departmentId ? Number(body.departmentId) : null,
          items,
        },
      }).returning();
      const sessionUser = (req as any).session?.user;
      const requestedBy = sessionUser?.username || sessionUser?.name || "API";
      await createApprovalRequest({
        module: "Accounting",
        documentType: "PaymentRequest",
        documentId: paymentRequest.id,
        documentNumber: paymentRequest.requestNumber,
        requestedBy,
      }, tx);
      await tx.insert(notificationsTable).values({
        title: "新付款申請",
        message: `${paymentRequest.requestNumber} - ${supplier.name} - $${total.toFixed(2)}`,
        type: "approval",
        module: "Accounting",
        documentType: "PaymentRequest",
        documentId: paymentRequest.id,
      });
      if (attachmentIds.length > 0) {
        await tx.update(attachmentsTable).set({
          documentType: "請款單", documentId: voucher.id,
          description: `${body.merchant || ""} / 請款單 ${voucherNumber}`,
        }).where(and(
          inArray(attachmentsTable.id, attachmentIds),
          eq(attachmentsTable.documentId, 0),
          eq(attachmentsTable.module, "accounting"),
          eq(attachmentsTable.uploadedBy, uploader), // 只能認領自己掃描上傳的附件
        ));
      }
      await tx.insert(activitiesTable).values({
        type: "create", title: "憑證一鍵入帳",
        description: `${voucherNumber} - ${voucher.description || category.name}`, module: "Accounting",
      });
      return { voucher, journalEntry, invoice, paymentRequest, pendingApproval: !directPost };
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: "憑證入帳失敗：" + (err.message || "Unknown error") });
  }
});

// 接收一張或多張發票照片 → 回傳結構化資料 + 可選擇直接存檔附件
router.post("/reimbursement/scan", upload.array("files", 10), async (req, res): Promise<void> => {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: "請至少上傳一張發票或收據照片" });
      return;
    }
    const allowedMimes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);
    for (const f of files) {
      if (!allowedMimes.has((f.mimetype || "").toLowerCase())) {
        res.status(400).json({ error: `不支援的檔案格式：${f.originalname}（${f.mimetype}）。請上傳 JPG／PNG／WEBP／HEIC 圖片。` });
        return;
      }
    }

    // 有設定 Gemini 就用原本的；沒有的話改用「看圖」那一級的模型（AI_MODEL_VISION，例如 Atlas 上的模型）
    const ai = geminiConfigured() ? gemini() : null;

    const prompt = `你是一位台灣會計助理，幫我看以下這張（或多張屬於同一筆報帳的）發票／收據／電子發票影本，識別下列資訊並輸出 JSON。

【可選的報帳分類，僅能從這 33 個 code 中擇一】
${categoriesForPrompt()}

判斷原則：
- 如完全看不懂或無法歸類，category_code 一律填 "19"（雜支）
- 金額一律是新台幣（TWD），數字不要帶逗號或貨幣符號
- 若是電子發票，發票號碼通常是「兩個英文字母 + 8 個數字」
- 日期請輸出 YYYY-MM-DD 格式
- 品項可整合成 1～8 個明細，不要逐字逐字
- 多張影本如果是同一筆報帳，items 合併在一起；若你判斷是不同報帳，請在 multi_receipt 標 true 並僅取第一張

請輸出符合 schema 的 JSON。`;

    const parts: any[] = [{ text: prompt }];
    for (const f of files) {
      parts.push({
        inlineData: {
          mimeType: f.mimetype || "image/jpeg",
          data: f.buffer.toString("base64"),
        },
      });
    }

    const result = !ai ? { text: await readReceiptWithVisionModel(prompt, files) } : await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["merchant", "category_code", "items", "total_amount"],
          properties: {
            merchant: { type: Type.STRING, description: "商家／開立公司名稱" },
            tax_id: { type: Type.STRING, description: "賣方統一編號（沒有就空字串）" },
            invoice_number: { type: Type.STRING, description: "發票號碼" },
            invoice_type: { type: Type.STRING, description: "三聯式／二聯式／電子發票／收據" },
            date: { type: Type.STRING, description: "YYYY-MM-DD" },
            currency: { type: Type.STRING },
            subtotal_amount: { type: Type.NUMBER, description: "未稅金額" },
            tax_amount: { type: Type.NUMBER },
            total_amount: { type: Type.NUMBER, description: "含稅總額" },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["description", "amount"],
                properties: {
                  description: { type: Type.STRING },
                  quantity: { type: Type.NUMBER },
                  unit_price: { type: Type.NUMBER },
                  amount: { type: Type.NUMBER },
                },
              },
            },
            category_code: { type: Type.STRING, description: "從提供的 33 個 code 擇一" },
            category_reason: { type: Type.STRING, description: "為何選此分類的一句話" },
            confidence: { type: Type.NUMBER, description: "0-1 的信心度" },
            notes: { type: Type.STRING },
            multi_receipt: { type: Type.BOOLEAN },
          },
        },
      },
    });

    const text = result.text ?? "";
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      res.status(502).json({ error: "AI 回應無法解析", raw: text });
      return;
    }

    const cat = findCategoryByCode(String(parsed.category_code ?? "19"));

    // 把照片存到 object storage 並建立 attachment（先掛 documentId=0，前端送出報帳單後再 patch）
    const savedAttachments: any[] = [];
    for (const f of files) {
      const objectPath = `${privateDir}/reimbursement/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeFilename(f.originalname || "receipt.jpg")}`;
      try {
        const bucket = gcs.bucket(bucketId);
        await bucket.file(objectPath).save(f.buffer, { contentType: f.mimetype });
      } catch (err: any) {
        // 即便儲存失敗也回傳 AI 結果，前端決定要不要再傳一次
        savedAttachments.push({ error: err?.message ?? String(err), fileName: f.originalname });
        continue;
      }

      const att = await db.transaction(async (tx) => {
        const now = new Date();
        const prefix = `FILE-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
        const [c] = await tx
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(attachmentsTable)
          .where(sql`"file_number" LIKE ${prefix + "%"}`);
        const seq = ((c?.count as number) || 0) + 1;
        const fNum = `${prefix}-${String(seq).padStart(4, "0")}`;
        const [row] = await tx
          .insert(attachmentsTable)
          .values({
            fileNumber: fNum,
            fileName: f.originalname || "receipt.jpg",
            fileType: f.mimetype || "image/jpeg",
            fileSize: f.size,
            filePath: objectPath,
            module: "accounting",
            documentType: "請款單",
            documentId: 0,
            uploadedBy: String((req as any).session?.user?.username || "API"),
            description: `AI 識別發票：${parsed.merchant ?? ""}`,
            tags: cat.code,
            status: "Active",
          })
          .returning();
        return row;
      });
      savedAttachments.push(att);
    }

    res.json({
      ok: true,
      parsed,
      category: cat,
      fallbackUsed: cat.code === FALLBACK_CATEGORY.code && parsed.category_code !== "19",
      attachments: savedAttachments,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

export default router;
