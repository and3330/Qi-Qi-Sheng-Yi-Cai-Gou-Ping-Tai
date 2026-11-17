import { Router, type IRouter } from "express";
import { eq, sql, ilike, desc, or } from "drizzle-orm";
import { db, kbArticlesTable, kbCategoriesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/kb-articles", requireAuth);
router.use("/kb-categories", requireAuth);

router.get("/kb-categories", async (_req, res): Promise<void> => {
  const rows = await db.select().from(kbCategoriesTable).orderBy(kbCategoriesTable.name);
  res.json(rows);
});

router.post("/kb-categories", async (req, res): Promise<void> => {
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ error: "名稱必填" }); return; }
  const [row] = await db.insert(kbCategoriesTable).values({ name, description }).returning();
  res.status(201).json(row);
});

router.patch("/kb-categories/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.update(kbCategoriesTable).set(req.body).where(eq(kbCategoriesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/kb-categories/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.delete(kbCategoriesTable).where(eq(kbCategoriesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

router.get("/kb-articles", async (req, res): Promise<void> => {
  const { search, categoryId, status } = req.query;
  const conditions: any[] = [];
  if (status) conditions.push(eq(kbArticlesTable.status, String(status)));
  if (categoryId) conditions.push(eq(kbArticlesTable.categoryId, Number(categoryId)));
  if (search) {
    const term = `%${String(search)}%`;
    conditions.push(or(ilike(kbArticlesTable.title, term), ilike(kbArticlesTable.content, term), ilike(kbArticlesTable.tags, term)));
  }

  const where = conditions.length > 0 ? sql`${conditions.reduce((a, b) => sql`${a} AND ${b}`)}` : undefined;

  const rows = await db.select({
    id: kbArticlesTable.id,
    title: kbArticlesTable.title,
    content: kbArticlesTable.content,
    categoryId: kbArticlesTable.categoryId,
    status: kbArticlesTable.status,
    authorId: kbArticlesTable.authorId,
    tags: kbArticlesTable.tags,
    viewCount: kbArticlesTable.viewCount,
    createdAt: kbArticlesTable.createdAt,
    updatedAt: kbArticlesTable.updatedAt,
    categoryName: sql<string | null>`(SELECT name FROM kb_categories WHERE id = "kb_articles"."category_id")`,
    authorName: sql<string | null>`(SELECT first_name || ' ' || last_name FROM employees WHERE id = "kb_articles"."author_id")`,
  }).from(kbArticlesTable).where(where).orderBy(desc(kbArticlesTable.updatedAt));

  res.json(rows);
});

router.post("/kb-articles", async (req, res): Promise<void> => {
  const { title, content, categoryId, status, authorId, tags } = req.body;
  if (!title) { res.status(400).json({ error: "標題必填" }); return; }
  const [row] = await db.insert(kbArticlesTable).values({ title, content, categoryId, status, authorId, tags }).returning();
  res.status(201).json(row);
});

router.get("/kb-articles/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select({
    id: kbArticlesTable.id,
    title: kbArticlesTable.title,
    content: kbArticlesTable.content,
    categoryId: kbArticlesTable.categoryId,
    status: kbArticlesTable.status,
    authorId: kbArticlesTable.authorId,
    tags: kbArticlesTable.tags,
    viewCount: kbArticlesTable.viewCount,
    createdAt: kbArticlesTable.createdAt,
    updatedAt: kbArticlesTable.updatedAt,
    categoryName: sql<string | null>`(SELECT name FROM kb_categories WHERE id = "kb_articles"."category_id")`,
    authorName: sql<string | null>`(SELECT first_name || ' ' || last_name FROM employees WHERE id = "kb_articles"."author_id")`,
  }).from(kbArticlesTable).where(eq(kbArticlesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await db.update(kbArticlesTable).set({ viewCount: row.viewCount + 1 }).where(eq(kbArticlesTable.id, id));
  res.json(row);
});

router.patch("/kb-articles/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.update(kbArticlesTable).set(req.body).where(eq(kbArticlesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/kb-articles/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.delete(kbArticlesTable).where(eq(kbArticlesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
