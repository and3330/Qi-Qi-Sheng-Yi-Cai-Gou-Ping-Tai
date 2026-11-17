import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAiPublishDiff } from "./ai-publish-safety.mjs";

function plan(tables = ["ai_actions", "ai_draft_documents"]) {
  return {
    success: true, hasDiff: true, hasStructuralDataLoss: false, maybeNonBackwardsCompatible: false,
    tablesToRemove: [], tablesToTruncate: [], columnsToRemove: [], schemasToRemove: [], matViewsToRemove: [], warnings: [],
    statementsToExecute: tables.flatMap(t => [
      `CREATE TABLE "${t}" ("id" serial PRIMARY KEY, "tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL, "payload" jsonb);`,
      `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY;`,
      `CREATE POLICY "tenant_isolation" ON "${t}" AS PERMISSIVE FOR ALL TO public USING (tenant_id = (current_setting('app.tenant_id'::text))::integer) WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer);`,
    ]),
  };
}
test("accepts complete additive tenant-isolated plan", () => {
  assert.equal(checkAiPublishDiff(plan()).safe, true);
});
test("accepts no-default explicit-tenant alternative", () => {
  const p = plan();
  p.statementsToExecute = p.statementsToExecute.map(s => s.replace("DEFAULT (current_setting('app.tenant_id'::text))::integer ", ""));
  assert.equal(checkAiPublishDiff(p).safe, true);
});
test("rejects observed Publish truncation and missing policy clauses", () => {
  const p = plan();
  p.statementsToExecute[0] = p.statementsToExecute[0].replace("(current_setting('app.tenant_id'::text))::integer", "(current_setting('app.tenant_id'");
  p.statementsToExecute[3] = 'CREATE POLICY tenant_isolation ON ai_actions AS PERMISSIVE FOR ALL TO public;';
  assert.equal(checkAiPublishDiff(p).safe, false);
});
test("rejects loss of FORCE RLS", () => {
  const p = plan(); p.statementsToExecute.splice(2, 1);
  assert.equal(checkAiPublishDiff(p).safe, false);
});
test("rejects existing-table mutations despite reassuring metadata", () => {
  for (const sql of ["ALTER TABLE invoices ADD COLUMN test integer;", "DELETE FROM invoices;", "DROP TABLE invoices;", "UPDATE ai_actions SET tenant_id=1;"]) {
    const p = plan(); p.statementsToExecute.push(sql);
    assert.equal(checkAiPublishDiff(p).safe, false);
  }
});
test("rejects constant tenants and permissive policies", () => {
  for (const [from, to] of [["current_setting('app.tenant_id'::text)", "1"], ["USING (tenant_id =", "USING (true OR tenant_id ="]]) {
    const p = plan(); p.statementsToExecute = p.statementsToExecute.map(s => s.replaceAll(from, to));
    assert.equal(checkAiPublishDiff(p).safe, false);
  }
});
test("requires actual successful diff, not an empty/failed response", () => {
  for (const p of [{}, { success: false }, { ...plan(), hasDiff: false }, plan([])]) assert.equal(checkAiPublishDiff(p).safe, false);
});
test("accepts ai_customer_drafts alone or with the first two AI tables, including its index", () => {
  for (const tables of [["ai_customer_drafts"], ["ai_actions", "ai_draft_documents", "ai_customer_drafts"]]) {
    const p = plan(tables);
    p.statementsToExecute.push('CREATE INDEX "ai_customer_drafts_tenant_created_idx" ON "ai_customer_drafts" USING btree ("tenant_id","created_at");');
    assert.deepEqual(checkAiPublishDiff(p), { safe: true, errors: [] });
  }
});
test("rejects ai_customer_drafts without FORCE RLS or without full policy predicates (Publish loss)", () => {
  const noForce = plan(["ai_customer_drafts"]);
  noForce.statementsToExecute = noForce.statementsToExecute.filter(s => !s.includes("FORCE"));
  assert.equal(checkAiPublishDiff(noForce).safe, false);
  const noPredicates = plan(["ai_customer_drafts"]);
  noPredicates.statementsToExecute[3] = 'CREATE POLICY "tenant_isolation" ON "ai_customer_drafts" AS PERMISSIVE FOR ALL TO public;';
  assert.equal(checkAiPublishDiff(noPredicates).safe, false);
  const noCheck = plan(["ai_customer_drafts"]);
  noCheck.statementsToExecute[3] = noCheck.statementsToExecute[3].replace(/ WITH CHECK .*$/, ";");
  assert.equal(checkAiPublishDiff(noCheck).safe, false);
});
test("rejects ai_customer_drafts index on other columns and changes to customers", () => {
  const p = plan(["ai_customer_drafts"]);
  p.statementsToExecute.push('CREATE INDEX "ai_customer_drafts_tenant_created_idx" ON "ai_customer_drafts" USING btree ("payload");');
  assert.equal(checkAiPublishDiff(p).safe, false);
  const q = plan(["ai_customer_drafts"]);
  q.statementsToExecute.push('CREATE UNIQUE INDEX customers_tax_id_idx ON customers (tax_id);');
  assert.equal(checkAiPublishDiff(q).safe, false);
});
