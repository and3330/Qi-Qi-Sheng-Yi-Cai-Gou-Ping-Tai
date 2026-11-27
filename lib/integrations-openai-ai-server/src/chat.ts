/**
 * 文字對答的共用入口：各功能（AI 助理、AI CMO、客服、社群文案）都呼叫這裡，
 * 由這裡依 provider.ts 的設定決定走哪一家：
 * - Claude（有設定 ANTHROPIC_API_KEY）：用官方 SDK，格式轉換在 claude.ts
 * - 其他（AtlasCloud 或原本的 Replit 整合）：OpenAI 相容連線，行為與原本相同
 *
 * 訊息與工具一律用 OpenAI 的格式傳入，回傳的助理訊息也是 OpenAI 的格式，
 * 可以直接推回對話陣列再呼叫下一輪（工具迴圈）。
 */
import type OpenAI from "openai";
import { chatAi } from "./client";
import { claudeChat, claudeChatStream } from "./claude";
import { resolveAiProvider, type AiTier } from "./provider";

export interface ChatRequest {
  /** strong＝需要正確性與工具呼叫；small＝簡單又頻繁的工作。預設 strong */
  tier?: AiTier;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.ChatCompletionTool[];
  /** 回答長度上限 */
  maxTokens: number;
  /** 要求只回一個 JSON 物件 */
  json?: boolean;
}

/** 呼叫模型一次。回傳助理訊息；模型沒有回任何東西時回傳 null */
export async function chatCompletion(request: ChatRequest): Promise<OpenAI.Chat.ChatCompletionMessage | null> {
  const tier = request.tier ?? "strong";
  const provider = resolveAiProvider(tier);
  if (provider.source === "anthropic") {
    return claudeChat({
      apiKey: provider.apiKey,
      model: provider.model,
      tier,
      messages: request.messages,
      tools: request.tools,
      maxTokens: request.maxTokens,
      json: request.json,
    });
  }
  const completion = await chatAi.chat.completions.create({
    model: provider.model,
    max_completion_tokens: request.maxTokens,
    messages: request.messages,
    ...(request.tools?.length ? { tools: request.tools } : {}),
    ...(request.json ? { response_format: { type: "json_object" as const } } : {}),
  });
  return completion.choices[0]?.message ?? null;
}

/** 呼叫模型並逐段回傳文字（不支援工具） */
export async function* chatCompletionStream(request: Omit<ChatRequest, "tools" | "json">): AsyncGenerator<string> {
  const tier = request.tier ?? "strong";
  const provider = resolveAiProvider(tier);
  if (provider.source === "anthropic") {
    yield* claudeChatStream({
      apiKey: provider.apiKey,
      model: provider.model,
      tier,
      messages: request.messages,
      maxTokens: request.maxTokens,
    });
    return;
  }
  const stream = await chatAi.chat.completions.create({
    model: provider.model,
    max_completion_tokens: request.maxTokens,
    messages: request.messages,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
