import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { aiActionLogsTable, db, pool } from "@workspace/db";
import { confirmAndExecuteAction, executeTool } from "./assistantTools";

test("only the explicit confirmation flow can execute the stored action payload", async () => {
  let confirmationId: number | undefined;
  try {
    const pending = await executeTool(
      "adjust_stock",
      { productId: -1, quantity: 1, reason: "authorization integration test" },
      {
        memberId: -1,
        memberRole: "admin",
        conversationId: -1,
        requestNonce: "request-one",
      },
    );
    assert.equal(pending.isError, false);
    if (!pending.result || typeof pending.result !== "object") {
      assert.fail("expected a pending action result object");
    }
    const pendingResult = pending.result as Record<string, unknown>;
    assert.equal(pendingResult.requiresConfirmation, true);
    confirmationId = Number(pendingResult.confirmationId);

    const unauthorized = await executeTool(
      "adjust_stock",
      { productId: -1, quantity: 1, reason: "authorization integration test", confirmationId },
      {
        memberId: -1,
        memberRole: "admin",
        conversationId: -1,
        requestNonce: "request-two",
      },
    );
    assert.equal(unauthorized.isError, true);

    const [row] = await db
      .select({ status: aiActionLogsTable.status })
      .from(aiActionLogsTable)
      .where(eq(aiActionLogsTable.id, confirmationId))
      .limit(1);
    assert.equal(row?.status, "pending");

    const execution = await confirmAndExecuteAction(confirmationId, {
      memberId: -1,
      memberRole: "admin",
      conversationId: -1,
    });
    assert.equal(execution.ok, false);
    assert.equal(execution.ok ? null : execution.error, "商品不存在或庫存不足以扣減");

    const [executedRow] = await db
      .select({ status: aiActionLogsTable.status })
      .from(aiActionLogsTable)
      .where(eq(aiActionLogsTable.id, confirmationId))
      .limit(1);
    assert.equal(executedRow?.status, "error");
  } finally {
    if (confirmationId) {
      await db
        .delete(aiActionLogsTable)
        .where(eq(aiActionLogsTable.id, confirmationId));
    }
    await pool.end();
  }
});