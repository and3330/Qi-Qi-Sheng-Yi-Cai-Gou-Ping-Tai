import { Router, type IRouter } from "express";
import { and, count, desc, eq, ilike, lte, ne, or, sum , notInArray} from "drizzle-orm";
import {
  db,
  membersTable,
  ordersTable,
  productsTable,
  type Member,
} from "@workspace/db";
import { UpdateAdminMemberBody } from "@workspace/api-zod";
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

  // Guard: an admin cannot demote or deactivate their own account
  if (id === req.member!.id) {
    if (data.role === "member" || data.isActive === false) {
      res.status(400).json({ error: "無法停用或移除自己的管理員權限" });
      return;
    }
  }

  const [updated] = await db
    .update(membersTable)
    .set(data)
    .where(eq(membersTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "找不到此會員" });
    return;
  }
  reindex("member", updated.id);
  res.json(serializeAdminMember(updated));
});

export default router;
