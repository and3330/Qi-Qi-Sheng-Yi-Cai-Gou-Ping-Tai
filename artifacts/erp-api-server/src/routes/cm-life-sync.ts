import { Router, type IRouter } from "express";
import { todayTaipei } from "../lib/inventory-journal";
import { tenantPool as pool } from "../lib/tenant-db";
import { requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/cm-life", requireRole("owner", "admin", "accountant"));

const CM_BASE = "https://cmsedu-life.com/api/erp";
const PROJECT_NAME = "CM生活+ 電商";
const BANK_ACCOUNT_NAME = "銀行存款-國泰板橋";

const ITEM_BY_ORDER_TYPE: Record<string, string> = {
  service: "CM 服務訂單",
  course:  "CM 課程訂單",
  lecture: "CM 講座訂單",
  product: "CM 商品訂單",
  tutor:   "CM 家教訂單",
};

const REVENUE_ACCOUNT_BY_TYPE: Record<string, string> = {
  service: "勞務收入",
  course:  "課程收入",
  lecture: "課程收入",
  product: "商品收入",
  tutor:   "勞務收入",
};

const TYPE_LABEL: Record<string, string> = {
  service: "服務", course: "課程", lecture: "講座", product: "商品", tutor: "家教",
};

const EXPENSE_ACCOUNT_BY_CATEGORY: Record<string, string> = {
  "行銷費用": "廣告費(營)",
  "辦公室租金": "租金支出(營)-房屋租金",
  "薪資": "薪資支出(營)-正職",
  "水電": "水電瓦斯費(營)",
};
const EXPENSE_FALLBACK_ACCOUNT = "其他管理及總務費用(營)";
const AD_SPEND_ACCOUNT = "廣告費(營)";

async function cmFetch(path: string): Promise<any> {
  const apiKey = process.env.CM_LIFE_ERP_API_KEY;
  if (!apiKey) throw new Error("CM_LIFE_ERP_API_KEY 未設定");
  const res = await fetch(`${CM_BASE}${path}`, { headers: { "x-api-key": apiKey } });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Upstream ${path} ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function getOrCreateProject(): Promise<number> {
  const found = await pool.query(`SELECT id FROM projects WHERE name=$1 LIMIT 1`, [PROJECT_NAME]);
  if (found.rows[0]) return found.rows[0].id as number;
  const ins = await pool.query(
    `INSERT INTO projects (name, description, status, priority, start_date)
     VALUES ($1, $2, 'Open', 'Medium', $3) RETURNING id`,
    [PROJECT_NAME, "CM生活+ (cmsedu-life.com) 電商平台同步：服務／課程／講座／商品／家教 訂單與費用", todayTaipei()],
  );
  return ins.rows[0].id as number;
}

async function getOrCreateItem(name: string): Promise<number> {
  const found = await pool.query(`SELECT id FROM items WHERE item_name=$1 LIMIT 1`, [name]);
  if (found.rows[0]) return found.rows[0].id as number;
  const code = `CM-${name}`;
  const ins = await pool.query(
    `INSERT INTO items (item_code, item_name, item_group, unit, item_type, status, selling_price)
     VALUES ($1, $2, $3, '次', 'Service', 'Active', 0) RETURNING id`,
    [code, name, "CM生活+"],
  );
  return ins.rows[0].id as number;
}

async function getAccountIdByName(name: string): Promise<{ id: number; name: string } | null> {
  const r = await pool.query(`SELECT id, account_name FROM accounts WHERE account_name=$1 LIMIT 1`, [name]);
  if (!r.rows[0]) return null;
  return { id: r.rows[0].id as number, name: r.rows[0].account_name as string };
}

async function getOrCreateCustomer(email: string | null, name: string | null, phone: string | null, userId: string | null): Promise<number> {
  const safeEmail = (email || "").trim().toLowerCase();
  if (safeEmail) {
    const f = await pool.query(`SELECT id FROM customers WHERE lower(email)=$1 LIMIT 1`, [safeEmail]);
    if (f.rows[0]) return f.rows[0].id as number;
  }
  if (userId) {
    const f = await pool.query(`SELECT id FROM customers WHERE customer_code=$1 LIMIT 1`, [`CM-U-${userId}`]);
    if (f.rows[0]) return f.rows[0].id as number;
  }
  const cname = (name || safeEmail || "CM 客戶").slice(0, 200);
  const code = userId ? `CM-U-${userId}` : `CM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const ins = await pool.query(
    `INSERT INTO customers (name, email, phone, customer_code, category)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [cname, safeEmail || null, phone || null, code, "CM生活+"],
  );
  return ins.rows[0].id as number;
}

async function fetchAllOrders(opts: { from?: string; to?: string }): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  const pageSize = 500;
  for (;;) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status: "paid" });
    if (opts.from) params.set("from", opts.from);
    if (opts.to) params.set("to", opts.to);
    const r = await cmFetch(`/orders?${params.toString()}`);
    all.push(...(r.data || []));
    if (page >= (r.totalPages || 1) || !r.data || r.data.length === 0) break;
    page++;
    if (page > 50) break; // 安全閥
  }
  return all;
}

