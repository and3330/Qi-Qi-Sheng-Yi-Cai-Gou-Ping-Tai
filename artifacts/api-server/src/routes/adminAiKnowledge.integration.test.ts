import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import { and, eq } from "drizzle-orm";
import {
  aiDocumentsTable,
  aiKnowledgeTable,
  db,
  membersTable,
  pool,
} from "@workspace/db";
import adminAiKnowledgeRouter from "./adminAiKnowledge";

const marker = `ai-knowledge-${process.pid}-${Date.now()}`;
let adminId = 0;
let memberId = 0;
let activeSessionId = 0;
let knowledgeId = 0;
let origin = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  return {
    response,
    body: response.status === 204 ? null : await response.json(),
  };
}

before(async () => {
  const [admin, member] = await db
    .insert(membersTable)
    .values([
      { username: `${marker}-admin`, passwordHash: "not-used", name: "Admin", role: "admin" },
      { username: `${marker}-member`, passwordHash: "not-used", name: "Member", role: "member" },
    ])
    .returning({ id: membersTable.id });
  adminId = admin.id;
  memberId = member.id;
  activeSessionId = adminId;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      session: { memberId: activeSessionId, destroy(callback: () => void) { callback(); } },
      log: { error() {} },
    });
    next();
  });
  app.use(adminAiKnowledgeRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (knowledgeId) {
    await db.delete(aiDocumentsTable).where(and(
      eq(aiDocumentsTable.entityKind, "ai_knowledge"),
      eq(aiDocumentsTable.entityId, knowledgeId),
    ));
    await db.delete(aiKnowledgeTable).where(eq(aiKnowledgeTable.id, knowledgeId));
  }
  if (adminId || memberId) {
    await db.delete(membersTable).where(
      eq(membersTable.username, `${marker}-admin`),
    );
    await db.delete(membersTable).where(
      eq(membersTable.username, `${marker}-member`),
    );
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.end();
});

test("ops can CRUD knowledge and active state synchronizes the public AI index", async () => {
  const created = await request("/admin/ai-knowledge", {
    method: "POST",
    body: JSON.stringify({
      title: `${marker} shipping`,
      category: "配送",
      content: "出貨後可在訂單頁查看配送狀態。",
    }),
  });
  assert.equal(created.response.status, 201);
  const createdBody = created.body as { id: number; isActive: boolean };
  knowledgeId = createdBody.id;
  assert.equal(createdBody.isActive, true);

  let [document] = await db.select().from(aiDocumentsTable).where(and(
    eq(aiDocumentsTable.entityKind, "ai_knowledge"),
    eq(aiDocumentsTable.entityId, knowledgeId),
  ));
  assert.equal(document?.scope, "public");
  assert.match(document?.content ?? "", /配送狀態/);

  const updated = await request(`/admin/ai-knowledge/${knowledgeId}`, {
    method: "PATCH",
    body: JSON.stringify({ content: "更新後的客服配送說明。" }),
  });
  assert.equal(updated.response.status, 200);
  [document] = await db.select().from(aiDocumentsTable).where(and(
    eq(aiDocumentsTable.entityKind, "ai_knowledge"),
    eq(aiDocumentsTable.entityId, knowledgeId),
  ));
  assert.match(document?.content ?? "", /更新後/);

  const inactive = await request(`/admin/ai-knowledge/${knowledgeId}`, {
    method: "PATCH",
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(inactive.response.status, 200);
  const absent = await db.select().from(aiDocumentsTable).where(and(
    eq(aiDocumentsTable.entityKind, "ai_knowledge"),
    eq(aiDocumentsTable.entityId, knowledgeId),
  ));
  assert.equal(absent.length, 0);

  const listed = await request("/admin/ai-knowledge");
  assert.equal(listed.response.status, 200);
  assert.equal(
    (listed.body as Array<{ id: number }>).some((row) => row.id === knowledgeId),
    true,
  );

  const deleted = await request(`/admin/ai-knowledge/${knowledgeId}`, {
    method: "DELETE",
  });
  assert.equal(deleted.response.status, 204);
  knowledgeId = 0;
});

test("ordinary members cannot access AI knowledge administration", async () => {
  activeSessionId = memberId;
  const denied = await request("/admin/ai-knowledge");
  assert.equal(denied.response.status, 403);
  assert.deepEqual(denied.body, { error: "Forbidden" });
  activeSessionId = adminId;
});