// Orval regenerates lib/erp-api-zod/src/index.ts with an ambiguous double re-export
// (zod consts in generated/api and same-named TS types in generated/types),
// which breaks declaration emit (TS2308). Keep only the zod const exports.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(dir, "..", "erp-api-zod", "src", "index.ts");
writeFileSync(indexPath, 'export * from "./generated/api";\n');
console.log("fixed", indexPath);
