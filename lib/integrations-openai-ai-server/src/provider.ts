/**
 * AI 對答模型的供應商與模型設定（集中一處）。
 *
 * 所有文字對答（AI 助理、AI CMO、客服、社群文案）都從這裡取得連線位址、金鑰與模型，
 * 換供應商或換模型只要改部署環境的設定，不用改程式：
 *
 *   ANTHROPIC_API_KEY      Claude（Anthropic）的金鑰。有設定就優先用 Claude，預設模型是最便宜的 claude-haiku-5-5
 *   AI_PROVIDER            同時設定了好幾家時，用這個指定要用哪一家：anthropic｜atlas｜replit（可不設）
 *   AI_PROVIDER_BASE_URL   供應商的 OpenAI 相容位址，例如 AtlasCloud：https://api.atlascloud.ai/v1
 *   AI_PROVIDER_API_KEY    該供應商的金鑰（只放在 Secrets）
 *   AI_MODEL_STRONG        需要正確性與工具呼叫的工作：AI 助理、AI CMO、客服
 *   AI_MODEL_SMALL         簡單又頻繁的工作：摘要、分類、文案
 *
 * 這幾個設定的名稱與規則跟 ERP 後端（artifacts/erp-api-server/src/lib/ai-provider.ts）相同，
 * 所以同一組 Secrets 會讓商城與 ERP 一起切換。
 *
 * 沒有設定 ANTHROPIC_API_KEY 也沒有設定 AI_PROVIDER_* 時，沿用原本的 Replit AI 整合（AI_INTEGRATIONS_OPENAI_*）
 * 與原本的模型，所以這個檔案上線後行為不變，直到有人設定新的供應商為止。
 * 圖片生成、語音、知識庫索引仍走原本的 OpenAI 連線，不受這裡影響（Claude 沒有這幾種模型）。
 *
 * Claude 不是 OpenAI 相容介面：各功能一律呼叫 chat.ts 的 chatCompletion／chatCompletionStream，
 * 由它依供應商決定走 OpenAI 相容連線還是 Claude 官方 SDK。
 */
export type AiTier = "strong" | "small";

export interface AiProvider {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** anthropic＝Claude；custom＝AI_PROVIDER_*；replit＝原本的整合；none＝都沒設定 */
  source: "anthropic" | "custom" | "replit" | "none";
}

/** 接 Claude 時各級預設的模型：都用最便宜的 Haiku 5.5；覺得不夠聰明，把 AI_MODEL_STRONG 改成 claude-sonnet-5-5 或 claude-opus-5-5 */
export const CLAUDE_DEFAULT_MODELS: Record<AiTier, string> = {
  strong: "claude-haiku-5-5",
  small: "claude-haiku-5-5",
};

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
  const forced = clean(env.AI_PROVIDER).toLowerCase();
  const anthropicKey = clean(env.ANTHROPIC_API_KEY);
  if (anthropicKey && (forced === "" || forced === "anthropic" || forced === "claude")) {
    // 只接受 claude- 開頭的模型名稱；之前留下來給別家用的覆寫（例如 openai/…）不會被送到 Claude
    const model = override.startsWith("claude-") ? override : CLAUDE_DEFAULT_MODELS[tier];
    return { baseUrl: "", apiKey: anthropicKey, model, source: "anthropic" };
  }
  // 位址與金鑰要兩個都有才算設定完成；只設一半時不要把金鑰送到另一家，直接退回原本的整合
  if (customBase && customKey && forced !== "replit") {
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
    // 模型名稱帶廠商前綴（例如 openai/…）是自訂供應商的寫法、claude- 開頭是 Claude 的，原本的整合都不認得，忽略這種覆寫
    const model =
      override && !override.includes("/") && !override.startsWith("claude-") ? override : LEGACY_MODEL;
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
      host =
        provider.source === "anthropic"
          ? "api.anthropic.com"
          : provider.baseUrl
            ? new URL(provider.baseUrl).host
            : "";
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
