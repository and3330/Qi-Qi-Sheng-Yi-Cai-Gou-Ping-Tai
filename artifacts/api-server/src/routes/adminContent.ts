import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  articlesTable,
  announcementsTable,
  contentRevisionsTable,
  type ContentRevision,
} from "@workspace/db";
import {
  CreateAdminArticleBody,
  UpdateAdminArticleBody,
  CreateAdminAnnouncementBody,
  UpdateAdminAnnouncementBody,
} from "@workspace/api-zod";
import { requireOps } from "../middlewares/requireMember";
import { reindex, removeFromIndex } from "../lib/aiIndex";

const router: IRouter = Router();

const STATUSES = ["draft", "review", "published", "archived"] as const;

function serializeAdminArticle(a: typeof articlesTable.$inferSelect) {
  return {
    id: a.id,
    kind: a.kind,
    title: a.title,
    category: a.category,
    summary: a.summary,
    content: a.content,
    imageUrl: a.imageUrl,
    status: a.status,
    publishedAt: a.publishedAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function serializeAdminAnnouncement(
  a: typeof announcementsTable.$inferSelect,
) {
  return {
    id: a.id,
    title: a.title,
    category: a.category,
    content: a.content,
    imageUrl: a.imageUrl,
    status: a.status,
    publishedAt: a.publishedAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function serializeRevision(r: ContentRevision) {
  return {
    id: r.id,
    entityKind: r.entityKind,
    entityId: r.entityId,
    title: r.title,
    category: r.category,
    summary: r.summary,
    content: r.content,
    status: r.status,
    editedBy: r.editedBy,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  };
}

async function recordArticleRevision(
  a: typeof articlesTable.$inferSelect,
  editedBy: number,
  note: string,
) {
  await db.insert(contentRevisionsTable).values({
    entityKind: "article",
    entityId: a.id,
    title: a.title,
    category: a.category,
    summary: a.summary,
    content: a.content,
    status: a.status,
    editedBy,
    note,
  });
}

async function recordAnnouncementRevision(
  a: typeof announcementsTable.$inferSelect,
  editedBy: number,
  note: string,
) {
  await db.insert(contentRevisionsTable).values({
    entityKind: "announcement",
    entityId: a.id,
    title: a.title,
    category: a.category,
    summary: null,
    content: a.content,
    status: a.status,
    editedBy,
    note,
  });
}

// ---------- 衛教文章 / FAQ ----------

router.get("/admin/articles", requireOps, async (req, res) => {
  const status =
    typeof req.query.status === "string" ? req.query.status : undefined;
  const conds = [];
  if (status && (STATUSES as readonly string[]).includes(status))
    conds.push(eq(articlesTable.status, status));
  const rows = await db
    .select()
    .from(articlesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(articlesTable.updatedAt));
  res.json(rows.map(serializeAdminArticle));
});

router.post("/admin/articles", requireOps, async (req, res) => {
  const parsed = CreateAdminArticleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "內容資料不完整" });
    return;
  }
  const [row] = await db
    .insert(articlesTable)
    .values({ ...parsed.data, updatedAt: new Date() })
    .returning();
  await recordArticleRevision(row, req.member!.id, "建立");
  reindex("article", row.id);
  res.status(201).json(serializeAdminArticle(row));
});

router.patch("/admin/articles/:id", requireOps, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateAdminArticleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "內容資料不完整" });
    return;
  }
  const [row] = await db
    .update(articlesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(articlesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "找不到此內容" });
    return;
  }
  await recordArticleRevision(
    row,
    req.member!.id,
    parsed.data.status ? `狀態變更為 ${parsed.data.status}` : "編輯",
  );
  reindex("article", row.id);
  res.json(serializeAdminArticle(row));
});

router.delete("/admin/articles/:id", requireOps, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const deleted = await db
    .delete(articlesTable)
    .where(eq(articlesTable.id, id))
    .returning({ id: articlesTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "找不到此內容" });
    return;
  }
  removeFromIndex("article", id);
  res.status(204).end();
});

// ---------- 公告 / 最新消息 ----------

router.get("/admin/announcements", requireOps, async (req, res) => {
  const status =
    typeof req.query.status === "string" ? req.query.status : undefined;
  const conds = [];
  if (status && (STATUSES as readonly string[]).includes(status))
    conds.push(eq(announcementsTable.status, status));
  const rows = await db
    .select()
    .from(announcementsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(announcementsTable.updatedAt));
  res.json(rows.map(serializeAdminAnnouncement));
});

