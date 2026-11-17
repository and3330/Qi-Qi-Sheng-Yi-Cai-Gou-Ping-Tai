// 報帳分類字典 — 對應到 ERP 既有會計科目
// AI 識別發票後從這 33 個子類擇一回傳；找不到就走 19 雜支。

export type ExpenseCategory = {
  code: string;          // 報帳子類代號（例：15-3）
  name: string;          // 報帳子類名稱（例：設計費用）
  group: string;         // 大分類（例：固定支出）
  description: string;   // 用以說明 AI 判斷依據
  accountId: number;     // 對應的會計科目 id
  accountNumber: string; // 對應的會計科目編號
  accountName: string;   // 對應的會計科目名稱
};

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  // ===== 資本支出 =====
  { code: "11-1", name: "軟體使用費", group: "資本支出", description: "公司長期租賃／訂閱／買斷之軟體授權費、虛擬主機、網域", accountId: 854, accountNumber: "6236", accountName: "軟體租用費" },
  { code: "11-2", name: "系統模組費", group: "資本支出", description: "網站模組、網頁買斷、系統一次性買斷之費用", accountId: 854, accountNumber: "6236", accountName: "軟體租用費" },
  { code: "12-1", name: "生產機具", group: "資本支出", description: "大型機具、生產所使用之機具", accountId: 471, accountNumber: "144", accountName: "機(器)具及設備" },
  { code: "12-2", name: "辦公器材", group: "資本支出", description: "小型工具、辦公常態使用之器材", accountId: 663, accountNumber: "1888", accountName: "雜項資產 -其他" },
  { code: "12-3", name: "電子設備", group: "資本支出", description: "電腦、印表機、數據機、電子相關設備", accountId: 471, accountNumber: "144", accountName: "機(器)具及設備" },

  // ===== 固定支出 =====
  { code: "00-1", name: "營業稅", group: "固定支出", description: "營業稅捐、營利事業所得稅", accountId: 826, accountNumber: "6138", accountName: "營業稅" },
  { code: "00-2", name: "記帳費用", group: "固定支出", description: "外部記帳師費用", accountId: 859, accountNumber: "6241", accountName: "記帳費" },
  { code: "10-1", name: "租金支出", group: "固定支出", description: "辦公室、場地、攤位、會議室、教室租金", accountId: 895, accountNumber: "61121", accountName: "租金支出(營)-房屋租金" },
  { code: "10-2", name: "水電費用", group: "固定支出", description: "辦公室水費、電費", accountId: 807, accountNumber: "6119", accountName: "水電瓦斯費(營)" },
  { code: "10-3", name: "網路電話費", group: "固定支出", description: "辦公室電話費、網路費、通訊費", accountId: 897, accountNumber: "6116-1", accountName: "電話費(營)" },
  { code: "13",   name: "文具用品", group: "固定支出", description: "辦公文具：鉛筆、剪刀、美工刀等", accountId: 801, accountNumber: "6113", accountName: "文具用品(營)" },
  { code: "14",   name: "雜項購置", group: "固定支出", description: "費用低於 10000，公司協作用之器材", accountId: 822, accountNumber: "6134", accountName: "其他管理及總務費用(營)" },
  { code: "15-1", name: "行銷軟件", group: "固定支出", description: "Line/微信、社群、網路平台租賃購買之行銷軟件", accountId: 806, accountNumber: "6118", accountName: "廣告費(營)" },
  { code: "15-2", name: "招聘通路", group: "固定支出", description: "人力銀行等招募通路費", accountId: 806, accountNumber: "6118", accountName: "廣告費(營)" },
  { code: "15-3", name: "設計費用", group: "固定支出", description: "委外設計、輸出費用", accountId: 806, accountNumber: "6118", accountName: "廣告費(營)" },
  { code: "17",   name: "印刷費", group: "固定支出", description: "公司基本印刷、委外印刷費", accountId: 860, accountNumber: "6242", accountName: "印刷費(管)" },
  { code: "18",   name: "郵寄費用", group: "固定支出", description: "郵件寄送、貨運通路相關費用", accountId: 804, accountNumber: "6116", accountName: "郵電費(營)" },
  { code: "19",   name: "雜支", group: "固定支出", description: "不屬於以上任何分類的項目", accountId: 822, accountNumber: "6134", accountName: "其他管理及總務費用(營)" },

  // ===== 進貨費用 =====
  { code: "20-1", name: "魔術道具", group: "進貨費用", description: "魔術相關物品進貨", accountId: 772, accountNumber: "5112", accountName: "原料進料費用(製)" },
  { code: "20-2", name: "氣球材料", group: "進貨費用", description: "氣球產品進貨", accountId: 772, accountNumber: "5112", accountName: "原料進料費用(製)" },
  { code: "20-3", name: "手工藝材料", group: "進貨費用", description: "美術／手作相關材料進貨", accountId: 772, accountNumber: "5112", accountName: "原料進料費用(製)" },
  { code: "20-4", name: "科學零件", group: "進貨費用", description: "模型與化學相關材料進貨", accountId: 772, accountNumber: "5112", accountName: "原料進料費用(製)" },
  { code: "20-5", name: "桌遊項目", group: "進貨費用", description: "桌遊相關進貨", accountId: 772, accountNumber: "5112", accountName: "原料進料費用(製)" },
  { code: "20-6", name: "其他原料", group: "進貨費用", description: "不屬於以上的進貨原料", accountId: 772, accountNumber: "5112", accountName: "原料進料費用(製)" },

  // ===== 差旅費用 =====
  { code: "30-1", name: "交通費用", group: "差旅費用", description: "車馬費、計程車、油資、停車費、捷運悠遊卡", accountId: 825, accountNumber: "6137", accountName: "交通費(營)" },
  { code: "30-2", name: "差旅費用", group: "差旅費用", description: "外地住宿、出差膳食", accountId: 802, accountNumber: "6114", accountName: "旅費(營)" },

  // ===== 人事費 =====
  { code: "41-1", name: "工讀生", group: "人事費", description: "專案／活動短時間工讀生薪資", accountId: 893, accountNumber: "61112", accountName: "薪資支出(營)-工讀" },
  { code: "41-2", name: "鐘點費用", group: "人事費", description: "外派才藝講師、講師鐘點費", accountId: 821, accountNumber: "6133", accountName: "勞務費(營)" },
  { code: "41-3", name: "活動費", group: "人事費", description: "表演者費用、合作廠商費用", accountId: 828, accountNumber: "6140", accountName: "活動費用" },
  { code: "42",   name: "行政薪資", group: "人事費", description: "行政人員薪資（不含勞健保）", accountId: 892, accountNumber: "61111", accountName: "薪資支出(營)-正職" },
  { code: "43",   name: "獎金費用", group: "人事費", description: "員工獎金", accountId: 894, accountNumber: "61113", accountName: "獎金(營)" },

  // ===== 內部人事 =====
  { code: "50-1", name: "職工福利", group: "內部人事", description: "尾牙、聚會、團購、員工聚餐", accountId: 817, accountNumber: "6129", accountName: "職工福利(營)" },
  { code: "50-2", name: "顧問費", group: "內部人事", description: "聘請顧問之費用", accountId: 821, accountNumber: "6133", accountName: "勞務費(營)" },
  { code: "50-3", name: "勞保費用", group: "內部人事", description: "國家規定之勞工保險費", accountId: 858, accountNumber: "6240", accountName: "勞保費" },
  { code: "50-4", name: "健保費用", group: "內部人事", description: "國家規定之健康保險費", accountId: 857, accountNumber: "6239", accountName: "健保費" },
  { code: "50-5", name: "勞退費用", group: "內部人事", description: "國家規定之勞工退休金提撥", accountId: 856, accountNumber: "6238", accountName: "勞工退休金" },
];

export const FALLBACK_CATEGORY = EXPENSE_CATEGORIES.find((c) => c.code === "19")!;

export function findCategoryByCode(code: string): ExpenseCategory {
  return EXPENSE_CATEGORIES.find((c) => c.code === code) ?? FALLBACK_CATEGORY;
}

export function categoriesForPrompt(): string {
  return EXPENSE_CATEGORIES.map((c) => `- ${c.code} ${c.name}（${c.group}）：${c.description}`).join("\n");
}
