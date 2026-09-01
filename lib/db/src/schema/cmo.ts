import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  numeric,
  date,
  index,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** AI CMO — KPI 目標 */
export const cmoGoalsTable = pgTable("cmo_goals", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  // daily_revenue | new_members | published_posts | points_issued | orders_count | ...
  metric: text("metric").notNull(),
  label: text("label").notNull(),
  targetValue: numeric("target_value", { precision: 14, scale: 2 }).notNull(),
  currentValue: numeric("current_value", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  unit: text("unit").notNull().default(""),
  // daily | weekly | monthly | quarterly
  period: text("period").notNull().default("monthly"),
  // high | medium | low
  priority: text("priority").notNull().default("medium"),
  // active | on_track | at_risk | behind | achieved
  status: text("status").notNull().default("active"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** AI CMO — 每日營運報告 */
export const cmoReportsTable = pgTable(
  "cmo_reports",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    reportDate: date("report_date").notNull(),
    // daily | manual
    reportType: text("report_type").notNull().default("daily"),
    summary: text("summary").notNull(),
    kpiSnapshot: jsonb("kpi_snapshot"),
    goalProgress: jsonb("goal_progress"),
    recommendations: text("recommendations"),
    rawData: jsonb("raw_data"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_cmo_reports_date").on(t.reportDate),
    // daily 報告每日僅一筆（多實例競態下冪等）；manual 不受限
    uniqueIndex("uq_cmo_reports_daily")
      .on(t.reportDate)
      .where(sql`${t.reportType} = 'daily'`),
  ],
);

/** AI CMO — 每日數據快照（凌晨收集，報告與對話引用） */
export const cmoMetricSnapshotsTable = pgTable(
  "cmo_metric_snapshots",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // 快照所屬日期（台北時區的當天營運數據）
    snapshotDate: date("snapshot_date").notNull(),
    // { revenue: {...}, members: {...}, content: {...}, points: {...}, social: {...}, wallet: {...}, errors: [...] }
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("uq_cmo_snapshot_date").on(t.snapshotDate)],
);

export type CmoGoal = typeof cmoGoalsTable.$inferSelect;
export type CmoReport = typeof cmoReportsTable.$inferSelect;
export type CmoMetricSnapshot = typeof cmoMetricSnapshotsTable.$inferSelect;
