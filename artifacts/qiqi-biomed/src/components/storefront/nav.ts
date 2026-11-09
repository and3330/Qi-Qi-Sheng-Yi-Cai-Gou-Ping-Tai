export const SHOP_CATEGORIES = [
  { name: "保健食品", desc: "日常營養補充" },
  { name: "醫療耗材", desc: "院所與居家耗材" },
  { name: "保養清潔", desc: "清潔與肌膚照護" },
  { name: "院所專區", desc: "醫療院所採購品項" },
] as const;

export const categoryHref = (c: string) => `/shop?category=${encodeURIComponent(c)}`;

export const INFO_LINKS = [
  { name: "最新消息", path: "/news" },
  { name: "知識專區", path: "/knowledge" },
  { name: "合作醫院", path: "/hospitals" },
];

export const MEMBER_LINKS = [
  { name: "會員中心", path: "/member" },
  { name: "訂單查詢", path: "/orders" },
  { name: "我的點數", path: "/points" },
  { name: "收藏清單", path: "/favorites" },
  { name: "快速訂購", path: "/quick-order" },
  { name: "客服中心", path: "/support" },
];
