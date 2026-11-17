import { Router, type IRouter } from "express";
import { eq, desc, sql, and, or } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();

router.use("/notifications", requireAuth);

function recipientFilter(req: any) {
  // 以登入 session 的身分過濾（requireAuth 保證 session.user 存在）
  const u = req.session?.user || req.user;
  const username = u?.username;
  if (!username) return undefined;
  if (u?.role === "super_admin") return undefined;
  // 員工自助帳號：只能看指名給自己的通知，不含全域/未指名的公司通知
  if (u?.role === "employee") return eq(notificationsTable.recipient, username);
  return or(
    eq(notificationsTable.recipient, "all"),
    eq(notificationsTable.recipient, username),
    sql`${notificationsTable.recipient} IS NULL`,
  );
}

router.get("/notifications", async (req, res): Promise<void> => {
  const conditions: any[] = [];
  const rec = recipientFilter(req);
  if (rec) conditions.push(rec);
  if (req.query.isRead) conditions.push(eq(notificationsTable.isRead, req.query.isRead as string));
  if (req.query.type) conditions.push(eq(notificationsTable.type, req.query.type as string));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const unreadConditions: any[] = [eq(notificationsTable.isRead, "No")];
  const unreadRecipient = recipientFilter(req);
  if (unreadRecipient) unreadConditions.push(unreadRecipient);
  const [rows, unread] = await Promise.all([
    db.select().from(notificationsTable).where(where).orderBy(desc(notificationsTable.createdAt)).limit(limit),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(notificationsTable).where(and(...unreadConditions)),
  ]);
  res.json({ notifications: rows, unreadCount: unread[0]?.count || 0 });
});

router.get("/notifications/unread-count", async (req, res): Promise<void> => {
  const conditions: any[] = [eq(notificationsTable.isRead, "No")];
  const rec = recipientFilter(req);
  if (rec) conditions.push(rec);
  const [result] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(notificationsTable).where(and(...conditions));
  res.json({ count: result?.count || 0 });
});

router.post("/notifications", requireRole("owner", "admin", "manager"), async (req, res): Promise<void> => {
  const { title, message, type, module, documentType, documentId, recipient } = req.body;
  if (!title || !message) { res.status(400).json({ error: "Missing required fields" }); return; }
  const [row] = await db.insert(notificationsTable).values({ title, message, type, module, documentType, documentId, recipient }).returning();
  res.status(201).json(row);
});

router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  const conditions: any[] = [eq(notificationsTable.id, Number(req.params.id))];
  const rec = recipientFilter(req);
  if (rec) conditions.push(rec);
  const [row] = await db.update(notificationsTable).set({ isRead: "Yes" }).where(and(...conditions)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.patch("/notifications/read-all", async (req, res): Promise<void> => {
  const conditions: any[] = [eq(notificationsTable.isRead, "No")];
  const rec = recipientFilter(req);
  if (rec) conditions.push(rec);
  await db.update(notificationsTable).set({ isRead: "Yes" }).where(and(...conditions));
  res.json({ success: true });
});

router.delete("/notifications/:id", requireRole("owner", "admin", "manager"), async (req, res): Promise<void> => {
  const [row] = await db.delete(notificationsTable).where(eq(notificationsTable.id, Number(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
