import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  announcementsTable,
  aiDocumentsTable,
  articlesTable,
  contentRevisionsTable,
  db,
  membersTable,
  pool,
} from "@workspace/db";
import adminContentRouter from "./adminContent";
import { waitForPendingReindexes } from "../lib/aiIndex";

const marker = `content-regression-${process.pid}-${Date.now()}`;
let memberId = 0;
let origin = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;
const articleIds: number[] = [];
const announcementIds: number[] = [];

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body: any = response.status === 204 ? null : await response.json();
  return { response, body };
}

before(async () => {
  const [member] = await db.insert(membersTable).values({
    username: marker,
    passwordHash: "not-used",
    role: "admin",
    name: "Content regression test",
  }).returning({ id: membersTable.id });
  memberId = member.id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      session: { memberId, destroy(callback: () => void) { callback(); } },
      log: { error() {} },
    });
    next();
  });
  app.use(adminContentRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await waitForPendingReindexes();
  const fixturePredicates = [
    ...(articleIds.length
      ? [and(eq(aiDocumentsTable.entityKind, "article"), inArray(aiDocumentsTable.entityId, articleIds))]
      : []),
    ...(announcementIds.length
      ? [and(eq(aiDocumentsTable.entityKind, "announcement"), inArray(aiDocumentsTable.entityId, announcementIds))]
      : []),
  ];
  if (fixturePredicates.length) {
    await db.delete(aiDocumentsTable).where(or(...fixturePredicates));
  }
  const revisionPredicates = [
    ...(articleIds.length
      ? [and(eq(contentRevisionsTable.entityKind, "article"), inArray(contentRevisionsTable.entityId, articleIds))]
      : []),
    ...(announcementIds.length
      ? [and(eq(contentRevisionsTable.entityKind, "announcement"), inArray(contentRevisionsTable.entityId, announcementIds))]
      : []),
  ];
  if (revisionPredicates.length) {
    await db.delete(contentRevisionsTable).where(or(...revisionPredicates));
  }
  if (articleIds.length) {
    await db.delete(articlesTable).where(inArray(articlesTable.id, articleIds));
  }
  if (announcementIds.length) {
    await db.delete(announcementsTable).where(inArray(announcementsTable.id, announcementIds));
  }
  if (memberId) await db.delete(membersTable).where(eq(membersTable.id, memberId));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

for (const kind of ["article", "faq"] as const) {
  test(`${kind} loads, edits, archives, and records revisions`, async () => {
    const created = await request("/admin/articles", {
      method: "POST",
      body: JSON.stringify({
        kind,
        title: `${marker}-${kind}`,
        category: "測試分類",
        summary: "原摘要",
        content: "原內容",
        imageUrl: null,
        status: "published",
      }),
    });
    assert.equal(created.response.status, 201);
    articleIds.push(created.body.id);

    const loaded = await request("/admin/articles");
    assert.equal(loaded.response.status, 200);
    assert(loaded.body.some((row: { id: number; kind: string }) => row.id === created.body.id && row.kind === kind));

    const edited = await request(`/admin/articles/${created.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: `${marker}-${kind}-edited`, category: "新分類" }),
    });
    assert.equal(edited.response.status, 200);
    assert.equal(edited.body.title, `${marker}-${kind}-edited`);

    const archived = await request(`/admin/articles/${created.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    });
    assert.equal(archived.response.status, 200);
    assert.equal(archived.body.status, "archived");

    const revisions = await request(`/admin/content-revisions?entityKind=article&entityId=${created.body.id}`);
    assert.equal(revisions.response.status, 200);
    assert.deepEqual(revisions.body.slice(0, 3).map((row: { status: string }) => row.status), [
      "archived", "published", "published",
    ]);
  });
}

test("announcement loads, edits, archives, and records revisions", async () => {
  const created = await request("/admin/announcements", {
    method: "POST",
    body: JSON.stringify({
      title: `${marker}-announcement`,
      category: "平台公告",
      content: "原公告",
      imageUrl: null,
      status: "published",
    }),
  });
  assert.equal(created.response.status, 201);
  announcementIds.push(created.body.id);

  const loaded = await request("/admin/announcements");
  assert(loaded.body.some((row: { id: number }) => row.id === created.body.id));

  const edited = await request(`/admin/announcements/${created.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({ title: `${marker}-announcement-edited` }),
  });
  assert.equal(edited.response.status, 200);

  const archived = await request(`/admin/announcements/${created.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "archived" }),
  });
  assert.equal(archived.response.status, 200);
  assert.equal(archived.body.status, "archived");

  const revisions = await request(`/admin/content-revisions?entityKind=announcement&entityId=${created.body.id}`);
  assert.deepEqual(revisions.body.slice(0, 3).map((row: { status: string }) => row.status), [
    "archived", "published", "published",
  ]);
});

test("invalid and missing content return stable client errors", async () => {
  const invalidArticle = await request("/admin/articles", {
    method: "POST",
    body: JSON.stringify({ kind: "article", title: "", category: "" }),
  });
  assert.equal(invalidArticle.response.status, 400);
  assert.deepEqual(invalidArticle.body, { error: "內容資料不完整" });

  const invalidAnnouncement = await request("/admin/announcements/not-an-id", {
    method: "PATCH",
    body: JSON.stringify({ status: "archived" }),
  });
  assert.equal(invalidAnnouncement.response.status, 400);
  assert.deepEqual(invalidAnnouncement.body, { error: "Invalid id" });

  for (const resource of ["articles", "announcements"]) {
    const missing = await request(`/admin/${resource}/2147483647`, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    });
    assert.equal(missing.response.status, 404);
    assert.deepEqual(missing.body, { error: "找不到此內容" });
  }
});