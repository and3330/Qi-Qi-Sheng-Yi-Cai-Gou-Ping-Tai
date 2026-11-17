// Read-only, deliberately narrow approval gate for the AI-only tables release.
// This does not execute SQL or modify a Publish plan.
// A plan may create any non-empty subset of the AI tables (e.g. only ai_customer_drafts
// when the first two are already published), but each table it touches must be complete:
// exactly one CREATE TABLE, ENABLE RLS, FORCE RLS and full tenant_isolation policy.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const TABLES = ["ai_actions", "ai_draft_documents", "ai_customer_drafts"];
const TABLE_RE = TABLES.join("|");
const INDEXES = {
  ai_actions: "ai_actions_tenant_created_idx",
  ai_draft_documents: "ai_drafts_tenant_created_idx",
  ai_customer_drafts: "ai_customer_drafts_tenant_created_idx",
};
const compact = s => s.replace(/["()\s]/g, "").replaceAll("::text", "");
const DEFAULT = "current_setting'app.tenant_id'::integer";
const PREDICATE = `tenant_id=${DEFAULT}`;

export function checkAiPublishDiff(diff) {
  const errors = [];
  if (diff?.success !== true || diff.hasDiff !== true || !Array.isArray(diff.statementsToExecute)) {
    return { safe: false, errors: ["No verifiable AI-table Publish plan"] };
  }
  for (const key of ["tablesToRemove", "tablesToTruncate", "columnsToRemove", "schemasToRemove", "matViewsToRemove"]) {
    if (!Array.isArray(diff[key]) || diff[key].length) errors.push(`Unsafe or missing metadata: ${key}`);
  }
  if (diff.hasStructuralDataLoss !== false || diff.maybeNonBackwardsCompatible !== false ||
      !Array.isArray(diff.warnings) || diff.warnings.length) errors.push("Publish reports risk or incomplete metadata");
  const seen = Object.fromEntries(TABLES.map(t => [t, { create: 0, enable: 0, force: 0, policy: 0 }]));
  for (const original of diff.statementsToExecute) {
    if (typeof original !== "string") { errors.push("Non-text SQL"); continue; }
    const s = original.trim().replace(/;\s*$/, "").replaceAll('"', "");
    // PostgreSQL-generated defaults/predicates here never contain semicolons/comments.
    if (/;|--|\/\*/.test(s)) { errors.push("Batched or commented SQL is not accepted"); continue; }
    let m;
    if ((m = s.match(new RegExp(`^CREATE TABLE (${TABLE_RE})\\s*\\(`, "i")))) {
      seen[m[1]].create++;
      const tenant = s.match(/\btenant_id\s+integer\s+([^,\n]+)/i)?.[1] ?? "";
      const declaration = compact(tenant.replace(/\bNOT NULL\b/ig, ""));
      // Either a complete tenant default or no default (explicit trusted INSERTs).
      if (!/\bNOT NULL\b/i.test(tenant) ||
          (declaration !== "" && declaration !== `DEFAULT${DEFAULT}`)) {
        errors.push(`${m[1]}: tenant_id must be NOT NULL with no default or a complete tenant default`);
      }
    } else if ((m = s.match(new RegExp(`^ALTER TABLE (${TABLE_RE}) (ENABLE|FORCE) ROW LEVEL SECURITY$`, "i")))) {
      seen[m[1]][m[2].toLowerCase()]++;
    } else if ((m = s.match(new RegExp(`^CREATE POLICY tenant_isolation ON (${TABLE_RE}) (?:AS PERMISSIVE )?FOR ALL TO public\\s+USING\\s*(\\(.*\\))\\s+WITH CHECK\\s*(\\(.*\\))$`, "is")))) {
      seen[m[1]].policy++;
      if (compact(m[2]) !== PREDICATE || compact(m[3]) !== PREDICATE) {
        errors.push(`${m[1]}: policy predicates do not enforce the tenant`);
      }
    } else if (!Object.entries(INDEXES).some(([table, index]) =>
      new RegExp(`^CREATE INDEX ${index} ON ${table}\\s+(?:USING btree\\s*)?\\(\\s*tenant_id\\s*,\\s*created_at\\s*\\)$`, "i").test(s))) {
      errors.push("Unexpected statement (only the new AI tables, indexes and RLS are allowed)");
    }
  }
  let present = 0;
  for (const [table, parts] of Object.entries(seen)) {
    const counts = Object.values(parts);
    if (counts.every(count => count === 0)) continue; // table not part of this plan
    present++;
    for (const [part, count] of Object.entries(parts)) {
      if (count !== 1) errors.push(`${table}: expected one ${part}, found ${count}`);
    }
  }
  if (present === 0) errors.push("Plan creates none of the AI tables");
  return { safe: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = checkAiPublishDiff(JSON.parse(await readFile(process.argv[2], "utf8")));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.safe ? 0 : 1;
  } catch {
    console.error("Provide a JSON result from explainSchemaDiff; no database connection is used.");
    process.exitCode = 2;
  }
}
