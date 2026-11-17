import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, clockInLocationsTable, employeesTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/clock-in-locations", requireAuth);

const ADMIN_ROLES = ["owner", "admin", "hr_admin"] as const;

function parseBody(body: Record<string, unknown>, partial = false) {
  const errors: string[] = [];
  const out: Record<string, unknown> = {};

  if (!partial || body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) errors.push("請填寫地點名稱");
    else out.name = name;
  }
  if (!partial || body.latitude !== undefined) {
    const lat = Number(body.latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push("緯度需介於 -90 ~ 90");
    else out.latitude = String(lat);
  }
  if (!partial || body.longitude !== undefined) {
    const lng = Number(body.longitude);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push("經度需介於 -180 ~ 180");
    else out.longitude = String(lng);
  }
  if (!partial || body.radiusMeters !== undefined) {
    const radius = Number(body.radiusMeters);
    if (!Number.isInteger(radius) || radius < 10 || radius > 100000) errors.push("半徑需為 10 ~ 100000 公尺的整數");
    else out.radiusMeters = radius;
  }
  if (body.isActive !== undefined) out.isActive = Boolean(body.isActive);

  return { errors, out };
}

router.get("/clock-in-locations", async (_req, res): Promise<void> => {
  const rows = await db.select().from(clockInLocationsTable).orderBy(clockInLocationsTable.id);
  res.json(rows.map(r => ({ ...r, latitude: Number(r.latitude), longitude: Number(r.longitude) })));
});

// 外勤例外名單（不受打卡圍欄限制的員工）
router.get("/clock-in-locations/exemptions", requireRole(...ADMIN_ROLES), async (_req, res): Promise<void> => {
  const rows = await db.select({
    id: employeesTable.id,
    employeeId: employeesTable.employeeId,
    firstName: employeesTable.firstName,
    lastName: employeesTable.lastName,
    geofenceExempt: employeesTable.geofenceExempt,
  }).from(employeesTable).where(eq(employeesTable.status, "Active")).orderBy(employeesTable.id);
  res.json(rows);
});

router.patch("/clock-in-locations/exemptions/:employeeId", requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const employeeId = Number(req.params.employeeId);
  if (!Number.isInteger(employeeId)) { res.status(400).json({ error: "員工編號格式不正確" }); return; }
  const [row] = await db.update(employeesTable)
    .set({ geofenceExempt: Boolean(req.body?.geofenceExempt) })
    .where(eq(employeesTable.id, employeeId))
    .returning({ id: employeesTable.id, geofenceExempt: employeesTable.geofenceExempt });
  if (!row) { res.status(404).json({ error: "找不到員工" }); return; }
  res.json(row);
});

router.post("/clock-in-locations", requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { errors, out } = parseBody(req.body || {});
  if (errors.length > 0) { res.status(400).json({ error: errors.join("；") }); return; }
  const [row] = await db.insert(clockInLocationsTable).values(out as typeof clockInLocationsTable.$inferInsert).returning();
  res.status(201).json({ ...row, latitude: Number(row.latitude), longitude: Number(row.longitude) });
});

router.patch("/clock-in-locations/:id", requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "地點編號格式不正確" }); return; }
  const { errors, out } = parseBody(req.body || {}, true);
  if (errors.length > 0) { res.status(400).json({ error: errors.join("；") }); return; }
  if (Object.keys(out).length === 0) { res.status(400).json({ error: "沒有要更新的欄位" }); return; }
  const [row] = await db.update(clockInLocationsTable).set(out).where(eq(clockInLocationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "找不到打卡地點" }); return; }
  res.json({ ...row, latitude: Number(row.latitude), longitude: Number(row.longitude) });
});

router.delete("/clock-in-locations/:id", requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "地點編號格式不正確" }); return; }
  const [row] = await db.delete(clockInLocationsTable).where(eq(clockInLocationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "找不到打卡地點" }); return; }
  res.status(204).end();
});

export default router;
