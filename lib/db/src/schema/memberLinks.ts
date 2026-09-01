import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { membersTable } from "./members";

/** 會員 Linktree 連結（類 Linktree 個人連結頁） */
export const memberLinksTable = pgTable(
  "member_links",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    url: text("url").notNull(),
    icon: text("icon"),
    // link | social | video | music
    linkType: text("link_type").notNull().default("link"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    // 管理員停用（moderation lock）：會員無法自行解除；公開頁需 isActive && !isBlocked
    isBlocked: boolean("is_blocked").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_member_links_member").on(t.memberId)],
);

/** 會員 Linktree 外觀設定（每會員一筆） */
export const memberLinktreeSettingsTable = pgTable(
  "member_linktree_settings",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    bio: text("bio"),
    subtitle: text("subtitle"),
    // default | dark | gradient | pastel
    theme: text("theme").notNull().default("default"),
    backgroundColor: text("background_color"),
    buttonColor: text("button_color"),
    buttonTextColor: text("button_text_color"),
    // rounded | pill | square | outline
    buttonStyle: text("button_style").notNull().default("rounded"),
    showAvatar: boolean("show_avatar").notNull().default(true),
    customTitle: text("custom_title"),
  },
  (t) => [uniqueIndex("uq_member_linktree_settings_member").on(t.memberId)],
);

export type MemberLink = typeof memberLinksTable.$inferSelect;
export type MemberLinktreeSettings =
  typeof memberLinktreeSettingsTable.$inferSelect;
