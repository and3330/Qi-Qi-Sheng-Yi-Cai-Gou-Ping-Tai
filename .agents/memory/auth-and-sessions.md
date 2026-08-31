---
name: Auth architecture & schema-evolution decisions
description: Session-based username/password auth is the current decision; Clerk was fully removed. Plus safe DB schema-evolution guidance.
---

# Auth is session-based username/password (current decision)

- Members register/login with their own 帳號/密碼 (bcryptjs + express-session + connect-pg-simple; "session" table managed in the drizzle schema). Clerk was completely removed at the user's explicit request. LINE/Google are reserved future *bindings* (`lineUserId`/`googleUserId` columns), not identities.
- Member tier (hospital/clinic/consumer) is assigned at registration via dedicated sign-up links (`/sign-up?type=hospital|clinic`); the user accepted the risk of link leakage and cancelled the invite-code follow-up task.
- **Why:** the user rejected third-party-hosted auth and wants everyone to set their own account/password.
- **How to apply:** never reintroduce Clerk code, deps, or `clerkUserId` columns. Login must reject `isActive=false` accounts before creating a session. `requireMember` loads from `session.memberId`; `requireAdmin` additionally checks `role === "admin"`. Admin promotion via promote-admin script (username or email).

# Task-agent merges can revert recent architecture changes

- A task agent branched before the Clerk→session-auth migration; its merge silently restored Clerk (schema, middleware, pages, deps) and deleted the session auth. Repair required restoring pre-merge files and re-integrating the new module on top.
- **How to apply:** after any task merge, diff the merge commit against the pre-merge commit in areas recently changed on main (esp. auth, schema, openapi). If the task branched before a big main-branch change, expect stomps and reconcile manually before pushing schema.

# Schema evolution must stay deployable (rule)

- Only add columns that are nullable or have defaults when a table may already contain rows; keep constraint names matching what drizzle-kit generates so schema sync never needs interactive confirmation (this environment has no TTY for prompts).
- **Why:** a required, default-less unique column made the schema unpushable against any populated database and blocked deployment (review-rejected).
