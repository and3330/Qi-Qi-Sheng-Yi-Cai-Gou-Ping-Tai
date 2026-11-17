import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Exercise the actual login body so a development-only fallback cannot quietly
// replace a rejected server response with an invented owner session.
const source = readFileSync(
  new URL("../../erp/src/contexts/auth-context.tsx", import.meta.url),
  "utf8",
);
const login = source.slice(source.indexOf("  const login ="), source.indexOf("  const logout ="));
const body = login.slice(login.indexOf("=> {") + 4, login.lastIndexOf("};"));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runLogin = new AsyncFunction("fetch", "updateUser", "companyCode", "username", "password", body);

test("rejected login never creates a local owner session", async () => {
  const users = [];
  await assert.rejects(
    runLogin(async () => ({ ok: false, json: async () => ({ error: "登入失敗" }) }),
      user => users.push(user), "test-company", "test-user", "invalid"),
    /登入失敗/,
  );
  assert.deepEqual(users, []);
});

test("network failure never creates a local owner session", async () => {
  const users = [];
  await assert.rejects(
    runLogin(async () => { throw new Error("offline"); },
      user => users.push(user), "test-company", "test-user", "invalid"),
    /offline/,
  );
  assert.deepEqual(users, []);
});

test("successful login uses only the server-returned identity", async () => {
  const identity = { id: 37, tenantId: 42, role: "employee" };
  const users = [];
  await runLogin(async () => ({ ok: true, json: async () => identity }),
    user => users.push(user), "test-company", "test-user", "test-password");
  assert.deepEqual(users, [identity]);
});
