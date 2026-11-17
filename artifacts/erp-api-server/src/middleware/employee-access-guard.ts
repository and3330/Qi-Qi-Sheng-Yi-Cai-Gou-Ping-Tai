import type { Request, Response, NextFunction } from "express";
import { EMPLOYEE_ROLE } from "./require-auth";

/**
 * 員工自助帳號（role=employee）只能使用自助功能：
 * 打自己的卡、看自己的出勤/薪資單、提出請假申請。
 * 其餘 API 一律 403。各路由內另有「只能操作自己資料」的細部限制。
 */
export function employeeAccessGuard(req: Request, res: Response, next: NextFunction): void {
  if ((req as any).apiKeyAuth) { next(); return; }
  const user = req.session?.user;
  if (!user || user.role !== EMPLOYEE_ROLE) { next(); return; }

  const path = req.path;
  const method = req.method;

  const allowed =
    // 認證相關
    path === "/admin/login" ||
    path === "/admin/logout" ||
    path === "/admin/me" ||
    path === "/admin/me/change-password" ||
    path === "/admin/me/shortcuts" ||
    path === "/admin/recovery-email" ||
    path === "/admin/verify-recovery-email" ||
    path === "/admin/forgot-password" ||
    path === "/admin/reset-password" ||
    path === "/health" ||
    // 打卡（路由內限制只能打自己的卡）
    path.startsWith("/attendance") ||
    // 請假：查詢自己的 + 提出申請（不可審批）
    (path === "/leaves" && (method === "GET" || method === "POST")) ||
    // 自己的假別餘額與假別清單；取消自己還沒核准的假單（原本這三個都被擋，員工看不到自己還剩幾天假）
    ((path === "/leaves/balance" || path === "/leaves/types") && method === "GET") ||
    (/^\/leaves\/\d+\/cancel$/.test(path) && method === "PATCH") ||
    // 工時表：填、查、刪自己的（路由內限制只能動自己的；核准與成本彙總另有角色限制）
    (path.startsWith("/timesheets") && path !== "/timesheets/review" && path !== "/timesheets/summary") ||
    // 薪資單：只能查詢（路由內限制只能看自己的）
    (path.startsWith("/salary-slips") && method === "GET") ||
    // 前端外框需要的唯讀資源
    (path === "/menu-permissions" && method === "GET") ||
    (path.startsWith("/notifications") && (method === "GET" || method === "PATCH")) ||
    // AI 對話：對話裡的每一步仍然用員工自己的身分回頭呼叫 API，一樣受這份清單限制
    (path === "/ai/chat" && method === "POST") ||
    // AI 拍照報銷：掃描發票、查分類、確認送出（confirm 內強制報銷人=自己）
    (path === "/reimbursement/scan" && method === "POST") ||
    (path === "/reimbursement/categories" && method === "GET") ||
    (path === "/reimbursement/confirm" && method === "POST") ||
    // 報銷表單需要的精簡主檔（只含 id/name，不含供應商聯絡資料等敏感欄位）
    (path === "/reimbursement/masters" && method === "GET") ||
    // 我的申請：自己送出付款／請款申請、看審批進度、撤回（路由內限制只能看、撤回自己送的）
    ((path === "/my-requests" || path === "/my-requests/options") && method === "GET") ||
    (path === "/my-requests" && method === "POST") ||
    (/^\/my-requests\/\d+\/cancel$/.test(path) && method === "POST") ||
    // 自己這張申請的收據照片：看、補、刪（路由內限制只能動自己的單、核准前才能改）
    (/^\/my-requests\/\d+\/attachments$/.test(path) && (method === "GET" || method === "POST")) ||
    (/^\/my-requests\/\d+\/attachments\/\d+$/.test(path) && (method === "GET" || method === "DELETE"));

  if (!allowed) {
    res.status(403).json({ error: "權限不足：員工帳號僅能使用打卡、出勤、薪資單、請假與自己的申請" });
    return;
  }
  next();
}
