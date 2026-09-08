export const ARTICLE_CATEGORIES = [
  "營養保健",
  "居家照護",
  "健康",
  "會員權益",
  "訂購須知",
] as const;

export const ANNOUNCEMENT_CATEGORIES = [
  "平台公告",
  "產品快報",
  "活動訊息",
  "合作醫院",
  "知識文章",
] as const;

export const NEWS_CATEGORIES = ["全部", ...ANNOUNCEMENT_CATEGORIES] as const;