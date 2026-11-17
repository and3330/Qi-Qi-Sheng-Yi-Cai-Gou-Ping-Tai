/**
 * AI 供應商與模型設定（集中一處）。
 *
 * 所有走 OpenAI 相容介面（/chat/completions）的 AI 功能都從這裡取得連線位址、金鑰與模型，
 * 換供應商或換模型只要改部署環境的設定，不用改程式：
 *
 *   ANTHROPIC_API_KEY      Claude（Anthropic）的金鑰。有設定就優先用 Claude，三級預設都是最便宜的 claude-haiku-5-5
 *   AI_PROVIDER            同時設定了好幾家時，用這個指定要用哪一家：anthropic｜atlas｜replit（可不設）
 *   AI_PROVIDER_BASE_URL   供應商的 OpenAI 相容位址，例如 AtlasCloud：https://api.atlascloud.ai/v1
 *   AI_PROVIDER_API_KEY    該供應商的金鑰（只放在 Secrets）
 *   AI_MODEL_STRONG        要求正確性的工作：把問題轉成 SQL、月報、異常偵測
 *   AI_MODEL_SMALL         簡單又頻繁的工作：對話意圖判斷、摘要、分類、文案、對帳建議
 *   AI_MODEL_VISION        要看圖或讀檔的工作：文件辨識、報價單匯入
 *
 * 沒有設定 ANTHROPIC_API_KEY 也沒有設定 AI_PROVIDER_* 時，沿用原本的 Replit AI 整合（AI_INTEGRATIONS_OPENAI_*）
 * 與原本的模型，所以這個檔案上線後行為不變，直到有人設定新的供應商為止。
 *
 * Claude 不是 OpenAI 相容介面：baseUrl 會是一個標記位址（ANTHROPIC_BASE），由 lib/ai-client.ts 的 aiFetch
 * 認出來後改用官方 SDK 呼叫。所以各功能一律用 aiFetch，不要直接用 fetch。
 */
export type AiTier = "strong" | "small" | "vision";

export interface AiProvider {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** anthropic＝Claude；custom＝AI_PROVIDER_*；replit＝原本的整合；none＝都沒設定 */
  source: "anthropic" | "custom" | "replit" | "none";
}

/** Claude 的標記位址：不是真的網址，aiFetch 看到這個開頭就改走 Claude 官方 SDK */
export const ANTHROPIC_BASE = "anthropic://messages";

/** 接 Claude 時各級預設的模型：全部用最便宜的 Haiku 5.5；覺得大腦不夠聰明，把 AI_MODEL_STRONG 改成 claude-sonnet-5-5 或 claude-opus-5-5 */
export const CLAUDE_DEFAULT_MODELS: Record<AiTier, string> = {
  strong: "claude-haiku-5-5",
  small: "claude-haiku-5-5",
  vision: "claude-haiku-5-5",
};

/**
 * 接上自訂供應商（AtlasCloud）時各級預設使用的模型；可用 AI_MODEL_* 覆寫。
 * 依 2026-11-11 的實測挑選（用本系統真正的提示詞跑 8 題查詢＋8 題意圖判斷）：
 * - gpt-5.6-luna：查詢 8/8 可執行、意圖 8/8、全部輸出合法 JSON，花費約為 gpt-6.1-sol 的九分之一
 * - gpt-6-luna：意圖 8/8、合法 JSON 16/16，是實測中總花費最低的
 * - 看圖的工作沒有實測；Google 的模型透過 Atlas 呼叫回錯誤，所以先用同樣支援圖片輸入的 gpt-5.6-luna
 */
export const CUSTOM_DEFAULT_MODELS: Record<AiTier, string> = {
  strong: "openai/gpt-5.6-luna",
  small: "openai/gpt-6-luna",
  vision: "openai/gpt-5.6-luna",
};

/** 原本 Replit 整合使用的模型 */
export const LEGACY_MODEL = "gpt-5.4-mini";

const TIER_ENV: Record<AiTier, string> = { strong: "AI_MODEL_STRONG", small: "AI_MODEL_SMALL", vision: "AI_MODEL_VISION" };
const clean = (value: string | undefined) => (value || "").trim();

export function resolveAiProvider(tier: AiTier, env: Record<string, string | undefined> = process.env): AiProvider {
  const override = clean(env[TIER_ENV[tier]]);
  const customBase = clean(env.AI_PROVIDER_BASE_URL).replace(/\/+$/, "");
  const customKey = clean(env.AI_PROVIDER_API_KEY);
  const forced = clean(env.AI_PROVIDER).toLowerCase();
  const anthropicKey = clean(env.ANTHROPIC_API_KEY);
  if (anthropicKey && (forced === "" || forced === "anthropic" || forced === "claude")) {
    // 只接受 claude- 開頭的模型名稱；之前留下來給別家用的覆寫（例如 openai/…）不會被送到 Claude
    const model = override.startsWith("claude-") ? override : CLAUDE_DEFAULT_MODELS[tier];
    return { baseUrl: `${ANTHROPIC_BASE}?tier=${tier}`, apiKey: anthropicKey, model, source: "anthropic" };
  }
  // 位址與金鑰要兩個都有才算設定完成；只設一半時不要把金鑰送到另一家，直接退回原本的整合
  if (customBase && customKey && forced !== "replit") {
    return { baseUrl: customBase, apiKey: customKey, model: override || CUSTOM_DEFAULT_MODELS[tier], source: "custom" };
  }
  const legacyBase = clean(env.AI_INTEGRATIONS_OPENAI_BASE_URL).replace(/\/+$/, "");
  const legacyKey = clean(env.AI_INTEGRATIONS_OPENAI_API_KEY);
  if (legacyBase && legacyKey) {
    // 模型名稱帶廠商前綴（例如 openai/…）是自訂供應商的寫法、claude- 開頭是 Claude 的，原本的整合都不認得，忽略這種覆寫
    const model = override && !override.includes("/") && !override.startsWith("claude-") ? override : LEGACY_MODEL;
    return { baseUrl: legacyBase, apiKey: legacyKey, model, source: "replit" };
  }
  return { baseUrl: "", apiKey: "", model: override || LEGACY_MODEL, source: "none" };
}

/**
 * 溫度參數。部分模型（實測：Atlas 上的 OpenAI GPT-5.6／GPT-6 系列；以及目前的 Claude 模型）只接受預設值，
 * 送出其他數值會整個請求失敗，所以這類模型不送這個參數。
 * 用法：JSON.stringify({ model, messages, ...temperatureParam(model, 0) })
 */
export function temperatureParam(model: string, temperature: number): { temperature?: number } {
  return /^(openai\/|claude-)/i.test(model) ? {} : { temperature };
}

/** 給管理畫面或健康檢查用：目前各級用的是哪個供應商、哪個模型（不含金鑰） */
export function describeAiProviders(env: Record<string, string | undefined> = process.env) {
  return (["strong", "small", "vision"] as const).map((tier) => {
    const provider = resolveAiProvider(tier, env);
    let host = "";
    try { host = provider.source === "anthropic" ? "api.anthropic.com" : provider.baseUrl ? new URL(provider.baseUrl).host : ""; } catch { host = "（位址格式不正確）"; }
    return { tier, source: provider.source, host, model: provider.model, configured: provider.source !== "none" };
  });
}
