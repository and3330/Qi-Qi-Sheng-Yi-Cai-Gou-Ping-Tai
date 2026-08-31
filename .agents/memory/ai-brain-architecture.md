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
