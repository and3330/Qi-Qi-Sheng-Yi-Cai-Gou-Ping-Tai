/** TLS/session-pooler handshakes cross regions; SQL/lock budgets stay short. */
export function sessionPoolOptions(provider: "replit" | "supabase") {
  return {
    max: provider === "supabase" ? 2 : 4,
    connectionTimeoutMillis: provider === "supabase" ? 10_000 : 1_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 2_000,
    query_timeout: 2_500,
  };
}
