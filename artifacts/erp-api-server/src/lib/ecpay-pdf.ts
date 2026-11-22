import puppeteer, { type Browser } from "puppeteer-core";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

let fontCss: string | undefined;
function printFontCss(): string {
  if (fontCss) return fontCss;
  const require = createRequire(import.meta.url);
  const cssPath = require.resolve("@fontsource/noto-sans-tc/400.css");
  fontCss = readFileSync(cssPath, "utf8").replace(
    /src: url\((\.\/files\/[^)]+\.woff2)\)[^;]+;/g,
    (_, file: string) => `src: url(data:font/woff2;base64,${readFileSync(path.resolve(path.dirname(cssPath), file)).toString("base64")}) format('woff2');`,
  ).replace(/unicode-range:([^;]+);/g, (_, ranges: string) => `unicode-range:${cjkOnly(ranges)};`);
  return fontCss;
}

/**
 * 內建字型只負責中文與全形符號：把英數字、拉丁字母的範圍拿掉（U+2000 以下），
 * 這樣內建字型可以排在最前面，英數字仍然落到綠界原本指定的字型，寬度與版面不變。
 * 整段都被拿掉時留一個不會用到的碼位，讓樣式保持合法。
 */
export function cjkOnly(ranges: string): string {
  const kept = ranges.split(",").map(range => range.trim()).filter(range => {
    const end = /^U\+[0-9a-f]+(?:-([0-9a-f]+))?$/i.exec(range);
    const last = parseInt(end?.[1] ?? range.slice(2), 16);
    return Number.isFinite(last) && last >= 0x2000;
  });
  return kept.length ? kept.join(",") : "U+10FFFF";
}

/**
 * 綠界的列印頁會在各個元素上自己指定字型，只對 body 設字型蓋不過去；
 * 主機上又沒有中文字型，中文就會印成方塊。
 * 這裡把內建的 Noto Sans TC 排在「每個元素」原本字型的最前面：
 * 內建字型只含中文（見 cjkOnly），所以中文一定用它，英數字維持綠界原本的字型與寬度。
 * （排在後面當備援不可靠：沒有中文字型的主機上仍然印成方塊，CI 重現過。）
 * 接完後主動把這頁用到的字載進來，再等字型就緒才輸出 PDF。
 */
export const APPLY_PRINT_FONT = `(async () => {
  for (const el of document.querySelectorAll("body, body *")) {
    const family = getComputedStyle(el).fontFamily || "sans-serif";
    if (!family.includes("Noto Sans TC")) el.style.setProperty("font-family", "'Noto Sans TC', " + family, "important");
  }
  const text = document.body.innerText;
  await Promise.all(["400", "700"].map(weight => document.fonts.load(weight + " 16px 'Noto Sans TC'", text)));
  await document.fonts.ready;
  await Promise.all(Array.from(document.images).map(image => image.decode()));
})()`;

// No caller-supplied HTML, cookies or URL. Each request gets an isolated browser.
export function isEcpayPrintUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".ecpay.com.tw") &&
      !url.username && !url.password && (!url.port || url.port === "443");
  } catch { return false; }
}

let active = 0;
export async function renderEcpayPdf(url: string, invoiceNumber: string): Promise<Buffer> {
  if (!isEcpayPrintUrl(url)) throw new Error("綠界列印網址無效");
  if (active >= 2) throw Object.assign(new Error("PDF 產生中，請稍後再試"), { status: 503 });
  active++;
  let browser: Browser | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath: (process.env.PATH || "").split(path.delimiter)
        .map(directory => path.join(directory, "chromium")).find(file => existsSync(file)) || "chromium",
      headless: true, timeout: 15_000,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"],
    });
    const runningBrowser = browser;
    const work = async () => {
      const page = await runningBrowser.newPage();
      page.setDefaultTimeout(20_000);
      // 內建字型是用 data: 塞進頁面的，不能被綠界頁面的內容安全政策擋掉（對外連線仍由下面的攔截把關）
      await page.setBypassCSP(true);
      await page.setRequestInterception(true);
      let failedResource = false;
      page.on("request", request => {
        const allowed = request.method() === "GET" &&
          (isEcpayPrintUrl(request.url()) || request.url().startsWith("data:"));
        void (allowed ? request.continue() : request.abort()).catch(() => {});
      });
      page.on("requestfailed", request => {
        if (["document", "image", "stylesheet", "font"].includes(request.resourceType())) failedResource = true;
      });
      page.on("response", response => {
        if (response.status() >= 400 && ["document", "image", "stylesheet", "font"].includes(response.request().resourceType())) failedResource = true;
      });
      await page.evaluateOnNewDocument("window.print = () => {};");
      const response = await page.goto(url, { waitUntil: "networkidle0", timeout: 20_000 });
      if (!response?.ok() || !isEcpayPrintUrl(page.url()) || failedResource) throw new Error("列印內容載入失敗");
      await page.addStyleTag({ content: printFontCss() });
      await page.evaluate(APPLY_PRINT_FONT);
      const text = String(await page.evaluate("document.body.innerText"));
      if (!text.includes("發票") || !text.replace(/[-\s]/g, "").includes(invoiceNumber)) throw new Error("綠界未回傳指定發票內容");
      const pdf = Buffer.from(await page.pdf({
        format: "A4", printBackground: true, preferCSSPageSize: true,
        margin: { top: "5mm", bottom: "5mm", left: "5mm", right: "5mm" },
        timeout: 15_000,
      }));
      if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("PDF 格式錯誤");
      return pdf;
    };
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("PDF 產生逾時")), 35_000);
      }),
    ]);
  } catch {
    // Do not expose signed print URLs or browser diagnostics in logs/responses.
    throw new Error("無法產生綠界發票 PDF，請稍後重試");
  } finally {
    if (timeout) clearTimeout(timeout);
    await browser?.close().catch(() => { browser?.process()?.kill("SIGKILL"); });
    active--;
  }
}
