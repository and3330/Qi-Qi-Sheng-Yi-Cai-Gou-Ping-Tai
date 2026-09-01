import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** 社群帳號（FB 粉專 / IG 商業帳號 / Threads / X） */
export const socialMarketingAccountsTable = pgTable(
  "social_marketing_accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // facebook | instagram | threads | twitter
    platform: text("platform").notNull(),
    platformAccountId: text("platform_account_id").notNull(),
    accountName: text("account_name").notNull(),
    // page | instagram_business | threads | twitter
    accountType: text("account_type").notNull().default("page"),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at"),
    profileImageUrl: text("profile_image_url"),
    // { pageId, igAccountId, userId }
    metadata: jsonb("metadata"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_sma_platform").on(t.platform),
    unique("uq_sma_platform_account").on(t.platform, t.platformAccountId),
  ],
);

/** 社群貼文 */
export const socialPostsTable = pgTable(
  "social_posts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    content: text("content").notNull(),
    platforms: text("platforms").array().notNull().default(sql`ARRAY[]::text[]`),
    hashtags: text("hashtags"),
    imageUrls: text("image_urls").array().default(sql`ARRAY[]::text[]`),
    // 排程時間（null = 手動發布）
    scheduledAt: timestamp("scheduled_at"),
    publishedAt: timestamp("published_at"),
    // draft | scheduled | published | failed
    status: text("status").notNull().default("draft"),
    // 各平台發布結果 { [platform]: { success, postId?, error? } }
    platformResults: jsonb("platform_results"),
    // 各平台明確指定的社群帳號 UUID { [platform]: accountId }
    targetAccountIds: jsonb("target_account_ids")
      .notNull()
      .default(sql`'{}'::jsonb`),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_social_posts_status").on(t.status),
    index("idx_social_posts_scheduled").on(t.scheduledAt),
  ],
);

/** 行銷自動化設定（key-value） */
export const marketingAutomationSettingsTable = pgTable(
  "marketing_automation_settings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    key: text("key").notNull().unique(),
    enabled: boolean("enabled").notNull().default(false),
    config: jsonb("config"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
);

export type SocialMarketingAccount =
  typeof socialMarketingAccountsTable.$inferSelect;
export type SocialPost = typeof socialPostsTable.$inferSelect;
export type MarketingAutomationSetting =
  typeof marketingAutomationSettingsTable.$inferSelect;
