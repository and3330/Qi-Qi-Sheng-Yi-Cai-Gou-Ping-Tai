# 七期生醫系統：AI 代理連線安裝說明

這份文件給「要幫七期生醫操作系統的 AI 代理」使用。
**用法：填好下面兩把金鑰，把「貼給 AI 的內容」整段複製，貼給你的 AI（Claude、ChatGPT、Codex、Grok 等支援 MCP 的代理）即可。**

整套系統有兩個連線入口，各管一半：

| 入口 | 管什麼 | 網址 | 金鑰從哪來 |
|---|---|---|---|
| 商城 | 後台的全部功能：商品與價格、庫存、訂單、會員與身份審核、機構、分潤、錢包、文章公告、電子報、社群貼文、報表 | `https://qi-qi-sheng-yi-cai-gou-ping-tai.replit.app/api/mcp` | 商城後台 →「Bot 連線」→ 新增金鑰 |
| ERP | 客戶、報價、銷貨、採購、庫存、會計、發票、人事、專案等全部模組 | `https://qi-qi-sheng-yi-cai-gou-ping-tai.replit.app/erp-mcp` | Replit 的 Secrets 設定 `ERP_AI_KEY_ADMIN` |

## 一、先準備兩把金鑰（只要做一次）

1. **商城金鑰**：用系統管理員帳號登入商城後台，到「Bot 連線」按「新增金鑰」。金鑰只會顯示一次，請立刻複製。
2. **ERP 金鑰**：到 Replit 專案的 Secrets 新增 `ERP_AI_KEY_ADMIN`，值自己取一串**至少 24 個字元**的亂碼（例如用密碼管理器產生 40 碼），存好後重新發布一次。
   - 要給不同職務的 AI 用不同權限時，可另外設定：`ERP_AI_KEY_SALES`（業務）、`ERP_AI_KEY_FINANCE`（財務）、`ERP_AI_KEY_READONLY`（唯讀）。每一把都要不一樣。

金鑰等同帳號密碼：不要貼在群組、文件或程式碼裡，只貼給你自己要用的 AI。要停用時，商城金鑰在「Bot 連線」停用或刪除；ERP 金鑰在 Secrets 改掉或刪除後重新發布。

## 二、貼給 AI 的內容（整段複製）

把 `【商城金鑰】`、`【ERP 金鑰】` 換成你的金鑰，再整段貼給 AI：

````text
請幫我連上「七期生醫」的兩個 MCP 伺服器，之後我會請你透過它們查詢與操作系統。

【連線設定】兩個都是 Streamable HTTP（無狀態，只用 POST），用 Bearer 金鑰驗證。

{
  "mcpServers": {
    "qiqi-shop": {
      "type": "http",
      "url": "https://qi-qi-sheng-yi-cai-gou-ping-tai.replit.app/api/mcp",
      "headers": { "Authorization": "Bearer 【商城金鑰】" }
    },
    "qiqi-erp": {
      "type": "http",
      "url": "https://qi-qi-sheng-yi-cai-gou-ping-tai.replit.app/erp-mcp",
      "headers": { "Authorization": "Bearer 【ERP 金鑰】" }
    }
  }
}

如果你是 Claude Code，請直接執行這兩行來安裝：
claude mcp add --transport http qiqi-shop https://qi-qi-sheng-yi-cai-gou-ping-tai.replit.app/api/mcp --header "Authorization: Bearer 【商城金鑰】"
claude mcp add --transport http qiqi-erp https://qi-qi-sheng-yi-cai-gou-ping-tai.replit.app/erp-mcp --header "Authorization: Bearer 【ERP 金鑰】"

如果你不支援 MCP，可以直接用 HTTP 呼叫（JSON-RPC 2.0）：
POST 上面的網址，標頭 Content-Type: application/json、Accept: application/json, text/event-stream、Authorization: Bearer 金鑰
列出工具：{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
呼叫工具：{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"工具名稱","arguments":{}}}

【裝好後請先做的事】
1. 對兩個伺服器各呼叫一次 tools/list，確認連得上，並把工具清單記下來。
2. 對 qiqi-shop 呼叫 admin_list_endpoints、對 qiqi-erp 呼叫 erp_list_endpoints（都可帶 keyword 篩選，例如 {"keyword":"商品"}），了解兩邊各有哪些功能可以操作。

【qiqi-shop：商城】
- 查詢類（直接回傳）：search_knowledge 查知識庫、sales_report 銷售報表、commission_report 佣金報表、low_stock 低庫存、list_orders 訂單列表、get_order 單一訂單、finance_summary 財務摘要、pending_tasks 待辦。
- 操作類（update_order_status 改訂單狀態、adjust_stock 調整庫存、topup_institution_wallet 機構錢包儲值、set_article_status 文章上下架、create_order 代客下單）：
  你呼叫後只會建立「待確認操作」，不會馬上生效。必須由後台人員登入商城後台「Bot 連線」按確認才會執行。
  你沒有辦法自己確認，也不要嘗試。建立後請告訴我「已送出，等後台確認」，之後用 get_action_status 查結果。
