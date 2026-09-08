import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { aiKnowledgeTable, db, type AiKnowledge } from "@workspace/db";
import {
  CreateAdminAiKnowledgeBody,
  UpdateAdminAiKnowledgeBody,
} from "@workspace/api-zod";
import { reindex, removeFromIndex } from "../lib/aiIndex";
import { requireOps } from "../middlewares/requireMember";

const router: IRouter = Router();

function serializeKnowledge(row: AiKnowledge) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    content: row.content,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseId(value: string | string[]) {
  if (typeof value !== "string") return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get("/admin/ai-knowledge", requireOps, async (_req, res) => {
  const rows = await db
    .select()
    .from(aiKnowledgeTable)
    .orderBy(desc(aiKnowledgeTable.updatedAt));
  res.json(rows.map(serializeKnowledge));
});

router.post("/admin/ai-knowledge", requireOps, async (req, res) => {
  const parsed = CreateAdminAiKnowledgeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "知識庫資料不完整或格式錯誤" });
    return;
  }
  const [row] = await db.insert(aiKnowledgeTable).values(parsed.data).returning();
  await reindex("ai_knowledge", row.id);
  res.status(201).json(serializeKnowledge(row));
});

router.patch("/admin/ai-knowledge/:id", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateAdminAiKnowledgeBody.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "知識庫更新資料不完整或格式錯誤" });
    return;
  }
  const [row] = await db
    .update(aiKnowledgeTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(aiKnowledgeTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "找不到此知識庫紀錄" });
    return;
  }
  await reindex("ai_knowledge", row.id);
  res.json(serializeKnowledge(row));
});

router.delete("/admin/ai-knowledge/:id", requireOps, async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const deleted = await db
    .delete(aiKnowledgeTable)
    .where(eq(aiKnowledgeTable.id, id))
    .returning({ id: aiKnowledgeTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "找不到此知識庫紀錄" });
    return;
  }
  await removeFromIndex("ai_knowledge", id);
  res.status(204).end();
});

export default router;