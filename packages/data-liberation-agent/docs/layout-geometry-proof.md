# Layout Geometry Proof Producer

Browser capture emits the optional `data-liberation/layout-geometry-proof/v1` sidecar. It is source evidence for a measured wrapper reduction.

Each route records bounded desktop and mobile `default` observations in `layout-geometry/<slug>.<viewport>.json`. The sidecars contain temporary identities, source and simulated boxes, and computed display, position, visibility, and child-count facts. Identities survive capture normalization only; export resolves them to the final structural selectors and removes every `data-dla-geometry-id` marker before materializing website HTML.

Export resolves identities against the normalized route DOM, verifies each resulting selector against the exact marker-free website bytes, derives SHA-256 source hashes and deterministic node IDs, and includes only reductions that preserve the wrapper and target boxes within one pixel at every recorded viewport. Explicit semantic and retained-runtime checks preserve landmark, ARIA, form, navigation, interactive, and script-referenced wrappers while inert generated attributes remain eligible. Missing, stale, and malformed observations are omitted. `layout-geometry-report.json` records accepted reductions plus capture omissions.
