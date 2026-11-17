import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/erp-db";
import { sql } from "drizzle-orm";
import { matchPostedRule, isPostedStatus, isNormalFlow, originalFor, changedOnly, driftedFields } from "../lib/posted-change-rules";
import { DOC_TARGET_PREFIX, NO_REVIEWER_NOTE, fieldLabel, hasOtherReviewer, registerDocReplayHandler, submitChangeRequest } from "../lib/change-requests";
import { auditLogsTable } from "@workspace/erp-db";
import { logger } from "../lib/logger";

/**
 * 已入帳單據的修改、作廢、取消先送審（老闆 2026-11-16）。
 * 擋在各單據路由前面：碰到已入帳的單，就把這次的請求存成異動申請、回 202「已送審」，不執行。
 * 財務或超級管理員核准後，系統用核准人的身分把同一個請求重送一次（帶一次性通行證，這裡就放行），
 * 原本各單據的檢查（關帳月份、狀態能不能換、分錄同步）全部照走。重送失敗，整筆核准退回。
 */

const REPLAY_HEADER = "x-change-replay";
const REASON_HEADER = "x-change-reason";
const replayTokens = new Map<string, { method: string; path: string; expires: number }>();

function takeReplayToken(req: Request): boolean {
  const token = req.get(REPLAY_HEADER);
  if (!token) return false;
  const t = replayTokens.get(token);
  replayTokens.delete(token);
  return !!t && t.expires > Date.now() && t.method === req.method.toUpperCase() && t.path === req.path;
}

function reasonOf(req: Request): string {
  const header = req.get(REASON_HEADER);
  if (header) { try { return decodeURIComponent(header).trim(); } catch { return header.trim(); } }
  const b = (req.body ?? {}) as Record<string, unknown>;
  return String(b.changeReason ?? b.reason ?? b.voidReason ?? "").trim();
}

export async function postedChangeGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const hit = matchPostedRule(req.method, req.path);
  if (!hit || !Number.isInteger(hit.id) || hit.id <= 0) { next(); return; }
  if (takeReplayToken(req)) { next(); return; }
  try {
    const { rule, id } = hit;
    const result: any = await db.execute(sql`select *, ${sql.raw(rule.numberColumn)} as "__number" from ${sql.identifier(rule.table)} where id = ${id}`);
    const row = (result.rows ?? result)[0] as Record<string, unknown> | undefined;
    if (!row || !isPostedStatus(rule, row.status) || isNormalFlow(rule, req.body)) { next(); return; }

    // 修改：只留真的有改的欄位。什麼都沒改就照原本流程走，不用審
    const isEdit = req.method.toUpperCase() === "PATCH";
    const body = isEdit ? changedOnly(row, req.body) : { ...((req.body ?? {}) as Record<string, unknown>) };
    delete body.changeReason;
    if (isEdit && Object.keys(body).length === 0) { next(); return; }
    // 只審特定欄位的單：沒改到那些欄位就照原本流程走；有改到就只送審那些欄位
    if (rule.gateFields) {
      for (const key of Object.keys(body)) if (!rule.gateFields.includes(key)) delete body[key];
      if (Object.keys(body).length === 0) { next(); return; }
    }

    const reason = reasonOf(req);
    const number = String(row.__number ?? `#${id}`);
    if (!reason) {
      res.status(428).json({ error: `${rule.label} ${number} 已經入帳，${rule.action}要先送審。請寫原因`, needsChangeReason: true, label: rule.label, number, action: rule.action });
      return;
    }
    const user = req.session?.user;
    const who = { username: user?.username || "API", role: user?.role ?? null };
    // 公司裡沒有其他人可以審（例如只有一個擁有者帳號）：原因照寫、紀錄照留，直接執行
    if (!(await hasOtherReviewer(db, who))) {
      await db.insert(auditLogsTable).values({
        action: "update", module: "Accounting", documentType: rule.table, documentId: id, documentNumber: number, userName: who.username,
        oldValues: originalFor(row, body), newValues: { summary: `${who.username} 自行${rule.action}（${NO_REVIEWER_NOTE}）；原因：${reason}`, payload: { method: req.method.toUpperCase(), path: req.path, body } },
        description: `${rule.action}${rule.label} ${number}（${NO_REVIEWER_NOTE}）`,
      });
      next(); return;
    }
    const { changeRequest } = await db.transaction(tx => submitChangeRequest(tx, {
      kind: req.method.toUpperCase() === "POST" ? "action" : "edit",
      targetType: `${DOC_TARGET_PREFIX}${rule.table}`, targetId: id, targetNumber: number,
      title: `${rule.action}${rule.label} ${number}`,
      payload: { method: req.method.toUpperCase(), path: req.path, body },
      original: originalFor(row, body), reason,
    }, who));
    res.status(202).json({ pending: true, changeGate: true, requestNumber: changeRequest.requestNumber, message: `已送出異動申請 ${changeRequest.requestNumber}，財務或超級管理員核准後才會${rule.action}` });
  } catch (err: any) {
    res.status(Number(err?.status) || 400).json({ error: err?.message || "送出異動申請失敗" });
  }
}

/** 核准後：用核准人的登入身分，把原本的請求重送給自己 */
registerDocReplayHandler(async (_tx, cr, ctx) => {
  const p = (cr.payload ?? {}) as { method?: string; path?: string; body?: unknown };
  if (!p.method || !p.path || !matchPostedRule(p.method, p.path)) throw Object.assign(new Error("異動申請內容不完整，無法執行"), { status: 400 });
  if (!ctx.cookie) throw Object.assign(new Error("請從網頁登入後再核准"), { status: 400 });
  // 送審之後這張單又被改過：不要用舊內容蓋掉，請申請人重送
  const hit = matchPostedRule(p.method, p.path)!;
  const found: any = await _tx.execute(sql`select * from ${sql.identifier(hit.rule.table)} where id = ${hit.id}`);
  const now = (found.rows ?? found)[0] as Record<string, unknown> | undefined;
  if (!now) throw Object.assign(new Error("這張單已經不在了，請駁回這張申請"), { status: 400 });
  const drift = driftedFields(now, cr.original as Record<string, unknown> | null);
  if (drift.length > 0) throw Object.assign(new Error(`這張單在送審之後又被改過（${drift.map(fieldLabel).join("、")}），核准會把新的內容蓋掉。請駁回，讓申請人重新送`), { status: 400 });
  const token = randomUUID();
  replayTokens.set(token, { method: p.method, path: p.path, expires: Date.now() + 60_000 });
  const port = process.env["PORT"];
  let r: globalThis.Response;
  try {
    r = await fetch(`http://127.0.0.1:${port}/api${p.path}`, {
      method: p.method,
      headers: { "content-type": "application/json", cookie: ctx.cookie, [REPLAY_HEADER]: token },
      body: JSON.stringify(p.body ?? {}),
    });
  } finally { replayTokens.delete(token); }
  if (r.status >= 400) {
    const data: any = await r.json().catch(() => ({}));
    logger.warn({ changeRequest: cr.requestNumber, status: r.status }, "change request replay failed");
    throw Object.assign(new Error(`執行失敗：${data?.error || data?.message || r.statusText}`), { status: 400 });
  }
  return `已${cr.title}`;
});
