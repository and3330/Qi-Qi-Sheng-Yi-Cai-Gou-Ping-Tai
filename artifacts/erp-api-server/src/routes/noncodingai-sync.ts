import { Router, type IRouter } from "express";
import { todayTaipei } from "../lib/inventory-journal";
import { tenantPool as pool } from "../lib/tenant-db";
import { requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/noncodingai", requireRole("owner", "admin", "accountant"));

const NCAI_BASE = "https://noncodingai.com/api/erp";
const PROJECT_NAME = "課程專案";
const BANK_ACCOUNT_NAME = "銀行存款-國泰板橋";

const ITEM_BY_ORDER_TYPE: Record<string, string> = {
  course: "線上課程銷售",
  creditTopup: "積分服務",
  consultation: "顧問諮詢",
};

const REVENUE_ACCOUNT_BY_TYPE: Record<string, string> = {
  course: "課程收入",
  creditTopup: "其他營業收入-其他",
  consultation: "其他營業收入-其他",
};

const EXPENSE_ACCOUNT_BY_CATEGORY: Record<string, string> = {
  ad_spend: "廣告費(營)",
  tool_cost: "軟體租用費",
  salary: "薪資支出(營)-正職",
};

async function ncaiFetch(path: string): Promise<any> {
  const apiKey = process.env.NONCODINGAI_ERP_API_KEY;
  if (!apiKey) throw new Error("NONCODINGAI_ERP_API_KEY 未設定");
  const res = await fetch(`${NCAI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Upstream ${path} ${res.status}`);
  return res.json();
}

async function getOrCreateProject(): Promise<number> {
  const found = await pool.query(`SELECT id FROM projects WHERE name=$1 LIMIT 1`, [PROJECT_NAME]);
  if (found.rows[0]) return found.rows[0].id as number;
  const ins = await pool.query(
    `INSERT INTO projects (name, description, status, priority, start_date)
     VALUES ($1, $2, 'Open', 'Medium', $3) RETURNING id`,
    [PROJECT_NAME, "noncodingai.com 課程平台同步：課程銷售、積分儲值、顧問諮詢與廣告／工具支出", todayTaipei()],
  );
  return ins.rows[0].id as number;
}

async function getOrCreateItem(name: string): Promise<number> {
  const found = await pool.query(`SELECT id FROM items WHERE item_name=$1 LIMIT 1`, [name]);
  if (found.rows[0]) return found.rows[0].id as number;
  const code = `NCAI-${name}`;
  const ins = await pool.query(
    `INSERT INTO items (item_code, item_name, item_group, unit, item_type, status, selling_price)
     VALUES ($1, $2, $3, '次', 'Service', 'Active', 0) RETURNING id`,
    [code, name, "noncodingai 服務"],
  );
  return ins.rows[0].id as number;
}

async function getAccountIdByName(name: string): Promise<{ id: number; name: string } | null> {
  const r = await pool.query(`SELECT id, account_name FROM accounts WHERE account_name=$1 LIMIT 1`, [name]);
  if (!r.rows[0]) return null;
  return { id: r.rows[0].id as number, name: r.rows[0].account_name as string };
}

async function getOrCreateCustomer(email: string | null, name: string | null, phone: string | null): Promise<number> {
  const safeEmail = (email || "").trim().toLowerCase();
  if (safeEmail) {
    const f = await pool.query(`SELECT id FROM customers WHERE lower(email)=$1 LIMIT 1`, [safeEmail]);
    if (f.rows[0]) return f.rows[0].id as number;
  }
  const cname = (name || safeEmail || "noncodingai 客戶").slice(0, 200);
  const code = `NCAI-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const ins = await pool.query(
    `INSERT INTO customers (name, email, phone, customer_code, category)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [cname, safeEmail || null, phone || null, code, "noncodingai"],
  );
  return ins.rows[0].id as number;
}

function cents(v: any): number {
  const n = Number(v) || 0;
  return Math.round(n) / 100;
}

