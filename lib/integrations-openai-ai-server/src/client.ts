import OpenAI from "openai";
import { resolveAiProvider } from "./provider";

const chatProvider = resolveAiProvider("strong");

const legacyBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const legacyKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

// 三種設定至少要有一種：Claude（ANTHROPIC_API_KEY）、自訂供應商（AI_PROVIDER_*）或原本的 Replit AI 整合
if (chatProvider.source === "none") {
  if (!legacyBase) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

/**
 * 原本的 Replit AI 整合：圖片生成、語音等仍使用這個連線。
 * 只設定了 Claude 或自訂供應商、沒有原本整合時，這個連線不可用（呼叫會失敗），但不影響文字對答。
 */
export const openai = new OpenAI({
  apiKey: legacyKey || "not-configured",
  baseURL: legacyBase || "http://127.0.0.1:9/not-configured",
});

/**
 * OpenAI 相容的文字對答連線：有設定 AI_PROVIDER_* 就走該供應商（例如 AtlasCloud），否則沿用原本的整合。
 * 各功能不要直接用這個連線，請呼叫 chat.ts 的 chatCompletion／chatCompletionStream：
 * 供應商是 Claude 時它會改走 Claude 官方 SDK，直接用這個連線會把請求送到錯的地方。
 */
export const chatAi =
  chatProvider.source === "custom"
    ? new OpenAI({ apiKey: chatProvider.apiKey, baseURL: chatProvider.baseUrl })
    : openai;
