import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTokenFromUrl,
  passwordValidationMessage,
  readJsonSafely,
  readTokenFromFragment,
  recoveryRequest,
} from "../recovery";

const policyError = "密碼至少10個字元，包含英文字母與數字（最多72 UTF-8位元組）";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("passwordValidationMessage", () => {
  it("counts Unicode code points rather than UTF-16 code units", () => {
    expect(passwordValidationMessage("A1😀😀😀😀😀😀😀😀")).toBeNull();
    expect(passwordValidationMessage("A1😀😀😀😀😀😀😀")).toBe(policyError);
  });

  it("enforces the 72-byte UTF-8 maximum", () => {
    expect(passwordValidationMessage(`A1${"界".repeat(23)}`)).toBeNull();
    expect(passwordValidationMessage(`A1${"界".repeat(24)}`)).toBe(policyError);
  });

  it("requires an ASCII English letter and ASCII digit", () => {
    expect(passwordValidationMessage("密碼密碼密碼密碼１２")).toBe(policyError);
    expect(passwordValidationMessage("密碼密碼密碼密碼12")).toBe(policyError);
    expect(passwordValidationMessage("abcdefghij")).toBe(policyError);
    expect(passwordValidationMessage("abcd123456")).toBeNull();
  });
});

describe("fragment token handling", () => {
  it("reads only the fragment without side effects", () => {
    const replaceState = vi.fn();
    const localStorage = { setItem: vi.fn() };
    vi.stubGlobal("window", {
      location: { hash: "#token=secret%20value", search: "", pathname: "/reset-password" },
      history: { state: { preserved: true }, replaceState },
      localStorage,
    });

    expect(readTokenFromFragment()).toBe("secret value");
    expect(replaceState).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("clears fragment and token query while retaining other query and history state", () => {
    const state = { preserved: true };
    const replaceState = vi.fn();
    const localStorage = { setItem: vi.fn() };
    const sessionStorage = { setItem: vi.fn() };
    vi.stubGlobal("window", {
      location: {
        hash: "#token=fragment-secret",
        search: "?token=query-secret&source=email",
        pathname: "/reset-password",
      },
      history: { state, replaceState },
      localStorage,
      sessionStorage,
    });

    clearTokenFromUrl();

    expect(replaceState).toHaveBeenCalledWith(state, "", "/reset-password?source=email");
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain("fragment-secret");
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain("query-secret");
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });
});

describe("recovery response handling", () => {
  it("does not parse a non-JSON response", async () => {
    const response = new Response("<html>fallback</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
    await expect(readJsonSafely(response)).resolves.toBeNull();
  });

  it("uses a JSON API error and safely falls back for HTML errors", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "連結已過期" }), {
        status: 410,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("<html>gateway error</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      })));

    await expect(recoveryRequest("reset-password", { method: "POST" })).rejects.toThrow("連結已過期");
    await expect(recoveryRequest("reset-password", { method: "POST" })).rejects.toThrow("請求失敗，請稍後再試");
  });

  it("rejects null or non-JSON 200 responses instead of reporting success", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("null", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("<html>SPA fallback</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })));

    await expect(recoveryRequest("reset-password", { method: "POST" })).rejects.toThrow("伺服器回應格式錯誤");
    await expect(recoveryRequest("reset-password", { method: "POST" })).rejects.toThrow("伺服器回應格式錯誤");
  });

  it("returns a valid object and sends the recovery API contract with credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(recoveryRequest<{ ok: boolean }>("reset-password", {
      method: "POST",
      body: JSON.stringify({ token: "fragment-token", password: "abcdefgh1Z" }),
    })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/erp-api/admin/reset-password", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ token: "fragment-token", password: "abcdefgh1Z" }),
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }));
  });
});