- 通用工具（可以使用商城後台的全部功能，約 130 個）：
  admin_list_endpoints 列出所有功能（可帶 keyword）；admin_describe_endpoint 查某個功能要帶哪些欄位；
  admin_get 查詢資料，參數 {"path":"/admin/members","query":{"search":"王"}}，直接回傳；
  admin_write 送出會改資料的操作，參數 {"method":"PATCH","path":"/admin/products/12","body":{...},"summary":"一句白話說明"}。
  例如：新增或修改商品與價格、上下架、審核會員的醫院或診所身份、修改機構、設定分潤規則、新增或編輯文章與公告、建立電子報、排程社群貼文。
  admin_write 跟其他操作類工具一樣，只會建立「待確認操作」，後台人員按確認後才生效，而且是用按確認那個人的權限執行。
  送出前請先用 admin_describe_endpoint 確認欄位；summary 要寫清楚對象與改動內容（例如「把商品 10011 的消費者價從 980 改成 950」），那是給按確認的人看的。
- 做不到的事：設定密碼、建立或管理金鑰、替自己按確認。遇到時請告訴我要自己到後台操作。
- 每次呼叫會扣商城的 AI 點數；回覆「AI 點數不足」時請告訴我，由管理員到後台儲值。

【qiqi-erp：ERP】
- 常用工具：search_customers 找客戶、search_documents／get_document 查單據、get_finance_summary 財務摘要、list_receivables 應收帳款、list_overdue_customers 逾期客戶、
  create_customer 建客戶、create_quotation 開報價單、get_quotation_pdf／send_quotation_pdf 報價單 PDF、
  list_unmatched_bank_entries／match_bank_entry 銀行對帳。
- 通用工具（全權金鑰才有）：erp_list_endpoints 列出所有可用功能；erp_request 直接操作任何模組，
  參數是 {"method":"GET|POST|PATCH|PUT|DELETE","path":"/customers","query":{},"body":{}}，path 用 erp_list_endpoints 回傳的路徑。
- 草稿類（create_document_draft、create_receipt_draft、create_customer_draft）：只建立草稿，要由人在 ERP 裡按確認才會變成正式單據。
- 留給人做、你做不到的事：付款、發薪、作廢、刪除、系統設定、把發票寄給客戶。erp_list_endpoints 裡標了 humanOnly 的功能就是這類，遇到時請告訴我要自己到 ERP 操作。
- 每一筆收入與支出都必須指定專案（projectId）。開報價單、銷貨單、採購單前，先用 erp_request GET /projects 找到專案編號。
- 商城的已付款訂單每小時會自動進 ERP（銷貨單編號開頭是 QIQI-SHOP-），不需要你手動搬。

【規則】
- 金額單位是新台幣。日期格式 YYYY-MM-DD，時區台北。
- 會改動資料的操作，執行前先跟我確認內容（對象、金額、數量）；我說好再做。
- 工具回傳錯誤時，把錯誤訊息原文告訴我，不要自己猜測或重試超過一次。
- 一分鐘最多 60 次請求，超過會被擋。
- 不要把金鑰寫進任何檔案、訊息或程式碼。
````

## 三、怎麼確認裝好了

請 AI 回答這兩個問題，答得出來就代表兩邊都通了：

- 「商城現在有哪些低庫存商品？」（走商城）
- 「ERP 這個月的收入是多少？」（走 ERP）

## 四、常見狀況

| 狀況 | 原因與處理 |
|---|---|
| ERP 回 503 `MCP configuration unavailable` | 還沒設定 `ERP_AI_KEY_ADMIN`、金鑰少於 24 個字元，或兩種職務設了同一把金鑰。修正後重新發布 |
| 回 401 | 金鑰打錯，或金鑰已停用 |
| 商城回「AI 點數不足」 | 到商城後台「AI 點數」儲值 |
| 商城的操作一直沒生效 | 還沒有人到後台「Bot 連線」按確認；待確認操作 60 分鐘後過期，要重新送 |
| 商城確認後顯示「沒有這個功能的權限」 | 按確認的人角色不夠（例如營運去確認只有系統管理員能做的事），請改由系統管理員確認 |
| ERP 回「請選擇專案」 | 單據少了專案，請 AI 先查 `/projects` 再帶 `projectId` |

## 五、給工程師：不經過 MCP 的 REST API

- **ERP**：所有功能都在 `/erp-api/` 底下。到 ERP「系統管理 → API 金鑰」建立金鑰（`erpk_` 開頭的金鑰＋`erps_` 開頭的密鑰，可設定權限），呼叫時帶
  `Authorization: Bearer erpk_xxx:erps_xxx`，或 `X-API-Key`＋`X-API-Secret` 兩個標頭。完整端點清單在 ERP「系統管理 → API 文件」。
- **外部系統送單進 ERP**：`POST /erp-api/integrations/events`（標準格式見 `GET /erp-api/integrations/format`），在 ERP「系統管理 → 外部串接」管理來源與對應。
- **商城**：`/api/` 底下是網站自己用的介面（登入後用 cookie），對外請一律走 `/api/mcp`；裡面的 `admin_get`、`admin_write` 可以使用後台全部功能。後台 API 有增減時，執行 `node scripts/build-admin-api-catalog.mjs` 重新產生功能清單再上線。
- 健康檢查：`GET /api/healthz`（商城）、`GET /erp-api/healthz`（ERP，會回報版本號）。
