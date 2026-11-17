import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(apiRoot, "../..");
const dbRoot = path.join(workspaceRoot, "lib/db");
const guardPath = path.join(dbRoot, "scripts/schema-push-guard.mjs");
const packageJson = JSON.parse(
  await readFile(path.join(apiRoot, "package.json"), "utf8"),
);
const dbPackageJson = JSON.parse(
  await readFile(path.join(dbRoot, "package.json"), "utf8"),
);
const schemaPushGuard = await readFile(guardPath, "utf8");
const buildSource = await readFile(path.join(apiRoot, "build.mjs"), "utf8");
const indexSource = await readFile(path.join(apiRoot, "src/index.ts"), "utf8");
const demoSeedSource = await readFile(
  path.join(apiRoot, "src/demo/demo-seed.ts"),
  "utf8",
);
const postMerge = await readFile(
  path.join(workspaceRoot, "scripts/post-merge.sh"),
  "utf8",
);
const artifactToml = await readFile(
  path.join(apiRoot, ".replit-artifact/artifact.toml"),
  "utf8",
);

const mutationPattern =
  /\bdrizzle-kit\s+push\b|\bpush-force\b|\bdb(?::schema)?:push\b|--filter\s+(?:@workspace\/)?db\s+(?:run\s+)?push\b/;
const fingerprintA = "a".repeat(32);
const fingerprintB = "b".repeat(32);

function normalScriptClosure(entrypoint) {
  const visited = new Set();
  const pending = [entrypoint];

  while (pending.length > 0) {
    const name = pending.pop();
    if (visited.has(name)) continue;
    visited.add(name);

    const command = packageJson.scripts[name];
    assert.equal(typeof command, "string", `missing ${name} script`);

    for (const match of command.matchAll(/\bpnpm\s+(?:run\s+)?([\w:-]+)/g)) {
      const referencedScript = match[1];
      if (packageJson.scripts[referencedScript]) pending.push(referencedScript);
    }
  }

  return [...visited].map((name) => [name, packageJson.scripts[name]]);
}

