import { spawnSync } from "node:child_process";
import { resolveDatabaseSource, resolveDatabaseUrl } from "../src/connection.mjs";

const CHECKER_PATH = "./scripts/schema-rls-audit.ts";
const PG_KEYS = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"];
const DEPLOYMENT_KEYS = [
  "REPLIT_DEPLOYMENT",
  "REPLIT_DEPLOYMENT_ID",
  "REPLIT_DEPLOYMENT_VERSION",
];

function fail(message) {
  process.stderr.write(`Refusing schema push: ${message}\n`);
  process.exit(1);
}

function assertDevelopmentOnly() {
  if (process.env.NODE_ENV !== "development") {
    fail("NODE_ENV must be development");
  }
  if (
    process.env.REPLIT_ENVIRONMENT === "production" ||
    DEPLOYMENT_KEYS.some((key) => Boolean(process.env[key]))
  ) {
    fail("deployment environments may not mutate schema");
  }
}

function checkerEnvironment(source) {
  const env = { ...process.env };
  if (source === "pg") {
    delete env.DATABASE_URL;
  } else if (source === "url") {
    for (const key of PG_KEYS) delete env[key];
  }
  return env;
}

function readCatalogFingerprint(source) {
  const result = spawnSync(
    "pnpm",
    ["exec", "tsx", CHECKER_PATH],
    {
      cwd: process.cwd(),
      env: checkerEnvironment(source),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  // Exit 1 means the catalog differs from checked-in schema. That is expected
  // before an intentional push, so this gate only consumes the catalog
  // fingerprint. Exit 2 means the read-only comparison itself failed.
  if (result.signal || (result.status !== 0 && result.status !== 1)) {
    fail(`read-only ${source} source comparison failed`);
  }

  try {
    const report = JSON.parse(result.stdout);
    if (
      report.format !== "erp-schema-rls-audit/v1" ||
      typeof report.catalogFingerprint !== "string" ||
      !/^[a-f0-9]{32}$/.test(report.catalogFingerprint)
    ) {
      throw new Error("invalid report");
    }
    return report.catalogFingerprint;
  } catch {
    fail(`read-only ${source} source comparison returned an invalid report`);
  }
}

function assertSourceMatch() {
  let source;
  try {
    resolveDatabaseUrl();
    source = resolveDatabaseSource();
  } catch {
    fail("active database configuration unavailable or invalid");
  }
  // Audit the actual runtime selection against an isolated explicit selection.
  // Unused legacy PG* is not a schema target. Fingerprints are not identity proof;
  // platform endpoint identity must be independently verified before mutation.
  const activeFingerprint = readCatalogFingerprint("auto");
  const selectedFingerprint = readCatalogFingerprint(source);
  if (activeFingerprint !== selectedFingerprint) {
    fail("active runtime and selected schema catalog sources do not match");
  }
}

assertDevelopmentOnly();

if (process.argv.includes("--force")) {
  fail("force push is disabled; it can remove tenant RLS protections");
}

assertSourceMatch();

if (!process.argv.includes("--check-only")) {
  const push = spawnSync(
    "pnpm",
    ["exec", "drizzle-kit", "push", "--config", "./drizzle.config.ts"],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" },
  );
  if (push.error) fail("drizzle schema push could not start");
  if (push.signal) fail(`drizzle schema push terminated by ${push.signal}`);
  if (push.status !== 0) process.exit(push.status ?? 1);

  const rls = spawnSync(
    process.execPath,
    ["./scripts/apply-rls.mjs"],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" },
  );
  if (rls.error) fail("RLS application could not start");
  if (rls.signal) fail(`RLS application terminated by ${rls.signal}`);
  if (rls.status !== 0) process.exit(rls.status ?? 1);
}