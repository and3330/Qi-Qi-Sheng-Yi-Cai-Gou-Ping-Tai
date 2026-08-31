---
name: Product variants invariants
description: Multi-spec (product_variants) stock rules
---
Rule: if a product has any active variant, cart add / order create / inventory adjust MUST specify a matching active variantId (server rejects otherwise). Variant stock decremented on order, restocked on cancel; stock_movements carry nullable variantId. Variant delete blocked when referenced by order items — deactivate instead. Variant stock edits go through inventory adjust only (PATCH ignores stock).
**Why:** UI enforces selection but direct API calls could bypass and desync parent product stock.
**How to apply:** any new stock-touching flow (e.g. purchasing receipt — still NOT variant-aware) must branch on variantId the same way.
