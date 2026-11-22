import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanPermissions, defaultRolePermissions, withInvoicePermissions, INVOICE_ACTION_PATHS } from "../../lib/role-defaults";
const mocks = vi.hoisted(() => ({ custom: vi.fn(), builtin: vi.fn() }));
vi.mock("../../lib/custom-roles", () => ({ customRoleForUser: mocks.custom, builtinRolePermissions: mocks.builtin }));
import { requireInvoicePermission, invoiceActionForPath } from "../invoice-permission";

beforeEach(() => { vi.resetAllMocks(); mocks.custom.mockResolvedValue(null); });

async function call(role: string, action: "issue" | "print", tenantId = 1) {
  const next = vi.fn();
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await requireInvoicePermission(action)({ tenantId, session: { user: { id: 7, role, tenantId: 1 } } } as any, res as any, next);
  return { res, next };
}

describe("configurable invoice permissions", () => {
  it("preserves the old manager default but preserves explicit revocation", () => {
    const defaults = defaultRolePermissions("manager", ["/sales/orders", "/sales/invoices"]);
    expect(defaults[INVOICE_ACTION_PATHS.issue]).toEqual(["view"]);
    expect(defaults[INVOICE_ACTION_PATHS.print]).toEqual(["view"]);
    const saved = cleanPermissions({ ...defaults, [INVOICE_ACTION_PATHS.issue]: [] }, ["/sales/orders", "/sales/invoices"]);
    expect(withInvoicePermissions("manager", saved)[INVOICE_ACTION_PATHS.issue]).toEqual([]);
    expect(defaultRolePermissions("sales", ["/sales/orders"])[INVOICE_ACTION_PATHS.issue]).toEqual([]);
  });
  it("allows explicitly granted sales users and independently denies printing", async () => {
    mocks.builtin.mockResolvedValue({ [INVOICE_ACTION_PATHS.issue]: ["view"], [INVOICE_ACTION_PATHS.print]: [] });
    expect((await call("sales", "issue")).next).toHaveBeenCalledOnce();
    expect((await call("sales", "print")).res.status).toHaveBeenCalledWith(403);
    expect(mocks.builtin).toHaveBeenCalledWith(1, "sales");
  });
  it("denies a manager after revocation and honors custom overrides", async () => {
    mocks.custom.mockResolvedValue({ permissions: { [INVOICE_ACTION_PATHS.issue]: [], [INVOICE_ACTION_PATHS.print]: ["view"] } });
    expect((await call("manager", "issue")).res.status).toHaveBeenCalledWith(403);
    expect((await call("manager", "print")).next).toHaveBeenCalledOnce();
    expect(mocks.builtin).not.toHaveBeenCalled();
  });
  it("fails closed on lookup errors and tenant mismatch", async () => {
    mocks.custom.mockRejectedValue(new Error("unavailable"));
    expect((await call("manager", "issue")).res.status).toHaveBeenCalledWith(503);
    expect((await call("owner", "issue", 2)).res.status).toHaveBeenCalledWith(401);
  });
  it("keeps administrator access and does not grant employee access", async () => {
    expect((await call("owner", "issue")).next).toHaveBeenCalledOnce();
    expect((await call("employee", "print")).res.status).toHaveBeenCalledWith(403);
  });
  it("only replaces guards for issue and print, not void or allowance", () => {
    expect(invoiceActionForPath("/sales-orders/1/issue-ecpay-invoice")).toBe("issue");
    expect(invoiceActionForPath("/invoices/1/ecpay-pdf")).toBe("print");
    expect(invoiceActionForPath("/invoices/1/ecpay-print")).toBe("print");
    expect(invoiceActionForPath("/invoices/1/ecpay-void")).toBeNull();
    expect(invoiceActionForPath("/invoices/1/ecpay-allowance")).toBeNull();
  });
});