router.post("/admin/announcements", requireOps, async (req, res) => {
  const parsed = CreateAdminAnnouncementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "內容資料不完整" });
    return;
  }
  const [row] = await db
    .insert(announcementsTable)
    .values({ ...parsed.data, updatedAt: new Date() })
    .returning();
  await recordAnnouncementRevision(row, req.member!.id, "建立");
  reindex("announcement", row.id);
  res.status(201).json(serializeAdminAnnouncement(row));
});

router.patch("/admin/announcements/:id", requireOps, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateAdminAnnouncementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "內容資料不完整" });
    return;
  }
  const [row] = await db
    .update(announcementsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(announcementsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "找不到此內容" });
    return;
  }
  await recordAnnouncementRevision(
    row,
    req.member!.id,
    parsed.data.status ? `狀態變更為 ${parsed.data.status}` : "編輯",
  );
  reindex("announcement", row.id);
  res.json(serializeAdminAnnouncement(row));
});

router.delete("/admin/announcements/:id", requireOps, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const deleted = await db
    .delete(announcementsTable)
    .where(eq(announcementsTable.id, id))
    .returning({ id: announcementsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "找不到此內容" });
    return;
  }
  removeFromIndex("announcement", id);
  res.status(204).end();
});

// ---------- 版本紀錄 ----------

router.get("/admin/content-revisions", requireOps, async (req, res) => {
  const entityKind =
    typeof req.query.entityKind === "string" ? req.query.entityKind : "";
  const entityId = Number(req.query.entityId);
  if (
    !["article", "announcement"].includes(entityKind) ||
    !Number.isInteger(entityId)
  ) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const rows = await db
    .select()
    .from(contentRevisionsTable)
    .where(
      and(
        eq(contentRevisionsTable.entityKind, entityKind),
        eq(contentRevisionsTable.entityId, entityId),
      ),
    )
    .orderBy(desc(contentRevisionsTable.createdAt))
    .limit(50);
  res.json(rows.map(serializeRevision));
});

router.post("/admin/content-revisions/:id/restore", requireOps, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const restored = await db.transaction(async (tx) => {
    const [revision] = await tx
      .select()
      .from(contentRevisionsTable)
      .where(eq(contentRevisionsTable.id, id))
      .limit(1);
    if (!revision || !revision.category) return null;

    if (revision.entityKind === "article") {
      const [row] = await tx
        .update(articlesTable)
        .set({
          title: revision.title,
          category: revision.category,
          summary: revision.summary,
          content: revision.content,
          status: revision.status,
          updatedAt: new Date(),
        })
        .where(eq(articlesTable.id, revision.entityId))
        .returning();
      if (!row) return null;
      const [newRevision] = await tx
        .insert(contentRevisionsTable)
        .values({
          entityKind: "article",
          entityId: row.id,
          title: row.title,
          category: row.category,
          summary: row.summary,
          content: row.content,
          status: row.status,
          editedBy: req.member!.id,
          note: `還原自版本 #${revision.id}`,
        })
        .returning();
      return { revisionId: newRevision.id, entityKind: "article" as const, entityId: row.id };
    }

    if (revision.entityKind === "announcement") {
      const [row] = await tx
        .update(announcementsTable)
        .set({
          title: revision.title,
          category: revision.category,
          content: revision.content,
          status: revision.status,
          updatedAt: new Date(),
        })
        .where(eq(announcementsTable.id, revision.entityId))
        .returning();
      if (!row) return null;
      const [newRevision] = await tx
        .insert(contentRevisionsTable)
        .values({
          entityKind: "announcement",
          entityId: row.id,
          title: row.title,
          category: row.category,
          summary: null,
          content: row.content,
          status: row.status,
          editedBy: req.member!.id,
          note: `還原自版本 #${revision.id}`,
        })
        .returning();
      return { revisionId: newRevision.id, entityKind: "announcement" as const, entityId: row.id };
    }

    return null;
  });

  if (!restored) {
    res.status(404).json({ error: "找不到此版本或原內容" });
    return;
  }

  reindex(restored.entityKind, restored.entityId);
  res.json(restored);
});

export default router;
