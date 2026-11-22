/**
 * 品項圖片：沿用附件功能存檔，一個品項一張主圖。
 * 存成附件的 module = "Inventory"、documentType = "ItemImage"、documentId = 品項 id，
 * 所以不用改品項資料表。這個檔案只放不碰資料庫的判斷，方便測試。
 */

export const ITEM_IMAGE_MODULE = "Inventory";
export const ITEM_IMAGE_DOCUMENT_TYPE = "ItemImage";

/** 瀏覽器能直接顯示、又沒有腳本風險的圖片格式（SVG 不收） */
export const ITEM_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export const isItemImage = (documentType: unknown): boolean => documentType === ITEM_IMAGE_DOCUMENT_TYPE;

/** 上傳品項圖片前的檢查；沒問題回傳 null */
export function itemImageUploadError(mimeType: string | undefined, documentId: unknown): string | null {
  const id = Number(documentId);
  if (!Number.isInteger(id) || id <= 0) return "請先儲存品項，再上傳圖片";
  if (!ITEM_IMAGE_MIME_TYPES.includes(String(mimeType || "").toLowerCase())) return "品項圖片只接受 JPG、PNG、WebP、GIF";
  return null;
}

/**
 * 下載附件時要不要讓瀏覽器直接顯示（給 <img> 用）。
 * 只有明確要求、而且確定是安全的圖片格式才直接顯示；其他一律當下載，避免檔案在瀏覽器裡被當網頁執行。
 */
export function showInline(fileType: string | null | undefined, requested: unknown): boolean {
  return (requested === "1" || requested === "true") && ITEM_IMAGE_MIME_TYPES.includes(String(fileType || "").toLowerCase());
}
