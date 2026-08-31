import {
  db,
  pool,
  productsTable,
  institutionsTable,
  articlesTable,
  announcementsTable,
} from "@workspace/db";

const img = (name: string) => `/images/products/${name}.jpg`;

const products = [
  { code: "10011", name: "七期益生菌 複方膠囊", category: "保健食品", spec: "60粒/盒", description: "嚴選專利菌株，每份含 300 億活菌，搭配益生元促進定殖，維持消化道機能。", imageUrl: img("probiotics"), priceHospital: 680, priceClinic: 780, priceConsumer: 980, stock: 500, isHot: true, isNew: false },
  { code: "10012", name: "深海魚油 Omega-3 軟膠囊", category: "保健食品", spec: "90粒/瓶", description: "rTG 型式高濃度魚油，EPA+DHA 達 84%，通過重金屬與塑化劑檢驗。", imageUrl: img("fishoil"), priceHospital: 750, priceClinic: 850, priceConsumer: 1080, stock: 420, isHot: true, isNew: false },
  { code: "10013", name: "游離型葉黃素 晶亮膠囊", category: "保健食品", spec: "30粒/盒", description: "FloraGLO 游離型葉黃素搭配玉米黃素 10:2 黃金比例，長時間用眼族群適用。", imageUrl: img("lutein"), priceHospital: 520, priceClinic: 590, priceConsumer: 750, stock: 600, isHot: true, isNew: true },
  { code: "10014", name: "高單位 B 群緩釋錠", category: "保健食品", spec: "60錠/瓶", description: "八種 B 群緩釋技術，持續釋放 8 小時，上班族與輪班族的活力補給。", imageUrl: img("vitaminb"), priceHospital: 380, priceClinic: 430, priceConsumer: 550, stock: 800, isHot: false, isNew: false },
  { code: "10015", name: "檸檬酸鈣+D3 錠", category: "保健食品", spec: "120錠/瓶", description: "檸檬酸鈣吸收率佳，添加維生素 D3 幫助鈣質吸收，維持骨骼健康。", imageUrl: img("calcium"), priceHospital: 450, priceClinic: 520, priceConsumer: 680, stock: 350, isHot: false, isNew: false },
  { code: "10016", name: "薑黃素 95% 萃取膠囊", category: "保健食品", spec: "60粒/盒", description: "95% 高純度薑黃素搭配黑胡椒萃取，吸收率提升 20 倍，調節生理機能。", imageUrl: img("curcumin"), priceHospital: 620, priceClinic: 700, priceConsumer: 880, stock: 280, isHot: false, isNew: true },
  { code: "20021", name: "醫用電子血壓計", category: "醫療耗材", spec: "1台/盒", description: "上臂式全自動血壓計，大字幕顯示與不規則脈波提示，二人記憶各 60 組。", imageUrl: img("bpmonitor"), priceHospital: 1650, priceClinic: 1850, priceConsumer: 2280, stock: 120, isHot: true, isNew: false },
  { code: "20022", name: "醫療級平面口罩", category: "醫療耗材", spec: "50入/盒", description: "雙鋼印醫療口罩，BFE 99% 三層防護，台灣製造。", imageUrl: img("masks"), priceHospital: 99, priceClinic: 120, priceConsumer: 150, stock: 2000, isHot: true, isNew: false },
  { code: "20023", name: "75% 酒精清潔噴霧", category: "醫療耗材", spec: "500ml/瓶", description: "食品級酒精製成，適用手部與環境清潔，附噴頭設計方便使用。", imageUrl: img("alcohol"), priceHospital: 85, priceClinic: 99, priceConsumer: 129, stock: 1500, isHot: false, isNew: false },
  { code: "20024", name: "血糖機試紙組", category: "醫療耗材", spec: "50片/盒", description: "適用七期血糖機系列，5 秒快速測量，僅需 0.5µL 微量血液。", imageUrl: img("glucosestrips"), priceHospital: 720, priceClinic: 820, priceConsumer: 990, stock: 300, isHot: false, isNew: true },
  { code: "30031", name: "胺基酸溫和洗面乳", category: "保養清潔", spec: "120g/條", description: "胺基酸系界面活性劑，pH5.5 弱酸性配方，敏弱肌適用。", imageUrl: img("cleanser"), priceHospital: 280, priceClinic: 320, priceConsumer: 420, stock: 450, isHot: false, isNew: false },
  { code: "40041", name: "無粉 NBR 檢診手套", category: "院所專區", spec: "100入/盒", description: "醫療級 NBR 材質，無粉低過敏設計，院所檢診專用。", imageUrl: img("gloves"), priceHospital: 180, priceClinic: 210, priceConsumer: 260, stock: 900, isHot: false, isNew: false },
];

