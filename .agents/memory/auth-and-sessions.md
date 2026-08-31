---
name: Identity & schema-evolution decisions
description: Clerk-only identity decision and safe DB schema-evolution guidance for this project
---

# Identity is Clerk-only (decision)

- Members exist only as Clerk identities: a member row is JIT-provisioned on the first authenticated request. There is no username/password auth, no server-side session store, and no email-based auto-linking between accounts.
- **Why:** a parallel legacy auth path was tried and rejected in security review — unverified emails enable account takeover in both directions, and required credential columns broke schema deployability. Clerk-only keeps a single trust anchor.
- **How to apply:** protected endpoints use `requireMember`/`requireAdmin`; never assume a member row exists before the first authenticated request; never link accounts by email match alone. Admin seeding is an explicit promotion (script/SQL by email or Clerk user id), not sign-up logic.

# Schema evolution must stay deployable (rule)

- Only add columns that are nullable or have defaults when a table may already contain rows; keep constraint names matching what drizzle-kit generates so schema sync never needs interactive confirmation (this environment has no TTY for prompts).
- **Why:** a required, default-less unique column made the schema unpushable against any populated database and blocked deployment (review-rejected).
