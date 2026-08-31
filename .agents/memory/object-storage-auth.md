---
name: Object storage private reads
description: Auth pattern for serving private shipment photos
---
Rule: GET /storage/objects/* requires login; staff (admin/ops/support) may read all; members only paths contained in their own orders' shipmentPhotos (jsonb `@>` containment).
**Why:** architect review flagged unauthenticated private-object disclosure; template ships with ACL commented out.
**How to apply:** any new private-object use case must add its own ownership predicate; never rely on path secrecy. Upload response keys are uploadURL/objectPath (capital URL).