const institutions = [
  { name: "臺中榮民總醫院", type: "hospital", city: "台中市", address: "台中市西屯區臺灣大道四段1650號", phone: "04-2359-2525", hours: "週一至週五 08:00-17:00", departments: ["家醫科", "心臟內科", "新陳代謝科", "骨科", "復健科"] },
  { name: "中國醫藥大學附設醫院", type: "hospital", city: "台中市", address: "台中市北區育德路2號", phone: "04-2205-2121", hours: "週一至週六 08:00-17:30", departments: ["中醫科", "腸胃科", "神經內科", "眼科"] },
  { name: "七期康心診所", type: "clinic", city: "台中市", address: "台中市西屯區市政北二路238號", phone: "04-2255-1234", hours: "週一至週六 09:00-21:00", departments: ["家醫科", "內科"] },
  { name: "惠民聯合診所", type: "clinic", city: "彰化縣", address: "彰化縣彰化市中山路二段556號", phone: "04-722-8899", hours: "週一至週五 08:30-21:30", departments: ["小兒科", "耳鼻喉科"] },
  { name: "安心藥局", type: "pharmacy", city: "台中市", address: "台中市南屯區公益路二段51號", phone: "04-2320-5678", hours: "每日 09:00-22:00", departments: [] },
  { name: "祐全藥局", type: "pharmacy", city: "台北市", address: "台北市大安區和平東路二段96號", phone: "02-2733-4455", hours: "週一至週六 09:00-21:00", departments: [] },
];

