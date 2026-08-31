---
name: DB constraint error handling
description: How to surface Postgres unique-constraint violations as friendly API errors in this stack
---

Rule: race-sensitive invariants (e.g. "one active row per key") must be enforced with a Postgres partial unique index, not just an app-level pre-check; translate the violation to a 400 with a friendly message.

**Why:** app-level checks read outside the insert/update transaction, so two concurrent requests can both pass the check and violate the invariant. Also, drizzle wraps the pg error — `code: "23505"` and `constraint` may live on `err.cause`, so the detector must walk the `cause` chain or the API returns 500 instead of 400.

**How to apply:** add `uniqueIndex(...).where(sql\`...\`)` in the drizzle schema (and apply DDL to dev DB via a pg script), keep the pre-check for the common-case friendly error, and catch 23505 by constraint name recursively through `cause`.
