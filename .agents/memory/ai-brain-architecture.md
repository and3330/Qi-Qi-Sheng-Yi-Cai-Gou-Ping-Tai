---
name: AI 大腦（RAG＋助理＋客服）架構決策
description: AI 知識庫索引、行政助理兩段式確認、衛教客服 guardrail 的關鍵設計與陷阱
---

## 向量檢索是可選的
Replit OpenAI/Gemini 代理不支援 embeddings API。aiIndex 設計為：有 `OPENAI_API_KEY` 才產生向量（text-embedding-3-small, 1536 維, pgvector），否則 embedding=null，searchDocuments 退回關鍵字檢索（中文問句拆雙字詞＋停用詞＋標題加權排序）。切換後需跑 POST /api/admin/ai-index/rebuild。
**Why:** 平台代理限制；系統必須在無金鑰時仍可用。

## 行政助理操作必須伺服器端兩段式確認
Prompt 裡的「先確認再執行」不可信（架構師審查判定為重大漏洞）。實作：操作工具第一次呼叫只建立 ai_action_logs pending 紀錄並回傳 confirmationId；執行需帶 confirmationId，以原子 UPDATE 認領（status=pending、同人同對話同工具、requestNonce 不同＝必須跨 HTTP 請求、10 分鐘內、單次有效），並以 pending 時保存的參數執行防抽換。機構錢包儲值僅限 admin 角色。
**陷阱:** 工具回傳不會存入對話歷史，下一輪模型會忘記 confirmationId — 路由端須查最新 pending 紀錄注入 system 提示。

## 衛教客服 guardrail
會員 RAG 只查 scope=public 文件；模型以輸出「[轉真人]」標記觸發 needsHuman（伺服器剝除標記後入庫）；轉真人後 AI 停止回覆、等客服 agent 角色訊息。禁療效宣稱、禁診斷用藥建議寫在 system prompt。

## 索引同步
mutation 路由以 fire-and-forget reindex(kind,id) 同步；刪除用 removeFromIndex。新增資料寫入路由時記得掛 hook。

## AI CMO 模組
- SSE 串流不走 orval（不支援），前端以 fetch+ReadableStream 解析；對話無伺服器狀態，context 由伺服器注入，AI 僅建議不執行操作。
- 「每日」自動報告必須基於已完整結束的日期（前一日）生成，避免半日數據誤導；排程冪等靠 DB 部分唯一約束，勿只靠記憶體旗標。

## 商城後台與 ERP 共用同一個 AI 大腦
ERP 儀表板與商城後台共用同一份行政助理對話、查詢工具與兩段式操作確認，不建立第二套互不相通的 AI。ERP 入口本身不代表取得平台營運資料權限，目前只有平台 admin/ops 可掛載完整 AI。
**Why:** 跨系統共用才能延續上下文，但直接把行政助理端點放寬給所有 ERP 角色會讓既有 staff 索引與商城資料越權外洩。
**How to apply:** 新增任何 ERP AI 入口時沿用同一 conversation owner；若要開放 ERP-only 角色，須先對每個查詢工具、RAG 文件與操作能力建立 ERP 角色/選單範圍，不可只修改路由 middleware。
