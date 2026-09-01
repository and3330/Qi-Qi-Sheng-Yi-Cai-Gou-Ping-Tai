---
name: 使用者提供之 URL 與 partial update 規則
description: 會員可存的外連 URL 驗證要求、PUT/settings partial update 慣例、moderation 停用需獨立欄位
---

**規則 1：** 任何由使用者提交、之後會渲染成 `<a href>` 的 URL，後端必須用 `new URL()` 解析並 allowlist 協定（http:、https:、mailto:、tel:），拒絕 javascript:、data:、相對路徑等。前端提示不可取代後端驗證。
**How to apply:** 新增任何含 URL 欄位的 API（連結頁、個人檔案、CMS 內容等）時套用。

**規則 2：** 欄位皆選填的 PUT/upsert 設定端點，只能寫入請求明確提供（!== undefined）的欄位；預設值只在初次建立時套用，否則合法的 partial update 會清空其他設定。

**規則 3：** 管理員的「停用/下架」moderation 必須用獨立欄位（如 is_blocked），與使用者自控的開關（is_active）分開；公開輸出需兩者同時允許，否則使用者可自行改回而使 moderation 失效。
