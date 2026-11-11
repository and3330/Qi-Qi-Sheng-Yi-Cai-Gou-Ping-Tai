import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { and, count, desc, eq, ilike, lte, ne, or, sum, notInArray, sql } from "drizzle-orm";
import {
  db,
  membersTable,
  ordersTable,
  productsTable,
  type Member,
} from "@workspace/db";
import { CreateAdminMemberBody, UpdateAdminMemberBody } from "@workspace/api-zod";
import { requireAdmin, requireStaff } from "../middlewares/requireMember";
import { reindex } from "../lib/aiIndex";

const router: IRouter = Router();

const LOW_STOCK_THRESHOLD = 10;

function serializeAdminMember(m: Member) {
  return {
    id: m.id,
    username: m.username,
    name: m.name,
    email: m.email,
    phone: m.phone,
    tier: m.tier,
    requestedTier: m.requestedTier ?? null,
    role: m.role,
    isActive: m.isActive,
    institutionVerified: m.institutionVerified,
    points: m.points,
    boundInstitutionId: m.boundInstitutionId,
    boundDepartment: m.boundDepartment,
    shippingAddress: m.shippingAddress,
    createdAt: m.createdAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown) {
  const err = error as { code?: string; cause?: { code?: string } };
  return err.code === "23505" || err.cause?.code === "23505";
}

router.get("/admin/stats", requireStaff, async (_req, res) => {
  const [[orders], [revenue], [members], [lowStock], [pendingOrders]] =
    await Promise.all([
      db.select({ value: count() }).from(ordersTable),
      db
        .select({ value: sum(ordersTable.totalAmount) })
        .from(ordersTable)
        .where(notInArray(ordersTable.status, ["cancelled", "returned"])),
      db.select({ value: count() }).from(membersTable),
      db
        .select({ value: count() })
        .from(productsTable)
        .where(lte(productsTable.stock, LOW_STOCK_THRESHOLD)),
      db
        .select({ value: count() })
        .from(ordersTable)
        .where(eq(ordersTable.status, "pending")),
    ]);
  res.json({
    orderCount: orders.value,
    pendingOrderCount: pendingOrders.value,
    totalRevenue: Number(revenue.value ?? 0),
    memberCount: members.value,
    lowStockCount: lowStock.value,
  });
});

router.get("/admin/members", requireStaff, async (req, res) => {
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";
  const tier = typeof req.query.tier === "string" ? req.query.tier : "";

  const conditions = [];
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(membersTable.username, pattern),
        ilike(membersTable.name, pattern),
        ilike(membersTable.email, pattern),
        ilike(membersTable.phone, pattern),
      ),
    );
  }
  if (tier === "hospital" || tier === "clinic" || tier === "consumer") {
    conditions.push(eq(membersTable.tier, tier));
  }

  const rows = await db
    .select()
    .from(membersTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(membersTable.createdAt))
    .limit(200);
  res.json(rows.map(serializeAdminMember));
});

router.post("/admin/members", requireAdmin, async (req, res) => {
  const parsed = CreateAdminMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確：帳號需 3–30 碼，密碼至少 8 碼" });
    return;
  }
  const { password, ...input } = parsed.data;
  const username = input.username.toLowerCase();
  const [existing] = await db
    .select({ id: membersTable.id })
    .from(membersTable)
    .where(eq(membersTable.username, username))
    .limit(1);
  if (existing) {
    res.status(400).json({ error: "此帳號已被使用" });
    return;
  }
  let created: Member;
  try {
    [created] = await db
      .insert(membersTable)
      .values({
        ...input,
        username,
        passwordHash: await bcrypt.hash(password, 10),
        email: input.email || null,
        phone: input.phone || null,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(400).json({ error: "此帳號已被使用" });
      return;
    }
    throw error;
  }
  reindex("member", created.id);
  res.status(201).json(serializeAdminMember(created));
});

router.get("/admin/members/:id", requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [member] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.id, id))
    .limit(1);
  if (!member) {
    res.status(404).json({ error: "找不到此會員" });
    return;
  }
  res.json(serializeAdminMember(member));
});

router.patch("/admin/members/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateAdminMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const data = parsed.data;
  const { password, username: requestedUsername, ...memberChanges } = data;
  const username = requestedUsername?.toLowerCase();

  // Guard: an admin cannot demote or deactivate their own account
  if (id === req.member!.id) {
    if (memberChanges.role === "member" || memberChanges.isActive === false) {
      res.status(400).json({ error: "無法停用或移除自己的管理員權限" });
      return;
    }
  }

  if (username) {
    const [duplicate] = await db
      .select({ id: membersTable.id })
      .from(membersTable)
      .where(and(eq(membersTable.username, username), ne(membersTable.id, id)))
      .limit(1);
    if (duplicate) {
      res.status(400).json({ error: "此帳號已被使用" });
      return;
    }
  }

  let updated: Member | undefined;
  try {
    [updated] = await db
      .update(membersTable)
      .set({
        ...memberChanges,
        // 身份真的被改動（或設成會員申請的那個身份）時，清掉待審的申請；
        // 只是編輯其他欄位、身份沒變時，申請保留。右邊的欄位是更新前的值。
        ...(memberChanges.tier && !("requestedTier" in memberChanges)
          ? {
              requestedTier: sql<string | null>`CASE WHEN ${membersTable.tier} <> ${memberChanges.tier} OR ${membersTable.requestedTier} = ${memberChanges.tier} THEN NULL ELSE ${membersTable.requestedTier} END`,
            }
          : {}),
        ...(username ? { username } : {}),
        ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
      })
      .where(eq(membersTable.id, id))
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(400).json({ error: "此帳號已被使用" });
      return;
    }
    throw error;
  }
  if (!updated) {
    res.status(404).json({ error: "找不到此會員" });
    return;
  }
  reindex("member", updated.id);
  res.json(serializeAdminMember(updated));
});

export default router;