const articles = [
  { kind: "article", title: "益生菌怎麼挑？三個關鍵一次看懂", category: "營養保健", summary: "菌株編號、活菌數與益生元，是挑選益生菌的三大關鍵。", imageUrl: img("probiotics"), content: "## 為什麼要看菌株編號\n\n同一菌種不同菌株，功效可能完全不同。選擇有臨床實證的專利菌株（如標示完整菌株編號者），才能確保效果。\n\n## 活菌數不是越多越好\n\n重點在於「到達腸道的活菌數」。建議選擇有包埋技術或耐胃酸實證的產品，每日 100～300 億即足夠。\n\n## 搭配益生元效果加乘\n\n益生元（如果寡糖、菊苣纖維）是益生菌的養分，能幫助好菌在腸道定殖，選擇複方設計更理想。" },
  { kind: "article", title: "魚油 EPA/DHA 比例怎麼選？", category: "營養保健", summary: "不同族群適合的 EPA 與 DHA 比例不同，選對才有感。", imageUrl: img("fishoil"), content: "## EPA 與 DHA 的差異\n\nEPA 主要參與循環與代謝調節，DHA 則與思緒清晰、視覺保健相關。\n\n## 如何挑選\n\n- 上班族日常保養：EPA:DHA 約 3:2 的均衡配方\n- 銀髮族循環保養：高 EPA 配方\n- 學齡孩童與孕媽咪：高 DHA 配方\n\n## 濃度與型式\n\nrTG 型式吸收率較佳，建議選擇 Omega-3 濃度 80% 以上的產品。" },
  { kind: "article", title: "3C 族護眼指南：葉黃素這樣補", category: "營養保健", summary: "長時間看螢幕的你，需要每日 10mg 游離型葉黃素。", imageUrl: img("lutein"), content: "## 為什麼需要葉黃素\n\n葉黃素是視網膜黃斑部的重要成分，人體無法自行合成，必須從飲食或補充品攝取。\n\n## 每日建議量\n\n研究建議每日補充葉黃素 10mg + 玉米黃素 2mg（黃金比例 10:2），連續補充 2～4 個月較有感。\n\n## 游離型 vs 酯化型\n\n游離型分子較小、不需消化酵素分解即可吸收，空腹也能補充，是多數專家推薦的型式。" },
  { kind: "article", title: "在家量血壓的正確方式：722 原則", category: "居家照護", summary: "掌握 722 原則，量出真正有參考價值的血壓數據。", imageUrl: img("bpmonitor"), content: "## 什麼是 722 原則\n\n- **7**：連續 7 天測量\n- **2**：每天早晚各量 2 回\n- **2**：每回量 2 次取平均\n\n## 測量前注意\n\n測量前 30 分鐘避免咖啡因、運動與抽菸，靜坐休息 5 分鐘後再量。\n\n## 正確姿勢\n\n背有靠、腳放平、手臂與心臟同高，壓脈帶下緣距手肘窩約兩指幅。" },
  { kind: "faq", title: "訂單成立後多久出貨？", category: "訂購須知", summary: "", content: "一般商品於訂單成立（匯款確認或選擇貨到付款）後 1～2 個工作天內出貨，宅配約 1～2 天送達。院所大宗採購另有專人聯繫安排。" },
  { kind: "faq", title: "匯款後需要通知嗎？", category: "訂購須知", summary: "", content: "請於匯款後至「會員中心 > 訂單查詢」回報帳號後五碼，或聯繫客服專線。我們確認入帳後即安排出貨並更新訂單狀態。" },
  { kind: "faq", title: "醫院 / 診所藥局會員如何申請？", category: "會員權益", summary: "", content: "註冊後至會員中心選擇會員身份並綁定合作院所，經平台審核通過後即可享有對應之採購價格。審核約需 1～3 個工作天。" },
  { kind: "faq", title: "商品可以退換貨嗎？", category: "訂購須知", summary: "", content: "非瑕疵商品於收貨後 7 天內保持包裝完整可申請退貨；保健食品拆封後基於衛生考量恕不退換。瑕疵品請拍照聯繫客服，我們將優先處理換貨。" },
];

const announcements = [
  { title: "七期生醫採購平台正式上線，會員註冊即享首購優惠", content: "歡迎加入七期生醫！即日起完成會員註冊並綁定身份，首筆訂單即享專屬採購價。院所會員另有大宗採購方案，歡迎洽詢。" },
  { title: "9 月院所採購月：醫療耗材滿萬折千", content: "9/1 至 9/30 期間，醫院與診所藥局會員採購醫療耗材類商品單筆滿 NT$10,000 現折 NT$1,000，數量有限，請及早下單。" },
  { title: "中秋連假出貨公告", content: "中秋連假期間（9/25-9/28）暫停出貨，9/29 起依訂單順序陸續安排出貨，造成不便敬請見諒。" },
  { title: "新品上市：游離型葉黃素、薑黃素 95% 膠囊", content: "全新升級配方正式上架！游離型葉黃素採 FloraGLO 專利原料，薑黃素 95% 搭配黑胡椒萃取吸收更佳，歡迎選購。" },
];

async function seed() {
  const existing = await db.select({ id: productsTable.id }).from(productsTable).limit(1);
  if (existing.length > 0) {
    console.log("Already seeded, skipping.");
    return;
  }
  await db.insert(productsTable).values(products);
  await db.insert(institutionsTable).values(institutions);
  await db.insert(articlesTable).values(articles);
  await db.insert(announcementsTable).values(announcements);
  console.log("Seeded.");
}

seed()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
