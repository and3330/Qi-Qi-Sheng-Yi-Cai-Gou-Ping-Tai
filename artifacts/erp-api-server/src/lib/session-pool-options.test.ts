import { describe, expect, it } from "vitest";
import { sessionPoolOptions } from "../../../../lib/erp-db/src/session-pool-options";

describe("session connection budgets", () => {
  it("allows Supabase TLS handshakes without increasing pool size or SQL timeouts", () => {
    expect(sessionPoolOptions("supabase")).toEqual({
      max:2, connectionTimeoutMillis:10_000, idleTimeoutMillis:30_000,
      statement_timeout:2_000, query_timeout:2_500,
    });
  });
  it("preserves existing managed-database budgets", () => {
    expect(sessionPoolOptions("replit")).toEqual({
      max:4, connectionTimeoutMillis:1_000, idleTimeoutMillis:30_000,
      statement_timeout:2_000, query_timeout:2_500,
    });
  });
});
