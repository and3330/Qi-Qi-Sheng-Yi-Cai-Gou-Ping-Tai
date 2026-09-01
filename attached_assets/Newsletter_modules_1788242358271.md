# 電子報模組 (Newsletter)

Resend 郵件發送、域名管理、API 金鑰管理、自動序列（Drip Sequence）與視覺化流程編輯器。

## 功能

1. **域名管理** — 新增/驗證/刪除自訂寄件域名（Resend DNS 驗證）
2. **API 金鑰管理** — 管理 Resend API 金鑰
3. **訂閱者管理** — 匯入/新增/編輯/刪除訂閱者，支援標籤分類與 CSV 匯入
4. **活動（Campaign）** — 建立郵件活動、HTML 編輯、排程發送、批次寄送
5. **自動序列** — 多步驟 Drip Sequence，可設定每封信的延遲天數
6. **自動入列** — 新訂閱者自動加入啟用中的序列
7. **流程編輯器** — 視覺化拖拉流程設計（flowData JSON 欄位）
8. **批次發送** — BATCH_SIZE=10, BATCH_DELAY_MS=1000 避免 API 限流
9. **公開 API** — v1 API 供外部系統訂閱/退訂/發送

## Schema（shared/schema.ts）

| 資料表 | 說明 |
|--------|------|
| `newsletterDomains` | 寄件域名（域名, 狀態, DNS 記錄）|
| `newsletterApiKeys` | API 金鑰（名稱, 金鑰, 權限）|
| `newsletterSubscribers` | 訂閱者（Email, 姓名, 標籤, 訂閱狀態）|
| `newsletterCampaigns` | 郵件活動（主旨, 內容, 排程時間, 狀態, 統計）|
| `newsletterSequences` | 自動序列定義 |
| `newsletterSequenceSteps` | 序列步驟（順序, 延遲天數, 主旨, 內容）|
| `newsletterSequenceEnrollments` | 序列入列記錄（訂閱者, 目前步驟, 下次發送時間）|

## API 端點（server/routes.ts）

### 域名
- `GET /api/newsletter/domains` — 取得域名列表
- `POST /api/newsletter/domains` — 新增域名
- `POST /api/newsletter/domains/:id/verify` — 驗證域名 DNS
- `DELETE /api/newsletter/domains/:id` — 刪除域名

### API 金鑰
- `GET /api/newsletter/api-keys` — 取得金鑰列表
- `POST /api/newsletter/api-keys` — 新增金鑰
- `PATCH /api/newsletter/api-keys/:id` — 更新金鑰
- `DELETE /api/newsletter/api-keys/:id` — 刪除金鑰

### 訂閱者
- `GET /api/newsletter/subscribers` — 取得訂閱者列表
- `POST /api/newsletter/subscribers` — 新增訂閱者
- `PATCH /api/newsletter/subscribers/:id` — 更新訂閱者
- `DELETE /api/newsletter/subscribers/:id` — 刪除訂閱者
- `POST /api/newsletter/subscribers/import` — CSV 匯入訂閱者

### 活動
- `GET /api/newsletter/campaigns` — 取得活動列表
- `POST /api/newsletter/campaigns` — 建立活動
- `PATCH /api/newsletter/campaigns/:id` — 更新活動
- `DELETE /api/newsletter/campaigns/:id` — 刪除活動
- `POST /api/newsletter/campaigns/:id/send` — 發送活動
- `POST /api/newsletter/campaigns/:id/schedule` — 排程活動
- `GET /api/newsletter/campaigns/:id/logs` — 取得發送記錄

### 序列
- `GET /api/newsletter/sequences` — 取得序列列表
- `GET /api/newsletter/sequences/:id` — 取得序列詳情
- `POST /api/newsletter/sequences` — 建立序列
- `PATCH /api/newsletter/sequences/:id` — 更新序列
- `DELETE /api/newsletter/sequences/:id` — 刪除序列
- `GET /api/newsletter/sequences/:id/steps` — 取得步驟列表
- `POST /api/newsletter/sequences/:id/steps` — 新增步驟
- `PATCH /api/newsletter/sequences/steps/:id` — 更新步驟
- `DELETE /api/newsletter/sequences/steps/:id` — 刪除步驟

### 用量
- `GET /api/newsletter/usage` — 取得郵件發送用量

### 公開 API（v1, 無需登入，使用 API 金鑰驗證）
- `POST /api/newsletter/v1/subscribers` — 外部訂閱
- `POST /api/newsletter/v1/unsubscribe` — 外部退訂
- `POST /api/newsletter/v1/send` — 外部發送郵件

## 後端服務

- **`server/newsletter-service.ts`**:
  - `addDomain()` / `verifyDomain()` / `getDomainStatus()` / `removeDomain()`
  - `sendCampaign()` — 批次發送活動郵件
  - `processScheduledCampaigns()` — 處理排程活動（每分鐘）
  - `processSequenceEnrollments()` — 處理序列入列（每小時）
  - `enrollSubscriberInSequences()` — 新訂閱者自動入列
  - `sendEmail()` — 單封郵件發送
  - `checkNewsletterQuota()` — 方案用量檢查

## 前端頁面

- `client/src/pages/newsletter-domains.tsx` — 域名管理
- `client/src/pages/newsletter-subscribers.tsx` — 訂閱者管理
- `client/src/pages/newsletter-campaigns.tsx` — 活動管理
- `client/src/pages/newsletter-sequences.tsx` — 序列管理
- `client/src/pages/sequence-flow-editor.tsx` — 視覺化流程編輯器

## 環境變數

| 變數 | 必要 | 說明 |
|------|------|------|
| `RESEND_API_KEY` | 是 | Resend 郵件服務 API Key |

## 依賴模組

- **帳務計費**: 受方案限制（每月郵件發送數量）
