// 產生「後台功能清單」給 AI 助理與 Bot 的通用工具用。
// 來源：lib/api-spec/openapi.yaml（有欄位說明）＋ artifacts/api-server/src/routes 裡實際註冊的 /admin 路由。
// 後台 API 有增減時重跑：node scripts/build-admin-api-catalog.mjs
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadYaml() {
  const pnpm = path.join(root, "node_modules", ".pnpm");
  const dir = readdirSync(pnpm).filter((d) => /^yaml@\d/.test(d)).sort().pop();
  if (!dir) throw new Error("找不到 yaml 套件，請先 pnpm install");
  return createRequire(import.meta.url)(path.join(pnpm, dir, "node_modules", "yaml"));
}
const YAML = loadYaml();
const spec = YAML.parse(readFileSync(path.join(root, "lib/api-spec/openapi.yaml"), "utf8"));

const deref = (node, depth = 0, seen = new Set()) => {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => deref(n, depth, seen));
  if (node.$ref) {
    const name = node.$ref.split("/").pop();
    if (seen.has(name) || depth > 4) return { type: "object", description: name };
    return deref(spec.components?.schemas?.[name], depth + 1, new Set([...seen, name]));
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "example" || k === "examples" || k === "x-orval") continue;
    out[k] = deref(v, depth, seen);
  }
  return out;
};

const norm = (p) => p.replace(/\{[^}]+\}/g, ":id").replace(/:[A-Za-z_]+/g, ":id");
const entries = new Map();
for (const [p, ops] of Object.entries(spec.paths ?? {})) {
  if (!p.startsWith("/admin") && !p.startsWith("/newsletter")) continue;
  for (const [method, op] of Object.entries(ops)) {
    if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
    const body = op.requestBody?.content?.["application/json"]?.schema;
    entries.set(`${method.toUpperCase()} ${norm(p)}`, {
      method: method.toUpperCase(),
      path: p.replace(/\{([^}]+)\}/g, ":$1"),
      summary: op.summary || op.description || "",
      tag: (op.tags ?? [])[0] ?? "",
      ...(op.parameters?.length ? { parameters: op.parameters.map((x) => deref(x)).map((x) => ({ name: x.name, in: x.in, required: !!x.required, type: x.schema?.type, enum: x.schema?.enum, description: x.description })) } : {}),
      ...(body ? { body: deref(body) } : {}),
    });
  }
}
// 規格書沒寫到、但程式裡實際有的後台路由也列進來（沒有欄位說明）
const routesDir = path.join(root, "artifacts/api-server/src/routes");
for (const file of readdirSync(routesDir).filter((f) => f.endsWith(".ts") && !f.includes(".test."))) {
  const src = readFileSync(path.join(routesDir, file), "utf8");
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*["'`](\/(?:admin|newsletter)[^"'`]*)["'`]/g)) {
    const key = `${m[1].toUpperCase()} ${norm(m[2])}`;
    if (!entries.has(key)) entries.set(key, { method: m[1].toUpperCase(), path: m[2], summary: "", tag: "" });
  }
}
const list = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
const out = path.join(root, "artifacts/api-server/src/lib/adminApiCatalog.generated.ts");
writeFileSync(out, `// 由 scripts/build-admin-api-catalog.mjs 產生，請勿手改。
export interface AdminEndpoint {
  method: string; path: string; summary: string; tag: string;
  parameters?: Array<{ name: string; in: string; required: boolean; type?: unknown; enum?: unknown; description?: string }>;
  body?: unknown;
}
export const ADMIN_API_CATALOG = ${JSON.stringify(list, null, 1)} as unknown as AdminEndpoint[];
`);
console.log(`admin api catalog: ${list.length} endpoints → ${path.relative(root, out)}${existsSync(out) ? "" : " (failed)"}`);
