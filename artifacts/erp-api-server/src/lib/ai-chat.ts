/**
 * AI 對話裡「既有 AI 功能」（查詢、月報、異常偵測、客訴分類、商品描述）的參數檢查與回覆整理。
 * 多步驟操作（查主檔、建單、改單）的部分在 ai-agent.ts。這個檔案只放不需要連線的部分，方便測試。
 */

export type ChatTool = "query" | "monthly_report" | "anomalies" | "classify_complaint" | "product_description" | "reply";

export interface ChatPlan {
  tool: ChatTool;
  /** 給使用者看的一句話：正在做什麼，或直接的回答 */
  say: string;
  args: Record<string, unknown>;
}

export interface ChatTurn { role: "user" | "assistant"; content: string }

export interface ChatAnswer {
  tool: ChatTool;
  ok: boolean;
  text: string;
  table?: { columns: string[]; rows: Array<Record<string, unknown>>; totalRows: number };
  /** 想看完整畫面時可以前往的頁面 */
  link?: { label: string; path: string };
  detail?: string;
}

export const CHAT_TOOL_PAGES: Record<Exclude<ChatTool, "reply">, { label: string; path: string }> = {
  query: { label: "開啟查詢頁", path: "/ai/assistant" },
  monthly_report: { label: "開啟月報頁", path: "/ai/monthly-report" },
  anomalies: { label: "開啟異常偵測頁", path: "/ai/anomalies" },
  classify_complaint: { label: "開啟客訴分類頁", path: "/ai/complaint-classify" },
  product_description: { label: "開啟商品描述頁", path: "/ai/product-description" },
};

const TOOLS: ChatTool[] = ["query", "monthly_report", "anomalies", "classify_complaint", "product_description", "reply"];
const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/**
 * 檢查並整理 AI 回傳的判斷結果。AI 的輸出不可信：功能名稱不在清單內、缺必要參數時，
 * 一律退回成「直接回答」，不會執行任何功能。
 */
export function normalizePlan(raw: unknown, message: string, now: Date = new Date()): ChatPlan {
  const fallback: ChatPlan = { tool: "reply", say: "我不太確定你的意思，可以再說清楚一點嗎？例如「本月營收多少」「幫我寫上個月的月報」。", args: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const plan = raw as Record<string, unknown>;
  const tool = TOOLS.includes(plan.tool as ChatTool) ? (plan.tool as ChatTool) : null;
  if (!tool) return fallback;
  const args = plan.args && typeof plan.args === "object" && !Array.isArray(plan.args) ? plan.args as Record<string, unknown> : {};
  const say = text(plan.say, 300);

  switch (tool) {
    case "query": {
      const question = text(args.question, 500) || message.trim().slice(0, 500);
      return question ? { tool, say: say || "我來查一下。", args: { question } } : fallback;
    }
    case "monthly_report":
      return { tool, say: say || "我來整理月報。", args: {
        year: clampInt(args.year, 2000, 2100, now.getFullYear()),
        month: clampInt(args.month, 1, 12, now.getMonth() + 1),
      } };
    case "anomalies":
      return { tool, say: say || "我來檢查有沒有異常。", args: { days: clampInt(args.days, 1, 365, 30) } };
    case "classify_complaint": {
      const complaint = text(args.text, 4000) || message.trim().slice(0, 4000);
      return complaint.length >= 5 ? { tool, say: say || "我來分類這則客訴。", args: { text: complaint } } : fallback;
    }
    case "product_description": {
      const itemName = text(args.item_name, 200);
      if (!itemName) return { tool: "reply", say: "要幫哪個商品寫描述？請告訴我品名，有特色或目標客群也可以一起說。", args: {} };
      const tone = ["professional", "friendly", "playful", "luxury"].includes(String(args.tone)) ? String(args.tone) : "professional";
      return { tool, say: say || "我來寫商品描述。", args: {
        item_name: itemName,
        key_features: Array.isArray(args.key_features) ? args.key_features.slice(0, 10).map(v => String(v).slice(0, 100)) : [],
        target_audience: text(args.target_audience, 200),
        tone,
      } };
    }
    default:
      return { tool: "reply", say: say || fallback.say, args: {} };
  }
}

/** 只保留最近幾輪、限制長度的對話紀錄，避免把過長或格式不對的內容送給 AI */
export function sanitizeHistory(raw: unknown, maxTurns = 8, maxChars = 600): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(turn => turn && typeof turn === "object" && (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string" && turn.content.trim())
    .slice(-maxTurns)
    .map(turn => ({ role: turn.role as ChatTurn["role"], content: String(turn.content).trim().slice(0, maxChars) }));
}

const LABELS: Record<string, string> = {
  summary: "摘要", highlights: "重點", risks: "風險", recommendations: "建議", recommendation: "建議", topRisks: "主要風險",
  category: "分類", severity: "嚴重程度", priority: "優先度", sentiment: "情緒", suggested_response: "建議回覆",
  sla_hours: "建議處理時限（小時）", tags: "標籤", needs_immediate_attention: "需要立即處理", title: "標題",
  short_description: "一句話描述", long_description: "完整描述", marketing_copy: "行銷短文", social_post: "社群貼文",
  seo_keywords: "關鍵字", feature_bullets: "特色", description: "說明", reason: "原因", action: "建議行動",
};

/** 把 AI 功能回傳的結構化內容整理成一般人看得懂的文字 */
export function renderValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return value.toLocaleString("zh-TW");
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map(item => {
      const rendered = renderValue(item, depth + 1);
      return rendered ? `• ${rendered.replace(/\n/g, "\n  ")}` : "";
    }).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, inner]) => {
      const rendered = renderValue(inner, depth + 1);
      if (!rendered) return "";
      const label = LABELS[key] ?? key;
      return rendered.includes("\n") || depth === 0 ? `【${label}】\n${rendered}` : `${label}：${rendered}`;
    }).filter(Boolean).join(depth === 0 ? "\n\n" : "\n");
  }
  return String(value);
}

