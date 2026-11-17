import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/erp-db", () => ({ currentTenantId: () => null }));
vi.mock("../tenant-db", () => ({ tenantPool: { query: vi.fn() } }));
vi.mock("../ecpay-invoice", () => ({ getInvoiceConfig: vi.fn() }));
import { sealSecrets, openSecrets, hintOf, hasMasterKey, SecretKeyMissingError } from "../secret-box";
import { platformEcpayBelongsTo } from "../tenant-integrations";

const env = { ERP_SECRETS_KEY: "unit-test-only-key-0123456789abcdef" } as NodeJS.ProcessEnv;

describe("secret-box", () => {
  it("seals and opens secrets with the master key", () => {
    const sealed = sealSecrets({ hashKey: "abcdefghijklmnop", hashIV: "ponmlkjihgfedcba" }, env);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("abcdefghijklmnop");
    expect(openSecrets(sealed, env)).toEqual({ hashKey: "abcdefghijklmnop", hashIV: "ponmlkjihgfedcba" });
  });

  it("uses a fresh IV every time", () => {
    expect(sealSecrets({ a: "1" }, env)).not.toBe(sealSecrets({ a: "1" }, env));
  });

  it("refuses to open with a different master key", () => {
    const sealed = sealSecrets({ apiKey: "re_123" }, env);
    expect(() => openSecrets(sealed, { ERP_SECRETS_KEY: "another-key-that-is-long-enough-000" } as NodeJS.ProcessEnv)).toThrow();
  });

  it("refuses to seal without a long enough master key", () => {
    expect(hasMasterKey({} as NodeJS.ProcessEnv)).toBe(false);
    expect(() => sealSecrets({ a: "1" }, { ERP_SECRETS_KEY: "short" } as NodeJS.ProcessEnv)).toThrow(SecretKeyMissingError);
  });

  it("shows only the last four characters", () => {
    expect(hintOf("re_abcdef1234")).toBe("••••1234");
    expect(hintOf("abc")).toBe("••••");
  });
});

describe("platform ECPay merchant", () => {
  it("belongs only to the tenant named in ECPAY_INVOICE_TENANT_ID", () => {
    const platformEnv = { ECPAY_INVOICE_TENANT_ID: "130" } as NodeJS.ProcessEnv;
    expect(platformEcpayBelongsTo(130, platformEnv)).toBe(true);
    expect(platformEcpayBelongsTo(131, platformEnv)).toBe(false);
    expect(platformEcpayBelongsTo(null, platformEnv)).toBe(false);
    expect(platformEcpayBelongsTo(130, {} as NodeJS.ProcessEnv)).toBe(false);
  });
});
