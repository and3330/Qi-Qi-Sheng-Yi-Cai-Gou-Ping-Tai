import { describe, expect, it } from "vitest";
import { allocateLines, normalizeEvent, paymentSplit, taxOf, type OrderData } from "../integration-format";

const order = (data: Record<string, unknown> = {}, top: Record<string, unknown> = {}) => ({
  source: "cm-life", kind: "order", externalId: "A1", occurredAt: "2026-11-13T08:00:00+08:00",
  data: {
    type: "product", buyer: { name: "王小明", email: "Buyer@Example.com" },
    lines: [{ sku: "TOY-1", name: "積木", quantity: 2, unitPrice: 900 }],
    shippingFee: 80, total: 1880, payments: [{ method: "stored_value", amount: 500 }, { method: "card", amount: 1380 }], ...data,
  }, ...top,
});

describe("外部單據標準格式", () => {
  it("整理一張合格的訂單", () => {
    const parsed = normalizeEvent(order());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event).toMatchObject({ source: "cm-life", kind: "order", externalId: "A1", occurredAt: "2026-11-13", amount: 1880 });
    const data = parsed.event.data as OrderData;
    expect(data.buyer.email).toBe("buyer@example.com");
    expect(data.lines[0]).toMatchObject({ sku: "TOY-1", amount: 1800 });
    expect(data.taxType).toBe("taxable");
  });
  it.each([
    [order({}, { source: "CM Life!" }), "來源代號"],
    [order({}, { kind: "invoice" }), "單據種類"],
    [order({}, { externalId: "" }), "外部編號"],
    [order({}, { occurredAt: "2026-02-30" }), "發生日期"],
    [order({ type: "" }), "訂單類型"],
    [order({ buyer: {} }), "姓名"],
    [order({ buyer: { name: "王", email: "not-an-email" } }), "Email"],
    [order({ lines: [] }), "至少要有一筆明細"],
    [order({ lines: [{ name: "積木", quantity: 0, unitPrice: 900 }] }), "數量"],
    [order({ total: 2000 }), "對不起來"],
    [order({ payments: [{ method: "card", amount: 1000 }] }), "付款合計"],
    [order({ payments: [] }), "付款方式"],
    [order({ taxType: "weird" }), "稅別"],
  ])("格式不對會說明原因 %#", (raw, message) => {
    const parsed = normalizeEvent(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(message);
  });
  it("儲值只收正數，動作只能是儲值或退還", () => {
    const base = { source: "cm-life", kind: "stored_value", externalId: "T1", occurredAt: "2026-11-13" };
    expect(normalizeEvent({ ...base, data: { member: { name: "王" }, amount: 1000 } })).toMatchObject({ ok: true, event: { amount: 1000, data: { action: "topup" } } });
    expect(normalizeEvent({ ...base, data: { member: { name: "王" }, amount: 0 } }).ok).toBe(false);
    expect(normalizeEvent({ ...base, data: { action: "gift", member: { name: "王" }, amount: 10 } }).ok).toBe(false);
  });
  it("人員報酬會整理成標準格式", () => {
    expect(normalizeEvent({ source: "icta-pro", kind: "payout", externalId: "S9", occurredAt: "2026-11-13", data: { amount: 3200, description: "講師費", payee: { name: "林老師" } } }))
      .toMatchObject({ ok: true, event: { kind: "payout", amount: 3200, summary: "林老師 講師費" } });
  });
});

describe("外部訂單的金額拆分", () => {
  it("餘額付款與實收分開", () => expect(paymentSplit([{ method: "stored_value", amount: 500 }, { method: "card", amount: 1380 }])).toEqual({ storedValue: 500, cash: 1380 }));
  it("運費另成一筆，折扣依比例攤，合計等於訂單總額", () => {
    const parsed = normalizeEvent(order({ lines: [{ sku: "A", name: "A", quantity: 1, unitPrice: 1000 }, { sku: "B", name: "B", quantity: 3, unitPrice: 333.33 }], shippingFee: 100, discount: 200, total: 1899.99, payments: [{ method: "card", amount: 1899.99 }] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const lines = allocateLines(parsed.event.data as OrderData);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatchObject({ name: "運費", isShipping: true });
    expect(Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100).toBe(1899.99);
    expect(lines[0].amount).toBeLessThan(1000);
  });
  it("應稅拆出 5%，免稅不拆", () => {
    expect(taxOf(1050, "taxable")).toEqual({ net: 1000, tax: 50 });
    expect(taxOf(1050, "exempt")).toEqual({ net: 1050, tax: 0 });
  });
});
