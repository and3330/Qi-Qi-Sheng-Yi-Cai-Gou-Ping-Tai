/** 異動申請的審核規則（不碰資料庫，方便測試） */
export const CHANGE_DOC_TYPE = "ChangeRequest";
export const FINANCE_REVIEW_ROLES = ["finance_admin", "accountant"] as const;
export const TOP_REVIEW_ROLES = ["super_admin", "owner"] as const;
export type ChangeKind = "unlock" | "delete" | "edit" | "action";
export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = { unlock: "解鎖月份", delete: "刪除", edit: "修改", action: "異動" };
/** 一般單據（發票、銷貨單…）的異動申請：targetType 是「doc:資料表」，核准後重送原本的請求 */
export const DOC_TARGET_PREFIX = "doc:";

const isFinance = (role: string | null | undefined) => (FINANCE_REVIEW_ROLES as readonly string[]).includes(role || "");
const isTop = (role: string | null | undefined) => (TOP_REVIEW_ROLES as readonly string[]).includes(role || "");

/** 誰可以審這張異動申請。回傳 null＝可以審，否則回傳原因 */
export function changeReviewBlock(actor: { username?: string; role?: string } | undefined, request: { requestedBy: string | null; requestedRole?: string | null }): string | null {
  if (!actor) return "請先登入";
  if (actor.username && actor.username === request.requestedBy) return "不可審批自己提交的申請";
  if (isFinance(request.requestedRole) || isTop(request.requestedRole)) {
    return isTop(actor.role) ? null : "財務送出的異動申請要由超級管理員審核";
  }
  return isTop(actor.role) || isFinance(actor.role) ? null : "異動申請要由財務或超級管理員審核";
}

/** 這張申請要通知誰 */
export function changeReviewerRoles(requestedRole: string | null | undefined): string[] {
  return isFinance(requestedRole) || isTop(requestedRole) ? [...TOP_REVIEW_ROLES] : [...FINANCE_REVIEW_ROLES, ...TOP_REVIEW_ROLES];
}


const FIELD_LABELS: Record<string, string> = {
  entryDate: "日期", description: "說明", projectId: "專案", departmentId: "部門", lockDate: "關帳日",
  accountId: "科目", debit: "借方", credit: "貸方", party: "對象", lines: "明細",
  remarks: "備註", note: "備註", status: "狀態", reason: "原因", amount: "金額", dueDate: "到期日", items: "品項",
  customerId: "客戶", supplierId: "供應商", orderDate: "單據日期", invoiceDate: "發票日期", deliveryDate: "交期",
  label: "標題", paymentMethod: "付款方式", bankAccount: "銀行帳號", invoiceTitle: "發票抬頭", invoiceTaxId: "統一編號",
  location: "存放地點", currentValue: "目前價值", newValue: "新價值", name: "名稱", custodian: "保管人",
};
export const fieldLabel = (key: string) => FIELD_LABELS[key] ?? key;

/** 審核人改了哪些地方，寫成一句給人看（記進審批歷程和 H） */
export function payloadDiff(before: unknown, after: unknown): string {
  const a = (before ?? {}) as Record<string, unknown>, b = (after ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === "lines" && (Array.isArray(a.lines) || Array.isArray(b.lines))) {
      const la = (Array.isArray(a.lines) ? a.lines : []) as Record<string, unknown>[];
      const lb = (Array.isArray(b.lines) ? b.lines : []) as Record<string, unknown>[];
      if (la.length !== lb.length) out.push(`明細 ${la.length} 行 → ${lb.length} 行`);
      for (let i = 0; i < Math.min(la.length, lb.length); i++) {
        for (const f of new Set([...Object.keys(la[i] ?? {}), ...Object.keys(lb[i] ?? {})])) {
          if (String(la[i]?.[f] ?? "") !== String(lb[i]?.[f] ?? "")) out.push(`第 ${i + 1} 行${f === "description" ? "摘要" : FIELD_LABELS[f] ?? f}：${String(la[i]?.[f] ?? "") || "（空白）"} → ${String(lb[i]?.[f] ?? "") || "（空白）"}`);
        }
      }
      continue;
    }
    if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) out.push(`${FIELD_LABELS[key] ?? key}：${String(a[key] ?? "") || "（空白）"} → ${String(b[key] ?? "") || "（空白）"}`);
  }
  return out.join("；");
}
