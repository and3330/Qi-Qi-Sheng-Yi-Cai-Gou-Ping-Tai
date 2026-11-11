/**
 * AI 對答模型的供應商與模型設定（集中一處）。
 *
 * 所有文字對答（AI 助理、AI CMO、客服、社群文案）都從這裡取得連線位址、金鑰與模型，
 * 換供應商或換模型只要改部署環境的設定，不用改程式：
 *
 *   AI_PROVIDER_BASE_URL   供應商的 OpenAI 相容位址，例如 AtlasCloud：https://api.atlascloud.ai/v1
 *   AI_PROVIDER_API_KEY    該供應商的金鑰（只放在 Secrets）
 *   AI_MODEL_STRONG        需要正確性與工具呼叫的工作：AI 助理、AI CMO、客服
 *   AI_MODEL_SMALL         簡單又頻繁的工作：摘要、分類、文案
 *
 * 沒有設定 AI_PROVIDER_* 時，沿用原本的 Replit AI 整合（AI_INTEGRATIONS_OPENAI_*）與原本的模型，
 * 所以這個檔案上線後行為不變，直到有人設定新的供應商為止。
 * 圖片生成與語音仍走原本的整合，不受這裡影響。
 */
export type AiTier = "strong" | "small";

export interface AiProvider {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** custom＝AI_PROVIDER_*；replit＝原本的整合；none＝都沒設定 */
  source: "custom" | "replit" | "none";
}

/** 接上自訂供應商（AtlasCloud）時各級預設使用的模型；可用 AI_MODEL_* 覆寫 */
export const CUSTOM_DEFAULT_MODELS: Record<AiTier, string> = {
  strong: "openai/gpt-5.6-luna",
  small: "openai/gpt-6-luna",
};

/** 原本 Replit 整合使用的模型 */
export const LEGACY_MODEL = "gpt-5.6-terra";

const TIER_ENV: Record<AiTier, string> = {
  strong: "AI_MODEL_STRONG",
  small: "AI_MODEL_SMALL",
};
const clean = (value: string | undefined) => (value || "").trim();

export function resolveAiProvider(
  tier: AiTier,
  env: Record<string, string | undefined> = process.env,
): AiProvider {
  const override = clean(env[TIER_ENV[tier]]);
  const customBase = clean(env.AI_PROVIDER_BASE_URL).replace(/\/+$/, "");
  const customKey = clean(env.AI_PROVIDER_API_KEY);
  // 位址與金鑰要兩個都有才算設定完成；只設一半時不要把金鑰送到另一家，直接退回原本的整合
  if (customBase && customKey) {
    return {
      baseUrl: customBase,
      apiKey: customKey,
      model: override || CUSTOM_DEFAULT_MODELS[tier],
      source: "custom",
    };
  }
  const legacyBase = clean(env.AI_INTEGRATIONS_OPENAI_BASE_URL).replace(/\/+$/, "");
  const legacyKey = clean(env.AI_INTEGRATIONS_OPENAI_API_KEY);
  if (legacyBase && legacyKey) {
    // 模型名稱帶廠商前綴（例如 openai/…）是自訂供應商的寫法，原本的整合不認得，忽略這種覆寫
    const model = override && !override.includes("/") ? override : LEGACY_MODEL;
    return { baseUrl: legacyBase, apiKey: legacyKey, model, source: "replit" };
  }
  return { baseUrl: "", apiKey: "", model: override || LEGACY_MODEL, source: "none" };
}

/** 文字對答要用的模型名稱 */
export function chatModel(tier: AiTier = "strong"): string {
  return resolveAiProvider(tier).model;
}

/** 給管理畫面或健康檢查用：目前用的是哪個供應商、哪個模型（不含金鑰） */
export function describeAiProviders(env: Record<string, string | undefined> = process.env) {
  return (["strong", "small"] as const).map((tier) => {
    const provider = resolveAiProvider(tier, env);
    let host = "";
    try {
      host = provider.baseUrl ? new URL(provider.baseUrl).host : "";
    } catch {
      host = "（位址格式不正確）";
    }
    return {
      tier,
      source: provider.source,
      host,
      model: provider.model,
      configured: provider.source !== "none",
    };
  });
}
