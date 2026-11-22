import { describe, expect, it } from "vitest";
import { isItemImage, itemImageUploadError, showInline } from "./item-image";

describe("品項圖片", () => {
  it("只把 ItemImage 當品項圖片", () => {
    expect(isItemImage("ItemImage")).toBe(true);
    expect(isItemImage("Item")).toBe(false);
    expect(isItemImage(undefined)).toBe(false);
  });

  it("上傳前要有品項、而且是圖片", () => {
    expect(itemImageUploadError("image/jpeg", "12")).toBeNull();
    expect(itemImageUploadError("IMAGE/PNG", 3)).toBeNull();
    expect(itemImageUploadError("image/jpeg", "0")).toContain("先儲存品項");
    expect(itemImageUploadError("image/jpeg", undefined)).toContain("先儲存品項");
    expect(itemImageUploadError("application/pdf", 3)).toContain("只接受");
    expect(itemImageUploadError("image/svg+xml", 3)).toContain("只接受");
    expect(itemImageUploadError(undefined, 3)).toContain("只接受");
  });

  it("只有明確要求的安全圖片才直接顯示，其餘照舊當下載", () => {
    expect(showInline("image/png", "1")).toBe(true);
    expect(showInline("image/png", undefined)).toBe(false);
    expect(showInline("text/html", "1")).toBe(false);
    expect(showInline("image/svg+xml", "1")).toBe(false);
    expect(showInline(null, "1")).toBe(false);
  });
});
