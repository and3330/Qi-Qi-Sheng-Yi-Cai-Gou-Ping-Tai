import type { ErrorRequestHandler } from "express";
import multer from "multer";

/** fileFilter 拒絕上傳時使用，multerErrorHandler 會回 400 */
export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

export const multerErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof UploadRejectedError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof multer.MulterError) {
    const map: Record<string, string> = {
      LIMIT_FILE_SIZE: "檔案過大（上限 15MB）",
      LIMIT_UNEXPECTED_FILE: "未預期的欄位",
    };
    res.status(400).json({ error: map[err.code] || `上傳失敗：${err.code}` });
    return;
  }
  next(err);
};
