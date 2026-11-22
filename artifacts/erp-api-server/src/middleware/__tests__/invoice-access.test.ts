import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { requireRole } from "../require-auth";
import { INVOICE_ISSUE_PRINT_ROLES } from "../../lib/invoice-access";

describe("invoice issue/print role boundary", () => {
  for (const role of ["super_admin", "owner", "admin", "finance_admin", "accountant", "manager", "sales", "warehouse", "hr_admin", "viewer", "employee"]) {
    it(`${role} receives only the intended invoice access`, () => {
      const req = { session: { user: { role, tenantId: 1 } } } as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();
      requireRole(...INVOICE_ISSUE_PRINT_ROLES)(req, res as unknown as Response, next);
      const allowed = ["super_admin", "owner", "admin", "finance_admin", "accountant", "manager"].includes(role);
      expect(next).toHaveBeenCalledTimes(allowed ? 1 : 0);
      if (!allowed) expect(res.status).toHaveBeenCalledWith(403);
    });
  }
  it("still rejects a manager without tenant scope", () => {
    const req = { session: { user: { role: "manager" } } } as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    requireRole(...INVOICE_ISSUE_PRINT_ROLES)(req, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
