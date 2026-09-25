# Design Workbench Contract Spike

Private Phase 0 package that proves the durable seams required before a Design Workbench UI may be built: a revisioned `DesignSession` storage domain, a durable source-Session change event, idempotent outbox delivery, and a Conversation projection.

This package is deliberately not a product plugin. It registers no sidebar or `main` UI, exposes no model tool, and is not composed into a shipped profile.

## Model Experience

- **System prompt:** none.
- **Tools:** none.
- **Tokens:** no model-visible content by itself.
- **KV cache:** no effect by itself.

## Known Limitations and Deferred Work

The package proves contracts only. Remote CRUD, browser state, task-scoped feedback UI, source-chat cards, design-session lifecycle, artifact storage, and production composition remain deferred until the Phase 0 tests pass and receive review.
