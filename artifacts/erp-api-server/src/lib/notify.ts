import { currentTenantClient } from "@workspace/erp-db";
import { logger } from "./logger";

export interface NotifyInput {
  title: string;
  message: string;
  type?: "info" | "warning" | "error" | "success" | "approval";
  module?: string;
  documentType?: string;
  documentId?: number;
  recipient?: string;
}

export async function notify(input: NotifyInput): Promise<number | null> {
  try {
    const client = currentTenantClient();
    if (!client) {
      logger.error({ input: input.title }, "notify() called outside tenant context — skipped");
      return null;
    }
    const r = await client.query(
      `INSERT INTO notifications (title, message, type, module, document_type, document_id, recipient)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        input.title.slice(0, 200),
        input.message.slice(0, 2000),
        input.type || "info",
        input.module || null,
        input.documentType || null,
        input.documentId || null,
        input.recipient || "all",
      ],
    );
    return r.rows[0]?.id ?? null;
  } catch (e: any) {
    logger.error({ err: e.message, input }, "notify() failed");
    return null;
  }
}
