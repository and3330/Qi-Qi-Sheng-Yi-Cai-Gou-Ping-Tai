import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, asc, eq } from "drizzle-orm";
import {
  announcementsTable,
  articlesTable,
  contentRevisionsTable,
  db,
  pool,
} from "@workspace/db";
import { restoreContentRevision } from "./adminContent";

const marker = `content-restore-${process.pid}-${Date.now()}`;
const articleIds: number[] = [];
const announcementIds: number[] = [];

async function revisions(entityKind: string, entityId: number) {
  return db
    .select()
    .from(contentRevisionsTable)
    .where(
      and(
        eq(contentRevisionsTable.entityKind, entityKind),
        eq(contentRevisionsTable.entityId, entityId),
      ),
    )
    .orderBy(asc(contentRevisionsTable.id));
}

async function createArticleFixture(
  kind: "article" | "faq",
  options: { currentImageUrl?: string | null; oldImageUrl?: string | null; legacyRevision?: boolean } = {},
) {
  const currentImageUrl = Object.hasOwn(options, "currentImageUrl")
    ? options.currentImageUrl
    : `${marker}-${kind}-current-image`;
  const oldImageUrl = Object.hasOwn(options, "oldImageUrl")
    ? options.oldImageUrl
    : `${marker}-${kind}-old-image`;
  const [article] = await db
    .insert(articlesTable)
    .values({
      kind,
      title: `${marker}-${kind}-current-title`,
      category: `${marker}-current-category`,
      summary: `${marker}-current-summary`,
      content: `${marker}-current-content`,
      imageUrl: currentImageUrl,
      status: "draft",
    })
    .returning();
  articleIds.push(article.id);

  const [oldRevision] = await db
    .insert(contentRevisionsTable)
    .values({
      entityKind: "article",
      entityId: article.id,
      title: `${marker}-${kind}-old-title`,
      category: `${marker}-old-category`,
      summary: `${marker}-${kind}-old-summary`,
      content: `${marker}-${kind}-old-content`,
      imageUrl: oldImageUrl,
      imageSnapshotPresent: !options.legacyRevision,
      status: "published",
      editedBy: -1,
      note: "original snapshot",
    })
    .returning();

  return { article, oldRevision };
}

test("文章還原所有快照欄位，新增版本且完整保留舊版本", async () => {
  const { article, oldRevision } = await createArticleFixture("article");
  const before = await revisions("article", article.id);

  const result = await restoreContentRevision(oldRevision.id, -2);

  assert.equal(result?.entityKind, "article");
  const [restored] = await db.select().from(articlesTable).where(eq(articlesTable.id, article.id));
  assert.deepEqual(
    {
      kind: restored.kind,
      title: restored.title,
      category: restored.category,
      summary: restored.summary,
      content: restored.content,
      imageUrl: restored.imageUrl,
      status: restored.status,
    },
    {
      kind: "article",
      title: oldRevision.title,
      category: oldRevision.category,
      summary: oldRevision.summary,
      content: oldRevision.content,
      imageUrl: oldRevision.imageUrl,
      status: oldRevision.status,
    },
  );

  const afterRestore = await revisions("article", article.id);
  assert.equal(afterRestore.length, before.length + 1);
  assert.deepEqual(afterRestore.slice(0, before.length), before);
  assert.equal(afterRestore.at(-1)?.id, result?.revisionId);
  assert.equal(afterRestore.at(-1)?.note, `還原自版本 #${oldRevision.id}`);
  assert.equal(afterRestore.at(-1)?.imageUrl, oldRevision.imageUrl);
  assert.equal(afterRestore.at(-1)?.imageSnapshotPresent, true);
});

test("FAQ 以文章版本還原，且不會改變內容類型", async () => {
  const { article, oldRevision } = await createArticleFixture("faq");

  await restoreContentRevision(oldRevision.id, -2);

  const [restored] = await db.select().from(articlesTable).where(eq(articlesTable.id, article.id));
  assert.deepEqual(
    {
      kind: restored.kind,
      title: restored.title,
      category: restored.category,
      summary: restored.summary,
      content: restored.content,
      status: restored.status,
    },
    {
      kind: "faq",
      title: oldRevision.title,
      category: oldRevision.category,
      summary: oldRevision.summary,
      content: oldRevision.content,
      status: oldRevision.status,
    },
  );
  assert.equal((await revisions("article", article.id)).length, 2);
});