async function fetchAll(path: string, opts: { from?: string; to?: string }): Promise<any[]> {
  const params = new URLSearchParams();
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  const r = await cmFetch(`${path}?${params.toString()}`);
  return r.data || [];
}

let cmSyncRunning = false;

router.post("/cm-life/sync", async (req, res): Promise<void> => {
  // 「外部串接」已經接手這個來源時，舊的同步就不再執行，避免同一筆訂單入帳兩次
  const takenOver = await pool.query(`SELECT 1 FROM integration_sources WHERE code = $1 AND is_active LIMIT 1`, ["cm-life"]);
  if (takenOver.rowCount && takenOver.rowCount > 0) {
    res.status(409).json({ error: "CM生活+ 已經改由「系統管理 → 外部串接」同步，請到那裡按「立即同步」" });
    return;
  }
  if (cmSyncRunning) {
    res.status(409).json({ error: "另一個 CM 同步正在進行中，請稍候再試" });
    return;
  }
  cmSyncRunning = true;
  try {
    const from = (req.query.from as string | undefined) || (req.body?.from as string | undefined);
    const to = (req.query.to as string | undefined) || (req.body?.to as string | undefined);

    const summary = {
      projectId: 0,
      orders:   { fetched: 0, imported: 0, skipped: 0, errors: [] as string[] },
      expenses: { fetched: 0, imported: 0, skipped: 0, errors: [] as string[] },
      adSpend:  { fetched: 0, imported: 0, skipped: 0, errors: [] as string[] },
    };

    const projectId = await getOrCreateProject();
    summary.projectId = projectId;

    const bank = await getAccountIdByName(BANK_ACCOUNT_NAME);
    const taxAcc = await getAccountIdByName("銷項稅額");
    if (!bank || !taxAcc) {
      res.status(500).json({ error: `缺少必要的會計科目（${BANK_ACCOUNT_NAME} 或 銷項稅額）` });
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
    const orders = await fetchAllOrders({ from, to });
    summary.orders.fetched = orders.length;
    for (const o of orders) {
      const client = await pool.connect();
      try {
        const orderNumber = `CM-O-${o.id}`;
        const dup = await client.query(`SELECT 1 FROM sales_orders WHERE order_number=$1 LIMIT 1`, [orderNumber]);
        if (dup.rowCount && dup.rowCount > 0) { summary.orders.skipped++; continue; }

        const final = Number(o.amount?.final ?? 0);
        if (final <= 0) { summary.orders.skipped++; continue; }

        const orderType = String(o.type || "course");
        const itemId = itemIdByType[orderType] ?? itemIdByType["course"];
        const itemName = ITEM_BY_ORDER_TYPE[orderType] ?? ITEM_BY_ORDER_TYPE["course"];
        const revAcc = revAccByType[orderType] ?? revAccByType["course"];
        if (!revAcc) { summary.orders.errors.push(`#${o.id}: 找不到收入科目`); continue; }

        // 稅額：若有開公司發票且帶 salesAmount 且 <= final，則 tax = final - salesAmount，否則不拆稅
        const sales = Number(o.invoice?.salesAmount ?? 0);
        const useTaxSplit = sales > 0 && sales <= final;
        const tax = useTaxSplit ? +(final - sales).toFixed(2) : 0;
        const preTax = useTaxSplit ? sales : final;

        const customerId = await getOrCreateCustomer(o.buyer?.email, o.buyer?.name, o.buyer?.phone, o.buyer?.userId);
        const orderDate = (o.createdAt || "").slice(0, 10);

        const items = [
          {
            itemId,
            itemName: `${TYPE_LABEL[orderType] ?? orderType}：${o.itemName ?? ""}`.slice(0, 200),
            quantity: Number(o.quantity ?? 1),
            rate: preTax,
            amount: preTax,
            tax,
            preTaxPrice: preTax,
            rateExclTax: preTax,
          },
        ];

        // Dr 銀行 final = Cr 收入 (preTax) + Cr 銷項稅額 (tax)
        const lines = [
          { debit: final, credit: 0, accountId: bank.id, accountName: bank.name },
          { debit: 0, credit: preTax, accountId: revAcc.id, accountName: revAcc.name },
          ...(tax > 0 ? [{ debit: 0, credit: tax, accountId: taxAcc.id, accountName: taxAcc.name }] : []),
        ];
        const totalDebit = +lines.reduce((s, l) => s + l.debit, 0).toFixed(2);
        const totalCredit = +lines.reduce((s, l) => s + l.credit, 0).toFixed(2);
        if (Math.abs(totalDebit - totalCredit) > 0.01) {
          summary.orders.errors.push(`#${o.id}: 借貸不平 Dr=${totalDebit} Cr=${totalCredit}`);
          continue;
        }
        const entryNumber = `JE-CM-O-${o.id}`;

        await client.query("BEGIN");
        const ins = await client.query(
          `INSERT INTO sales_orders (order_number, customer_id, order_date, status, total_amount, items, project_id, order_source, remarks, extra_fields)
           VALUES ($1,$2,$3,'Completed',$4,$5::jsonb,$6,'cm-life',$7,$8::jsonb)
           ON CONFLICT (order_number) DO NOTHING RETURNING id`,
          [
            orderNumber, customerId, orderDate, final,
            JSON.stringify(items), projectId,
            `CM #${o.orderNumber} ${o.type} ${o.payment?.provider ?? ""}`,
            JSON.stringify({
              cmId: o.id, cmOrderNumber: o.orderNumber, orderGroupId: o.orderGroupId,
              orderType: o.type, paymentProvider: o.payment?.provider, paymentRef: o.payment?.ref,
              taxTWD: tax, preTaxTWD: preTax, finalTWD: final,
              invoice: o.invoice, logistics: o.logistics, utm: o.utm, attendee: o.attendee, coupon: o.coupon,
              amount: o.amount,
            }),
          ],
        );
        if (ins.rowCount === 0) { await client.query("ROLLBACK"); summary.orders.skipped++; continue; }

        await client.query(
          `INSERT INTO journal_entries (entry_number, entry_date, description, total_debit, total_credit, status, lines, project_id)
           VALUES ($1,$2,$3,$4,$5,'Posted',$6::jsonb,$7)
           ON CONFLICT (entry_number) DO NOTHING`,
          [
            entryNumber, orderDate,
            `${TYPE_LABEL[orderType] ?? orderType}：${o.itemName ?? ""} - ${o.buyer?.name ?? ""}`.slice(0, 200),
            totalDebit, totalCredit, JSON.stringify(lines), projectId,
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
    const expenses = await fetchAll("/expenses", { from, to });
    summary.expenses.fetched = expenses.length;
    for (const e of expenses) {
      try {
        const entryNumber = `JE-CM-E-${e.id}`;
        const dup = await pool.query(`SELECT 1 FROM journal_entries WHERE entry_number=$1 LIMIT 1`, [entryNumber]);
        if (dup.rowCount && dup.rowCount > 0) { summary.expenses.skipped++; continue; }

        const amount = Number(e.amount) || 0;
        if (amount <= 0) { summary.expenses.skipped++; continue; }

        const accName = EXPENSE_ACCOUNT_BY_CATEGORY[String(e.categoryName)] ?? EXPENSE_FALLBACK_ACCOUNT;
        const expAcc = await getAccountIdByName(accName);
        if (!expAcc) { summary.expenses.errors.push(`#${e.id}: 找不到科目 ${accName}`); continue; }

        const date = (e.date || e.createdAt || "").slice(0, 10);
        const lines = [
          { debit: amount, credit: 0, accountId: expAcc.id, accountName: expAcc.name },
          { debit: 0, credit: amount, accountId: bank.id, accountName: bank.name },
        ];
        const ins = await pool.query(
          `INSERT INTO journal_entries (entry_number, entry_date, description, total_debit, total_credit, status, lines, project_id)
           VALUES ($1,$2,$3,$4,$5,'Posted',$6::jsonb,$7)
           ON CONFLICT (entry_number) DO NOTHING RETURNING id`,
          [
            entryNumber, date,
            `${e.categoryName ?? "費用"} - ${e.description ?? e.note ?? ""}`.slice(0, 200),
            amount, amount, JSON.stringify(lines), projectId,
          ],
        );
        if (ins.rowCount === 0) summary.expenses.skipped++; else summary.expenses.imported++;
      } catch (err: any) {
        summary.expenses.errors.push(`#${e.id}: ${err?.message ?? String(err)}`);
      }
    }

    // ===== 廣告花費 =====
    const adAcc = await getAccountIdByName(AD_SPEND_ACCOUNT);
    const ads = await fetchAll("/ad-spend", { from, to });
    summary.adSpend.fetched = ads.length;
    if (!adAcc && ads.length > 0) {
      summary.adSpend.errors.push(`找不到廣告費科目 ${AD_SPEND_ACCOUNT}`);
    } else {
      for (const a of ads) {
        try {
          const entryNumber = `JE-CM-A-${a.id}`;
          const dup = await pool.query(`SELECT 1 FROM journal_entries WHERE entry_number=$1 LIMIT 1`, [entryNumber]);
          if (dup.rowCount && dup.rowCount > 0) { summary.adSpend.skipped++; continue; }
          const amount = Number(a.amount) || 0;
          if (amount <= 0) { summary.adSpend.skipped++; continue; }
          const date = (a.date || a.createdAt || "").slice(0, 10);
          const lines = [
            { debit: amount, credit: 0, accountId: adAcc!.id, accountName: adAcc!.name },
            { debit: 0, credit: amount, accountId: bank.id, accountName: bank.name },
          ];
          const ins = await pool.query(
            `INSERT INTO journal_entries (entry_number, entry_date, description, total_debit, total_credit, status, lines, project_id)
             VALUES ($1,$2,$3,$4,$5,'Posted',$6::jsonb,$7)
             ON CONFLICT (entry_number) DO NOTHING RETURNING id`,
            [entryNumber, date, `廣告 ${a.channel ?? ""} ${a.note ?? ""}`.slice(0, 200), amount, amount, JSON.stringify(lines), projectId],
          );
          if (ins.rowCount === 0) summary.adSpend.skipped++; else summary.adSpend.imported++;
        } catch (err: any) {
          summary.adSpend.errors.push(`#${a.id}: ${err?.message ?? String(err)}`);
        }
      }
    }

    res.json({ ok: true, summary });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  } finally {
    cmSyncRunning = false;
  }
});

router.get("/cm-life/stats", async (_req, res): Promise<void> => {
  try {
    const proj = await pool.query(`SELECT id FROM projects WHERE name=$1 LIMIT 1`, [PROJECT_NAME]);
    if (!proj.rows[0]) { res.json({ projectExists: false }); return; }
    const projectId = proj.rows[0].id as number;
    const so = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_amount),0)::numeric AS gross
       FROM sales_orders WHERE project_id=$1 AND order_source='cm-life'`,
      [projectId],
    );
    const ord = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_debit),0)::numeric AS total
       FROM journal_entries WHERE project_id=$1 AND entry_number LIKE 'JE-CM-O-%'`,
      [projectId],
    );
    const exp = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_debit),0)::numeric AS total
       FROM journal_entries WHERE project_id=$1 AND entry_number LIKE 'JE-CM-E-%'`,
      [projectId],
    );
    const ad = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_debit),0)::numeric AS total
       FROM journal_entries WHERE project_id=$1 AND entry_number LIKE 'JE-CM-A-%'`,
      [projectId],
    );
    const byType = await pool.query(
      `SELECT (extra_fields->>'orderType') AS type, COUNT(*)::int AS count, COALESCE(SUM(total_amount),0)::numeric AS amount
       FROM sales_orders WHERE project_id=$1 AND order_source='cm-life' GROUP BY 1 ORDER BY 1`,
      [projectId],
    );
    const lastSync = await pool.query(
      `SELECT MAX(created_at) AS last FROM journal_entries WHERE project_id=$1 AND entry_number LIKE 'JE-CM-%'`,
      [projectId],
    );
    res.json({
      projectExists: true, projectId,
      salesOrders: so.rows[0],
      orderJournals: ord.rows[0],
      expenseJournals: exp.rows[0],
      adSpendJournals: ad.rows[0],
      ordersByType: byType.rows,
      lastSyncedAt: lastSync.rows[0]?.last ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

router.get("/cm-life/upstream-summary", async (req, res): Promise<void> => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const data = await cmFetch(`/financial-summary?${params.toString()}`);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

router.get("/cm-life/health", async (_req, res): Promise<void> => {
  try {
    const data = await cmFetch("/health");
    res.json(data);
  } catch (err: any) {
    res.status(503).json({ error: err?.message ?? String(err) });
  }
});

export default router;
