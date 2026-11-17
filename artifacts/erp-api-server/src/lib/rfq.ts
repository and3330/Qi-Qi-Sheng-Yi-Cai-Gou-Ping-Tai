import type { RfqItem, RfqQuote } from "@workspace/erp-db";

/** 詢價比價（純計算）：各家報價統一換成台幣後比較 */

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export interface QuoteSummary {
  supplierId: number;
  supplierName: string;
  currency: string;
  exchangeRate: number;
  leadDays: number | null;
  validUntil: string | null;
  note: string | null;
  quotedAt: string;
  /** 每個品項換成台幣的單價；沒報是 null */
  unitPricesTwd: Array<number | null>;
  /** 有報價的品項合計（台幣） */
  totalTwd: number;
  quotedCount: number;
  /** 每個品項都有報價才能直接比總價 */
  complete: boolean;
  /** 報價已過有效期限 */
  expired: boolean;
}

export interface QuoteComparison {
  quotes: QuoteSummary[];
  /** 每個品項最便宜的是哪一家（沒人報是 null） */
  lowestByItem: Array<number | null>;
  /** 全部品項都有報、總價最低的那一家 */
  cheapestSupplierId: number | null;
  /** 最貴和最便宜的完整報價差多少（台幣） */
  spreadTwd: number;
}

export function compareQuotes(items: RfqItem[], quotes: RfqQuote[], today: string): QuoteComparison {
  const summaries: QuoteSummary[] = quotes.map(quote => {
    const rate = quote.currency === "TWD" ? 1 : (Number(quote.exchangeRate) > 0 ? Number(quote.exchangeRate) : 1);
    const unitPricesTwd = items.map((_, index) => {
      const price = quote.prices?.[index];
      return price == null || !Number.isFinite(Number(price)) || Number(price) < 0 ? null : Math.round(Number(price) * rate * 10000) / 10000;
    });
    const quotedCount = unitPricesTwd.filter(price => price !== null).length;
    return {
      supplierId: quote.supplierId, supplierName: quote.supplierName, currency: quote.currency, exchangeRate: rate,
      leadDays: quote.leadDays ?? null, validUntil: quote.validUntil ?? null, note: quote.note ?? null, quotedAt: quote.quotedAt,
      unitPricesTwd,
      totalTwd: round2(items.reduce((sum, item, index) => sum + (unitPricesTwd[index] ?? 0) * (Number(item.quantity) || 0), 0)),
      quotedCount,
      complete: items.length > 0 && quotedCount === items.length,
      expired: !!quote.validUntil && quote.validUntil < today,
    };
  });
  const lowestByItem = items.map((_, index) => {
    let best: QuoteSummary | null = null;
    for (const summary of summaries) {
      const price = summary.unitPricesTwd[index];
      if (price === null) continue;
      if (!best || price < (best.unitPricesTwd[index] as number)) best = summary;
    }
    return best ? best.supplierId : null;
  });
  const complete = summaries.filter(summary => summary.complete).sort((a, b) => a.totalTwd - b.totalTwd);
  return {
    quotes: summaries,
    lowestByItem,
    cheapestSupplierId: complete[0]?.supplierId ?? null,
    spreadTwd: complete.length > 1 ? round2(complete[complete.length - 1].totalTwd - complete[0].totalTwd) : 0,
  };
}
