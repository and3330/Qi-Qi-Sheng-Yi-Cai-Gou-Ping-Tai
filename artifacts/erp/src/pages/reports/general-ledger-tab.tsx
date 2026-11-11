import { useMemo, useState } from 'react';
import {
  getGetErpGeneralLedgerQueryKey,
  useGetErpGeneralLedger,
  useListErpAccounts,
} from '@workspace/api-client-react';
import { Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { fmtMoney } from '@/lib/report-format';

interface LedgerRow {
  date: string;
  entryId: number;
  entryNumber: string;
  reference?: string | null;
  description?: string | null;
  debit: number;
  credit: number;
  balance: number;
}
interface LedgerReport {
  account: { id: number; accountNumber: string; accountName: string; accountType: string } | null;
  rows: LedgerRow[];
}

/** 總帳：選一個科目，看這段期間每一筆傳票的借貸與餘額 */
export function GeneralLedgerTab({ startDate, endDate }: { startDate: string; endDate: string }) {
  const [accountId, setAccountId] = useState('');
  const { data: accounts } = useListErpAccounts();
  const options = useMemo(
    () =>
      (accounts ?? [])
        .filter((a) => a.isActive && !a.hasChildren)
        .map((a) => ({ value: String(a.id), label: `${a.accountNumber} ${a.accountName}` })),
    [accounts],
  );
  const params = { accountId: Number(accountId), startDate, endDate };
  const query = useGetErpGeneralLedger(params, {
    query: { queryKey: getGetErpGeneralLedgerQueryKey(params), enabled: !!accountId },
  });
  const report = query.data as unknown as LedgerReport | undefined;
  const totalDebit = report?.rows.reduce((sum, r) => sum + r.debit, 0) ?? 0;
  const totalCredit = report?.rows.reduce((sum, r) => sum + r.credit, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="max-w-md space-y-1">
        <Label>會計科目</Label>
        <SearchableSelect value={accountId} onValueChange={setAccountId} options={options} placeholder="選擇要查詢的科目" />
      </div>
      <Card className="overflow-x-auto border-t-2 border-t-primary">
        {!accountId && <div className="p-8 text-center text-muted-foreground">請先選擇科目</div>}
        {accountId && query.isLoading && (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
        {accountId && query.error != null && (
          <div className="p-8 text-center text-destructive">載入失敗，請稍後再試</div>
        )}
        {accountId && report && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日期</TableHead>
                <TableHead>傳票編號</TableHead>
                <TableHead>摘要</TableHead>
                <TableHead>參考</TableHead>
                <TableHead className="text-right">借方</TableHead>
                <TableHead className="text-right">貸方</TableHead>
                <TableHead className="text-right">餘額</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    這段期間沒有分錄
                  </TableCell>
                </TableRow>
              )}
              {report.rows.map((row, index) => (
                <TableRow key={`${row.entryId}-${index}`}>
                  <TableCell>{row.date}</TableCell>
                  <TableCell className="font-mono">{row.entryNumber}</TableCell>
                  <TableCell>{row.description || '—'}</TableCell>
                  <TableCell>{row.reference || '—'}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(row.debit, true)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(row.credit, true)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(row.balance)}</TableCell>
                </TableRow>
              ))}
              {report.rows.length > 0 && (
                <TableRow className="font-semibold">
                  <TableCell colSpan={4}>本期合計</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(totalDebit)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(totalCredit)}</TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
