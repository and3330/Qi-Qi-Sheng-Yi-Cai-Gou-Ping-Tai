/**
 * AI 呼叫的共用入口。
 *
 * ERP 各個 AI 功能原本都是直接呼叫 OpenAI 相容的 /chat/completions。這裡提供一個用法相同的 aiFetch：
 * - 供應商是 Atlas 或 Replit 內建時：原樣送出，行為不變。
 * - 供應商是 Claude（Anthropic）時：用官方 SDK 呼叫，並把回應整理成同樣的格式，
 *   所以各功能的程式不用知道背後是哪一家。
 */
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_BASE, type AiTier } from "./ai-provider";

type OpenAiPart = { type?: string; text?: string; image_url?: { url?: string } };
interface OpenAiMessage { role?: string; content?: string | OpenAiPart[] }
interface OpenAiBody {
  model?: string;
  messages?: OpenAiMessage[];
  response_format?: { type?: string };
  max_completion_tokens?: number;
  max_tokens?: number;
}

const CLAUDE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ClaudeImageType = (typeof CLAUDE_IMAGE_TYPES)[number];
const JSON_ONLY = "\n\n只輸出一個 JSON 物件：不要加任何說明文字，也不要用程式碼框包起來。";

export class AiRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** 把 OpenAI 格式的訊息轉成 Claude 的格式（純計算，方便測試） */
export function toClaudeRequest(body: OpenAiBody): { system: string; messages: Anthropic.MessageParam[]; wantsJson: boolean; maxTokens: number } {
  const wantsJson = body.response_format?.type === "json_object";
  const systemParts: string[] = [];
  const messages: Anthropic.MessageParam[] = [];

  for (const message of body.messages ?? []) {
    if (message.role === "system") {
      const text = typeof message.content === "string" ? message.content : (message.content ?? []).map(part => part.text ?? "").join("\n");
      if (text.trim()) systemParts.push(text);
      continue;
    }
    const role = message.role === "assistant" ? "assistant" : "user";
    if (typeof message.content === "string") {
      if (message.content.trim()) messages.push({ role, content: message.content });
      continue;
    }
    const blocks: Anthropic.ContentBlockParam[] = [];
    // Claude 建議圖片放在文字前面
    for (const part of message.content ?? []) {
      const url = part.type === "image_url" ? part.image_url?.url ?? "" : "";
      if (!url) continue;
      const data = /^data:([^;,]+);base64,(.+)$/s.exec(url);
      if (data) {
        const mediaType = (data[1].toLowerCase() === "image/jpg" ? "image/jpeg" : data[1].toLowerCase()) as ClaudeImageType;
        if (!CLAUDE_IMAGE_TYPES.includes(mediaType)) throw new AiRequestError(400, `這種圖片格式（${data[1]}）目前的 AI 模型讀不了，請改用 JPG 或 PNG`);
        blocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data: data[2] } });
      } else if (/^https:\/\//.test(url)) {
        blocks.push({ type: "image", source: { type: "url", url } });
      }
    }
    for (const part of message.content ?? []) {
      if (part.type === "text" && part.text?.trim()) blocks.push({ type: "text", text: part.text });
    }
    if (blocks.length > 0) messages.push({ role, content: blocks });
  }

  // Claude 規定第一則一定要是使用者說的話
  if (messages.length === 0 || messages[0].role !== "user") messages.unshift({ role: "user", content: "請開始。" });
  const requested = Number(body.max_completion_tokens ?? body.max_tokens);
  // 這個上限包含模型思考用掉的字數，給太小會還沒回答就被截斷，所以至少留 8000
  const maxTokens = Number.isFinite(requested) && requested > 0 ? Math.min(Math.max(requested, 8000), 16000) : 16000;
  return { system: systemParts.join("\n\n") + (wantsJson ? JSON_ONLY : ""), messages, wantsJson, maxTokens };
}

