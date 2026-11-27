/**
 * Claude（Anthropic）的呼叫與格式轉換。
 *
 * 商城各個 AI 功能的訊息與工具都是照 OpenAI 的格式寫的。這裡把它們轉成 Claude 的格式、
 * 用官方 SDK 呼叫，再把回答整理回 OpenAI 的格式，所以各功能不用知道背後是哪一家。
 * 各功能不要直接用這個檔案，請呼叫 chat.ts 的 chatCompletion／chatCompletionStream。
 */
import Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { AiTier } from "./provider";

type ChatMessageParam = OpenAI.Chat.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.ChatCompletionTool;

const JSON_ONLY = "\n\n只輸出一個 JSON 物件：不要加任何說明文字，也不要用程式碼框包起來。";

/** AI 呼叫失敗；message 是可以直接給人看的中文說明 */
export class AiChatError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AiChatError";
  }
}

/**
 * Claude 回的助理訊息 → 當時的原始內容。
 * 工具迴圈下一輪要把上一輪的回答原封不動送回去（裡面可能有思考區塊，改動或丟掉會被拒絕或變笨），
 * 而 OpenAI 的訊息格式放不下這些區塊，所以用訊息物件本身當鑰匙另外記著。
 */
const rawAssistantContent = new WeakMap<object, Anthropic.ContentBlock[]>();

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "",
    )
    .join("\n");
}

function parseToolInput(raw: string | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** 把 OpenAI 格式的對話轉成 Claude 的格式（純計算，方便測試） */
export function toClaudeMessages(messages: ChatMessageParam[]): {
  system: string;
  messages: Anthropic.MessageParam[];
} {
  const systemParts: string[] = [];
  const out: Anthropic.MessageParam[] = [];

  for (const message of messages) {
    if (message.role === "system" || message.role === "developer") {
      const text = textOf(message.content);
      if (text.trim()) systemParts.push(text);
      continue;
    }
    if (message.role === "tool") {
      const result: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: message.tool_call_id,
        content: textOf(message.content) || "（沒有內容）",
      };
      // 同一輪的工具結果要放在同一則使用者訊息裡，拆開送會讓模型以後不再一次呼叫多個工具
      const last = out[out.length - 1];
      if (
        last?.role === "user" &&
        Array.isArray(last.content) &&
        last.content.every((block) => block.type === "tool_result")
      ) {
        last.content.push(result);
      } else {
        out.push({ role: "user", content: [result] });
      }
      continue;
    }
    if (message.role === "assistant") {
      const raw = rawAssistantContent.get(message);
      if (raw) {
        out.push({ role: "assistant", content: raw });
        continue;
      }
      const blocks: Anthropic.ContentBlockParam[] = [];
      const text = textOf(message.content);
      if (text.trim()) blocks.push({ type: "text", text });
      for (const call of message.tool_calls ?? []) {
        if (call.type !== "function") continue;
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: parseToolInput(call.function.arguments),
        });
      }
      if (blocks.length > 0) out.push({ role: "assistant", content: blocks });
      continue;
    }
    if (message.role === "user") {
      const text = textOf(message.content);
      if (text.trim()) out.push({ role: "user", content: text });
    }
  }

  // Claude 規定第一則一定要是使用者說的話
  if (out.length === 0 || out[0].role !== "user") out.unshift({ role: "user", content: "請開始。" });
  // 最後一則也不能是助理的話（那是要模型接著寫，目前的模型不接受）
  if (out[out.length - 1].role === "assistant") out.push({ role: "user", content: "請繼續。" });
  return { system: systemParts.join("\n\n"), messages: out };
}

/** 把 OpenAI 格式的工具定義轉成 Claude 的格式 */
export function toClaudeTools(tools: ChatTool[] | undefined): Anthropic.Tool[] {
  const out: Anthropic.Tool[] = [];
  for (const tool of tools ?? []) {
    if (tool.type !== "function") continue;
    const parameters = (tool.function.parameters ?? {}) as Record<string, unknown>;
    out.push({
      name: tool.function.name,
      description: tool.function.description ?? "",
      input_schema: { ...parameters, type: "object" },
    });
  }
  return out;
}

/** 從模型的回答裡取出 JSON：去掉程式碼框，或擷取第一個到最後一個大括號之間的內容 */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1]?.trim() ?? "",
    trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      /* 試下一種 */
    }
  }
  return trimmed;
}

/** 把 Claude 的回答整理成 OpenAI 格式的助理訊息，並記住原始內容供下一輪送回 */
export function fromClaudeMessage(
  content: Anthropic.ContentBlock[],
  wantsJson: boolean,
): OpenAI.Chat.ChatCompletionMessage {
  const text = content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  const toolCalls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] = [];
  for (const block of content) {
    if (block.type !== "tool_use") continue;
    toolCalls.push({
      id: block.id,
      type: "function",
      function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
    });
  }
  const message: OpenAI.Chat.ChatCompletionMessage = {
    role: "assistant",
    content: text ? (wantsJson ? extractJson(text) : text) : null,
    refusal: null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
  rawAssistantContent.set(message, content);
  return message;
}

