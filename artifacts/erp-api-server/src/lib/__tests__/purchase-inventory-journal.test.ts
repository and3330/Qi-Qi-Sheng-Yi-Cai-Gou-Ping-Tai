import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/erp-db", () => ({ db: {} }));
vi.mock("@workspace/erp-db/schema", () => ({
  journalEntriesTable: { __t: "journal_entries" }, invoicesTable: { __t: "invoices" }, salesOrdersTable: {}, purchaseOrdersTable: { __t: "purchase_orders" },
  accountsTable: { __t: "accounts" }, accountingSettingsTable: { __t: "accounting_settings" }, itemsTable: { __t: "items" },
}));

import { createInvoiceJournalEntry, splitInventoryAmount } from "../auto-journal";

const ACCOUNTS = [
  { id: 1, accountNumber: "1221", accountName: "存貨", accountType: "Asset", isGroup: false },
  { id: 2, accountNumber: "5121", accountName: "進貨", accountType: "Expense", isGroup: false },
  { id: 3, accountNumber: "2141", accountName: "應付帳款", accountType: "Liability", isGroup: false },
  { id: 4, accountNumber: "1281", accountName: "進項稅額", accountType: "Asset", isGroup: false },
  { id: 5, accountNumber: "2281", accountName: "銷項稅額", accountType: "Liability", isGroup: false },
];

/** 假交易：依查詢的資料表回傳對應資料，並記下寫入的分錄 */
function fakeTx(itemRows: Array<{ id: number; isVirtual: boolean }> = []) {
  const journals: any[] = [];
  const rowsFor = (table: any) => table?.__t === "items" ? itemRows : table?.__t === "accounting_settings" ? [{ lockDate: null }] : ACCOUNTS;
  const chain = (rows: any[]): any => {
    const p: any = Promise.resolve(rows);
    p.where = () => chain(rows); p.limit = () => chain(rows); p.orderBy = () => chain(rows);
    return p;
  };
  return {
    journals,
    select: () => ({ from: (table: any) => chain(rowsFor(table)) }),
    execute: async () => ({ rows: ACCOUNTS }),
    insert: () => ({
      values: (v: any) => {
        const p: any = Promise.resolve();
        p.returning = async () => { journals.push(v); return [{ id: journals.length, ...v }]; };
        p.onConflictDoNothing = async () => undefined;
        return p;
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
}

const base = { id: 7, invoiceNumber: "PINV-1", invoiceDate: "2026-11-11", totalAmount: "1050", exchangeRate: "1", taxType: "taxable", taxAmount: "50" };
const lineSummary = (tx: ReturnType<typeof fakeTx>) => tx.journals[0].lines.map((l: any) => [l.accountName, l.debit, l.credit]);

describe("splitInventoryAmount", () => {
  it("依庫存品項金額佔比拆分，兩邊相加等於原金額", () => {
    expect(splitInventoryAmount(1000, [{ amount: 300, isStock: true }, { amount: 700, isStock: false }])).toEqual({ stock: 300, other: 700 });
    const odd = splitInventoryAmount(100, [{ amount: 1, isStock: true }, { amount: 2, isStock: false }]);
    expect(odd.stock + odd.other).toBeCloseTo(100, 2);
  });

  it("全部是庫存品項或完全沒有時不產生零頭", () => {
    expect(splitInventoryAmount(952.38, [{ amount: 1000, isStock: true }])).toEqual({ stock: 952.38, other: 0 });
    expect(splitInventoryAmount(500, [{ amount: 500, isStock: false }])).toEqual({ stock: 0, other: 500 });
    expect(splitInventoryAmount(500, [])).toEqual({ stock: 0, other: 500 });
  });
});

describe("採購發票入帳", () => {
  it("來自進貨單的庫存品項：借 存貨、進項稅額／貸 應付帳款", async () => {
    const tx = fakeTx();
    await createInvoiceJournalEntry(tx, { ...base, invoiceType: "Purchase", purchaseReceiptId: 3, items: [{ itemId: 10, amount: 1050, isVirtual: false }] });
    expect(lineSummary(tx)).toEqual([["存貨", 1000, 0], ["進項稅額", 50, 0], ["應付帳款", 0, 1050]]);
  });

  it("庫存品項與服務混合時，只有庫存品項列存貨，其餘維持進貨", async () => {
    const tx = fakeTx([{ id: 10, isVirtual: false }, { id: 11, isVirtual: true }]);
    await createInvoiceJournalEntry(tx, { ...base, invoiceType: "Purchase", purchaseOrderId: 9, items: [{ itemId: 10, amount: 600 }, { itemId: 11, amount: 400 }] });
    expect(lineSummary(tx)).toEqual([["存貨", 600, 0], ["進貨", 400, 0], ["進項稅額", 50, 0], ["應付帳款", 0, 1050]]);
  });

  it("沒有連結採購單或進貨單的發票不會收貨，維持列進貨", async () => {
    const tx = fakeTx();
    await createInvoiceJournalEntry(tx, { ...base, invoiceType: "Purchase", items: [{ itemId: 10, amount: 1050, isVirtual: false }] });
    expect(lineSummary(tx)).toEqual([["進貨", 1000, 0], ["進項稅額", 50, 0], ["應付帳款", 0, 1050]]);
  });

  it("採購退回的折讓單：借 應付帳款／貸 存貨", async () => {
    const tx = fakeTx([{ id: 10, isVirtual: false }]);
    await createInvoiceJournalEntry(tx, { ...base, taxType: "unclassified", taxAmount: "0", totalAmount: "300", invoiceType: "Debit Note", items: [{ itemId: 10, quantity: 3, rate: 100, amount: 300 }] });
    expect(lineSummary(tx)).toEqual([["應付帳款", 300, 0], ["存貨", 0, 300]]);
  });
});
