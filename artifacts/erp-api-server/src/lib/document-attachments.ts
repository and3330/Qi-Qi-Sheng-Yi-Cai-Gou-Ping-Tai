import type { Response } from "express";
import multer from "multer";
import { sql } from "drizzle-orm";
import { db, attachmentsTable } from "@workspace/erp-db";
import { UploadRejectedError } from "../middleware/multer-error";
import { objectStorageClient as storage, objectStorageBucketId as bucketId, privateObjectDir as privateDir } from "./object-storage";

/**
 * 單據附件（收據、發票照片）：員工在「我的申請」附上，審批的人在審批內容裡看。
 * 只收圖片與 PDF，單檔 10MB。檔案放在私有儲存區，只能透過有檢查權限的路由讀。
 */
const ALLOWED_TYPES = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf)$/;
export const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.test(file.mimetype)) cb(null, true);
    else cb(new UploadRejectedError("只能上傳照片或 PDF"));
  },
});

export const MAX_ATTACHMENTS_PER_DOCUMENT = 10;

export type AttachmentSummary = { id: number; fileName: string; fileType: string | null; fileSize: number | null; uploadedBy: string | null; createdAt: string };

const rowsOf = (result: any): any[] => (result?.rows ?? result) as any[];

/**
 * 一張單據的附件。付款申請另外帶上「AI 拍照報銷」掛在請款單（voucher）上的照片。
 * 查詢走一般連線（有租戶隔離），不會讀到別家公司的檔案。
 */
export async function documentAttachments(documentType: string, documentId: number, voucherId?: number | null): Promise<AttachmentSummary[]> {
  if (!documentId) return [];
  const rows = rowsOf(await db.execute(sql`
    SELECT id, file_name, file_type, file_size, uploaded_by, created_at FROM attachments
    WHERE status = 'Active' AND (
      (document_type = ${documentType} AND document_id = ${documentId})
      ${voucherId ? sql`OR (document_type = '請款單' AND document_id = ${voucherId})` : sql``}
    )
    ORDER BY id`));
  return rows.map(r => ({ id: Number(r.id), fileName: String(r.file_name), fileType: r.file_type ?? null, fileSize: r.file_size == null ? null : Number(r.file_size), uploadedBy: r.uploaded_by ?? null, createdAt: String(r.created_at) }));
}

const sanitizeFilename = (name: string): string => name.replace(/[^a-zA-Z0-9._\-一-鿿]/g, "_").slice(0, 200);

/** 存一個附件並掛到單據上 */
export async function saveDocumentAttachment(file: Express.Multer.File, opts: { module: string; documentType: string; documentId: number; uploadedBy: string; description?: string }) {
  const objectPath = `${privateDir}/attachments/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeFilename(file.originalname || "receipt.jpg")}`;
  await storage.bucket(bucketId).file(objectPath).save(file.buffer, { contentType: file.mimetype });
  return db.transaction(async (tx) => {
    const now = new Date();
    const prefix = `FILE-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [c] = await tx.select({ count: sql<number>`COUNT(*)::int` }).from(attachmentsTable).where(sql`"file_number" LIKE ${prefix + "%"}`);
    const [row] = await tx.insert(attachmentsTable).values({
      fileNumber: `${prefix}-${String(((c?.count as number) || 0) + 1).padStart(4, "0")}`,
      fileName: file.originalname || "receipt.jpg",
      fileType: file.mimetype,
      fileSize: file.size,
      filePath: objectPath,
      module: opts.module,
      documentType: opts.documentType,
      documentId: opts.documentId,
      uploadedBy: opts.uploadedBy,
      description: opts.description ?? null,
      status: "Active",
    }).returning();
    return row;
  });
}

/** 把附件送給瀏覽器：圖片與 PDF 直接在瀏覽器打開，其他的下載 */
export async function sendAttachment(res: Response, attachmentId: number): Promise<void> {
  const [row] = rowsOf(await db.execute(sql`SELECT file_name, file_type, file_path FROM attachments WHERE id = ${attachmentId}`));
  if (!row) { res.status(404).json({ error: "找不到這個附件" }); return; }
  try {
    const file = storage.bucket(bucketId).file(row.file_path);
    const [exists] = await file.exists();
    if (!exists) { res.status(404).json({ error: "檔案不見了，請重新上傳" }); return; }
    const inline = ALLOWED_TYPES.test(row.file_type || "");
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
    res.setHeader("Content-Type", row.file_type || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300");
    const stream = file.createReadStream();
    stream.on("error", () => { if (!res.headersSent) res.status(502).json({ error: "檔案讀取失敗" }); else res.destroy(); });
    stream.pipe(res);
  } catch {
    if (!res.headersSent) res.status(502).json({ error: "檔案讀取失敗" });
  }
}

/** 從儲存區刪掉一個附件（資料列與檔案） */
export async function removeAttachment(attachmentId: number): Promise<void> {
  const [row] = rowsOf(await db.execute(sql`DELETE FROM attachments WHERE id = ${attachmentId} RETURNING file_path`));
  if (row?.file_path) { try { await storage.bucket(bucketId).file(row.file_path).delete(); } catch { /* 檔案已不在，資料列已刪即可 */ } }
}
