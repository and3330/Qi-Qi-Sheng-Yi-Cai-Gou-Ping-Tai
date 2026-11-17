/**
 * 展示模式（DEMO_MODE=true）
 * - 啟動時與每天凌晨 04:00 (Asia/Taipei) 將資料庫重置為虛構的示範資料
 * - 自動建立 test/test 展示帳號
 * - 所有資料皆為虛構，與任何真實公司無關
 */
import cron from "node-cron";
import {
  db,
  adminUsersTable,
  departmentsTable,
  projectsTable,
  employeesTable,
  teachersTable,
  customersTable,
  suppliersTable,
  itemsTable,
  warehousesTable,
  quotationsTable,
  salesOrdersTable,
  invoicesTable,
} from "@workspace/erp-db";
import { runWithTenant } from "@workspace/erp-db";
import { sql } from "drizzle-orm";
import { hashPassword } from "../lib/auth";
import { logger } from "../lib/logger";
import { ensureAccountingBaseline, selectAccountingBaseline } from "../lib/accounting-baseline";

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

/** 重置時保留的資料表（其餘 public schema 全部清空） */
const KEEP_TABLES = new Set(["demo_meta", "__drizzle_migrations"]);

const today = () => new Date();
const d = (offsetDays: number) => {
  const t = new Date(today().getTime() + offsetDays * 86400000);
  return t.toISOString().slice(0, 10);
};

/**
 * 安全防護（fail-closed）：避免在真實系統上誤啟用 DEMO_MODE 而清空資料。
 * 只有以下情況允許重置：
 * 1. demo_meta 已有 last_reset（代表這個資料庫本來就是展示資料庫）
 * 2. 明確設定 DEMO_FORCE_INIT=true（全新展示資料庫第一次初始化用）
 * 任何查詢失敗一律視為不安全。
 */
async function isSafeToReset(): Promise<boolean> {
  if (process.env.DEMO_FORCE_INIT === "true") return true;
  try {
    const meta: any = await db.execute(sql`
      SELECT value FROM demo_meta WHERE key = 'last_reset'
    `);
    return Boolean(meta?.rows?.length);
  } catch {
    return false; // fail closed：demo_meta 不存在或查詢失敗 → 拒絕
  }
}

export async function resetDemoData(): Promise<void> {
  if (!(await isSafeToReset())) {
    logger.error("DEMO: 無法確認這是展示資料庫，拒絕重置！全新展示資料庫第一次初始化請設定 DEMO_FORCE_INIT=true");
    return;
  }
  // 單一交易：清空＋seed＋標記，一步失敗全部回滾；advisory lock 防止並發重置
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(902_2026)`);
    const r: any = await tx.execute(sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    const tables: string[] = (r?.rows ?? [])
      .map((row: any) => String(row.tablename))
      .filter((t: string) => !KEEP_TABLES.has(t) && /^[a-z0-9_]+$/.test(t));
    if (tables.length > 0) {
      await tx.execute(sql.raw(
        `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
      ));
    }
    await seedDemoDataInto(tx);
  });
}

