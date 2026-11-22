/**
 * BI 顧問：只把伺服器端依使用者權限重新計算的指標送給 Gemini（不採信前端傳入的上下文）。
 * 未設定整合時直接回報不可用，不產生任何啟發式「建議」。
 */
import { GoogleGenAI } from "@google/genai";
import type { BiPage } from "./types";

export const BI_AI_MODEL = "gemini-3.5-flash-lite";

export function geminiConfigured(): boolean {
  return Boolean(process.env.AI_INTEGRATIONS_GEMINI_BASE_URL && process.env.AI_INTEGRATIONS_GEMINI_API_KEY);
}

const PAGE_LABEL: Record<BiPage, string> = {
  executive: "營運總覽",
  sales: "銷售與獲利",
  inventory: "庫存與供應鏈",
  hr: "人力成本與效能",
};

export function buildPrompt(page: BiPage, context: unknown, question: string): string {
  return [
    `你是協助台灣中小企業經營者解讀 ERP 報表的財務分析顧問。目前頁面：${PAGE_LABEL[page]}。`,
    "規則：",
    "1. 只能根據下方 JSON 中的數字回答；JSON 中 value 為 null 的指標代表資料不足，必須明說無法判斷並引用 reason，不可推測數值。",
    "2. 不得編造任何未出現在資料中的公司名稱、客戶、金額、百分比或日期。",
    "3. 引用金額使用新台幣千分位；比率以百分比表示，保留一位小數。",
    "4. 先給結論，再列出依據的指標，最後提出可執行的檢查步驟。使用繁體中文，不使用表情符號。",
    "5. 問題與經營數據無關時，簡短說明只能回答本頁數據相關問題。",
    "",
    "本頁指標（伺服器即時計算，JSON）：",
    JSON.stringify(context),
    "",
    `使用者問題：${question}`,
  ].join("\n");
}

export async function askGemini(prompt: string): Promise<string> {
  const ai = new GoogleGenAI({
    apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY!,
    httpOptions: { apiVersion: "", baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
  });
  const res = await ai.models.generateContent({
    model: BI_AI_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { maxOutputTokens: 8192, temperature: 0.2 },
  });
  const text = res.text?.trim();
  if (!text) throw new Error("模型未回傳內容");
  return text;
}

/** 縮減上下文：去掉過長清單，只留前 N 筆，降低 token 與洩漏面 */
export function compactContext(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = Array.isArray(v) ? v.slice(0, 15) : v;
  }
  return out;
}
