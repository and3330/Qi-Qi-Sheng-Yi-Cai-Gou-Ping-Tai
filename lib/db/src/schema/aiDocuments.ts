import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  vector,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * AI 知識庫文件（RAG 向量索引）
 * 全站資料同步成可檢索文件：商品、訂單、會員、機構、庫存異動、錢包／佣金、財務、CMS 內容
 */
export const aiDocumentsTable = pgTable(
  "ai_documents",
  {
    id: serial("id").primaryKey(),
    // product | order | member | institution | article | announcement | stock | finance | commission
    entityKind: text("entity_kind").notNull(),
    entityId: integer("entity_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    // 權限邊界：staff（後台人員）| public（已發佈內容，衛教客服可用）
    scope: text("scope").notNull().default("staff"),
    // 機構隔離（僅該機構可見的資料），null = 不限
    institutionId: integer("institution_id"),
    // OpenAI text-embedding-3-small = 1536 維；無金鑰時為 null（退回關鍵字檢索）
    embedding: vector("embedding", { dimensions: 1536 }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ai_doc_entity_idx").on(t.entityKind, t.entityId),
    index("ai_doc_scope_idx").on(t.scope),
  ],
);

export type AiDocument = typeof aiDocumentsTable.$inferSelect;

/** AI 行政助理操作稽核紀錄 */
export const aiActionLogsTable = pgTable("ai_action_logs", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").notNull(),
  // 工具名稱，如 create_order / adjust_stock
  action: text("action").notNull(),
  // 傳入參數快照
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  // pending（待確認）| executing | ok | error | rejected
  status: text("status").notNull(),
  result: text("result"),
  // 所屬對話（伺服器端確認機制）
  conversationId: integer("conversation_id"),
  // 建立 pending 時的請求代碼（稽核用途；不可作為授權依據）
  requestNonce: text("request_nonce"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AiActionLog = typeof aiActionLogsTable.$inferSelect;
