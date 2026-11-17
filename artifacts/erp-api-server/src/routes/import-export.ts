import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, customersTable, suppliersTable, itemsTable, employeesTable, leadsTable, accountsTable, departmentsTable, warehousesTable, currenciesTable } from "@workspace/erp-db";
import multer from "multer";
import { UploadRejectedError } from "../middleware/multer-error";
import { requireAuth, requireRole } from "../middleware/require-auth";

const IMPORT_EXTS = new Set([".xlsx", ".xls", ".csv"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
    if (IMPORT_EXTS.has(ext)) cb(null, true);
    else cb(new UploadRejectedError("僅支援 Excel（.xlsx / .xls）或 CSV 檔案"));
  },
});

const router: IRouter = Router();
// 匯入匯出是整批讀寫主檔資料，只開放給老闆與系統管理員
router.use("/import-export", requireAuth, requireRole("owner", "admin"));

const exportableModules: Record<string, { table: any; label: string; columns: string[] }> = {
  customers: { table: customersTable, label: "客戶", columns: ["id", "name", "contactPerson", "email", "phone", "address", "taxId", "status"] },
  suppliers: { table: suppliersTable, label: "供應商", columns: ["id", "name", "contactPerson", "email", "phone", "address", "taxId", "status"] },
  items: { table: itemsTable, label: "品項", columns: ["id", "itemCode", "itemName", "itemGroup", "unit", "sellingPrice", "buyingPrice", "status"] },
  employees: { table: employeesTable, label: "員工", columns: ["id", "employeeId", "firstName", "lastName", "email", "phone", "designation", "dateOfJoining", "status"] },
  leads: { table: leadsTable, label: "潛在客戶", columns: ["id", "name", "company", "email", "phone", "source", "status"] },
  accounts: { table: accountsTable, label: "會計科目", columns: ["id", "accountNumber", "accountName", "accountType", "isGroup"] },
  departments: { table: departmentsTable, label: "部門", columns: ["id", "name", "costCenter"] },
  warehouses: { table: warehousesTable, label: "倉庫", columns: ["id", "name", "location", "status"] },
  currencies: { table: currenciesTable, label: "幣別", columns: ["id", "code", "name", "symbol", "isBase", "isActive"] },
};

/** 只留資料表真的有的欄位（清單寫錯或資料表改過時不會整批失敗） */
function realColumns(mod: { table: any; columns: string[] }): string[] {
  return mod.columns.filter(col => col in mod.table);
}

router.get("/import-export/modules", async (_req, res): Promise<void> => {
  const modules = Object.entries(exportableModules).map(([key, val]) => ({ key, label: val.label, columns: realColumns(val) }));
  res.json(modules);
});

router.get("/import-export/export/:module", async (req, res): Promise<void> => {
  const mod = exportableModules[String(req.params.module)];
  if (!mod) { res.status(400).json({ error: "Invalid module" }); return; }
  const columns = realColumns(mod);
  const rows: any[] = await db.select().from(mod.table);
  // 只輸出列出的欄位：原本整列送出，員工的薪資、投保設定等沒列出的欄位也會一起被匯出
  const data = rows.map(row => Object.fromEntries(columns.map(col => [col, row[col]])));
  res.json({ module: req.params.module, label: mod.label, columns, data });
});

router.post("/import-export/import/:module", upload.single("file"), async (req, res): Promise<void> => {
  const mod = exportableModules[String(req.params.module)];
  if (!mod) { res.status(400).json({ error: "Invalid module" }); return; }
  if (!req.body.data) { res.status(400).json({ error: "No data provided" }); return; }

  try {
    const rows = JSON.parse(req.body.data);
    if (!Array.isArray(rows) || rows.length === 0) { res.status(400).json({ error: "檔案裡沒有資料" }); return; }
    if (rows.length > 5000) { res.status(400).json({ error: "一次最多匯入 5000 筆，請分批匯入" }); return; }
    const columns = realColumns(mod);

    let imported = 0;
    let errors: string[] = [];

    for (const [index, row] of rows.entries()) {
      try {
        const cleanRow: any = {};
        for (const col of columns) {
          if (col !== "id" && row[col] !== undefined && row[col] !== "") cleanRow[col] = row[col];
        }
        if (Object.keys(cleanRow).length === 0) throw new Error("這一列沒有可匯入的欄位");
        await db.insert(mod.table).values(cleanRow);
        imported++;
      } catch (e: any) {
        const code = e?.code || e?.cause?.code;
        const reason = code === "23505" ? "資料重複（編號或名稱已存在）" : code === "23502" ? "缺少必填欄位" : (e?.message || "格式不正確").slice(0, 80);
        errors.push(`第 ${index + 2} 列：${reason}`);
      }
    }

    res.json({ imported, errors: errors.slice(0, 10), total: rows.length });
  } catch (e: any) {
    res.status(400).json({ error: `Parse error: ${e.message}` });
  }
});

export default router;
