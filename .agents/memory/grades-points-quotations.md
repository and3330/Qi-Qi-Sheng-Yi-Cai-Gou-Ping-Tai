---
name: 分級/點數/報價單業務規則
description: 機構分級授權、點數累折、報價單轉訂單的關鍵不變量與決策
---

## 機構分級 × 商品授權
- 規則：products.allowedGrades（jsonb，null/空=不限）；會員分級 = 已審核綁定機構的 institutions.grade；後台角色回傳 "STAFF" 不受限。
- **Why:** 授權範圍是銷售合規需求，須在所有下單路徑一致把關。
- **How to apply:** 任何新的下單/建單路徑（前台結帳、AI 代客下單、報價單轉訂單、未來 LINE 下單）都必須呼叫 middlewares/optionalMember 的 resolveMemberGrade + gradeAllowed，否則就是分級繞過漏洞（曾被 architect 審查抓出）。

## 點數
- 規則：完成訂單每滿 NT$100 得 1 點；結帳折抵 1 點 = NT$1；orders.totalAmount 為折抵後淨額；佣金與回饋點數都以淨額計（刻意決策）。
- 扣點必須用條件式原子 UPDATE（points >= X），並寫 point_transactions；取消訂單退回折抵點數（type=refund）。

## 報價單
- 只有「accepted」且未過 validUntil 的報價單能轉訂單；轉單交易內鎖報價單列，且需重新驗證商品上架、規格啟用、會員分級。
- 狀態變更用條件式 UPDATE（WHERE status = 讀到的舊值），否則會與轉單競態。

## 其他
- 有啟用規格的商品：採購單與報價單品項都必須指定 variantId（與購物車/訂單相同的不變量）；PO 拒絕停售規格。
