import pg from "pg";
import { readFile } from "node:fs/promises";
import * as schema from "../src/schema/index.ts";
import {
  auditSnapshot,
  collectSnapshot,
  connectionConfig,
  expectedSchemaFromExports,
  PUBLIC_CATALOG_AUDIT_SQL,
  type CatalogSnapshot,
  type ConnectionSource,
} from "./schema-rls-audit-core.ts";

function optionValue(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function snapshotFromJson(value: unknown): CatalogSnapshot {
  if (Array.isArray(value) && value.length === 1) return value[0] as CatalogSnapshot;
  if (value && typeof value === "object" && "rows" in value) {
    const rows = (value as { rows?: unknown[] }).rows;
    if (rows?.length === 1) return rows[0] as CatalogSnapshot;
  }
  return value as CatalogSnapshot;
}

async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2);
    if (args.includes("--query")) {
      process.stdout.write(`${PUBLIC_CATALOG_AUDIT_SQL}\n`);
      return;
    }
    const requestedSource = optionValue(args, "--source") ?? "auto";
    if (!["auto", "pg", "url"].includes(requestedSource)) throw new Error("invalid source");
    const expected = expectedSchemaFromExports(schema);
    const snapshotPath = optionValue(args, "--snapshot");
    let snapshot: CatalogSnapshot;
    if (snapshotPath) {
      const parsed: unknown = JSON.parse(await readFile(snapshotPath, "utf8"));
      snapshot = snapshotFromJson(parsed);
    } else {
      const client = new pg.Client(connectionConfig(process.env, requestedSource as ConnectionSource));
      snapshot = await collectSnapshot(client);
    }
    const result = auditSnapshot(expected, snapshot);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch {
    // Never expose pg errors: they can contain connection URLs, hosts, or users.
    process.stderr.write('{"ok":false,"format":"erp-schema-rls-audit/v1","error":"read-only schema audit failed"}\n');
    process.exitCode = 2;
  }
}

await main();