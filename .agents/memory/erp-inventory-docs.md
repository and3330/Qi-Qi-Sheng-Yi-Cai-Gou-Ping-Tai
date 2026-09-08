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

## 分倉庫存不變式（2026-09-01 起：warehouse_stock 才是唯一真實數字）
- 2026-09-01 修復雙重帳：products.stock / product_variants.stock 已改為**唯讀鏡像**，不再是權威、不再參與任何
  「庫存夠不夠」的判斷。唯一真實數字＝warehouse_stock（各倉庫存）加總。
- 任何扣/補庫存路徑一律只透過 lib/warehouseStock.ts 的函式異動分倉（allocateSellableStock / increaseWarehouseStock /
  decreaseWarehouseStock / adjustWarehouseStock），異動完成後呼叫該檔案的 syncMirrorStock(tx, {productId, variantId})
  把「各倉加總」寫回舊制欄位當鏡像；絕不可再對 productsTable.stock / productVariantsTable.stock 下條件式
  gte(...) UPDATE 當作第二道扣庫存關卡（那就是雙重帳的根源）。
- 出庫一律用 guarded UPDATE（quantity >= n）針對指定倉；商城下單走可售倉貪婪分配（預設倉優先），可售倉合計不足即擋單。
- 調撥（transfer 類型 movement）不改總量，stockAfter 記同步後的鏡像總量；每筆調撥寫出庫+入庫兩筆 movement 各帶 warehouseId。
- 同一商品/規格在單內出現多列時，必須先彙總再分配/寫 movement，否則以 key 覆蓋的分配結果會重複或遺漏。
- 佈署回填必須冪等且能校正部分同步（以「總量-各倉合計」差額補預設倉），不能只在建立預設倉時回填。

**Why:** 舊制總量欄位與各倉分表各自維護會漂移；把總量欄位降級為「異動後才同步」的唯讀鏡像，
可從根本消滅雙重扣帳風險，同時保留既有讀取路徑（列表/搜尋/AI 索引）不用大改。
**How to apply:** 新增任何扣/補庫存路徑時，只呼叫 warehouseStock.ts 的函式異動分倉，完成後呼叫一次
syncMirrorStock 同步鏡像；新增回填/遷移一律寫成可重跑的差額校正。

## OpenAPI/orval 陷阱
- request body 一律用 $ref component schema；inline body 會與 orval 產生的 {OperationId}Body 型別名稱衝突。
- query 參數勿加 minimum/maximum：orval zod 產出會在 const 宣告前引用（TS2448），數值夾限改在伺服器端做。

## 進銷存製單人規則
- 使用者手動選擇的 HR 員工必須存放在獨立的 `creatorEmployeeId`，不可覆寫既有 `createdBy`；前者是單據上的製單人，後者是實際操作帳號的稽核軌跡。
- 報價單轉銷貨單時沿用製單人；採購退回未另選製單人時沿用原採購單。採購入庫是更新原採購單，直接保留原製單人。
- 直接建立單據時只接受在職員工；歷史單據與未指定情況允許 null。

**Why:** 製單人可能與登入建立單據的人不同，但稽核紀錄仍必須保留真正的操作帳號。

**How to apply:** 新增進銷存單據或轉單流程時，同時考慮 `creatorEmployeeId` 的選取、回傳與繼承，不得改變 `createdBy` 語意。

## 其他
- 收斂舊 API 時用完整 410 handler 取代原 handler，勿在開頭塞 early-return（TS 對 unreachable code 失去 narrowing）。
- 本專案 DDL 遷移腳本必須冪等且涵蓋前置基礎表；dev/部署 DB 可能落後 schema 檔，執行前先比對 information_schema。