/** 從模型的回答裡取出 JSON：去掉程式碼框，或擷取第一個到最後一個大括號之間的內容 */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  const candidates = [trimmed, /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1]?.trim() ?? "", trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { JSON.parse(candidate); return candidate; } catch { /* 試下一種 */ }
  }
  return trimmed;
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

/** 思考深度：大腦用預設（中），簡單工作與看圖用低，比較省也比較快；可用 AI_CLAUDE_EFFORT 統一覆寫 */
function effortFor(tier: AiTier): "low" | "medium" | "high" {
  const override = (process.env.AI_CLAUDE_EFFORT || "").trim().toLowerCase();
  if (override === "low" || override === "medium" || override === "high") return override;
  return tier === "strong" ? "medium" : "low";
}

async function callClaude(apiKey: string, tier: AiTier, body: OpenAiBody): Promise<{ content: string; usage: Anthropic.Usage }> {
  const request = toClaudeRequest(body);
  let response: Anthropic.Message;
  try {
    response = await clientFor(apiKey).messages.create({
      model: body.model || "claude-haiku-5-5",
      max_tokens: request.maxTokens,
      // 系統提示很長而且每一步都重複送（例如多步驟對話、資料表說明）：快取起來，後面幾次只算一成的費用
      system: request.system.length > 4000
        ? [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }]
        : request.system || undefined,
      messages: request.messages,
      output_config: { effort: effortFor(tier) },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new AiRequestError(401, "Claude 的金鑰無效，請檢查 ANTHROPIC_API_KEY");
    if (error instanceof Anthropic.PermissionDeniedError) throw new AiRequestError(403, "這把 Claude 金鑰沒有使用這個模型的權限");
    if (error instanceof Anthropic.NotFoundError) throw new AiRequestError(404, `找不到模型 ${body.model}，請檢查 AI_MODEL_* 的設定`);
    if (error instanceof Anthropic.RateLimitError) throw new AiRequestError(429, "Claude 目前使用量已達上限，請稍後再試");
    if (error instanceof Anthropic.BadRequestError) throw new AiRequestError(400, `Claude 不接受這個請求：${error.message.slice(0, 200)}`);
    if (error instanceof Anthropic.APIError) throw new AiRequestError(Number(error.status) || 502, `Claude 服務錯誤：${error.message.slice(0, 200)}`);
    throw new AiRequestError(504, "連不上 Claude，請稍後再試");
  }
  if (response.stop_reason === "refusal") throw new AiRequestError(422, "AI 拒絕處理這個要求");
  const text = response.content.map(block => (block.type === "text" ? block.text : "")).join("").trim();
  if (!text) throw new AiRequestError(502, response.stop_reason === "max_tokens" ? "AI 的回答太長被截斷，請把問題縮小一點" : "AI 沒有回內容");
  return { content: request.wantsJson ? extractJson(text) : text, usage: response.usage };
}

/**
 * 用法和 fetch 一樣：aiFetch(`${baseUrl}/chat/completions`, { method, headers, body })。
 * baseUrl 是 Claude 的標記位址時改走官方 SDK，回傳內容仍然是 { choices: [{ message: { content } }] }。
 */
export async function aiFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<Response> {
  if (!url.startsWith(ANTHROPIC_BASE)) return fetch(url, init);

  const tier = (new URL(url).searchParams.get("tier") || "strong") as AiTier;
  const apiKey = String(init.headers?.Authorization ?? init.headers?.authorization ?? "").replace(/^Bearer\s+/i, "");
  const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  try {
    const body = JSON.parse(init.body || "{}") as OpenAiBody;
    const result = await callClaude(apiKey, tier, body);
    return json(200, {
      model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: result.content }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: result.usage.input_tokens + (result.usage.cache_read_input_tokens ?? 0) + (result.usage.cache_creation_input_tokens ?? 0),
        completion_tokens: result.usage.output_tokens,
        cached_tokens: result.usage.cache_read_input_tokens ?? 0,
      },
    });
  } catch (error) {
    if (error instanceof AiRequestError) return json(error.status, { error: { message: error.message } });
    return json(500, { error: { message: "AI 呼叫失敗" } });
  }
}