/** 把各功能的回應整理成對話可以顯示的統一格式 */
export function formatAnswer(tool: Exclude<ChatTool, "reply">, status: number, body: any): ChatAnswer {
  const link = CHAT_TOOL_PAGES[tool];
  if (status === 403 && body?.code === "module_disabled") {
    return { tool, ok: false, text: "這個 AI 功能目前沒有開放，如需使用請聯絡管理員。" };
  }
  if (status < 200 || status >= 300) {
    return { tool, ok: false, text: typeof body?.error === "string" ? body.error : "這個功能暫時無法使用，請稍後再試。", link, detail: typeof body?.sql === "string" ? body.sql : undefined };
  }
  switch (tool) {
    case "query": {
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      const columns = Array.isArray(body?.columns) ? body.columns.map(String) : [];
      return {
        tool, ok: true,
        text: String(body?.summary || `共 ${rows.length} 筆資料。`),
        table: rows.length > 0 && columns.length > 0 ? { columns, rows: rows.slice(0, 50), totalRows: rows.length } : undefined,
        detail: typeof body?.intent === "string" ? body.intent : undefined,
        link,
      };
    }
    case "monthly_report":
      return { tool, ok: true, text: renderValue(body?.report) || "月報沒有產生內容。", link };
    case "anomalies": {
      const parts = [
        `近 ${body?.period?.days ?? ""} 天共找到 ${body?.totalCount ?? 0} 筆需要留意的項目。`,
        renderValue(body?.summary),
        body?.topRisks?.length ? `【主要風險】\n${renderValue(body.topRisks, 1)}` : "",
        body?.recommendation ? `【建議】\n${renderValue(body.recommendation, 1)}` : "",
      ];
      return { tool, ok: true, text: parts.filter(Boolean).join("\n\n"), link };
    }
    case "classify_complaint":
      return { tool, ok: true, text: renderValue(body?.classification) || "沒有分類結果。", link };
    case "product_description":
      return { tool, ok: true, text: renderValue(body?.generated) || "沒有產生內容。", link };
  }
}
