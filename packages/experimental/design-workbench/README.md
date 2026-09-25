# Experimental Design Workbench

Formal experimental Host/Client boundary for the durable Design Workbench. The Host owns the `design_workbench` storage domain, revision-checked Remote mutations, and reconnect-safe baseline/increment feed. The Client mirrors only Host-authoritative state and contributes a shell-owned sidebar entry plus one keyed root `main` panel.

The Phase 0 contract-spike package remains a separate historical proof and is not a runtime dependency or a second authority in production composition.

## Model Experience

- **System prompt:** none.
- **Tools:** none in Phase 1.
- **Tokens:** no model-visible content.
- **KV cache:** no effect.

## Known Limitations and Deferred Work

Phase 1 intentionally omits chat creation handoff, toolviews, linked-Agent feedback controls, DecisionPack generation, preview rendering, browser URL routing, and production visual polish. The current Client remembers only in-page selected-task navigation; durable business state always comes from the Host and reconnect replaces the complete baseline. Cross-build handling for unknown custom Session events remains outside this package.
