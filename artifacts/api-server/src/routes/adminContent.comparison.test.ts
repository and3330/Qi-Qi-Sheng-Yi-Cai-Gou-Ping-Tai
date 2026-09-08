import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  announcementsTable,
  articlesTable,
  contentRevisionsTable,
  db,
  pool,
} from "@workspace/db";
import { getContentRevisionComparison } from "./adminContent";

const marker = `content-comparison-${process.pid}-${Date.now()}`;
const articleIds: number[] = [];
const announcementIds: number[] = [];

test("文章版本會與目前的標題、分類、摘要、內文及狀態比較", async () => {
  const [article] = await db.insert(articlesTable).values({
    kind: "article",
    title: `${marker}-current-title`,
    category: `${marker}-current-category`,
    summary: `${marker}-current-summary`,
    content: `${marker}-current-content`,
    status: "published",
  }).returning();
  articleIds.push(article.id);
  const [revision] = await db.insert(contentRevisionsTable).values({
    entityKind: "article",
    entityId: article.id,
    title: `${marker}-old-title`,
    category: `${marker}-old-category`,
    summary: `${marker}-old-summary`,
    content: `${marker}-old-content`,
    status: "draft",
    editedBy: -1,
  }).returning();

  const comparison = await getContentRevisionComparison(revision.id);

  assert.equal(comparison?.revision.id, revision.id);
  assert.deepEqual(comparison?.current, {
    title: article.title,
    category: article.category,
    summary: article.summary,
    content: article.content,
    status: article.status,
  });
});

test("公告版本會與目前內容比較且摘要固定為空", async () => {
  const [announcement] = await db.insert(announcementsTable).values({
    title: `${marker}-current-title`,
    category: `${marker}-current-category`,
    content: `${marker}-current-content`,
    status: "review",
  }).returning();
  announcementIds.push(announcement.id);
  const [revision] = await db.insert(contentRevisionsTable).values({
    entityKind: "announcement",
    entityId: announcement.id,
    title: `${marker}-old-title`,
    category: `${marker}-old-category`,
    summary: null,
    content: `${marker}-old-content`,
    status: "archived",
    editedBy: -1,
  }).returning();

  const comparison = await getContentRevisionComparison(revision.id);

  assert.equal(comparison?.revision.id, revision.id);
  assert.deepEqual(comparison?.current, {
    title: announcement.title,
    category: announcement.category,
    summary: null,
    content: announcement.content,
    status: announcement.status,
  });
});

test("版本或目前內容不存在時不回傳比較資料", async () => {
  assert.equal(await getContentRevisionComparison(2_147_483_647), null);

  const [article] = await db.insert(articlesTable).values({
    kind: "article",
    title: `${marker}-deleted-title`,
    category: `${marker}-deleted-category`,
    summary: null,
    content: null,
    status: "draft",
  }).returning();
  articleIds.push(article.id);
  const [revision] = await db.insert(contentRevisionsTable).values({
    entityKind: "article",
    entityId: article.id,
    title: article.title,
    category: article.category,
    summary: article.summary,
    content: article.content,
    status: article.status,
    editedBy: -1,
  }).returning();
  await db.delete(articlesTable).where(eq(articlesTable.id, article.id));

  assert.equal(await getContentRevisionComparison(revision.id), null);
});

after(async () => {
  for (const entityId of articleIds) {
    await db.delete(contentRevisionsTable).where(and(
      eq(contentRevisionsTable.entityKind, "article"),
      eq(contentRevisionsTable.entityId, entityId),
    ));
    await db.delete(articlesTable).where(eq(articlesTable.id, entityId));
  }
  for (const entityId of announcementIds) {
    await db.delete(contentRevisionsTable).where(and(
      eq(contentRevisionsTable.entityKind, "announcement"),
      eq(contentRevisionsTable.entityId, entityId),
    ));
    await db.delete(announcementsTable).where(eq(announcementsTable.id, entityId));
  }
  await pool.end();
});