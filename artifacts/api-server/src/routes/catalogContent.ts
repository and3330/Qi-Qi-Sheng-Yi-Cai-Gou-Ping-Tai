import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import {
  db,
  institutionsTable,
  articlesTable,
  announcementsTable,
  productsTable,
} from "@workspace/db";
import {
  ListInstitutionsQueryParams,
  ListArticlesQueryParams,
  GetArticleParams,
} from "@workspace/api-zod";
import {
  serializeInstitution,
  serializeArticle,
  serializeProduct,
} from "../lib/serialize";

const router: IRouter = Router();

router.get("/institutions", async (req, res) => {
  const parsed = ListInstitutionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const conditions: SQL[] = [];
  if (parsed.data.type)
    conditions.push(eq(institutionsTable.type, parsed.data.type));
  if (parsed.data.city)
    conditions.push(eq(institutionsTable.city, parsed.data.city));
  const rows = await db
    .select()
    .from(institutionsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(institutionsTable.id);
  res.json(rows.map(serializeInstitution));
});

router.get("/articles", async (req, res) => {
  const parsed = ListArticlesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const conditions: SQL[] = [];
  if (parsed.data.kind) conditions.push(eq(articlesTable.kind, parsed.data.kind));
  if (parsed.data.category)
    conditions.push(eq(articlesTable.category, parsed.data.category));
  if (parsed.data.search) {
    conditions.push(
      or(
        ilike(articlesTable.title, `%${parsed.data.search}%`),
        ilike(articlesTable.summary, `%${parsed.data.search}%`),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(articlesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(articlesTable.publishedAt));
  res.json(rows.map(serializeArticle));
});

router.get("/articles/:id", async (req, res) => {
  const parsed = GetArticleParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(articlesTable)
    .where(eq(articlesTable.id, parsed.data.id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "文章不存在" });
    return;
  }
  res.json(serializeArticle(row));
});

router.get("/announcements", async (_req, res) => {
  const rows = await db
    .select()
    .from(announcementsTable)
    .orderBy(desc(announcementsTable.publishedAt));
  res.json(
    rows.map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      publishedAt: a.publishedAt.toISOString(),
    })),
  );
});

router.get("/home/summary", async (_req, res) => {
  const [hot, announcements, latest] = await Promise.all([
    db
      .select()
      .from(productsTable)
      .where(eq(productsTable.isHot, true))
      .orderBy(productsTable.code)
      .limit(8),
    db
      .select()
      .from(announcementsTable)
      .orderBy(desc(announcementsTable.publishedAt))
      .limit(5),
    db
      .select()
      .from(articlesTable)
      .where(eq(articlesTable.kind, "article"))
      .orderBy(desc(articlesTable.publishedAt))
      .limit(4),
  ]);
  res.json({
    hotProducts: hot.map(serializeProduct),
    announcements: announcements.map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      publishedAt: a.publishedAt.toISOString(),
    })),
    latestArticles: latest.map(serializeArticle),
  });
});

export default router;
