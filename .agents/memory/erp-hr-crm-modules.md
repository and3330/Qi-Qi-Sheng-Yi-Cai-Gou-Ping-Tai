---
name: ERP HR/CRM/專案/資產/製造/品質/合約模組規則
description: /erp 新模組群（HR、CRM、專案、資產、製造、品質、合約、橫向功能）的關鍵不變式
---

- 薪資敏感資料遮罩在**後端**：非 PAYROLL_ROLES（super_admin/admin/hr_admin）的員工主檔回應剔除 baseSalary/bankAccount/idNumber/勞健保級距；/erp/hr/payroll* 與勞健保級距 API 整組角色限制。前端只是不顯示，不可依賴前端。
- 出勤打卡/請假的「自己」對應 erp_employees.memberId = 登入 member id；找不到員工檔回 400。
- 請假簽核、商機終態(won/lost)、製令狀態流轉一律條件式 UPDATE 防競態。
- 資產折舊：直線法、最後一期補尾差、(assetId,period) 唯一冪等；自動立帳走既有 createAutoJournalEntry 機制（sourceType 'asset_depreciation'、sourceId 'assetId-period'，fire-and-forget）。重跑 run 會對缺 journalEntryId 的舊列補立帳。
- 製令完工目前**不動庫存**（第一版僅單據管理，UI 有註明）；未來要接庫存時遵守庫存所有權規則。
- ERP CRM 客訴/工單與商城會員端 AI 客服 conversations 是各自獨立體系，勿混用。
- 全域搜尋員工結果僅 HR 角色可見且不含敏感欄位。
- 通知 createErpNotification 為 fire-and-forget，掛在請假/指派等寫入點。
- **Why:** 薪資/個資外洩與帳務重複入帳是最大風險；後端遮罩與冪等立帳是硬規則。
- **How to apply:** 新增回傳員工資料的端點都要走同一遮罩 helper；新增折舊/立帳路徑沿用 source 冪等。
