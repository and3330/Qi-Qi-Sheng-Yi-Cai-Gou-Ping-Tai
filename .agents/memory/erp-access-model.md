---
name: ERP access model
description: How ERP (/erp artifact) authorization works on top of the shared shop session
---

- ERP shares the shop's express-session; no separate login. Effective ERP role = member's erp_role if set, else platform admin ⇒ super_admin, else null (blocked).
- **Why:** SSO with existing shop accounts was mandated; platform admins must get in without extra setup.
- **How to apply:** menu permissions are enforced on BOTH sides with identical rules — server middleware resolves per-menu allowed roles (override row wins over defaults; empty roles array = explicit "all ERP roles"; super_admin always passes) and the ERP sidebar/RoleGate uses the same logic. New ERP module endpoints must be gated by the menu-permission resolver for their page path, never by frontend hiding alone. Keep the server menu-defaults map in sync with the ERP nav config.
