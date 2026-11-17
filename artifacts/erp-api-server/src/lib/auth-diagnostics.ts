import { pgErrorCode } from "./pg-error";

export type AuthStage = "acquire" | "begin" | "bounds" | "user_lookup" | "tenant_recheck"
  | "password_verify" | "password_rehash" | "session_persist" | "commit" | "cleanup";
export type AuthFailure = { stage: AuthStage; reason: string };
export type AuthFailureReporter = (failure: AuthFailure) => void;

/** Cross-region TLS can exceed one second. Do not relax SQL or lock budgets. */
export function authConnectionTimeoutMs(provider: "replit" | "supabase") {
  return provider === "supabase" ? 10_000 : 1_000;
}

export class AuthConnectionDeadlineError extends Error {
  constructor() { super("Authentication connection deadline"); }
}

/** Only fixed categories / allowlisted driver codes; never serialize the error. */
export function reportAuthFailure(report: AuthFailureReporter | undefined, stage: AuthStage, error: unknown) {
  if (!report) return;
  const allowed = new Set(["55P03", "57014", "25P03", "53300", "57P01", "08001", "08006",
    "42P01", "42703", "42501", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"]);
  const code = pgErrorCode(error);
  const reason = error instanceof AuthConnectionDeadlineError ? "connection_deadline"
    : code && allowed.has(code) ? code : "other";
  // Observability must never change authentication / cleanup behavior.
  try { report({ stage, reason }); } catch { /* diagnostic sink unavailable */ }
}
