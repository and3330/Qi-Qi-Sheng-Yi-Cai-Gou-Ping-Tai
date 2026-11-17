/**
 * Replit's supported runtime source is DATABASE_URL. PG* is only a legacy
 * fallback when it is absent. This module has no connection side effects.
 * Never fall back after a malformed URL or a failed connection.
 */
export function resolveDatabaseSource(env = process.env) {
  if (env.DATABASE_URL) return "url";
  if (env.PGHOST && env.PGUSER && env.PGPASSWORD && env.PGDATABASE) return "pg";
  throw new Error("Database configuration unavailable: DATABASE_URL or complete legacy PG* required");
}

export function resolveDatabaseUrl(env = process.env) {
  if (resolveDatabaseSource(env) === "url") {
    try {
      const url = new URL(env.DATABASE_URL);
      if (!["postgres:", "postgresql:"].includes(url.protocol) ||
          !url.hostname || !url.username || !url.password || !url.pathname.slice(1)) {
        throw new Error();
      }
      // pg otherwise fills missing connection fields from ambient PG* even
      // when a connectionString is supplied. Pin the standard port and TLS
      // default; explicit URL settings (including local sslmode=disable) win.
      if (!url.port && !url.searchParams.has("port")) url.port = "5432";
      if (!url.searchParams.has("sslmode") && !url.searchParams.has("ssl")) {
        url.searchParams.set("sslmode", "require");
      }
      return url.toString();
    } catch {
      // Never echo a connection string or URL parsing error containing secrets.
      throw new Error("Invalid DATABASE_URL: complete PostgreSQL credentials required");
    }
  }
  try {
    const url = new URL(`postgresql://${env.PGHOST}:${env.PGPORT || "5432"}/`);
    url.pathname = `/${encodeURIComponent(env.PGDATABASE)}`;
    url.username = env.PGUSER;
    url.password = env.PGPASSWORD;
    url.searchParams.set("sslmode", env.PGSSLMODE === "disable" ? "disable" : "require");
    return url.toString();
  } catch {
    throw new Error("Invalid legacy PG* configuration");
  }
}