function runGuard(args = [], overrides = {}) {
  const stubDir = mkdtempSync(path.join(os.tmpdir(), "schema-push-guard-"));
  const stubPath = path.join(stubDir, "pnpm");
  const logPath = path.join(stubDir, "calls.log");
  writeFileSync(
    stubPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, args.join(" ") + "\\n");
if (args[0] === "exec" && args[1] === "tsx") {
  // Both fields means runtime auto selection; URL-only means the guard's
  // isolated canonical selection. Neither branch actually opens a connection.
  const source = process.env.DATABASE_URL
    ? (process.env.PGHOST ? "AUTO" : "URL")
    : "PG";
  fs.appendFileSync(process.env.STUB_LOG, "SOURCE " + source + "\\n");
  const mode = process.env["STUB_MODE_" + source] || "report";
  if (mode === "unavailable") process.exit(2);
  if (mode === "malformed") {
    process.stdout.write('{"catalogFingerprint":"not-a-valid-fingerprint"}\\n');
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    format: "erp-schema-rls-audit/v1",
    catalogFingerprint: process.env["STUB_FINGERPRINT_" + source]
  }) + "\\n");
  process.exit(Number(process.env["STUB_STATUS_" + source] || "0"));
}
if (args[0] === "exec" && args[1] === "drizzle-kit") {
  fs.appendFileSync(process.env.STUB_LOG, "MUTATION\\n");
  // Never allow a regression to proceed into the real apply-rls script.
  process.exit(3);
}
process.exit(3);
`,
  );
  chmodSync(stubPath, 0o755);

  const env = {
    PATH: `${stubDir}:${process.env.PATH}`,
    NODE_ENV: "development",
    PGHOST: "pg-source.invalid",
    PGPORT: "5432",
    PGUSER: "test-user",
    PGPASSWORD: "test-password",
    PGDATABASE: "test-database",
    DATABASE_URL: "postgresql://test-user:test-password@url-source.invalid:5432/test-database?sslmode=require",
    STUB_LOG: logPath,
    STUB_FINGERPRINT_AUTO: fingerprintA,
    // Stale unused PG differs deliberately and must never be checked.
    STUB_FINGERPRINT_PG: fingerprintB,
    STUB_FINGERPRINT_URL: fingerprintA,
    ...overrides,
  };

  try {
    const result = spawnSync(process.execPath, [guardPath, ...args], {
      cwd: dbRoot,
      env,
      encoding: "utf8",
    });
    let calls = "";
    try {
      calls = readFileSync(logPath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return { result, calls };
  } finally {
    rmSync(stubDir, { recursive: true, force: true });
  }
}

test("normal API dev, build, and start chains never mutate the database", () => {
  for (const entrypoint of ["dev", "build", "start"]) {
    for (const [name, command] of normalScriptClosure(entrypoint)) {
      assert.doesNotMatch(
        command,
        mutationPattern,
        `${entrypoint} reaches database mutation through ${name}`,
      );
    }
  }
});

test("normal fresh startup cannot import legacy business seed data", () => {
  assert.equal(
    existsSync(path.join(apiRoot, "src/auto-seed.ts")),
    false,
    "legacy empty-customer auto-seed module must stay removed",
  );
  assert.equal(
    existsSync(path.join(apiRoot, "seed-data.sql")),
    false,
    "legacy business data dump must not remain in the API artifact",
  );
  assert.doesNotMatch(buildSource, /seed-data\.sql|copyFile/);
  assert.doesNotMatch(
    indexSource,
    /autoSeedIfEmpty|auto-seed|seed-data\.sql/,
  );
});

test("synthetic demo reset remains separately and explicitly gated", () => {
  assert.match(
    demoSeedSource,
    /process\.env\.DEMO_MODE === "true"/,
  );
  assert.match(indexSource, /startDemoMode\(\)/);
  assert.match(
    demoSeedSource,
    /if \(!isDemoMode\(\)\) return;/,
  );
  assert.match(
    demoSeedSource,
    /process\.env\.DEMO_FORCE_INIT === "true"/,
  );
});

test("the production artifact build and run paths contain no schema push", () => {
  assert.match(
    artifactToml,
    /args = \["pnpm", "--filter", "@workspace\/api-server", "run", "build"\]/,
  );
  assert.doesNotMatch(packageJson.scripts.build, mutationPattern);
  assert.doesNotMatch(packageJson.scripts.start, mutationPattern);
  assert.doesNotMatch(artifactToml, mutationPattern);
});

test("node safety test is outside Vitest discovery and has an explicit script", () => {
  assert.equal(
    packageJson.scripts["test:build-safety"],
    "node --test tests/build-safety.node.mjs",
  );
});

test("schema push is explicit and delegates to the guarded DB entrypoint", () => {
  const command = packageJson.scripts["db:schema:push:dev"];
  assert.equal(typeof command, "string");
  assert.match(command, /\$NODE_ENV/);
  assert.match(command, /!= "development"/);
  assert.match(command, /@workspace\/db run push/);
  assert.doesNotMatch(command, /--force|\bpush-force\b/);
});

test("public DB push requires read-only source match before mutation", () => {
  assert.equal(
    dbPackageJson.scripts.push,
    "node ./scripts/schema-push-guard.mjs",
  );
  assert.match(
    dbPackageJson.scripts["check:schema-source-match:read-only"],
    /schema-push-guard\.mjs --check-only/,
  );
  assert.match(schemaPushGuard, /NODE_ENV !== "development"/);
  assert.match(schemaPushGuard, /assertSourceMatch\(\);[\s\S]*drizzle-kit/);
  assert.match(schemaPushGuard, /\^\[a-f0-9\]\{32\}\$/);
});

test("unequal auto and explicit URL fingerprints fail before push", () => {
  const { result, calls } = runGuard([], {
    STUB_FINGERPRINT_URL: fingerprintB,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /catalog sources do not match/);
  assert.match(calls, /SOURCE AUTO[\s\S]*SOURCE URL/);
  assert.doesNotMatch(calls, /SOURCE PG/);
  assert.doesNotMatch(calls, /drizzle-kit|MUTATION/);
});

test("malformed and unavailable checker reports fail closed before push", () => {
  for (const overrides of [
    { STUB_MODE_AUTO: "malformed" },
    { STUB_MODE_URL: "unavailable" },
  ]) {
    const { result, calls } = runGuard([], overrides);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /read-only .* source comparison/);
    assert.doesNotMatch(calls, /drizzle-kit|MUTATION/);
  }
});

test("equal fingerprints permit check-only despite compatibility exit 1", () => {
  const { result, calls } = runGuard(["--check-only"], {
    STUB_STATUS_AUTO: "1",
    STUB_STATUS_URL: "1",
  });
  assert.equal(result.status, 0);
  assert.equal((calls.match(/exec tsx/g) ?? []).length, 2);
  assert.match(calls, /SOURCE AUTO[\s\S]*SOURCE URL/);
  assert.doesNotMatch(calls, /SOURCE PG/);
  assert.doesNotMatch(calls, /drizzle-kit|MUTATION/);
});

test("production and force reject before checker or mutation", () => {
  for (const [args, overrides, message] of [
    [[], { NODE_ENV: "production" }, /NODE_ENV must be development/],
    [["--force"], {}, /force push is disabled/],
  ]) {
    const { result, calls } = runGuard(args, overrides);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.equal(calls, "");
  }
});

test("post-merge setup performs no database mutation", () => {
  assert.match(postMerge, /pnpm install --frozen-lockfile/);
  assert.doesNotMatch(postMerge, mutationPattern);
});