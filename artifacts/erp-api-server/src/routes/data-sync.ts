import { Router, type IRouter } from "express";
import { pool } from "@workspace/erp-db";
import { requireRole } from "../middleware/require-auth";
import { platformOperatorOnly } from "../middleware/saas-guard";

const router: IRouter = Router();
router.use("/data-sync", requireRole("super_admin"), platformOperatorOnly);

const TABLE_ORDER = [
  "admin_users",
  "departments",
  "designations",
  "grades",
  "shift_types",
  "currencies",
  "warehouses",
  "accounts",
  "asset_categories",
  "ticket_categories",
  "kb_categories",
  "quality_inspection_templates",
  "sla_definitions",
  "print_templates",
  "approval_workflows",
  "insurance_brackets",
  "customers",
  "suppliers",
  "items",
  "price_lists",
  "employees",
  "teachers",
  "projects",
  "leads",
  "opportunities",
  "quotations",
  "sales_orders",
  "purchase_orders",
  "invoices",
  "ecpay_invoice_issue_requests",
  "ecpay_invoice_allowances",
  "journal_entries",
  "contracts",
  "calendar_events",
  "notifications",
  "audit_logs",
  "activities",
  "api_keys",
  "tasks",
  "attendance",
  "leaves",
  "salary_slips",
  "delivery_notes",
  "purchase_receipts",
  "stock_entries",
  "price_list_items",
  "boms",
  "assets",
  "support_tickets",
  "kb_articles",
  "non_conformance_reports",
  "bank_statements",
  "bank_reconciliation_entries",
  "approval_requests",
  "attachments",
  "vouchers",
  "payment_requests",
  "sales_returns",
  "purchase_returns",
  "bom_items",
  "work_orders",
  "work_order_items",
  "job_cards",
  "quality_inspections",
  "capa_actions",
  "asset_maintenance",
  "asset_movements",
  "asset_depreciation_entries",
  "asset_value_adjustments",
  "exchange_rates",
];

