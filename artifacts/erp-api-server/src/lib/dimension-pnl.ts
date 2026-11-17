import { db } from "@workspace/erp-db";
import { sql, type SQL } from "drizzle-orm";

export interface DimensionPnl {
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
}

/**
 * 部門／專案損益：與損益表（/reports/income-statement）同一套口徑。
 * - 只計已過帳分錄（排除 Draft）
 * - 收入 = 收入科目 貸方 − 借方；支出 = 費用科目 借方 − 貸方
 * - 部門歸屬：分錄表頭部門，或分錄所屬專案隸屬該部門
 * 不可用「分錄借方合計／貸方合計」當收支：每張平衡分錄借貸相等，淨額恆為 0；
 * 也不可另外加計收付款單，因為它們已自動產生分錄，會重複計算。
 */
export function dimensionEntryFilter(dim: { projectId: number } | { departmentId: number }): SQL {
  if ("projectId" in dim) return sql`je.project_id = ${dim.projectId}`;
  return sql`(je.department_id = ${dim.departmentId}
    OR je.project_id IN (SELECT id FROM projects WHERE department_id = ${dim.departmentId}))`;
}

export async function getDimensionPnl(dim: { projectId: number } | { departmentId: number }): Promise<DimensionPnl> {
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN a.account_type = 'Income'
        THEN COALESCE((line->>'credit')::numeric, 0) - COALESCE((line->>'debit')::numeric, 0)
        ELSE 0 END), 0)::float AS income,
      COALESCE(SUM(CASE WHEN a.account_type = 'Expense'
        THEN COALESCE((line->>'debit')::numeric, 0) - COALESCE((line->>'credit')::numeric, 0)
        ELSE 0 END), 0)::float AS expense
    FROM journal_entries je
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(je.lines, '[]'::jsonb)) line
    JOIN accounts a ON a.id = NULLIF(line->>'accountId', '')::int
    WHERE je.status <> 'Draft' AND ${dimensionEntryFilter(dim)}
  `);
  const row = (result.rows[0] ?? {}) as { income?: number; expense?: number };
  const totalIncome = Number(row.income ?? 0);
  const totalExpense = Number(row.expense ?? 0);
  return { totalIncome, totalExpense, netProfit: totalIncome - totalExpense };
}
