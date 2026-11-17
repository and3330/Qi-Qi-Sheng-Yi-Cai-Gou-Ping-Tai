import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory double for the human approval of AI customer drafts. The real
// PostgreSQL behaviour (RLS, FOR UPDATE, SAVEPOINT rollback) is covered by
// ai-drafts.postgres.test.ts; this suite needs no database.
const state = vi.hoisted(() => ({
  user: { id: 12, tenantId: 7, role: "accountant" } as any,
  key: false,
  tenantId: 7,
  draft: null as any,
  customers: 0,
  audits: [] as any[],
  auditFails: false,
  tail: Promise.resolve(),
  validate: vi.fn(),
  received: undefined as any,
}));

vi.mock("@workspace/erp-db", () => {
  const chain = () => ({
    from: () => chain(), where: () => chain(),
    for: async () => state.draft ? [state.draft] : [],
    orderBy: async () => state.draft ? [state.draft] : [],
  });
  return {
    currentTenantId: () => state.tenantId,
    aiDraftDocumentsTable: { id: "id", tenantId: "tenantId", status: "status", createdAt: "createdAt" },
    aiCustomerDraftsTable: { id: "cid", tenantId: "ctenant", status: "cstatus", createdAt: "ccreated" },
    aiActionsTable: { table: "ai_actions" },
    customersTable: {},
    activitiesTable: {},
    invoicesTable: {},
    invoiceSettlementsTable: {},
    vouchersTable: {},
    db: {
      insert: () => ({ values: async (values: any) => {
        if (state.auditFails) throw new Error("private audit failure");
        state.audits.push(values);
      } }),
      select: chain,
      update: () => ({
        set: (values: any) => ({ where: () => ({ returning: async () => {
          state.draft = { ...state.draft, ...values };
          return [state.draft];
        } }) }),
      }),
    },
    runInTenantTransaction: async (fn: () => Promise<unknown>) => {
      const previous = state.tail;
      let release!: () => void;
      state.tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const snapshot = { draft: structuredClone(state.draft), customers: state.customers, audits: [...state.audits] };
      try { return await fn(); }
      catch (error) {
        state.draft = snapshot.draft; state.customers = snapshot.customers; state.audits = snapshot.audits;
        throw error;
      } finally { release(); }
    },
  };
});
vi.mock("../../mcp/customer-drafts", async () => {
  class CustomerDraftConflictError extends Error {
    constructor(public field: string, public source: string) { super("duplicate"); }
  }
  return { CustomerDraftConflictError, validateCustomerDraft: state.validate };
});
vi.mock("../../middleware/module-guard", () => ({
  moduleGuard: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../customers", async () => {
  const { Router } = await import("express");
  const { requireAuth } = await import("../../middleware/require-auth");
  const router = Router();
  router.use("/customers", requireAuth);
  router.post("/customers", (req, res) => {
    state.received = { body: req.body, user: req.session.user };
    state.customers++;
    res.status(201).json({ id: 501, ...req.body, totalOrders: 0, totalSpent: 0 });
  });
  return { default: router };
});
vi.mock("../vouchers", async () => ({ default: (await import("express")).Router() }));
vi.mock("../quotations", async () => ({ default: (await import("express")).Router() }));
vi.mock("../payment-requests", async () => ({ default: (await import("express")).Router() }));
vi.mock("../invoices", async () => ({ default: (await import("express")).Router() }));

import router from "../ai-drafts";
import { CustomerDraftConflictError } from "../../mcp/customer-drafts";

describe("human approval of AI customer drafts (in-memory double)", () => {
  let server: Server;
  let url: string;
  beforeEach(async () => {
    Object.assign(state, {
      user: { id: 12, tenantId: 7, role: "accountant" }, tenantId: 7, key: false,
      draft: { id: 3, tenantId: 7, status: "pending", payload: { name: "Stored Co", taxId: "22099131" } },
      customers: 0, audits: [], auditFails: false, received: undefined, tail: Promise.resolve(),
    });
    state.validate.mockReset().mockImplementation(async (payload: any) => ({ ...payload }));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).session = { user: state.user };
      (req as any).apiKeyAuth = state.key;
      (req as any).apiKey = state.key ? { tenantId: 7, permissions: "admin" } : undefined;
      next();
    });
    app.use(router);
    server = await new Promise<Server>(resolve => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server");
    url = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); });
  const post = (action = "confirm", id = "3") => fetch(`${url}/ai-drafts/customers/${id}/${action}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload: { name: "Forged" }, resultCustomerId: 999, tenantId: 8 }),
  });

  it("lists customer drafts for the session tenant", async () => {
    const response = await fetch(`${url}/ai-drafts/customers?status=pending`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([state.draft]);
    expect((await fetch(`${url}/ai-drafts/customers?status=bad`)).status).toBe(400);
  });

  it("revalidates the STORED payload (excluding itself), creates via POST /customers as the human, records result and audit", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(state.validate).toHaveBeenCalledWith({ name: "Stored Co", taxId: "22099131" }, 3);
    expect(state.received).toEqual({ body: { name: "Stored Co", taxId: "22099131" }, user: state.user });
    expect(await response.json()).toMatchObject({ status: "confirmed", confirmedBy: 12, resultCustomerId: 501 });
    expect(state.audits).toEqual([expect.objectContaining({
      tenantId: 7, tool: "human_confirm_customer_draft", args: { draftId: 3, userId: 12 }, targetType: "customers", targetId: 501,
    })]);
  });

  it("serializes duplicate confirmations: one 200, one 409, one customer", async () => {
    const responses = await Promise.all([post(), post()]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(state.customers).toBe(1);
  });

  it("returns 409 with the conflicting field when revalidation finds a duplicate; creates nothing", async () => {
    state.validate.mockRejectedValue(new CustomerDraftConflictError("taxId", "customer"));
    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ field: "taxId" });
    expect(state.customers).toBe(0);
    expect(state.draft.status).toBe("pending");
  });

  it("returns 400 for an invalid stored payload without leaking details", async () => {
    state.validate.mockRejectedValue(new Error("private validation detail"));
    const response = await post();
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private");
    expect(state.customers).toBe(0);
  });

  it("rolls back the customer and draft transition when the audit insert fails", async () => {
    state.auditFails = true;
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private");
    expect(state.customers).toBe(0);
    expect(state.draft.status).toBe("pending");
  });

  it("reject changes only status and prevents later confirmation", async () => {
    expect((await post("reject")).status).toBe(200);
    expect(state.draft.status).toBe("rejected");
    expect(state.validate).not.toHaveBeenCalled();
    expect((await post()).status).toBe(409);
    expect(state.customers).toBe(0);
  });

  it("denies API keys, missing sessions, wrong roles and mismatched tenants", async () => {
    state.key = true;
    expect((await post()).status).toBe(403);
    state.key = false;
    state.user = undefined;
    expect((await post()).status).toBe(401);
    state.user = { id: 12, tenantId: 7, role: "sales_admin" };
    expect((await post()).status).toBe(403);
    state.user = { id: 12, tenantId: 8, role: "owner" };
    expect((await post()).status).toBe(403);
    expect(state.customers).toBe(0);
    expect(state.validate).not.toHaveBeenCalled();
  });

  it("returns 404 for an inaccessible draft and 400 for a bad id", async () => {
    state.draft = null;
    expect((await post()).status).toBe(404);
    expect((await post("confirm", "abc")).status).toBe(400);
  });
});