router.get("/data-sync/export", async (_req, res): Promise<void> => {
  try {
    const client = await pool.connect();
    try {
      const tablesResult = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
      );
      const allTables = tablesResult.rows.map((r: any) => r.table_name);

      const bundle: Record<string, any[]> = {};
      let totalRows = 0;

      for (const table of allTables) {
        const result = await client.query(`SELECT * FROM "${table}"`);
        if (result.rows.length > 0) {
          bundle[table] = result.rows;
          totalRows += result.rows.length;
        }
      }

      res.json({
        version: 1,
        exportedAt: new Date().toISOString(),
        tables: Object.keys(bundle),
        totalRows,
        data: bundle,
      });
    } finally {
      client.release();
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/data-sync/stats", async (_req, res): Promise<void> => {
  try {
    const client = await pool.connect();
    try {
      const tablesResult = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
      );

      const stats: { table: string; count: number }[] = [];
      for (const row of tablesResult.rows) {
        const countResult = await client.query(`SELECT count(*) as cnt FROM "${row.table_name}"`);
        const count = parseInt(countResult.rows[0].cnt, 10);
        if (count > 0) {
          stats.push({ table: row.table_name, count });
        }
      }

      res.json({ stats, total: stats.reduce((s, r) => s + r.count, 0) });
    } finally {
      client.release();
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/data-sync/prepare", async (_req, res): Promise<void> => {
  try {
    const client = await pool.connect();
    try {
      const fkResult = await client.query(`
        SELECT
          tc.table_name,
          tc.constraint_name,
          pg_get_constraintdef(pgc.oid) AS definition
        FROM information_schema.table_constraints tc
        JOIN pg_constraint pgc ON pgc.conname = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
        ORDER BY tc.table_name
      `);
      const fks = fkResult.rows;

      for (const fk of fks) {
        try {
          await client.query(`ALTER TABLE public."${fk.table_name}" DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`);
        } catch {}
      }

      const allTables = (await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
      )).rows.map((r: any) => r.table_name);

      for (const table of allTables) {
        try {
          await client.query(`TRUNCATE TABLE "${table}" CASCADE`);
        } catch {}
      }

      res.json({ success: true, droppedFks: fks.length, truncatedTables: allTables.length, fks });
    } finally {
      client.release();
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/data-sync/push-table", async (req, res): Promise<void> => {
  try {
    const { table, rows } = req.body;
    if (!table || !rows || !Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "table and rows required" });
      return;
    }

    const client = await pool.connect();
    try {
      const columns = Object.keys(rows[0]);
      const colNames = columns.map(c => `"${c}"`).join(", ");

      const batchSize = 50;
      let importedCount = 0;

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        try {
          await client.query("BEGIN");
          for (const row of batch) {
            const values = columns.map((_, idx) => `$${idx + 1}`).join(", ");
            const params = columns.map(c => {
              const val = row[c];
              if (val === null || val === undefined) return null;
              if (typeof val === "object") return JSON.stringify(val);
              return val;
            });
            await client.query(`INSERT INTO "${table}" (${colNames}) VALUES (${values})`, params);
          }
          await client.query("COMMIT");
          importedCount += batch.length;
        } catch {
          await client.query("ROLLBACK");
          for (const row of batch) {
            try {
              const values = columns.map((_, idx) => `$${idx + 1}`).join(", ");
              const params = columns.map(c => {
                const val = row[c];
                if (val === null || val === undefined) return null;
                if (typeof val === "object") return JSON.stringify(val);
                return val;
              });
              await client.query(`INSERT INTO "${table}" (${colNames}) VALUES (${values})`, params);
              importedCount++;
            } catch {}
          }
        }
      }

      const seqResult = await client.query(`
        SELECT column_name, column_default 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1 
          AND column_default LIKE 'nextval%'
      `, [table]);

      for (const seq of seqResult.rows) {
        const seqName = seq.column_default.match(/nextval\('([^']+)'/)?.[1];
        if (seqName) {
          try {
            await client.query(`SELECT setval('${seqName}', COALESCE((SELECT MAX("${seq.column_name}") FROM "${table}"), 1))`);
          } catch {}
        }
      }

      res.json({ success: true, table, imported: importedCount, total: rows.length });
    } finally {
      client.release();
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/data-sync/finalize", async (req, res): Promise<void> => {
  try {
    const { fks } = req.body;
    if (!fks || !Array.isArray(fks)) {
      res.status(400).json({ error: "fks array required" });
      return;
    }

    const client = await pool.connect();
    try {
      let restored = 0;
      for (const fk of fks) {
        try {
          await client.query(`ALTER TABLE public."${fk.table_name}" ADD CONSTRAINT "${fk.constraint_name}" ${fk.definition}`);
          restored++;
        } catch {}
      }

      res.json({ success: true, restoredFks: restored });
    } finally {
      client.release();
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/data-sync/import", async (req, res): Promise<void> => {
  try {
    const bundle = req.body;
    if (!bundle || !bundle.data) {
      res.status(400).json({ error: "Invalid sync bundle" });
      return;
    }

    const client = await pool.connect();
    try {
      const tablesToImport = Object.keys(bundle.data);

      const allTables = (await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
      )).rows.map((r: any) => r.table_name);

      const fkResult = await client.query(`
        SELECT
          tc.table_name,
          tc.constraint_name,
          pg_get_constraintdef(pgc.oid) AS definition
        FROM information_schema.table_constraints tc
        JOIN pg_constraint pgc ON pgc.conname = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
        ORDER BY tc.table_name
      `);
      const fks = fkResult.rows;

      for (const fk of fks) {
        try {
          await client.query(`ALTER TABLE public."${fk.table_name}" DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`);
        } catch {}
      }

      if (!bundle.appendOnly) {
        for (const table of allTables) {
          try {
            await client.query(`TRUNCATE TABLE "${table}" CASCADE`);
          } catch {}
        }
      }

      const importOrder = TABLE_ORDER.filter(t => tablesToImport.includes(t));
      const remainingImport = tablesToImport.filter(t => !importOrder.includes(t));
      const fullImportOrder = [...importOrder, ...remainingImport];

      const results: { table: string; imported: number; error?: string }[] = [];

      for (const table of fullImportOrder) {
        const rows = bundle.data[table];
        if (!rows || rows.length === 0) continue;

        try {
          const columns = Object.keys(rows[0]);
          const colNames = columns.map(c => `"${c}"`).join(", ");

          const batchSize = 50;
          let importedCount = 0;

          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            try {
              await client.query("BEGIN");
              for (const row of batch) {
                const values = columns.map((_, idx) => `$${idx + 1}`).join(", ");
                const params = columns.map(c => {
                  const val = row[c];
                  if (val === null || val === undefined) return null;
                  if (typeof val === "object") return JSON.stringify(val);
                  return val;
                });
                await client.query(`INSERT INTO "${table}" (${colNames}) VALUES (${values})`, params);
              }
              await client.query("COMMIT");
              importedCount += batch.length;
            } catch {
              await client.query("ROLLBACK");
              for (const row of batch) {
                try {
                  const values = columns.map((_, idx) => `$${idx + 1}`).join(", ");
                  const params = columns.map(c => {
                    const val = row[c];
                    if (val === null || val === undefined) return null;
                    if (typeof val === "object") return JSON.stringify(val);
                    return val;
                  });
                  await client.query(`INSERT INTO "${table}" (${colNames}) VALUES (${values})`, params);
                  importedCount++;
                } catch {}
              }
            }
          }

          const seqResult = await client.query(`
            SELECT column_name, column_default 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = $1 
              AND column_default LIKE 'nextval%'
          `, [table]);

          for (const seq of seqResult.rows) {
            const seqName = seq.column_default.match(/nextval\('([^']+)'/)?.[1];
            if (seqName) {
              try {
                await client.query(`SELECT setval('${seqName}', COALESCE((SELECT MAX("${seq.column_name}") FROM "${table}"), 1))`);
              } catch {}
            }
          }

          results.push({ table, imported: importedCount });
        } catch (e: any) {
          results.push({ table, imported: 0, error: e.message });
        }
      }

      if (!bundle.appendOnly) {
        for (const fk of fks) {
          try {
            await client.query(`ALTER TABLE public."${fk.table_name}" ADD CONSTRAINT "${fk.constraint_name}" ${fk.definition}`);
          } catch {}
        }
      }

      res.json({
        success: true,
        importedAt: new Date().toISOString(),
        results,
        totalImported: results.reduce((s, r) => s + r.imported, 0),
        errors: results.filter(r => r.error),
      });
    } finally {
      client.release();
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