const clients = new Map<string, Anthropic>();
function clientFor(apiKey: string): Anthropic {
  let client = clients.get(apiKey);
  if (!client) {
    // 逾時單位是毫秒；失敗最多再試一次，避免使用者等太久
    client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
    clients.set(apiKey, client);
  }
  return client;
}

/** 思考深度：需要正確性的工作用中，簡單工作用低，比較省也比較快；可用 AI_CLAUDE_EFFORT 統一覆寫 */
function effortFor(tier: AiTier): "low" | "medium" | "high" {
  const override = (process.env.AI_CLAUDE_EFFORT || "").trim().toLowerCase();
  if (override === "low" || override === "medium" || override === "high") return override;
  return tier === "strong" ? "medium" : "low";
}

export interface ClaudeChatParams {
  apiKey: string;
  model: string;
  tier: AiTier;
  messages: ChatMessageParam[];
  tools?: ChatTool[];
  maxTokens: number;
  json?: boolean;
}

function buildRequest(params: ClaudeChatParams): Anthropic.MessageCreateParamsNonStreaming {
  const converted = toClaudeMessages(params.messages);
  const system = converted.system + (params.json ? JSON_ONLY : "");
  const tools = toClaudeTools(params.tools);
  // 這個上限包含模型思考用掉的字數，給太小會還沒回答就被截斷，所以至少留 8000
  const maxTokens =
    Number.isFinite(params.maxTokens) && params.maxTokens > 0
      ? Math.min(Math.max(params.maxTokens, 8000), 16000)
      : 16000;
  return {
    model: params.model,
    max_tokens: maxTokens,
    // 系統提示與工具定義很長，而且工具迴圈每一輪都重複送：快取起來，後面幾輪只算一成的費用
    system:
      system.length > 4000 || tools.length > 0
        ? [{ type: "text", text: system || "你是助理。", cache_control: { type: "ephemeral" } }]
        : system || undefined,
    messages: converted.messages,
    ...(tools.length ? { tools } : {}),
    output_config: { effort: effortFor(params.tier) },
  };
}

function toChatError(error: unknown, model: string): AiChatError {
  if (error instanceof AiChatError) return error;
  if (error instanceof Anthropic.AuthenticationError)
    return new AiChatError(401, "Claude 的金鑰無效，請檢查 ANTHROPIC_API_KEY");
  if (error instanceof Anthropic.PermissionDeniedError)
    return new AiChatError(403, "這把 Claude 金鑰沒有使用這個模型的權限");
  if (error instanceof Anthropic.NotFoundError)
    return new AiChatError(404, `找不到模型 ${model}，請檢查 AI_MODEL_* 的設定`);
  if (error instanceof Anthropic.RateLimitError)
    return new AiChatError(429, "Claude 目前使用量已達上限，請稍後再試");
  if (error instanceof Anthropic.BadRequestError)
    return new AiChatError(400, `Claude 不接受這個請求：${error.message.slice(0, 200)}`);
  if (error instanceof Anthropic.APIConnectionError) return new AiChatError(504, "連不上 Claude，請稍後再試");
  if (error instanceof Anthropic.APIError)
    return new AiChatError(Number(error.status) || 502, `Claude 服務錯誤：${error.message.slice(0, 200)}`);
  return new AiChatError(502, "AI 呼叫失敗");
}

function checkStop(response: Anthropic.Message): void {
  if (response.stop_reason === "refusal") throw new AiChatError(422, "AI 拒絕處理這個要求");
  // 被長度上限截斷時，工具參數可能只寫到一半，不能拿去執行
  if (response.stop_reason === "max_tokens")
    throw new AiChatError(502, "AI 的回答太長被截斷，請把問題縮小一點");
}

/** 呼叫 Claude 一次，回傳 OpenAI 格式的助理訊息（可能帶工具呼叫） */
export async function claudeChat(params: ClaudeChatParams): Promise<OpenAI.Chat.ChatCompletionMessage> {
  let response: Anthropic.Message;
  try {
    response = await clientFor(params.apiKey).messages.create(buildRequest(params));
  } catch (error) {
    throw toChatError(error, params.model);
  }
  checkStop(response);
  return fromClaudeMessage(response.content, params.json === true);
}

/** 呼叫 Claude 並逐段回傳文字（不支援工具） */
export async function* claudeChatStream(params: ClaudeChatParams): AsyncGenerator<string> {
  try {
    const stream = clientFor(params.apiKey).messages.stream(buildRequest({ ...params, tools: undefined }));
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
    checkStop(await stream.finalMessage());
  } catch (error) {
    throw toChatError(error, params.model);
  }
}
