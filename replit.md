# 七期生醫採購平台 (Qiqi Biomed)

Mobile-first B2B2C 醫藥採購 WebApp：三種會員身份（A 醫院 / B 診所藥局 / C 消費者）依身份顯示不同採購價，含商城、快速訂購、購物車、訂單追蹤、知識專區、合作醫院名錄與會員中心。

## Run & Operate

- Workflows: `artifacts/api-server: API Server`（/api，port 由 PORT 決定）、`artifacts/qiqi-biomed: web`（前端，previewPath `/`）
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server exec tsx src/seed.ts` — seed demo data (idempotent, skips if products exist)
- Required env: `DATABASE_URL`, `SESSION_SECRET`（Clerk 已移除，`CLERK_*` 環境變數不再使用）

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + express-session (connect-pg-simple) + bcryptjs, Drizzle ORM + PostgreSQL
- Frontend: React + Vite + wouter + TanStack Query（Orval 產生 hooks）+ shadcn/Tailwind v4
- Auth: 自建帳號密碼會員系統（session cookie；`/api/auth/register|login|logout`、`GET /api/me` 未登入回 401）。members 表預留 `lineUserId`/`googleUserId` 供未來 LINE/Google 額外綁定。session 表由 drizzle schema 管理（`lib/db/src/schema/sessions.ts`）；`createTableIfMissing` 在 esbuild bundle 下會壞，勿開啟。

## Where things live

- OpenAPI 契約（single source of truth）：`lib/api-spec/openapi.yaml`
- DB schema：`lib/db/src/schema/`（members, products, carts, orders, institutions, content, favorites）
- API routes：`artifacts/api-server/src/routes/`；auth middleware：`src/middlewares/requireMember.ts`（讀 session.memberId 載入 member）
- 前端頁面：`artifacts/qiqi-biomed/src/pages/`；產品圖：`artifacts/qiqi-biomed/public/images/products/`
- Seed：`artifacts/api-server/src/seed.ts`

## Architecture decisions

- 三層價格存於 product 欄位（priceHospital/priceClinic/priceConsumer）；下單時價格一律由伺服器依 `member.tier` 計算，不信任 client。
- `PATCH /me` 不允許自行修改 tier（防止自我升級取得低價）；tier 由平台審核調整。
- 下單使用 DB transaction 原子扣庫存，庫存不足回 400。
- 付款僅開放 bank_transfer / cod；`wallet` enum 值預留給未來機構錢包模組。
- ERP、分潤、ICOPE、AI 客服等模組刻意未建，資料結構保留擴充點（member.points、institutions 綁定）。
- codegen script 內含 sed 將 zod import 改為 `zod/v4`（orval 產出 v4 語法）。

## 機構後台 (Institution Portal)

- `/portal`（總覽/orders/wallet/reports），限 tier hospital|clinic（`requirePortal`）；guest 導 /sign-in、consumer 顯示無權限。
- 資料範圍：`boundInstitutionId` 且 `institutionVerified=true`（管理員在 /admin 會員管理審核）才看得到全院所訂單，否則僅個人。會員自行改綁院所會自動重置審核狀態（`PATCH /me`）。
- 錢包為「個人錢包」（reuse GET /wallet），非機構共用錢包。
- 醫院/診所會員登入後，首頁顯示機構後台入口卡片。

## Product

- 公開瀏覽：首頁、商城（顯示消費者價）、知識專區、最新消息、合作醫院
- 登入後：購物車、快速訂購、結帳（匯款/貨到付款）、訂單狀態追蹤、收藏、會員中心（綁定院所/科室）

## User preferences

- 介面全繁體中文（zh-TW）、不用 emoji；使用者為非技術背景，以繁中溝通、少術語。
- 品牌：深綠醫療風（參考葡眾/葡萄王 App）。

## Gotchas

- 改 `lib/api-spec/openapi.yaml` 後必跑 codegen；body schema 命名用實體名（如 `ProductInput`）避免 TS2308。
- 前端登入狀態以 `useGetMe`（401 = 未登入）判斷，見 `src/hooks/use-auth.ts`；受保護頁未登入導向 `/sign-in`。
- 前端受保護的 query hooks 必須以 `isLoaded && isSignedIn` gate，否則登出狀態狂打 401。

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
