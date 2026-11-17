import { describe, expect, it } from "vitest";
import { toSafeDatabaseError } from "../safe-json-db-error";

describe("toSafeDatabaseError", () => {
  it.each(["42P01", "42703", "3F000"])("maps wrapped missing-schema error %s to 503", (code) => {
    const error = new Error("Drizzle query failed", { cause: { code, query: "private sql", params: ["private value"] } });
    expect(toSafeDatabaseError(error)).toEqual({
      status: 503,
      code: "DATABASE_UPDATE_REQUIRED",
      error: "資料庫尚未完成更新，請聯絡系統管理員執行資料庫更新。",
    });
  });

  it("maps a wrapped unique violation to 409", () => {
    const error = new Error("query failed", { cause: { cause: { code: "23505" } } });
    expect(toSafeDatabaseError(error)).toMatchObject({ status: 409, code: "DUPLICATE_RECORD" });
  });

  it("does not expose generic database error details", () => {
    const safe = toSafeDatabaseError(new Error("select * from customers; customer@example.com"));
    expect(safe).toEqual({
      status: 500,
      code: "DATABASE_ERROR",
      error: "客戶資料操作失敗，請稍後再試。",
    });
    expect(JSON.stringify(safe)).not.toContain("customer@example.com");
  });
});