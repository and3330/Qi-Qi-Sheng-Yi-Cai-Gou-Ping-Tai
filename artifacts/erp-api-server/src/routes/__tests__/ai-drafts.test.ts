import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: 12, tenantId: 7, role: "accountant" } as any,
  key: false,
  tenantId: 7,
  draft: {} as any,
  created: 0,
  locked: false,
  blocked: false,
  createFails: false,
  commitFails: false,
  updateFails: false,
  auditFails: false,
  committed: false,
  tail: Promise.resolve(),
  validate: vi.fn(),
  received: undefined as any,
}));

vi.mock("@workspace/erp-db", () => {
  const chain = () => ({
    from: () => chain(), where: () => chain(),
    for: async () => { state.locked = true; return state.draft ? [state.draft] : []; },
    orderBy: async () => state.draft ? [state.draft] : [],
  });
  return {
    currentTenantId: () => state.tenantId,
    aiDraftDocumentsTable: { id: "id", tenantId: "tenantId", status: "status", createdAt: "createdAt" },
    aiActionsTable: {},
    db: {
      insert: () => ({ values: async (values: any) => {
        expect(values.args).toEqual({ draftId: 1, userId: 12 });
        if (state.auditFails) throw new Error("private audit failure");
      } }),
      select: chain,
      update: () => ({
        set: (values: any) => ({ where: () => ({ returning: async () => {
          if (state.updateFails) throw new Error("private update failure");
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
      const original = structuredClone(state.draft);
      const created = state.created;
      try {
        const result = await fn();
        if (state.commitFails) throw new Error("private commit failure");
        state.committed = true;
        return result;
      } catch (error) {
        state.draft = original; state.created = created;
        throw error;
      } finally { release(); }
    },
  };
});
vi.mock("../../mcp/drafts", () => ({
  docTypeSchema: { safeParse: (type: string) => ({ success: ["receipt", "payment", "quotation", "payment_request", "sales_invoice"].includes(type), data: type }) },
  draftTarget: () => "/vouchers",
  validateDraft: state.validate,
}));
vi.mock("../../middleware/module-guard", () => ({
  moduleGuard: (req: any, res: any, next: any) => {
    expect(req.path).toBe("/vouchers");
    if (state.blocked) res.status(403).json({ error: "module disabled" });
    else next();
  },
}));
vi.mock("../vouchers", async () => {
  const { Router } = await import("express");
  const { requireAuth, requireRole } = await import("../../middleware/require-auth");
  const router = Router();
  router.use("/vouchers", requireAuth, requireRole("owner", "admin", "finance_admin", "accountant"));
  router.post("/vouchers", (req, res) => {
    expect(state.locked).toBe(true);
    state.received = { body: req.body, user: req.session.user };
    state.created++;
    if (state.createFails) res.status(400).json({ error: "period closed" });
    else res.status(201).json({ id: 81 });
  });
  return { default: router };
});
vi.mock("../customers", async () => ({ default: (await import("express")).Router() }));
vi.mock("../quotations", async () => ({ default: (await import("express")).Router() }));
vi.mock("../payment-requests", async () => ({ default: (await import("express")).Router() }));
vi.mock("../invoices", async () => ({ default: (await import("express")).Router() }));

import router from "../ai-drafts";

describe("human AI draft approval (isolated in-memory transaction double)", () => {
  let server: Server;
  let url: string;
  beforeEach(async () => {
    Object.assign(state, {
      user: { id: 12, tenantId: 7, role: "accountant" }, tenantId: 7, key: false,
      draft: { id: 1, tenantId: 7, status: "pending", docType: "receipt", payload: { stored: true } },
      created: 0, locked: false, blocked: false, createFails: false, commitFails: false,
      updateFails: false, auditFails: false, committed: false, received: undefined, tail: Promise.resolve(),
    });
    state.validate.mockReset().mockResolvedValue({ voucherType: "收款單", normalized: true });
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
  const post = (path = "/ai-drafts/1/confirm") => fetch(`${url}${path}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload: { forged: true }, resultDocumentId: 999 }),
  });

  it("lists pending drafts as an array", async () => {
    const response = await fetch(`${url}/ai-drafts?status=pending`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([state.draft]);
  });
  it.each(["employee", "sales_admin"])("denies role %s", async role => {
    state.user.role = role;
    expect((await post()).status).toBe(403);
    expect(state.created).toBe(0);
  });
  it("denies even admin API keys with a human session", async () => {
    state.key = true;
    expect((await post()).status).toBe(403);
    expect(state.validate).not.toHaveBeenCalled();
  });
  it("denies AI bearer/no session and mismatched tenant context", async () => {
    state.user = undefined;
    expect((await post()).status).toBe(401);
    state.user = { id: 12, tenantId: 8, role: "owner" };
    expect((await post()).status).toBe(403);
  });
  it("revalidates stored input, retains human identity and responds after commit", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(state.committed).toBe(true);
    expect(state.validate).toHaveBeenCalledWith("receipt", { stored: true });
    expect(state.received).toEqual({ body: { voucherType: "收款單", normalized: true }, user: state.user });
    expect(await response.json()).toMatchObject({ status: "confirmed", confirmedBy: 12, resultDocumentId: 81 });
  });
  it("serializes duplicate confirmations and creates once", async () => {
    const responses = await Promise.all([post(), post()]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(state.created).toBe(1);
  });
  it("reject changes only draft state and prevents later approval", async () => {
    expect((await post("/ai-drafts/1/reject")).status).toBe(200);
    expect(state.draft.status).toBe("rejected");
    expect(state.validate).not.toHaveBeenCalled();
    expect((await post()).status).toBe(409);
    expect(state.created).toBe(0);
  });
  it("checks target module permissions before creating", async () => {
    state.blocked = true;
    expect((await post()).status).toBe(403);
    expect(state.created).toBe(0);
    expect(state.draft.status).toBe("pending");
  });
  it.each(["createFails", "updateFails", "commitFails", "auditFails"] as const)("rolls back on %s without sending success", async key => {
    state[key] = true;
    const response = await post();
    expect(response.status).toBe(key === "createFails" ? 400 : 500);
    expect(state.created).toBe(0);
    expect(state.draft.status).toBe("pending");
    expect(await response.text()).not.toContain("private");
  });
  it("fails revalidation without invoking business creation", async () => {
    state.validate.mockRejectedValue(new Error("private reference"));
    expect((await post()).status).toBe(400);
    expect(state.created).toBe(0);
  });
  it("returns 404 for inaccessible draft and validates IDs/status", async () => {
    state.draft = null;
    expect((await post()).status).toBe(404);
    expect((await post("/ai-drafts/no/confirm")).status).toBe(400);
    expect((await fetch(`${url}/ai-drafts?status=bad`)).status).toBe(400);
  });
});
