import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { randomBytes } from "node:crypto";

/** 寄件域名（Resend DNS 驗證） */
export const newsletterDomainsTable = pgTable("newsletter_domains", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  resendDomainId: text("resend_domain_id"),
  // pending | verified | failed | temporary_failure | not_started
  status: text("status").notNull().default("pending"),
  dnsRecords: jsonb("dns_records"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * 公開 v1 API 用的金鑰。僅儲存雜湊值（sha256），原始金鑰只在建立當下
 * 回傳一次，之後無法再次取得；keyLastFour 供後台辨識用。
 */
export const newsletterApiKeysTable = pgTable("newsletter_api_keys", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyLastFour: text("key_last_four").notNull().default(""),
  // full | subscribe_only
  permissions: text("permissions").notNull().default("full"),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 訂閱者 */
export const newsletterSubscribersTable = pgTable(
  "newsletter_subscribers",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name"),
    // 標籤陣列（字串）
    tags: jsonb("tags").notNull().default([]),
    // subscribed | unsubscribed
    status: text("status").notNull().default("subscribed"),
    // manual | import | api
    source: text("source").notNull().default("manual"),
    // 退訂連結專用權杖（不可猜測），退訂僅能以此權杖驗證，不可用 email 直接退訂
    unsubscribeToken: text("unsubscribe_token")
      .notNull()
      .unique()
      .$defaultFn(() => randomBytes(24).toString("hex")),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("idx_newsletter_subscribers_status").on(t.status)],
);

/** 郵件活動 */
export const newsletterCampaignsTable = pgTable(
  "newsletter_campaigns",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    fromEmail: text("from_email").notNull(),
    htmlContent: text("html_content").notNull().default(""),
    // 只寄給含此標籤的訂閱者（null = 全部）
    tagFilter: text("tag_filter"),
    // draft | scheduled | sending | sent | failed
    status: text("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at"),
    sentAt: timestamp("sent_at"),
    recipientCount: integer("recipient_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("idx_newsletter_campaigns_status").on(t.status, t.scheduledAt)],
);

/** 發送記錄（活動與序列共用；campaignId/sequenceStepId 擇一） */
export const newsletterSendLogsTable = pgTable(
  "newsletter_send_logs",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id").references(() => newsletterCampaignsTable.id),
    sequenceStepId: integer("sequence_step_id"),
    subscriberId: integer("subscriber_id"),
    email: text("email").notNull(),
    subject: text("subject"),
    // sent | failed
    status: text("status").notNull().default("sent"),
    error: text("error"),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_newsletter_send_logs_campaign").on(t.campaignId),
    index("idx_newsletter_send_logs_sent_at").on(t.sentAt),
  ],
);

/** 自動序列（Drip Sequence） */
export const newsletterSequencesTable = pgTable("newsletter_sequences", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  fromEmail: text("from_email"),
  isActive: boolean("is_active").notNull().default(false),
  // 視覺化流程編輯器資料（節點位置等）
  flowData: jsonb("flow_data"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** 序列步驟 */
export const newsletterSequenceStepsTable = pgTable(
  "newsletter_sequence_steps",
  {
    id: serial("id").primaryKey(),
    sequenceId: integer("sequence_id")
      .notNull()
      .references(() => newsletterSequencesTable.id),
    stepOrder: integer("step_order").notNull().default(1),
    delayDays: integer("delay_days").notNull().default(0),
    subject: text("subject").notNull(),
    htmlContent: text("html_content").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_newsletter_sequence_steps_seq").on(t.sequenceId, t.stepOrder)],
);

/** 序列入列記錄 */
export const newsletterSequenceEnrollmentsTable = pgTable(
  "newsletter_sequence_enrollments",
  {
    id: serial("id").primaryKey(),
    sequenceId: integer("sequence_id")
      .notNull()
      .references(() => newsletterSequencesTable.id),
    subscriberId: integer("subscriber_id")
      .notNull()
      .references(() => newsletterSubscribersTable.id),
    // 已完成的步驟數（0 = 尚未寄出第一封）
    currentStep: integer("current_step").notNull().default(0),
    // active | completed | cancelled | failed（重試達上限，需人工處理）
    status: text("status").notNull().default("active"),
    nextSendAt: timestamp("next_send_at"),
    // 目前這一步累積的寄送失敗次數；成功寄出後歸零。用於退避重試與失敗上限判斷。
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lastError: text("last_error"),
    enrolledAt: timestamp("enrolled_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    uniqueIndex("uq_newsletter_enrollment").on(t.sequenceId, t.subscriberId),
    index("idx_newsletter_enrollments_due").on(t.status, t.nextSendAt),
  ],
);

export type NewsletterDomain = typeof newsletterDomainsTable.$inferSelect;
export type NewsletterApiKey = typeof newsletterApiKeysTable.$inferSelect;
export type NewsletterSubscriber = typeof newsletterSubscribersTable.$inferSelect;
export type NewsletterCampaign = typeof newsletterCampaignsTable.$inferSelect;
export type NewsletterSendLog = typeof newsletterSendLogsTable.$inferSelect;
export type NewsletterSequence = typeof newsletterSequencesTable.$inferSelect;
export type NewsletterSequenceStep = typeof newsletterSequenceStepsTable.$inferSelect;
export type NewsletterSequenceEnrollment =
  typeof newsletterSequenceEnrollmentsTable.$inferSelect;
