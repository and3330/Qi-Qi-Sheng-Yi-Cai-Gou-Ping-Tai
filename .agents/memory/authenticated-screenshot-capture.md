---
name: Authenticated screenshot capture
description: Constraint and planning rule for decks that require many authenticated application screenshots.
---

Testing-browser screenshots returned as evidence IDs cannot be copied directly into workspace assets, while standard app-preview screenshots start without the tester's authenticated session.

**Why:** A large screenshot deck reached layout/export only to reveal that the shell browser could not capture reliably in this environment and app-preview captures were redirected to sign-in.

**How to apply:** Before building a bulk screenshot deck, prove one authenticated screenshot can be saved as a real workspace image and reused by the deck. Do not batch or label captures as final until that round trip succeeds.