import { afterEach, describe, expect, it, vi } from "vitest";
import { AiRequestError, aiFetch, extractJson, toClaudeRequest } from "../ai-client";
import { ANTHROPIC_BASE, CLAUDE_DEFAULT_MODELS, CUSTOM_DEFAULT_MODELS, describeAiProviders, resolveAiProvider, temperatureParam } from "../ai-provider";

const ATLAS = { AI_PROVIDER_BASE_URL: "https://api.atlascloud.ai/v1", AI_PROVIDER_API_KEY: "atlas-key" };
const LEGACY = { AI_INTEGRATIONS_OPENAI_BASE_URL: "https://legacy.example/v1", AI_INTEGRATIONS_OPENAI_API_KEY: "legacy-key" };
const CLAUDE = { ANTHROPIC_API_KEY: "claude-key" };

describe("AI 供應商：Claude", () => {
  it("有設定 Claude 金鑰就優先用 Claude，三級預設都是最便宜的 Haiku 5.5", () => {
    for (const tier of ["strong", "small", "vision"] as const) {
      const provider = resolveAiProvider(tier, { ...LEGACY, ...ATLAS, ...CLAUDE });
      expect(provider).toEqual({ baseUrl: `${ANTHROPIC_BASE}?tier=${tier}`, apiKey: "claude-key", model: "claude-haiku-5-5", source: "anthropic" });
    }
    expect(CLAUDE_DEFAULT_MODELS).toEqual({ strong: "claude-haiku-5-5", small: "claude-haiku-5-5", vision: "claude-haiku-5-5" });
  });

  it("可以只把大腦換成比較強的 Claude；別家的模型名稱不會被送到 Claude", () => {
    expect(resolveAiProvider("strong", { ...CLAUDE, AI_MODEL_STRONG: "claude-sonnet-5-5" }).model).toBe("claude-sonnet-5-5");
    expect(resolveAiProvider("small", { ...CLAUDE, AI_MODEL_STRONG: "claude-sonnet-5-5" }).model).toBe("claude-haiku-5-5");
    expect(resolveAiProvider("strong", { ...CLAUDE, AI_MODEL_STRONG: "openai/gpt-6.1-sol" }).model).toBe("claude-haiku-5-5");
  });

  it("AI_PROVIDER 可以指定用哪一家；沒有 Claude 金鑰時行為跟原本一樣", () => {
    expect(resolveAiProvider("strong", { ...ATLAS, ...CLAUDE, AI_PROVIDER: "atlas" })).toMatchObject({ source: "custom", apiKey: "atlas-key", model: CUSTOM_DEFAULT_MODELS.strong });
    expect(resolveAiProvider("strong", { ...LEGACY, ...ATLAS, ...CLAUDE, AI_PROVIDER: "replit" })).toMatchObject({ source: "replit", apiKey: "legacy-key" });
    expect(resolveAiProvider("strong", { ...LEGACY, ...ATLAS })).toMatchObject({ source: "custom" });
    expect(resolveAiProvider("strong", LEGACY)).toMatchObject({ source: "replit" });
    // 留給 Claude 的模型名稱不會被送到原本的整合
    expect(resolveAiProvider("strong", { ...LEGACY, AI_MODEL_STRONG: "claude-sonnet-5-5" }).model).not.toContain("claude");
  });

  it("Claude 不接受自訂溫度，所以不送；狀態說明不含金鑰", () => {
    expect(temperatureParam("claude-haiku-5-5", 0)).toEqual({});
    const described = describeAiProviders(CLAUDE);
    expect(described[0]).toMatchObject({ source: "anthropic", host: "api.anthropic.com", model: "claude-haiku-5-5", configured: true });
    expect(JSON.stringify(described)).not.toContain("claude-key");
  });
});

describe("AI 共用入口：轉成 Claude 的格式", () => {
  it("系統提示分開放，要求 JSON 時加上只輸出 JSON 的說明", () => {
    const request = toClaudeRequest({
      messages: [{ role: "system", content: "你是 ERP 助理" }, { role: "user", content: "本月營收" }, { role: "assistant", content: '{"action":"query"}' }, { role: "user", content: "[工具結果] {}" }],
      response_format: { type: "json_object" },
    });
    expect(request.system).toContain("你是 ERP 助理");
    expect(request.system).toContain("只輸出一個 JSON 物件");
    expect(request.wantsJson).toBe(true);
    expect(request.messages.map(m => m.role)).toEqual(["user", "assistant", "user"]);
    expect(toClaudeRequest({ messages: [{ role: "user", content: "嗨" }] }).system).toBe("");
  });

  it("圖片轉成 Claude 的圖片區塊，放在文字前面", () => {
    const request = toClaudeRequest({ messages: [{ role: "user", content: [{ type: "text", text: "這是什麼" }, { type: "image_url", image_url: { url: "data:image/jpg;base64,QUJD" } }] }] });
    expect(request.messages[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } },
      { type: "text", text: "這是什麼" },
    ]);
  });

  it("Claude 讀不了的圖片格式（HEIC）會明講，不會默默送出", () => {
    expect(() => toClaudeRequest({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/heic;base64,QUJD" } }] }] })).toThrow(AiRequestError);
  });

  it("第一則不是使用者的話時補上一則；回答長度上限不會低到連思考都不夠", () => {
    expect(toClaudeRequest({ messages: [{ role: "system", content: "x" }] }).messages).toEqual([{ role: "user", content: "請開始。" }]);
    expect(toClaudeRequest({ messages: [{ role: "assistant", content: "先前的回答" }] }).messages[0].role).toBe("user");
    expect(toClaudeRequest({ messages: [], max_completion_tokens: 2048 }).maxTokens).toBe(8000);
    expect(toClaudeRequest({ messages: [], max_completion_tokens: 999999 }).maxTokens).toBe(16000);
    expect(toClaudeRequest({ messages: [] }).maxTokens).toBe(16000);
  });

  it("從回答裡取出 JSON：直接是 JSON、包在程式碼框裡、前後有說明文字都可以", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
    expect(JSON.parse(extractJson('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
    expect(JSON.parse(extractJson('好的，結果如下：\n{"a":{"b":2}}\n以上。'))).toEqual({ a: { b: 2 } });
    // 真的不是 JSON 就原樣回傳，讓呼叫的地方照原本的方式報錯
    expect(extractJson("我不知道")).toBe("我不知道");
  });
});

describe("AI 共用入口：其他供應商原樣送出", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("不是 Claude 的位址直接用原本的方式呼叫", async () => {
    const fake = vi.fn(async () => new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 }));
    vi.stubGlobal("fetch", fake);
    const init = { method: "POST", headers: { Authorization: "Bearer atlas-key" }, body: "{}" };
    const response = await aiFetch("https://api.atlascloud.ai/v1/chat/completions", init);
    expect(fake).toHaveBeenCalledWith("https://api.atlascloud.ai/v1/chat/completions", init);
    expect((await response.json() as any).choices[0].message.content).toBe("ok");
  });
});
