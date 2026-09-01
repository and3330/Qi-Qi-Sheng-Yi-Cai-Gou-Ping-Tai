---
name: Social marketing integrations
description: Social account credentials are optional and platform failures must remain visible and isolated.
---

社群行銷模組必須把各平台憑證視為可選設定：未設定或授權失效時，後台應明確顯示原因並讓草稿、預覽與 AI 功能繼續可用，不可因單一平台阻止模組啟動或讓其他平台失敗。

**Why:** 實際部署常會分階段取得 Meta 與 X 的開發者憑證；硬性要求全部憑證會讓管理員無法先使用內容規劃與貼文管理。

**How to apply:** 新增平台或調整 OAuth、發布器與排程器時，將憑證檢查限制在該平台的操作，記錄每個平台的成功/失敗結果，並在管理頁提供可理解的設定提示。

所有社群 OAuth（不只使用 PKCE 的平台）都必須使用短效、一次性的 state，並綁定發起授權的管理員 session 與平台。

**Why:** 僅依 callback 的 code 連接帳號會讓已登入的管理員遭跨站請求誘導，誤綁攻擊者控制的社群帳號。

**How to apply:** 產生授權 URL 時建立 state；callback 在交換 token 前驗證 session、平台、時效並立即消耗 state。任何驗證失敗都要求重新授權。

每則可排程或發布的貼文必須保存各平台的目標帳號 ID；發布器不可用「第一個啟用帳號」作為隱含預設。

**Why:** 同平台可連接多個品牌帳號，任意選擇會把公司內容發到錯誤品牌，且資料庫的第一筆查詢順序不保證穩定。

**How to apply:** 草稿可暫時缺少目標；排程、立即發布與 AI 批次排程前，必須驗證每個目標帳號的平台相符且仍啟用，發布時只讀取貼文明確指定的 ID。