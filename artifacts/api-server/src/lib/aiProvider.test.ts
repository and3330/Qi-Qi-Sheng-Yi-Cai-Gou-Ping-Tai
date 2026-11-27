/**
 * AI 供應商選擇與 Claude 格式轉換的單元測試（不連線、不需要金鑰）
 * 執行：pnpm --filter @workspace/api-server run test:ai-provider
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { describeAiProviders, resolveAiProvider } from "@workspace/integrations-openai-ai-server/provider";
import {
  extractJson,
  fromClaudeMessage,
  toClaudeMessages,
  toClaudeTools,
} from "@workspace/integrations-openai-ai-server/claude";

const LEGACY = {
  AI_INTEGRATIONS_OPENAI_BASE_URL: "https://replit.example/v1/",
  AI_INTEGRATIONS_OPENAI_API_KEY: "legacy-key",
};
const ATLAS = { AI_PROVIDER_BASE_URL: "https://api.atlascloud.ai/v1", AI_PROVIDER_API_KEY: "atlas-key" };

test("沒有設定新供應商：沿用原本的整合與模型", () => {
  const p = resolveAiProvider("strong", LEGACY);
  assert.equal(p.source, "replit");
  assert.equal(p.model, "gpt-5.6-terra");
  assert.equal(p.baseUrl, "https://replit.example/v1");
});

test("設定 ANTHROPIC_API_KEY：優先用 Claude，預設 Haiku 5.5", () => {
  const p = resolveAiProvider("strong", { ...LEGACY, ...ATLAS, ANTHROPIC_API_KEY: " claude-key " });
  assert.equal(p.source, "anthropic");
  assert.equal(p.apiKey, "claude-key");
  assert.equal(p.model, "claude-haiku-5-5");
});

test("Claude：只接受 claude- 開頭的模型覆寫", () => {
  const base = { ANTHROPIC_API_KEY: "k" };
  assert.equal(resolveAiProvider("strong", { ...base, AI_MODEL_STRONG: "claude-sonnet-5-5" }).model, "claude-sonnet-5-5");
  assert.equal(resolveAiProvider("strong", { ...base, AI_MODEL_STRONG: "openai/gpt-5.6-luna" }).model, "claude-haiku-5-5");
  assert.equal(resolveAiProvider("small", { ...base, AI_MODEL_STRONG: "claude-opus-5-5" }).model, "claude-haiku-5-5");
});

test("AI_PROVIDER 可以指定用哪一家", () => {
  const all = { ...LEGACY, ...ATLAS, ANTHROPIC_API_KEY: "k" };
  assert.equal(resolveAiProvider("strong", { ...all, AI_PROVIDER: "atlas" }).source, "custom");
  assert.equal(resolveAiProvider("strong", { ...all, AI_PROVIDER: "replit" }).source, "replit");
  assert.equal(resolveAiProvider("strong", { ...all, AI_PROVIDER: "claude" }).source, "anthropic");
});

test("原本的整合不會收到別家的模型名稱", () => {
  assert.equal(resolveAiProvider("strong", { ...LEGACY, AI_MODEL_STRONG: "claude-opus-5-5" }).model, "gpt-5.6-terra");
  assert.equal(resolveAiProvider("strong", { ...LEGACY, AI_MODEL_STRONG: "openai/gpt-6-luna" }).model, "gpt-5.6-terra");
});

test("describeAiProviders：不含金鑰", () => {
  const rows = describeAiProviders({ ANTHROPIC_API_KEY: "secret-value" });
  assert.equal(rows[0].source, "anthropic");
  assert.equal(rows[0].host, "api.anthropic.com");
  assert.ok(!JSON.stringify(rows).includes("secret-value"));
});

test("toClaudeMessages：系統提示合併、工具呼叫與結果轉換", () => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: "規則一" },
    { role: "system", content: "規則二" },
    { role: "user", content: "訂單 12 出貨了嗎" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_a", type: "function", function: { name: "get_order", arguments: '{"id":12}' } },
        { id: "call_b", type: "function", function: { name: "find_member", arguments: "不是 JSON" } },
      ],
    },
    { role: "tool", tool_call_id: "call_a", content: '{"status":"shipped"}' },
    { role: "tool", tool_call_id: "call_b", content: "" },
  ];
  const out = toClaudeMessages(messages);
  assert.equal(out.system, "規則一\n\n規則二");
  assert.equal(out.messages.length, 3);
  assert.deepEqual(out.messages[0], { role: "user", content: "訂單 12 出貨了嗎" });
  assert.deepEqual(out.messages[1], {
    role: "assistant",
    content: [
      { type: "tool_use", id: "call_a", name: "get_order", input: { id: 12 } },
      { type: "tool_use", id: "call_b", name: "find_member", input: {} },
    ],
  });
  // 同一輪的兩個工具結果要合在同一則使用者訊息
  assert.deepEqual(out.messages[2], {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "call_a", content: '{"status":"shipped"}' },
      { type: "tool_result", tool_use_id: "call_b", content: "（沒有內容）" },
    ],
  });
});

test("toClaudeMessages：第一則補使用者、最後一則不能是助理、空訊息略過", () => {
  const out = toClaudeMessages([
    { role: "system", content: "規則" },
    { role: "assistant", content: "您好" },
    { role: "user", content: "   " },
  ]);
  assert.deepEqual(
    out.messages.map((m) => m.role),
    ["user", "assistant", "user"],
  );
  assert.equal(out.messages[0].content, "請開始。");
  assert.equal(out.messages[2].content, "請繼續。");
});

test("toClaudeTools：轉成 Claude 的工具格式", () => {
  const tools = toClaudeTools([
    {
      type: "function",
      function: {
        name: "get_order",
        description: "查訂單",
        parameters: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
      },
    },
  ]);
  assert.deepEqual(tools, [
    {
      name: "get_order",
      description: "查訂單",
      input_schema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
    },
  ]);
});

test("fromClaudeMessage：整理回 OpenAI 格式，下一輪原樣送回（含思考區塊）", () => {
  const raw = [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "text", text: "我查一下。", citations: null },
    { type: "tool_use", id: "toolu_1", name: "get_order", input: { id: 12 } },
  ] as unknown as Parameters<typeof fromClaudeMessage>[0];
  const message = fromClaudeMessage(raw, false);
  assert.equal(message.content, "我查一下。");
  assert.deepEqual(message.tool_calls, [
    { id: "toolu_1", type: "function", function: { name: "get_order", arguments: '{"id":12}' } },
  ]);
  const replay = toClaudeMessages([
    { role: "user", content: "訂單 12" },
    message,
    { role: "tool", tool_call_id: "toolu_1", content: "{}" },
  ]);
  assert.equal(replay.messages[1].content, raw);
});

test("fromClaudeMessage：只有工具呼叫時 content 為 null；要求 JSON 時去掉程式碼框", () => {
  const onlyTool = fromClaudeMessage(
    [{ type: "tool_use", id: "t", name: "x", input: {} }] as unknown as Parameters<typeof fromClaudeMessage>[0],
    false,
  );
  assert.equal(onlyTool.content, null);
  const json = fromClaudeMessage(
    [{ type: "text", text: '```json\n{"a":1}\n```', citations: null }] as unknown as Parameters<typeof fromClaudeMessage>[0],
    true,
  );
  assert.equal(json.content, '{"a":1}');
});

test("extractJson：前後有說明文字時取出大括號內容", () => {
  assert.equal(extractJson('好的：{"a":1} 以上'), '{"a":1}');
  assert.equal(extractJson("不是 JSON"), "不是 JSON");
});

// ---------- 用本機假伺服器走一遍 Claude 官方 SDK（不連外、金鑰是假的） ----------
test("chatCompletion／chatCompletionStream：經 Claude SDK 送出正確的請求並解讀回應", async () => {
  const { createServer } = await import("node:http");
  const seen: Array<Record<string, any>> = [];
  const usage = { input_tokens: 1, output_tokens: 1 };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      seen.push({ ...body, _key: `${req.headers["x-api-key"] ?? ""} ${req.headers.authorization ?? ""}`, _path: req.url });
      const base = { id: "msg_1", type: "message", role: "assistant", model: body.model, stop_sequence: null, usage };
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send("message_start", { type: "message_start", message: { ...base, content: [], stop_reason: null } });
        send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
        for (const text of ["營收", "成長"]) {
          send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
        }
        send("content_block_stop", { type: "content_block_stop", index: 0 });
        send("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } });
        send("message_stop", { type: "message_stop" });
        res.end();
        return;
      }
      const hasToolResult = JSON.stringify(body.messages).includes("tool_result");
      const content = hasToolResult
        ? [{ type: "text", text: "訂單 12 已出貨。" }]
        : [
            { type: "thinking", thinking: "", signature: "sig" },
            { type: "tool_use", id: "toolu_1", name: "get_order", input: { id: 12 } },
          ];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...base, content, stop_reason: hasToolResult ? "end_turn" : "tool_use" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const saved = { ...process.env };
  process.env.ANTHROPIC_API_KEY = "test-not-a-real-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.AI_MODEL_STRONG = "claude-sonnet-5-5";
  delete process.env.AI_PROVIDER;
  // 圖片與語音模組載入時仍要求原本的 OpenAI 整合有設定（正式環境本來就有）
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||= "http://127.0.0.1:9/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||= "test-not-a-real-key";
  try {
    const { chatCompletion, chatCompletionStream } = await import("@workspace/integrations-openai-ai-server");
    const tools: OpenAI.Chat.ChatCompletionTool[] = [
      { type: "function", function: { name: "get_order", description: "查訂單", parameters: { type: "object", properties: { id: { type: "number" } } } } },
    ];
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: "你是後台助理" },
      { role: "user", content: "訂單 12 出貨了嗎" },
    ];
    // 第一輪：模型要求呼叫工具
    const first = await chatCompletion({ maxTokens: 8192, messages, tools });
    assert.ok(first?.tool_calls?.length === 1);
    const call = first.tool_calls[0];
    assert.ok(call.type === "function");
    assert.equal(call.function.name, "get_order");
    assert.deepEqual(JSON.parse(call.function.arguments), { id: 12 });
    // 第二輪：照 AI 助理的寫法把助理訊息與工具結果推回去
    messages.push(first);
    messages.push({ role: "tool", tool_call_id: call.id, content: '{"status":"shipped"}' });
    const second = await chatCompletion({ maxTokens: 8192, messages, tools });
    assert.equal(second?.content, "訂單 12 已出貨。");
    assert.equal(second?.tool_calls, undefined);

    assert.equal(seen[0]._path, "/v1/messages");
    assert.ok(String(seen[0]._key).includes("test-not-a-real-key"));
    assert.equal(seen[0].model, "claude-sonnet-5-5");
    assert.equal(seen[0].max_tokens, 8192);
    assert.deepEqual(seen[0].output_config, { effort: "medium" });
    assert.equal(seen[0].system[0].text, "你是後台助理");
    assert.deepEqual(seen[0].system[0].cache_control, { type: "ephemeral" });
    assert.equal(seen[0].tools[0].name, "get_order");
    assert.equal(seen[0].temperature, undefined);
    assert.equal(seen[0].tool_choice, undefined);
    // 第二輪：前面的內容一字不改，思考區塊原樣送回，工具結果接在後面
    assert.deepEqual(seen[1].system, seen[0].system);
    assert.deepEqual(seen[1].tools, seen[0].tools);
    assert.deepEqual(seen[1].messages[0], seen[0].messages[0]);
    assert.deepEqual(seen[1].messages[1].content[0], { type: "thinking", thinking: "", signature: "sig" });
    assert.equal(seen[1].messages[1].content[1].type, "tool_use");
    assert.deepEqual(seen[1].messages[2], {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"status":"shipped"}' }],
    });

    // 串流（AI 行銷長）
    let streamed = "";
    for await (const delta of chatCompletionStream({ maxTokens: 8192, messages: [{ role: "user", content: "本月重點" }] })) {
      streamed += delta;
    }
    assert.equal(streamed, "營收成長");
    assert.equal(seen[2].stream, true);
    assert.equal(seen[2].tools, undefined);
  } finally {
    process.env = saved;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
