import { Router, Request, Response } from "express";
import type { PgTable } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// ============================================================
// Linktree 個人連結頁路由模組
// 支援連結 CRUD、外觀設定、公開頁面
// ============================================================

interface AuthUser {
  id: number;
  role: string;
}

interface DrizzleDB {
  select(fields?: Record<string, unknown>): { from(table: PgTable): { where(cond: SQL): { orderBy(...args: unknown[]): Promise<Record<string, unknown>[]> }; orderBy(...args: unknown[]): Promise<Record<string, unknown>[]> } };
  insert(table: PgTable): { values(data: Record<string, unknown>): { returning(): Promise<Record<string, unknown>[]> } };
  update(table: PgTable): { set(data: Record<string, unknown>): { where(cond: SQL): { returning(): Promise<Record<string, unknown>[]> } } };
  delete(table: PgTable): { where(cond: SQL): Promise<void> };
}

interface LinktreeDeps {
  db: DrizzleDB;
  userLinks: PgTable & Record<string, unknown>;
  userLinktreeSettings: PgTable & Record<string, unknown>;
  users: PgTable & Record<string, unknown>;
  eq: (col: unknown, val: unknown) => SQL;
  and: (...conds: SQL[]) => SQL;
  asc: (col: unknown) => SQL;
}

function getAuthUser(req: Request): AuthUser | null {
  if (!req.isAuthenticated() || !req.user) return null;
  return req.user as AuthUser;
}

export function createLinktreeRoutes(deps: LinktreeDeps) {
  const router = Router();
  const { db, userLinks, userLinktreeSettings, users, eq, and, asc } = deps;

  router.get("/api/linktree/links", async (req: Request, res: Response) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ message: "未登入" });
    const links = await (db.select().from(userLinks) as unknown as { where(c: SQL): { orderBy(o: unknown): Promise<Record<string, unknown>[]> } })
      .where(eq(userLinks.userId, user.id))
      .orderBy(asc(userLinks.sortOrder));
    res.json(links);
  });

  router.post("/api/linktree/links", async (req: Request, res: Response) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ message: "未登入" });
    const { title, subtitle, url, icon, linkType, sortOrder } = req.body;
    if (!title || !url) return res.status(400).json({ message: "標題和 URL 為必填" });
    const [link] = await db.insert(userLinks).values({
      userId: user.id, title, subtitle, url, icon,
      linkType: linkType || 'link',
      sortOrder: sortOrder || 0,
    }).returning();
    res.json(link);
  });

  router.patch("/api/linktree/links/:id", async (req: Request, res: Response) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ message: "未登入" });
    const id = parseInt(req.params.id);
    const [updated] = await (db.update(userLinks).set(req.body) as unknown as { where(c: SQL): { returning(): Promise<Record<string, unknown>[]> } })
      .where(and(eq(userLinks.id, id), eq(userLinks.userId, user.id)))
      .returning();
    if (!updated) return res.status(404).json({ message: "找不到連結" });
    res.json(updated);
  });

  router.delete("/api/linktree/links/:id", async (req: Request, res: Response) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ message: "未登入" });
    await db.delete(userLinks).where(and(eq(userLinks.id, parseInt(req.params.id)), eq(userLinks.userId, user.id)));
    res.json({ message: "已刪除" });
  });

  router.get("/api/linktree/settings", async (req: Request, res: Response) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ message: "未登入" });
    const [settings] = await (db.select().from(userLinktreeSettings) as unknown as { where(c: SQL): Promise<Record<string, unknown>[]> })
      .where(eq(userLinktreeSettings.userId, user.id));
    res.json(settings || {});
  });

  router.put("/api/linktree/settings", async (req: Request, res: Response) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ message: "未登入" });
    const existing = await (db.select().from(userLinktreeSettings) as unknown as { where(c: SQL): Promise<Record<string, unknown>[]> })
      .where(eq(userLinktreeSettings.userId, user.id));
    if (existing.length > 0) {
      const [updated] = await (db.update(userLinktreeSettings).set(req.body) as unknown as { where(c: SQL): { returning(): Promise<Record<string, unknown>[]> } })
        .where(eq(userLinktreeSettings.userId, user.id)).returning();
      return res.json(updated);
    }
    const [created] = await db.insert(userLinktreeSettings).values({ userId: user.id, ...req.body }).returning();
    res.json(created);
  });

  router.get("/api/linktree/public/:userId", async (req: Request, res: Response) => {
    const userId = parseInt(req.params.userId);
    const [userRow] = await (db.select({
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    }).from(users) as unknown as { where(c: SQL): Promise<Record<string, unknown>[]> })
      .where(eq(users.id, userId));
    if (!userRow) return res.status(404).json({ message: "找不到用戶" });

    const links = await (db.select().from(userLinks) as unknown as { where(c: SQL): { orderBy(o: unknown): Promise<Record<string, unknown>[]> } })
      .where(and(eq(userLinks.userId, userId), eq(userLinks.isActive, true)))
      .orderBy(asc(userLinks.sortOrder));
    const [settings] = await (db.select().from(userLinktreeSettings) as unknown as { where(c: SQL): Promise<Record<string, unknown>[]> })
      .where(eq(userLinktreeSettings.userId, userId));

    res.json({ user: userRow, links, settings: settings || {} });
  });

  return router;
}
