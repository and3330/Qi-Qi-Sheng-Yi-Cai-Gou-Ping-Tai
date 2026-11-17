import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { X509Certificate } from "node:crypto";
import { resolveDatabaseUrl as resolveManagedDatabaseUrl } from "./connection.mjs";

export function runtimeDatabaseProvider(env = process.env) {
  const provider = env.ERP_DATABASE_PROVIDER || "replit";
  if (!["replit", "supabase"].includes(provider)) throw new Error("Invalid ERP_DATABASE_PROVIDER");
  return provider;
}

function publicCaPath() {
  let dir = resolve(process.cwd());
  for (let depth = 0; depth < 10; depth++) {
    const path = join(dir, "lib/erp-db/certs/supabase-root-2021.crt");
    if (existsSync(path)) return path;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Supabase public CA unavailable");
}

/** Explicit runtime opt-in only. Dev schema tooling retains its managed resolver. */
export function resolveRuntimeDatabaseUrl(env = process.env) {
  if (runtimeDatabaseProvider(env) === "replit") return resolveManagedDatabaseUrl(env);
  try {
    const url = new URL(env.SUPABASE_DATABASE_URL || "");
    const project = env.SUPABASE_PROJECT_REF || "kfmstyauifksaepahvrp";
    if (!/^[a-z]{20}$/.test(project) ||
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !url.hostname.endsWith(".pooler.supabase.com") ||
        decodeURIComponent(url.username) !== `postgres.${project}` ||
        !url.password || decodeURIComponent(url.password).includes("YOUR-PASSWORD") ||
        url.pathname !== "/postgres" || (url.port && url.port !== "5432") ||
        url.hash || /[\r\n]/.test(env.SUPABASE_DATABASE_URL || "")) throw new Error();
    const allowed = new Set(["sslmode", "sslrootcert", "application_name", "connect_timeout"]);
    for (const key of url.searchParams.keys()) if (!allowed.has(key)) throw new Error();
    const caPath = publicCaPath();
    const cert = new X509Certificate(readFileSync(caPath));
    if (!cert.ca || cert.fingerprint256.replaceAll(":", "").toLowerCase() !==
        "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa" ||
        Date.parse(cert.validTo) <= Date.now()) throw new Error();
    url.port = "5432";
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.set("sslrootcert", caPath);
    return url.toString();
  } catch {
    // Never include pg/URL errors, secret values, hosts, or usernames.
    throw new Error("Invalid Supabase database configuration");
  }
}
