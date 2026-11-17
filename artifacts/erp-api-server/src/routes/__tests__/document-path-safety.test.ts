import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const delivery = readFileSync(new URL("../delivery-notes.ts", import.meta.url), "utf8");
const receipts = readFileSync(new URL("../purchase-receipts.ts", import.meta.url), "utf8");
const salesOrders = readFileSync(new URL("../sales-orders.ts", import.meta.url), "utf8");
const purchaseOrders = readFileSync(new URL("../purchase-orders.ts", import.meta.url), "utf8");

function routeBody(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("stock-moving document safety invariants", () => {
  it("uses collision-resistant order and stock-document numbers", () => {
    for (const source of [salesOrders, purchaseOrders, delivery, receipts]) {
      expect(source).toContain("randomUUID()");
    }
  });

  it.each([
    [delivery, 'router.post("/delivery-notes"', 'router.get("/delivery-notes/:id"'],
    [receipts, 'router.post("/purchase-receipts"', 'router.get("/purchase-receipts/:id"'],
  ])("locks linked parent orders and rejects over-allocation on direct document creation", (source, start, end) => {
    const body = routeBody(source, start, end);
    expect(body).toContain("db.transaction(async (tx)");
    expect(body).toMatch(/from\((salesOrdersTable|purchaseOrdersTable)\)[\s\S]*?\.for\("update"\)/);
    expect(body).toContain("allocated");
    expect(body).toContain("allowed");
  });

  it.each([
    [delivery, 'router.post("/delivery-notes/from-order/:orderId"', 'router.delete("/delivery-notes/:id"'],
    [receipts, 'router.post("/purchase-receipts/from-order/:orderId"', '// 從進貨單一鍵產生'],
  ])("serializes from-order remaining quantity calculation with a parent row lock", (source, start, end) => {
    const body = routeBody(source, start, end);
    expect(body).toContain("db.transaction(async (tx)");
    expect(body).toMatch(/tx\.select\(\)\.from\((salesOrdersTable|purchaseOrdersTable)\)[\s\S]*?\.for\("update"\)/);
    expect(body).toContain("await tx.insert(");
  });

  it("keeps stock movement and parent-order completion in the same transaction", () => {
    const deliveryPatch = routeBody(delivery, 'router.patch("/delivery-notes/:id"', 'router.post("/delivery-notes/from-order/:orderId"');
    const receiptPatch = routeBody(receipts, 'router.patch("/purchase-receipts/:id"', 'router.post("/purchase-receipts/from-order/:orderId"');
    expect(deliveryPatch).toContain("await recalcOrderStatus(locked.salesOrderId, undefined, tx)");
    expect(receiptPatch).toContain("await recalcPOStatus(tx, locked.purchaseOrderId)");
  });

  it("does not reverse moving-average cost when a submitted receipt is cancelled", () => {
    const adjuster = routeBody(receipts, "async function adjustStock", "async function recalcPOStatus");
    const cancellationBranch = adjuster.slice(adjuster.indexOf("if (direction === 1)"));
    expect(cancellationBranch).not.toContain("reversedAvg");
    expect(cancellationBranch).not.toMatch(/direction === -1[\s\S]*movingAvgCost/);
  });

  it("snapshots virtual-item classification on every sales-order write path", () => {
    expect(salesOrders.match(/isVirtual[:,]/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(salesOrders).toContain("isVirtual: items[0]?.isVirtual === true");
    expect(salesOrders).toContain("isVirtual = dbItem?.isVirtual === true");
    expect(delivery).toContain("oi.isVirtual === false || (oi.isVirtual === undefined");
  });

  it("rejects sales-order content and status changes in one request and rechecks Draft under lock", () => {
    const patch = routeBody(salesOrders, 'router.patch("/sales-orders/:id"', 'router.delete("/sales-orders/:id"');
    expect(patch).toContain("if (wantsContentEdit && req.body.status !== undefined)");
    expect(patch).toContain('locked.status !== "Draft"');
    expect(patch.indexOf('.for("update")')).toBeLessThan(patch.indexOf('locked.status !== "Draft"'));
  });
});