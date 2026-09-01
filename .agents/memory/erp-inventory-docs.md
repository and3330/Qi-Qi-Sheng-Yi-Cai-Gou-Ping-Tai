---
name: ERP 進銷存單據規則
description: 庫存所有權與退貨不變式等跨模組業務規則
---

## 庫存所有權（避免雙重扣帳）
- 商城訂單自動連動銷貨單；連動單的出貨/完成/取消一律委派商城訂單狀態機，ERP 不自行動庫存；ERP 原生單據才由 ERP 扣/補庫存。
- 虛擬品項判定以單據明細的 isVirtual 快照為準。

**Why:** 商城與 ERP 共用同一份庫存，兩邊都動會重複扣帳；快照避免品項事後改虛擬造成錯帳。
**How to apply:** 新增任何動庫存路徑時，先判斷單據是否連動商城，連動則委派。

## 退貨不變式
- 建立銷退/採退必須：合併同一來源明細的重複列、在同一交易內對來源單主檔 FOR UPDATE 鎖後再檢查累計退回量，否則重複列或併發可繞過超退檢查。
- 部分退貨不得改訂單終態；全數退貨必須走商城訂單狀態機的 returned 轉換（統一退款、收回點數/佣金、回補庫存並扣除先前部分退回已回補量）。

**Why:** 逐列檢查+無鎖 check-then-insert 有競態；狀態機外直寫 orders.status 會漏掉財務沖回並破壞報表/篩選。
**How to apply:** 任何「對既有單據建立沖銷/退回單」的新路徑都套同一模式；新增訂單終態要同步 openapi enum、報表排除條件與前端標籤。

## OpenAPI/orval 陷阱
- request body 一律用 $ref component schema；inline body 會與 orval 產生的 {OperationId}Body 型別名稱衝突。

## 其他
- 收斂舊 API 時用完整 410 handler 取代原 handler，勿在開頭塞 early-return（TS 對 unreachable code 失去 narrowing）。
- 本專案 DDL 遷移腳本必須冪等且涵蓋前置基礎表；dev/部署 DB 可能落後 schema 檔，執行前先比對 information_schema。