/** 將示範資料寫入指定的資料庫連線（測試時可傳入交易以便回滾；不含清空動作） */
export async function seedDemoDataInto(dbx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<void> {
  logger.info("DEMO: 開始寫入示範資料...");

  // ── 展示帳號 ──
  await dbx.insert(adminUsersTable).values({
    username: "test",
    passwordHash: await hashPassword("test"),
    displayName: "展示帳號",
    role: "super_admin",
    isActive: true,
  });

  // ── 部門 / 專案 ──
  const depts = await dbx.insert(departmentsTable).values([
    { name: "校園事業部" },
    { name: "課程事業部" },
    { name: "商城事業部" },
    { name: "行政管理部" },
  ]).returning();
  const [dCampus, dCourse, dShop, dAdmin] = depts;

  const projects = await dbx.insert(projectsTable).values([
    { name: "校園機器人課程專案", departmentId: dCampus.id, status: "Open", startDate: d(-120), budgetIncome: "1200000", budgetExpense: "700000" },
    { name: "暑期科學營", departmentId: dCourse.id, status: "Open", startDate: d(-60), budgetIncome: "600000", budgetExpense: "350000" },
    { name: "線上商城營運", departmentId: dShop.id, status: "Open", startDate: d(-200), budgetIncome: "900000", budgetExpense: "500000" },
  ]).returning();
  const [pRobot, pCamp, pShop] = projects;

  // ── 員工 ──
  const employees = await dbx.insert(employeesTable).values([
    { employeeId: "EMP-001", firstName: "大明", lastName: "王", email: "daming@demo.example.com", phone: "0912-345-678", departmentId: dAdmin.id, designation: "總經理", dateOfJoining: d(-1400), salary: "80000" },
    { employeeId: "EMP-002", firstName: "小美", lastName: "陳", email: "xiaomei@demo.example.com", phone: "0922-111-222", departmentId: dCampus.id, designation: "業務主任", dateOfJoining: d(-900), salary: "52000" },
    { employeeId: "EMP-003", firstName: "志豪", lastName: "林", email: "zhihao@demo.example.com", phone: "0933-333-444", departmentId: dCourse.id, designation: "課程企劃", dateOfJoining: d(-700), salary: "45000" },
    { employeeId: "EMP-004", firstName: "雅婷", lastName: "張", email: "yating@demo.example.com", phone: "0955-555-666", departmentId: dShop.id, designation: "電商專員", dateOfJoining: d(-450), salary: "42000" },
    { employeeId: "EMP-005", firstName: "俊傑", lastName: "李", email: "junjie@demo.example.com", phone: "0966-777-888", departmentId: dAdmin.id, designation: "會計", dateOfJoining: d(-600), salary: "48000" },
  ]).returning();

  // ── 老師 ──
  await dbx.insert(teachersTable).values([
    { teacherId: "T-001", name: "黃老師", position: "機器人講師", phone: "0911-000-111", status: "Active" },
    { teacherId: "T-002", name: "吳老師", position: "科學實驗講師", phone: "0911-000-222", status: "Active" },
    { teacherId: "T-003", name: "劉老師", position: "程式設計講師", phone: "0911-000-333", status: "Active" },
  ]);

  // ── 客戶 ──
  const customers = await dbx.insert(customersTable).values([
    { customerCode: "C-0001", name: "陽光國小", contactPerson: "許主任", phone: "02-2345-6789", city: "台北市", category: "學校" },
    { customerCode: "C-0002", name: "快樂國小", contactPerson: "郭組長", phone: "02-8765-4321", city: "新北市", category: "學校" },
    { customerCode: "C-0003", name: "希望中學", contactPerson: "曾老師", phone: "03-1234-5678", city: "桃園市", category: "學校" },
    { customerCode: "C-0004", name: "未來教育基金會", contactPerson: "蔡執行長", phone: "02-5555-1234", city: "台北市", taxId: "12345678", category: "機構" },
    { customerCode: "C-0005", name: "小星星幼兒園", contactPerson: "楊園長", phone: "04-2222-3333", city: "台中市", category: "學校" },
    { customerCode: "C-0006", name: "宏達文具行", contactPerson: "趙老闆", phone: "02-6666-7777", taxId: "87654321", category: "經銷商" },
    { customerCode: "C-0007", name: "王小姐（網路訂單）", phone: "0987-654-321", category: "個人" },
    { customerCode: "C-0008", name: "博學補習班", contactPerson: "孫班主任", phone: "07-333-4444", city: "高雄市", category: "補習班" },
  ]).returning();

  // ── 供應商 ──
  const suppliers = await dbx.insert(suppliersTable).values([
    { supplierCode: "S-0001", name: "創新教具有限公司", contactPerson: "洪經理", phone: "02-1111-2222", taxId: "23456789" },
    { supplierCode: "S-0002", name: "大同印刷廠", contactPerson: "江先生", phone: "02-3333-4444", taxId: "34567890" },
    { supplierCode: "S-0003", name: "全球電子材料行", contactPerson: "何小姐", phone: "04-5555-6666", taxId: "45678901" },
  ]).returning();

  // ── 倉庫 / 品項 ──
  await dbx.insert(warehousesTable).values([
    { name: "總倉", location: "台北市內湖區" },
    { name: "門市倉", location: "台北市大安區" },
  ]);

  await dbx.insert(itemsTable).values([
    { itemCode: "ITEM-001", itemName: "機器人入門套件", unit: "組", sellingPrice: "1500", buyingPrice: "900", currentStock: "120", reorderLevel: "30" },
    { itemCode: "ITEM-002", itemName: "科學實驗材料包", unit: "包", sellingPrice: "350", buyingPrice: "180", currentStock: "300", reorderLevel: "50" },
    { itemCode: "ITEM-003", itemName: "程式設計教材（上冊）", unit: "本", sellingPrice: "420", buyingPrice: "210", currentStock: "80", reorderLevel: "20" },
    { itemCode: "ITEM-004", itemName: "課程講師鐘點", unit: "堂", sellingPrice: "1200", buyingPrice: "0", currentStock: "0" },
    { itemCode: "ITEM-005", itemName: "積木創作組", unit: "盒", sellingPrice: "880", buyingPrice: "520", currentStock: "15", reorderLevel: "25" },
    { itemCode: "ITEM-006", itemName: "電子零件包", unit: "包", sellingPrice: "260", buyingPrice: "130", currentStock: "200", reorderLevel: "40" },
  ]);

  // ── 會計科目（與新租戶相同的不可變通用基線） ──
  await ensureAccountingBaseline(dbx, selectAccountingBaseline("generic"));

  // ── 報價單 ──
  await dbx.insert(quotationsTable).values([
    { quotationNumber: "QT-10001", customerId: customers[0].id, customerName: customers[0].name, quotationDate: d(-20), validUntil: d(10), status: "Sent", totalAmount: "54000", grandTotal: "54000", departmentId: dCampus.id, projectId: pRobot.id, items: [{ itemName: "機器人課程（18週）", quantity: 18, unit: "堂", rate: 3000, amount: 54000 }] },
    { quotationNumber: "QT-10002", customerId: customers[3].id, customerName: customers[3].name, quotationDate: d(-12), validUntil: d(18), status: "Draft", totalAmount: "126000", grandTotal: "126000", departmentId: dCourse.id, projectId: pCamp.id, items: [{ itemName: "暑期科學營（三梯次）", quantity: 3, unit: "梯", rate: 42000, amount: 126000 }] },
    { quotationNumber: "QT-10003", customerId: customers[7].id, customerName: customers[7].name, quotationDate: d(-5), validUntil: d(25), status: "Accepted", totalAmount: "36000", grandTotal: "36000", departmentId: dCourse.id, items: [{ itemName: "程式設計班（12堂）", quantity: 12, unit: "堂", rate: 3000, amount: 36000 }] },
  ]);

  // ── 銷貨單 ──
  const mkItems = (rows: Array<[string, number, string, number]>) =>
    rows.map(([itemName, quantity, unit, rate]) => ({ itemName, quantity, unit, rate, amount: quantity * rate }));

  const orders = await dbx.insert(salesOrdersTable).values([
    { orderNumber: "SO-20001", customerId: customers[0].id, orderDate: d(-45), status: "Completed", totalAmount: "54000", departmentId: dCampus.id, projectId: pRobot.id, handlerId: employees[1].id, label: "陽光國小_機器人社團(春季)", items: mkItems([["機器人課程（18週）", 18, "堂", 3000]]) },
    { orderNumber: "SO-20002", customerId: customers[1].id, orderDate: d(-30), status: "Confirmed", totalAmount: "31500", departmentId: dCampus.id, projectId: pRobot.id, handlerId: employees[1].id, items: mkItems([["科學實驗材料包", 90, "包", 350]]) },
    { orderNumber: "SO-20003", customerId: customers[4].id, orderDate: d(-14), status: "Confirmed", totalAmount: "26400", departmentId: dCourse.id, projectId: pCamp.id, handlerId: employees[2].id, items: mkItems([["積木創作組", 30, "盒", 880]]) },
    { orderNumber: "SO-20004", customerId: customers[6].id, orderDate: d(-3), status: "Draft", totalAmount: "1500", departmentId: dShop.id, projectId: pShop.id, handlerId: employees[3].id, items: mkItems([["機器人入門套件", 1, "組", 1500]]) },
    { orderNumber: "SO-20005", customerId: customers[5].id, orderDate: d(-8), status: "Confirmed", totalAmount: "52800", departmentId: dShop.id, projectId: pShop.id, handlerId: employees[3].id, items: mkItems([["積木創作組", 60, "盒", 880]]) },
  ]).returning();

  // ── 發票（銷項） ──
  await dbx.insert(invoicesTable).values([
    { invoiceNumber: "INV-30001", invoiceType: "Sales", customerId: customers[0].id, salesOrderId: orders[0].id, invoiceDate: d(-40), dueDate: d(-10), status: "Paid", totalAmount: "54000", paidAmount: "54000", outstandingAmount: "0", taxType: "taxable", netAmount: "51429", taxAmount: "2571", items: mkItems([["機器人課程（18週）", 18, "堂", 3000]]) },
    { invoiceNumber: "INV-30002", invoiceType: "Sales", customerId: customers[1].id, salesOrderId: orders[1].id, invoiceDate: d(-25), dueDate: d(5), status: "Submitted", totalAmount: "31500", paidAmount: "0", outstandingAmount: "31500", taxType: "taxable", netAmount: "30000", taxAmount: "1500", items: mkItems([["科學實驗材料包", 90, "包", 350]]) },
    { invoiceNumber: "INV-30003", invoiceType: "Sales", customerId: customers[5].id, salesOrderId: orders[4].id, invoiceDate: d(-6), dueDate: d(24), status: "Submitted", totalAmount: "26400", paidAmount: "10000", outstandingAmount: "16400", taxType: "taxable", netAmount: "25143", taxAmount: "1257", items: mkItems([["積木創作組", 30, "盒", 880]]) },
    { invoiceNumber: "PINV-40001", invoiceType: "Purchase", supplierId: suppliers[0].id, invoiceDate: d(-15), dueDate: d(15), status: "Submitted", totalAmount: "48000", paidAmount: "0", outstandingAmount: "48000", taxType: "taxable", netAmount: "45714", taxAmount: "2286", items: mkItems([["機器人入門套件（進貨）", 50, "組", 960]]) },
  ]);

  await dbx.execute(sql`
    CREATE TABLE IF NOT EXISTS demo_meta (key text PRIMARY KEY, value text NOT NULL);
  `);
  await dbx.execute(sql`
    INSERT INTO demo_meta (key, value) VALUES ('last_reset', ${new Date().toISOString()})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  `);

  logger.info("DEMO: 示範資料重置完成（帳號 test / 密碼 test）");
}

/** 距上次重置超過 24 小時才重置（避免 autoscale 重啟時洗掉訪客操作） */
async function resetIfStale(): Promise<void> {
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS demo_meta (key text PRIMARY KEY, value text NOT NULL)`);
    const r: any = await db.execute(sql`SELECT value FROM demo_meta WHERE key = 'last_reset'`);
    const last = r?.rows?.[0]?.value ? new Date(r.rows[0].value).getTime() : 0;
    if (Date.now() - last > 24 * 3600 * 1000) {
      await resetDemoData();
    } else {
      logger.info("DEMO: 距上次重置未滿 24 小時，跳過");
    }
  } catch (err) {
    logger.error({ err }, "DEMO: 重置檢查失敗");
  }
}

export function startDemoMode(): void {
  if (!isDemoMode()) return;
  logger.warn("DEMO_MODE 已啟用：資料庫將每日重置為示範資料");
  // 展示資料一律屬於 1 號租戶（RLS 需要租戶上下文）
  void runWithTenant(1, () => resetIfStale());
  cron.schedule("0 4 * * *", () => void runWithTenant(1, () => resetIfStale()), { timezone: "Asia/Taipei" });
}
