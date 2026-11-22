import { afterEach, describe, expect, it, vi } from "vitest";
import puppeteer from "puppeteer-core";
import { extractText } from "unpdf";
import { cjkOnly, isEcpayPrintUrl, renderEcpayPdf } from "../ecpay-pdf";

afterEach(() => vi.restoreAllMocks());

describe("official invoice PDF", () => {
  it("rejects non-official URLs and credentials", async () => {
    for (const url of ["http://einvoice.ecpay.com.tw/a", "https://ecpay.com.tw.evil.test/a", "file:///etc/passwd", "https://localhost/a", "https://user:password@einvoice.ecpay.com.tw/a", "https://einvoice.ecpay.com.tw:8080/a"]) {
      expect(isEcpayPrintUrl(url)).toBe(false);
      await expect(renderEcpayPdf(url, "AB12345678")).rejects.toThrow();
    }
    expect(isEcpayPrintUrl("https://einvoice.ecpay.com.tw/a")).toBe(true);
  });

  it("keeps only CJK ranges in the bundled font so Latin text stays in the page's own font", () => {
    expect(cjkOnly("U+20-22,U+41-5d,U+3f,U+4e00-4e0f,U+ff01")).toBe("U+4e00-4e0f,U+ff01");
    expect(cjkOnly("U+0000-00FF,U+0131,U+2000-206F,U+FFFD")).toBe("U+2000-206F,U+FFFD");
    expect(cjkOnly("U+0000-00FF, U+0131")).toBe("U+10FFFF");
  });

  it("creates a real PDF with Chinese text using Chromium, without external requests", async () => {
    const launch = puppeteer.launch.bind(puppeteer);
    let closed = false;
    vi.spyOn(puppeteer, "launch").mockImplementation(async options => {
      // 本機沒有名為 chromium 的執行檔時，可用 TEST_CHROMIUM 指到 Chrome
      // 測試機冷啟動 Chromium 常超過正式用的 15 秒上限（CI 偶發失敗的原因），測試裡放寬啟動時間
      const browser = await launch({ ...options, timeout: 90_000, executablePath: process.env.TEST_CHROMIUM || options?.executablePath });
      const newPage = browser.newPage.bind(browser);
      vi.spyOn(browser, "newPage").mockImplementation(async () => {
        const page = await newPage();
        vi.spyOn(page, "goto").mockImplementation(async () => {
          await page.setContent("<html><head><style>h1, p, td { font-family: Arial; }</style></head><body><h1>電子發票證明聯</h1><p>AB-12345678</p><table><tr><td>買方 04165860</td></tr></table><p>含稅總額 35,420</p></body></html>");
          return { ok: () => true } as any;
        });
        vi.spyOn(page, "url").mockReturnValue("https://einvoice.ecpay.com.tw/fixture");
        return page;
      });
      browser.on("disconnected", () => { closed = true; });
      return browser;
    });
    const pdf = await renderEcpayPdf("https://einvoice.ecpay.com.tw/fixture", "AB12345678");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const result = await extractText(new Uint8Array(pdf), { mergePages: true });
    expect(result.text).toContain("電子發票證明聯");
    expect(result.text).toContain("35,420");
    // 綠界的頁面在元素上自己指定字型；中文必須落到內建的 Noto Sans TC，不能靠主機有沒有裝中文字型
    expect(pdf.toString("latin1")).toMatch(/Noto ?Sans ?TC/i);
    expect(closed).toBe(true);
  }, 150_000);
});
