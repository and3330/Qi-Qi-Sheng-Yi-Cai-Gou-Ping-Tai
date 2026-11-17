import { and, eq } from "drizzle-orm";
import { integrationEventsTable, integrationSourcesTable, journalEntriesTable, salesOrdersTable, type IntegrationSource } from "@workspace/erp-db";
import { normalizeEvent } from "./integration-format";
import { processEvent } from "./integration-process";
import { logger } from "./logger";

/**
 * 把外部送來的單據收進收件匣並馬上處理。
 * 外部系統自己推送、ERP 去對方那邊抓回來，走的是同一個入口，規則完全一樣。
 */

export interface IngestResult {
  ok: boolean; duplicate?: boolean; id?: number; externalId: string | null; status?: string; error?: string | null; result?: unknown;
}
/** 舊同步程式已經入過帳的單據：用舊的單號或分錄編號認，認到就不再入一次 */
export interface LegacyRef { salesOrderNumber?: string; journalEntryNumber?: string }

type Database = { select: any; insert: any; update: any; transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T> };

async function alreadyPostedByLegacy(database: Database, legacy: LegacyRef | undefined): Promise<string | null> {
  if (legacy?.salesOrderNumber) {
    const [order] = await database.select({ id: salesOrdersTable.id }).from(salesOrdersTable).where(eq(salesOrdersTable.orderNumber, legacy.salesOrderNumber)).limit(1);
    if (order) return `舊的同步已經入過帳（銷貨單 ${legacy.salesOrderNumber}），不再重複入帳`;
  }
  if (legacy?.journalEntryNumber) {
    const [entry] = await database.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(eq(journalEntriesTable.entryNumber, legacy.journalEntryNumber)).limit(1);
    if (entry) return `舊的同步已經入過帳（分錄 ${legacy.journalEntryNumber}），不再重複入帳`;
  }
  return null;
}

export async function ingestEvents(
  database: Database,
  batch: unknown[],
  opts: { actor: string; apiKeyId?: number | null; legacy?: (raw: any) => LegacyRef | undefined },
): Promise<IngestResult[]> {
  const sources: IntegrationSource[] = await database.select().from(integrationSourcesTable);
  const results: IngestResult[] = [];
  for (const raw of batch) {
    const parsed = normalizeEvent(raw);
    if (!parsed.ok) { results.push({ ok: false, externalId: (raw as any)?.externalId ?? null, error: parsed.error }); continue; }
    const event = parsed.event;
    const source = sources.find(s => s.code === event.source);
    if (!source) { results.push({ ok: false, externalId: event.externalId, error: `ERP 還沒有設定來源「${event.source}」，請先到「外部串接」新增` }); continue; }
    if (!source.isActive) { results.push({ ok: false, externalId: event.externalId, error: `來源「${source.name}」已停用` }); continue; }
    if (opts.apiKeyId != null && source.apiKeyId && source.apiKeyId !== opts.apiKeyId) { results.push({ ok: false, externalId: event.externalId, error: "這把 API 金鑰不能替這個來源送資料" }); continue; }
    try {
      const [inserted] = await database.insert(integrationEventsTable).values({
        sourceId: source.id, kind: event.kind, externalId: event.externalId, occurredAt: event.occurredAt,
        payload: event.data, amount: String(event.amount), summary: event.summary || null,
      }).onConflictDoNothing().returning();
      let record = inserted;
      if (!record) {
        [record] = await database.select().from(integrationEventsTable).where(and(
          eq(integrationEventsTable.sourceId, source.id), eq(integrationEventsTable.kind, event.kind), eq(integrationEventsTable.externalId, event.externalId)));
      }
      if (inserted) {
        const legacyNote = await alreadyPostedByLegacy(database, opts.legacy?.(raw));
        if (legacyNote) {
          [record] = await database.update(integrationEventsTable).set({ status: "ignored", error: legacyNote, processedBy: opts.actor }).where(eq(integrationEventsTable.id, inserted.id)).returning();
        } else {
          record = await processEvent(database as any, inserted.id, opts.actor);
        }
      } else if (record.status === "failed" || record.status === "pending") {
        // 重送的如果上次沒成功就再試一次（多半是對應設定補好了）
        record = await processEvent(database as any, record.id, opts.actor);
      }
      results.push({
        ok: record.status === "processed" || record.status === "ignored", duplicate: !inserted, id: record.id,
        externalId: event.externalId, status: record.status, error: record.error, result: record.result,
      });
    } catch (err: any) {
      logger.error({ err: err?.message, externalId: event.externalId }, "integration event ingest failed");
      results.push({ ok: false, externalId: event.externalId, error: "系統處理時發生錯誤，請稍後重送" });
    }
  }
  return results;
}
