---
name: Dev DB schema sync pitfalls
description: drizzle-kit push blocks on TTY prompts; dev DB can lag schema files; deps must be declared in package.json
---

- **drizzle-kit push is interactive here**: it can prompt about table/column renames and hang in non-TTY shells. **How to apply:** apply additive DDL via a small `pg` node script (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`) instead of push.
- **Dev DB can lag behind schema files**: columns/tables that git history says exist may be missing in the current environment's dev DB, and legacy NOT NULL columns may linger. **How to apply:** before debugging 500s, diff information_schema against `lib/db/src/schema/*`; prefer dropping NOT NULL on legacy columns over deleting them.
- **Undeclared deps get pruned**: packages that exist only in pnpm-lock but not in a package.json get removed by any `pnpm install`, silently breaking the app. **How to apply:** always declare installs in the package's package.json.
