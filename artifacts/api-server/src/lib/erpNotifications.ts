import { db, erpNotificationsTable } from "@workspace/db";

export async function createErpNotification(input: {
  memberId: number | null | undefined;
  type: string;
  title: string;
  body?: string | null;
  linkPath?: string | null;
}) {
  if (!input.memberId) return;
  await db.insert(erpNotificationsTable).values({
    memberId: input.memberId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    linkPath: input.linkPath ?? null,
  });
}