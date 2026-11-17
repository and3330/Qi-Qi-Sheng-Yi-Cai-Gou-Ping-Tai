import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, attachmentsTable } from "@workspace/erp-db";
import multer from "multer";
import { UploadRejectedError } from "../middleware/multer-error";
import { objectStorageClient as storage, objectStorageBucketId as bucketId, privateObjectDir as privateDir } from "../lib/object-storage";
import { requireAuth } from "../middleware/require-auth";

// 封鎖可執行 / 具腳本風險的副檔名，其餘文件、圖片類皆允許
const BLOCKED_EXTS = new Set([
  ".exe", ".dll", ".bat", ".cmd", ".com", ".msi", ".scr", ".ps1", ".sh",
  ".js", ".mjs", ".vbs", ".jar", ".html", ".htm", ".svg", ".php",
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
    if (BLOCKED_EXTS.has(ext)) cb(new UploadRejectedError("不允許上傳此類型的檔案"));
    else cb(null, true);
  },
});


function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, "_").slice(0, 200);
}

async function generateFileNumber(txDb: any): Promise<string> {
  const now = new Date();
  const prefix = `FILE-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [result] = await txDb
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(attachmentsTable)
    .where(sql`"file_number" LIKE ${prefix + "%"}`);
  const seq = (result?.count || 0) + 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

// 敏感模組的附件需要對應角色才能存取；其餘模組任何內部使用者皆可
const MODULE_ROLES: Record<string, string[]> = {
  HR: ["owner", "admin", "hr_admin"],
  Accounting: ["owner", "admin", "finance_admin", "accountant"],
};

function canAccessAttachmentModule(req: any, module: string | null | undefined): boolean {
  if (req.apiKeyAuth) return req.apiKey?.permissions === "admin"; // API key 需 admin 權限
  const u = req.session?.user;
  if (!u) return false;
  if (u.role === "super_admin") return true;
  if (u.role === "employee") return false; // 員工自助帳號不可存取附件
  const allowed = MODULE_ROLES[module || ""];
  return !allowed || allowed.includes(u.role);
}

const router: IRouter = Router();
router.use("/attachments", requireAuth);

router.get("/attachments", async (req, res): Promise<void> => {
  const conditions: any[] = [];
  if (req.query.module) conditions.push(eq(attachmentsTable.module, req.query.module as string));
  if (req.query.documentType) conditions.push(eq(attachmentsTable.documentType, req.query.documentType as string));
  if (req.query.documentId) conditions.push(eq(attachmentsTable.documentId, Number(req.query.documentId)));
  if (req.query.status) conditions.push(eq(attachmentsTable.status, req.query.status as string));
  if (req.query.search) {
    const q = `%${String(req.query.search)}%`;
    conditions.push(
      sql`(${attachmentsTable.fileName} ILIKE ${q} OR ${attachmentsTable.fileNumber} ILIKE ${q} OR ${attachmentsTable.description} ILIKE ${q} OR ${attachmentsTable.tags} ILIKE ${q})`
    );
  }

  const rows = await db.select().from(attachmentsTable).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(attachmentsTable.createdAt));
  // 依角色過濾掉無權限模組的附件
  res.json(rows.filter(r => canAccessAttachmentModule(req, r.module)));
});

router.post("/attachments", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const { module, documentType, documentId, uploadedBy, description, tags } = req.body;
  if (!module || !documentType) { res.status(400).json({ error: "Missing required fields: module, documentType" }); return; }
  if (!canAccessAttachmentModule(req, module)) {
    res.status(403).json({ error: "權限不足", message: "您沒有存取此模組附件的權限" }); return;
  }

  const objectPath = `${privateDir}/attachments/${Date.now()}-${sanitizeFilename(req.file.originalname)}`;

  try {
    const bucket = storage.bucket(bucketId);
    const file = bucket.file(objectPath);
    await file.save(req.file.buffer, { contentType: req.file.mimetype });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to upload file to storage: " + err.message }); return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const fileNumber = await generateFileNumber(tx);
      const [row] = await tx.insert(attachmentsTable).values({
        fileNumber,
        fileName: req.file!.originalname,
        fileType: req.file!.mimetype,
        fileSize: req.file!.size,
        filePath: objectPath,
        module,
        documentType,
        documentId: documentId ? Number(documentId) : 0,
        uploadedBy: uploadedBy || null,
        description: description || null,
        tags: tags || null,
        status: "Active",
      }).returning();
      return row;
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: "建立失敗: " + (err.message || "Unknown error") });
  }
});

router.patch("/attachments/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [existingRow] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, id));
  if (!existingRow) { res.status(404).json({ error: "Attachment not found" }); return; }
  if (!canAccessAttachmentModule(req, existingRow.module) || (req.body.module !== undefined && !canAccessAttachmentModule(req, req.body.module))) {
    res.status(403).json({ error: "權限不足", message: "您沒有存取此模組附件的權限" }); return;
  }

  const updateData: any = {};
  const allowedFields = ["fileName", "description", "tags", "status", "module", "documentType", "documentId"];
  if (req.body.documentId !== undefined) req.body.documentId = Number(req.body.documentId);
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updateData[field] = req.body[field];
  }

  const [updated] = await db.update(attachmentsTable).set(updateData).where(eq(attachmentsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Attachment not found" }); return; }
  res.json(updated);
});

router.get("/attachments/download/:id", async (req, res): Promise<void> => {
  const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, Number(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessAttachmentModule(req, row.module)) {
    res.status(403).json({ error: "權限不足", message: "您沒有存取此模組附件的權限" }); return;
  }

  const requestModule = req.query.module as string | undefined;
  const requestDocType = req.query.documentType as string | undefined;
  const requestDocId = req.query.documentId as string | undefined;
  if (requestModule && requestDocType && requestDocId) {
    if (requestModule !== row.module || requestDocType !== row.documentType || Number(requestDocId) !== row.documentId) {
      res.status(403).json({ error: "Unauthorized: context mismatch" }); return;
    }
  }

  try {
    const bucket = storage.bucket(bucketId);
    const file = bucket.file(row.filePath);
    const [exists] = await file.exists();
    if (!exists) { res.status(404).json({ error: "File not found in storage" }); return; }
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.fileName)}"`);
    res.setHeader("Content-Type", row.fileType || "application/octet-stream");
    const stream = file.createReadStream();
    stream.on("error", () => {
      if (!res.headersSent) res.status(502).json({ error: "檔案儲存讀取失敗" });
      else res.destroy();
    });
    stream.pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to download file: " + err.message });
  }
});

router.delete("/attachments/:id", async (req, res): Promise<void> => {
  const [existing] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, Number(req.params.id)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessAttachmentModule(req, existing.module)) {
    res.status(403).json({ error: "權限不足", message: "您沒有存取此模組附件的權限" }); return;
  }

  const [row] = await db.delete(attachmentsTable).where(eq(attachmentsTable.id, Number(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  try {
    const bucket = storage.bucket(bucketId);
    await bucket.file(row.filePath).delete();
  } catch {}
  res.sendStatus(204);
});

export default router;
