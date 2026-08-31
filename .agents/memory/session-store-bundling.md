---
name: Session store vs esbuild bundling
description: connect-pg-simple createTableIfMissing breaks in bundled servers
---

Rule: never enable connect-pg-simple's `createTableIfMissing` in the api-server — manage the `session` table via the drizzle schema (`lib/db/src/schema/sessions.ts`) instead.

**Why:** the api-server dev workflow bundles with esbuild; connect-pg-simple reads `table.sql` relative to its module at runtime, which doesn't exist in `dist/`, so every session write fails silently (login returns 200 but /api/me stays 401, no rows in `session` table).

**How to apply:** any new session-backed service in this monorepo should keep `createTableIfMissing: false` and rely on drizzle push for the table.
