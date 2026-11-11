/**
 * 社群行銷 AI：文案產生、社群圖片產生（存入物件儲存公開路徑）、內容排程規劃。
 * 使用專案既有的 AI 整合（平台代理模型）。
 */
import { randomUUID } from "node:crypto";
import { chatAi, chatModel, generateImageBuffer } from "@workspace/integrations-openai-ai-server";
import type OpenAI from "openai";
import { objectStorageClient } from "./objectStorage";
import { getPublicBaseUrl } from "./socialService";

const TEXT_MODEL = chatModel();

// ---------- AI 文案 ----------
export async function generateSocialContent(input: {
  topic: string;
  platforms: string[];
  tone?: string;
}): Promise<{ content: string; hashtags: string }> {
  const completion = await chatAi.chat.completions.create({
    model: TEXT_MODEL,
    max_completion_tokens: 2048,
    messages: [
      {
        role: "system",
        content:
          "你是「七期生醫」（醫療生技採購平台）的社群小編。使用繁體中文。禁止療效宣稱與誇大不實。輸出 JSON：{\"content\": \"貼文內文（不含 hashtag）\", \"hashtags\": \"逗號分隔的標籤（不含 # 號）\"}。內文精煉有吸引力，適合多平台發布。",
      },
      {
        role: "user",
        content: `主題：${input.topic}\n目標平台：${input.platforms.join("、")}${input.tone ? `\n語氣：${input.tone}` : ""}\n請產生一則社群貼文。`,
      },
    ],
    response_format: { type: "json_object" },
  });
  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: any = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { content: raw, hashtags: "" };
  }
  return {
    content: String(parsed.content ?? "").trim(),
    hashtags: String(parsed.hashtags ?? "").trim(),
  };
}

// ---------- AI 圖片（存入公開物件儲存，回傳可公開抓取的 URL） ----------
function getPublicDir(): string {
  const paths = (process.env.PUBLIC_OBJECT_SEARCH_PATHS || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paths.length) {
    throw new Error("PUBLIC_OBJECT_SEARCH_PATHS 未設定，無法儲存社群圖片");
  }
  return paths[0];
}

export async function generateSocialImage(prompt: string): Promise<{
  imageUrl: string;
  objectPath: string;
}> {
  const buffer = await generateImageBuffer(
    `社群媒體貼文用圖片，風格專業、乾淨、適合醫療生技品牌：${prompt}`,
    "1024x1024",
  );
  const publicDir = getPublicDir();
  const fileName = `social/${randomUUID()}.png`;
  const fullPath = `${publicDir.replace(/\/$/, "")}/${fileName}`;
  const parts = fullPath.replace(/^\//, "").split("/");
  const bucketName = parts[0];
  const objectName = parts.slice(1).join("/");
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .save(buffer, { contentType: "image/png" });
  const imageUrl = `${getPublicBaseUrl()}/api/storage/public-objects/${fileName}`;
  return { imageUrl, objectPath: `/${bucketName}/${objectName}` };
}

// ---------- AI Content Planner（對話式規劃，輸出結構化計畫） ----------
export type PlannedPost = {
  content: string;
  hashtags: string;
  platforms: string[];
  scheduledAt: string; // ISO
  title?: string;
};

const PLANNER_SYSTEM = `你是「七期生醫」（醫療生技採購平台）的 AI 社群內容規劃師。使用繁體中文與管理者對話，協助規劃社群貼文排程。

規則：
1. 先透過對話了解需求（主題方向、期間、頻率、平台）。資訊足夠時再輸出計畫。
2. 輸出計畫時，回覆最後必須附上一個 JSON 區塊，格式：
\`\`\`json
{"plan": [{"title": "...", "content": "貼文內文", "hashtags": "標籤1,標籤2", "platforms": ["facebook","threads"], "scheduledAt": "YYYY-MM-DDTHH:mm:00+08:00"}]}
\`\`\`
3. scheduledAt 必須是未來時間（台北時區），排程分散在合理的黃金時段（例如 12:00、19:00）。
4. 平台限用 facebook / instagram / threads / twitter。instagram 貼文需搭配圖片，若無圖片素材請避免只排 instagram。
5. 內容禁止療效宣稱與誇大不實，符合醫療生技產業規範。
6. 若尚在討論階段，不要輸出 JSON 區塊。`;

export async function runContentPlanner(
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ reply: string; plan: PlannedPost[] | null }> {
  const now = new Date();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: PLANNER_SYSTEM },
    { role: "system", content: `現在時間：${now.toISOString()}（UTC）` },
    ...history.map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })),
  ];
  const completion = await chatAi.chat.completions.create({
    model: TEXT_MODEL,
    max_completion_tokens: 4096,
    messages,
  });
  const reply = completion.choices[0]?.message?.content ?? "";
  const plan = extractPlan(reply);
  return { reply, plan };
}

export function extractPlan(text: string): PlannedPost[] | null {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    const items = Array.isArray(parsed?.plan) ? parsed.plan : null;
    if (!items) return null;
    const valid: PlannedPost[] = [];
    for (const it of items) {
      if (
        typeof it?.content === "string" &&
        Array.isArray(it?.platforms) &&
        typeof it?.scheduledAt === "string" &&
        !Number.isNaN(Date.parse(it.scheduledAt))
      ) {
        valid.push({
          title: typeof it.title === "string" ? it.title : undefined,
          content: it.content,
          hashtags: typeof it.hashtags === "string" ? it.hashtags : "",
          platforms: it.platforms.filter((p: unknown) => typeof p === "string"),
          scheduledAt: it.scheduledAt,
        });
      }
    }
    return valid.length ? valid : null;
  } catch {
    return null;
  }
}
