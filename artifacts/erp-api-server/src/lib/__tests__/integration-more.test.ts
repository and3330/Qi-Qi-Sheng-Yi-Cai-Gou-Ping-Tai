import { describe, expect, it, vi } from "vitest";

vi.mock("../integration-ingest", () => ({ ingestEvents: vi.fn() }));

import { normalizeEvent, type OrderData, type PayoutData, type RefundData } from "../integration-format";
import { adapterInfo, cmOrderToEvent, ncaiOrderToEvent } from "../integration-adapters";

const base = (kind: string, data: Record<string, unknown>) => ({ source: "icta-pro", kind, externalId: "X1", occurredAt: "2026-11-13", data });

describe("人員報酬格式", () => {
  it("只送稅前金額；沒給金額時用時數 × 鐘點費", () => {
    const parsed = normalizeEvent(base("payout", { payee: { name: "林老師", email: "T@Example.com" }, hours: 8, rate: 800 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const data = parsed.event.data as PayoutData;
    expect(data).toMatchObject({ amount: 6400, incomeType: "50", serviceDate: "2026-11-13", type: "*", payee: { kind: "teacher", email: "t@example.com" } });
  });
  it.each([
    [{ payee: { name: "" }, amount: 100 }, "姓名"],
    [{ payee: { name: "林", kind: "vendor" }, amount: 100 }, "對象種類"],
    [{ payee: { name: "林" }, amount: 0 }, "應付金額"],
    [{ payee: { name: "林" }, amount: 100, serviceDate: "2026-13-01" }, "服務日期"],
  ])("格式不對會擋 %#", (data, message) => {
    const parsed = normalizeEvent(base("payout", data));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(message);
  });
});

describe("退款、費用、資產異動格式", () => {
  it("退款沒寫去向就當原路退回", () => {
    const parsed = normalizeEvent(base("refund", { orderExternalId: "A1", amount: 900 }));
    expect(parsed.ok && (parsed.event.data as RefundData).refundTo).toEqual([{ method: "original", amount: 900 }]);
  });
  it("退款去向合計要等於退款金額", () => {
    expect(normalizeEvent(base("refund", { orderExternalId: "A1", amount: 900, refundTo: [{ method: "card", amount: 500 }] })).ok).toBe(false);
    expect(normalizeEvent(base("refund", { amount: 900 })).ok).toBe(false);
    expect(normalizeEvent(base("refund", { orderExternalId: "A1", amount: 900, restock: [{ sku: "", quantity: 1 }] })).ok).toBe(false);
  });
  it("費用的稅額不能大於金額", () => {
    expect(normalizeEvent(base("expense", { type: "廣告", amount: 5250, taxAmount: 250 }))).toMatchObject({ ok: true, event: { amount: 5250, data: { paid: true, taxAmount: 250 } } });
    expect(normalizeEvent(base("expense", { type: "廣告", amount: 100, taxAmount: 100 })).ok).toBe(false);
    expect(normalizeEvent(base("expense", { amount: 100 })).ok).toBe(false);
  });
  it("資產異動要有編號；借出要有借用人、換地點要有地點", () => {
    expect(normalizeEvent(base("asset_movement", { assetNumber: "AST-1", action: "checkout", holder: "林老師" })).ok).toBe(true);
    expect(normalizeEvent(base("asset_movement", { assetNumber: "AST-1", action: "checkout" })).ok).toBe(false);
    expect(normalizeEvent(base("asset_movement", { assetNumber: "AST-1", action: "transfer" })).ok).toBe(false);
    expect(normalizeEvent(base("asset_movement", { action: "return" })).ok).toBe(false);
    expect(normalizeEvent(base("asset_movement", { serialNumber: "SN9", action: "return" })).ok).toBe(true);
  });
  it("金流手續費不能大於實收金額", () => {
    const order = (paymentFee: number) => normalizeEvent({ source: "ai-university", kind: "order", externalId: "1", occurredAt: "2026-11-13", data: { type: "course", buyer: { name: "王" }, lines: [{ name: "課", quantity: 1, unitPrice: 1000 }], total: 1000, payments: [{ method: "ecpay", amount: 1000 }], paymentFee } });
    expect(order(28)).toMatchObject({ ok: true, event: { data: { paymentFee: 28 } } });
    expect(order(1000).ok).toBe(false);
  });
});

describe("CM生活+ 與 AI 大學的轉接", () => {
  it("CM生活+ 訂單轉成標準格式，並帶著舊同步的單號", () => {
    const event = cmOrderToEvent({ id: "o-9", type: "product", orderNumber: "CM001", createdAt: "2026-11-13T03:00:00Z", itemId: "p-7", itemName: "積木", quantity: 2, amount: { final: 1700, pointsUsed: 50 }, payment: { provider: "newebpay" }, buyer: { userId: "u1", name: "王小明", email: "a@b.co" }, invoice: { invoiceNumber: "AB12345678" }, coupon: { code: "SALE" } })!;
    expect(event._legacy).toEqual({ salesOrderNumber: "CM-O-o-9" });
    const parsed = normalizeEvent(event);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const data = parsed.event.data as OrderData;
    expect(data).toMatchObject({ type: "product", total: 1700, invoiceNumber: "AB12345678", payments: [{ method: "newebpay", amount: 1700 }] });
    expect(data.lines[0]).toMatchObject({ sku: "p-7", quantity: 2, unitPrice: 850, amount: 1700 });
    expect(data.note).toContain("優惠券 SALE");
  });
  it("CM生活+ 金額是 0 的訂單不轉", () => expect(cmOrderToEvent({ id: 1, amount: { final: 0 } })).toBeNull());
  it("AI 大學的金額單位是分，手續費另外帶", () => {
    const event = ncaiOrderToEvent({ id: 5, status: "completed", paymentGateway: "ecpay", amount: 1260000, taxAmount: 60000, channelFeeAmount: 35280, productName: "AI 超級主理人", customerName: "陳", customerEmail: "c@d.co", createdAt: "2026-11-01T10:00:00Z", invoiceNo: "CD87654321" })!;
    const parsed = normalizeEvent(event);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.event.data).toMatchObject({ total: 12600, taxType: "taxable", paymentFee: 352.8, invoiceNumber: "CD87654321" });
    expect(event._legacy).toEqual({ salesOrderNumber: "NCAI-O-5" });
  });
  it("AI 大學沒完成的、國外金流的訂單不轉", () => {
    expect(ncaiOrderToEvent({ id: 1, status: "pending", amount: 1000 })).toBeNull();
    expect(ncaiOrderToEvent({ id: 1, status: "completed", paymentGateway: "Stripe", amount: 1000 })).toBeNull();
  });
  it("只有設定過轉接的來源代號可以主動抓資料", () => {
    expect(adapterInfo("cm-life")).toMatchObject({ canPull: true, envKey: "CM_LIFE_ERP_API_KEY" });
    expect(adapterInfo("icta-pro")).toEqual({ canPull: false, configured: false });
  });
});