async function fetchAllOrders(): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  const limit = 200;
  for (;;) {
    const r = await ncaiFetch(`/orders?limit=${limit}&offset=${offset}`);
    all.push(...r.data);
    if (all.length >= r.pagination.total || r.data.length === 0) break;
    offset += limit;
  }
  return all;
}

async function fetchAllExpenses(): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  const limit = 200;
  for (;;) {
    const r = await ncaiFetch(`/expenses?limit=${limit}&offset=${offset}`);
    all.push(...r.data);
    if (all.length >= r.pagination.total || r.data.length === 0) break;
    offset += limit;
  }
  return all;
}

router.post("/noncodingai/sync", async (_req, res): Promise<void> => {
  // 「外部串接」已經接手這個來源時，舊的同步就不再執行，避免同一筆訂單入帳兩次
  const takenOver = await pool.query(`SELECT 1 FROM integration_sources WHERE code = $1 AND is_active LIMIT 1`, ["ai-university"]);
  if (takenOver.rowCount && takenOver.rowCount > 0) {
    res.status(409).json({ error: "AI 大學 已經改由「系統管理 → 外部串接」同步，請到那裡按「立即同步」" });
    return;
  }
  try {
    const summary = {
      projectId: 0,
      orders: { fetched: 0, imported: 0, skipped: 0, errors: [] as string[] },
      expenses: { fetched: 0, imported: 0, skipped: 0, errors: [] as string[] },
    };

    const projectId = await getOrCreateProject();
    summary.projectId = projectId;

    const bank = await getAccountIdByName(BANK_ACCOUNT_NAME);
    const taxAcc = await getAccountIdByName("銷項稅額");
    const feeAcc = await getAccountIdByName("手續費(營)");
    if (!bank || !taxAcc || !feeAcc) {
      res.status(500).json({ error: "缺少必要的會計科目（銀行存款-國泰板橋／銷項稅額／手續費(營)）" });
      return;
    }

    const itemIdByType: Record<string, number> = {};
    for (const t of Object.keys(ITEM_BY_ORDER_TYPE)) {
      itemIdByType[t] = await getOrCreateItem(ITEM_BY_ORDER_TYPE[t]);
    }
    const revAccByType: Record<string, { id: number; name: string }> = {};
    for (const t of Object.keys(REVENUE_ACCOUNT_BY_TYPE)) {
      const a = await getAccountIdByName(REVENUE_ACCOUNT_BY_TYPE[t]);
      if (a) revAccByType[t] = a;
    }

    // ===== 訂單 =====
    const SKIP_GATEWAYS = new Set(["stripe", "airwallex"]);
    const orders = await fetchAllOrders();
    summary.orders.fetched = orders.length;
    for (const o of orders) {
      const client = await pool.connect();
      try {
        if (o.status !== "completed") {
          summary.orders.skipped++;
          continue;
        }
        if (SKIP_GATEWAYS.has(String(o.paymentGateway || "").toLowerCase())) {
          summary.orders.skipped++;
          continue;
        }
        const orderNumber = `NCAI-O-${o.id}`;
        const dup = await client.query(`SELECT 1 FROM sales_orders WHERE order_number=$1 LIMIT 1`, [orderNumber]);
        if (dup.rowCount && dup.rowCount > 0) {
          summary.orders.skipped++;
          continue;
        }
        const amount = cents(o.amount);
        const tax = cents(o.taxAmount);
        const fee = cents(o.channelFeeAmount);
        const netCash = +(amount - fee).toFixed(2); // 金流真正入帳金額（含稅，僅扣手續費）
        const preTax = +(amount - tax).toFixed(2);  // 收入（不含稅）
        const orderType = String(o.orderType || "course");
        const itemId = itemIdByType[orderType] ?? itemIdByType["course"];
        const itemName = ITEM_BY_ORDER_TYPE[orderType] ?? ITEM_BY_ORDER_TYPE["course"];
        const revAcc = revAccByType[orderType] ?? revAccByType["course"];
        if (!revAcc) {
          summary.orders.errors.push(`#${o.id}: 找不到收入科目`);
          continue;
        }
        const customerId = await getOrCreateCustomer(o.customerEmail, o.customerName, o.customerPhone);
        const orderDate = (o.createdAt || "").slice(0, 10);

        const items = [
          {
            itemId,
            itemName: `${itemName}：${o.productName ?? ""}`.slice(0, 200),
            quantity: 1,
            rate: preTax,
            amount: preTax,
            tax,
            preTaxPrice: preTax,
            rateExclTax: preTax,
          },
        ];

        // 會計傳票：Dr 銀行存款 (amount - fee) + Dr 手續費 fee = Cr 收入 (amount-tax) + Cr 銷項稅額 tax
        const lines = [
          { debit: netCash, credit: 0, accountId: bank.id, accountName: bank.name },
          ...(fee > 0 ? [{ debit: fee, credit: 0, accountId: feeAcc.id, accountName: feeAcc.name }] : []),
          { debit: 0, credit: preTax, accountId: revAcc.id, accountName: revAcc.name },
          ...(tax > 0 ? [{ debit: 0, credit: tax, accountId: taxAcc.id, accountName: taxAcc.name }] : []),
        ];
        const totalDebit = +lines.reduce((s, l) => s + l.debit, 0).toFixed(2);
        const totalCredit = +lines.reduce((s, l) => s + l.credit, 0).toFixed(2);
        if (Math.abs(totalDebit - totalCredit) > 0.01) {
          summary.orders.errors.push(`#${o.id}: 借貸不平 Dr=${totalDebit} Cr=${totalCredit}`);
          continue;
        }
        const entryNumber = `JE-${orderNumber}`;

        await client.query("BEGIN");
        const ins = await client.query(
          `INSERT INTO sales_orders (order_number, customer_id, order_date, status, total_amount, items, project_id, order_source, remarks, extra_fields)
           VALUES ($1,$2,$3,'Completed',$4,$5::jsonb,$6,'noncodingai',$7,$8::jsonb)
           ON CONFLICT (order_number) DO NOTHING RETURNING id`,
          [
            orderNumber,
            customerId,
            orderDate,
            amount,
            JSON.stringify(items),
            projectId,
            `noncodingai #${o.id} ${o.paymentGateway}/${o.paymentChannel ?? ""}`,
            JSON.stringify({
              ncaiId: o.id,
              orderType: o.orderType,
              paymentGateway: o.paymentGateway,
              paymentChannel: o.paymentChannel,
              channelFeeTWD: fee,
              taxTWD: tax,
              netCashTWD: netCash,
              currency: o.currency,
              invoiceNo: o.invoiceNo,
              stripePaymentIntentId: o.stripePaymentIntentId,
              airwallexPaymentIntentId: o.airwallexPaymentIntentId,
            }),
          ],
        );
        if (ins.rowCount === 0) {
          await client.query("ROLLBACK");
          summary.orders.skipped++;
          continue;
        }
        await client.query(
          `INSERT INTO journal_entries (entry_number, entry_date, description, total_debit, total_credit, status, lines, project_id)
           VALUES ($1,$2,$3,$4,$5,'Posted',$6::jsonb,$7)
           ON CONFLICT (entry_number) DO NOTHING`,
          [
            entryNumber,
            orderDate,
            `${itemName}：${o.productName ?? ""} - ${o.customerName ?? ""}`.slice(0, 200),
            totalDebit,
            totalCredit,
            JSON.stringify(lines),
            projectId,
          ],
        );
        await client.query("COMMIT");
        summary.orders.imported++;
      } catch (err: any) {
        try { await client.query("ROLLBACK"); } catch {}
        summary.orders.errors.push(`#${o.id}: ${err?.message ?? String(err)}`);
      } finally {
        client.release();
      }
    }

    // ===== 費用 =====
    const expenses = await fetchAllExpenses();
    summary.expenses.fetched = expenses.length;
    for (const e of expenses) {
      try {
        const entryNumber = `JE-NCAI-E-${e.id}`;
        const dup = await pool.query(`SELECT 1 FROM journal_entries WHERE entry_number=$1 LIMIT 1`, [entryNumber]);
        if (dup.rowCount && dup.rowCount > 0) {
          summary.expenses.skipped++;
          continue;
        }
        const amount = Number(e.amount) || 0;
        if (amount <= 0) {
          summary.expenses.skipped++;
          continue;
        }
        const accName = EXPENSE_ACCOUNT_BY_CATEGORY[String(e.category)] ?? "其他營業費用-其他";
        const expAcc = await getAccountIdByName(accName);
        if (!expAcc) {
          summary.expenses.errors.push(`#${e.id}: 找不到科目 ${accName}`);
          continue;
        }
        const date = (e.date || e.createdAt || "").slice(0, 10);
        const lines = [
          { debit: amount, credit: 0, accountId: expAcc.id, accountName: expAcc.name },
          { debit: 0, credit: amount, accountId: bank.id, accountName: bank.name },
        ];
        await pool.query(
          `INSERT INTO journal_entries (entry_number, entry_date, description, total_debit, total_credit, status, lines, project_id)
           VALUES ($1,$2,$3,$4,$5,'Posted',$6::jsonb,$7)`,
          [
            entryNumber,
            date,
            `${e.category} - ${e.description ?? ""}`.slice(0, 200),
            amount,
            amount,
            JSON.stringify(lines),
            projectId,
          ],
        );
        summary.expenses.imported++;
      } catch (err: any) {
        summary.expenses.errors.push(`#${e.id}: ${err?.message ?? String(err)}`);
      }
    }

    res.json({ ok: true, summary });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

router.get("/noncodingai/stats", async (_req, res): Promise<void> => {
  try {
    const proj = await pool.query(`SELECT id FROM projects WHERE name=$1 LIMIT 1`, [PROJECT_NAME]);
    if (!proj.rows[0]) {
      res.json({ projectExists: false });
      return;
    }
    const projectId = proj.rows[0].id as number;
    const so = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_amount),0)::numeric AS gross
       FROM sales_orders WHERE project_id=$1 AND order_source='noncodingai'`,
      [projectId],
    );
    const je = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_debit),0)::numeric AS total_debit
       FROM journal_entries WHERE project_id=$1`,
      [projectId],
    );
    const exp = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_debit),0)::numeric AS total
       FROM journal_entries WHERE project_id=$1 AND entry_number LIKE 'JE-NCAI-E-%'`,
      [projectId],
    );
    const ord = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_debit),0)::numeric AS total
       FROM journal_entries WHERE project_id=$1 AND entry_number LIKE 'JE-NCAI-O-%'`,
      [projectId],
    );
    const lastSync = await pool.query(
      `SELECT MAX(created_at) AS last FROM journal_entries WHERE project_id=$1`,
      [projectId],
    );
    res.json({
      projectExists: true,
      projectId,
      salesOrders: so.rows[0],
      journalEntries: je.rows[0],
      orderJournals: ord.rows[0],
      expenseJournals: exp.rows[0],
      lastSyncedAt: lastSync.rows[0]?.last ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

router.get("/noncodingai/upstream-summary", async (_req, res): Promise<void> => {
  try {
    const data = await ncaiFetch("/summary");
    const totals = data.totals ?? {};
    res.json({
      currency: data.currency,
      totals: {
        grossTWD: cents(totals.gross),
        channelFeesTWD: cents(totals.channelFees),
        taxTWD: cents(totals.tax),
        netCourseTWD: cents(totals.netCourse),
      },
      byOrderType: Object.fromEntries(
        Object.entries(data.byOrderType ?? {}).map(([k, v]: any) => [
          k,
          {
            count: v.count,
            grossTWD: cents(v.gross),
            channelFeesTWD: v.channelFees != null ? cents(v.channelFees) : undefined,
            taxTWD: v.tax != null ? cents(v.tax) : undefined,
            netTWD: v.net != null ? cents(v.net) : undefined,
          },
        ]),
      ),
      courseByGateway: (data.courseByGateway ?? []).map((g: any) => ({
        gateway: g.gateway,
        count: g.count,
        grossTWD: cents(g.gross),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

export default router;