test("沒有圖片的文章版本會在還原時清除目前圖片", async () => {
  const { article, oldRevision } = await createArticleFixture("article", {
    oldImageUrl: null,
  });

  await restoreContentRevision(oldRevision.id, -2);

  const [restored] = await db.select().from(articlesTable).where(eq(articlesTable.id, article.id));
  assert.equal(restored.imageUrl, null);
  assert.equal((await revisions("article", article.id)).at(-1)?.imageSnapshotPresent, true);
});

test("既有舊版本沒有圖片快照時保留目前圖片", async () => {
  const currentImageUrl = `${marker}-legacy-current-image`;
  const { article, oldRevision } = await createArticleFixture("article", {
    currentImageUrl,
    legacyRevision: true,
  });

  await restoreContentRevision(oldRevision.id, -2);

  const [restored] = await db.select().from(articlesTable).where(eq(articlesTable.id, article.id));
  assert.equal(restored.imageUrl, currentImageUrl);
  assert.equal((await revisions("article", article.id)).at(-1)?.imageUrl, currentImageUrl);
});

test("公告還原標題、分類、內文與狀態，新增版本並保留歷史", async () => {
  const [announcement] = await db
    .insert(announcementsTable)
    .values({
      title: `${marker}-announcement-current-title`,
      category: `${marker}-announcement-current-category`,
      content: `${marker}-announcement-current-content`,
      imageUrl: `${marker}-announcement-current-image`,
      status: "archived",
    })
    .returning();
  announcementIds.push(announcement.id);
  const [oldRevision] = await db
    .insert(contentRevisionsTable)
    .values({
      entityKind: "announcement",
      entityId: announcement.id,
      title: `${marker}-announcement-old-title`,
      category: `${marker}-announcement-old-category`,
      summary: null,
      content: `${marker}-announcement-old-content`,
      imageUrl: `${marker}-announcement-old-image`,
      imageSnapshotPresent: true,
      status: "review",
      editedBy: -1,
      note: "original snapshot",
    })
    .returning();
  const before = await revisions("announcement", announcement.id);

  const result = await restoreContentRevision(oldRevision.id, -2);

  const [restored] = await db
    .select()
    .from(announcementsTable)
    .where(eq(announcementsTable.id, announcement.id));
  assert.deepEqual(
    {
      title: restored.title,
      category: restored.category,
      content: restored.content,
      imageUrl: restored.imageUrl,
      status: restored.status,
    },
    {
      title: oldRevision.title,
      category: oldRevision.category,
      content: oldRevision.content,
      imageUrl: oldRevision.imageUrl,
      status: oldRevision.status,
    },
  );
  const afterRestore = await revisions("announcement", announcement.id);
  assert.equal(afterRestore.length, before.length + 1);
  assert.deepEqual(afterRestore.slice(0, before.length), before);
  assert.equal(afterRestore.at(-1)?.id, result?.revisionId);
  assert.equal(afterRestore.at(-1)?.imageUrl, oldRevision.imageUrl);
  assert.equal(afterRestore.at(-1)?.imageSnapshotPresent, true);
});

test("不存在的版本不會更新內容或新增歷史", async () => {
  const { article } = await createArticleFixture("article");
  const beforeArticle = await db.select().from(articlesTable).where(eq(articlesTable.id, article.id));
  const beforeRevisions = await revisions("article", article.id);

  const result = await restoreContentRevision(2_147_483_647, -2);

  assert.equal(result, null);
  assert.deepEqual(
    await db.select().from(articlesTable).where(eq(articlesTable.id, article.id)),
    beforeArticle,
  );
  assert.deepEqual(await revisions("article", article.id), beforeRevisions);
});

test("原內容已不存在時不會新增部分還原版本", async () => {
  const { article, oldRevision } = await createArticleFixture("article");
  await db.delete(articlesTable).where(eq(articlesTable.id, article.id));
  const beforeRevisions = await revisions("article", article.id);

  const result = await restoreContentRevision(oldRevision.id, -2);

  assert.equal(result, null);
  assert.deepEqual(await revisions("article", article.id), beforeRevisions);
});

after(async () => {
  for (const entityId of articleIds) {
    await db
      .delete(contentRevisionsTable)
      .where(
        and(
          eq(contentRevisionsTable.entityKind, "article"),
          eq(contentRevisionsTable.entityId, entityId),
        ),
      );
    await db.delete(articlesTable).where(eq(articlesTable.id, entityId));
  }
  for (const entityId of announcementIds) {
    await db
      .delete(contentRevisionsTable)
      .where(
        and(
          eq(contentRevisionsTable.entityKind, "announcement"),
          eq(contentRevisionsTable.entityId, entityId),
        ),
      );
    await db.delete(announcementsTable).where(eq(announcementsTable.id, entityId));
  }
  await pool.end();
});