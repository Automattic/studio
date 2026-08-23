# Layout Geometry Proof Producer

Browser capture can emit the optional `blocks-engine/php-transformer/layout-geometry-proof/v1` artifact field. The field is producer-neutral evidence for a measured wrapper reduction; it does not require a Blocks Engine capture adapter.

Each route records bounded desktop and mobile `default` observations in `layout-geometry/<slug>.<viewport>.json`. The sidecars contain stable structural selectors, source and simulated boxes, and computed display, position, visibility, and child-count facts. Temporary `data-dla-geometry-id` markers correlate the live DOM only and are removed before captured HTML is serialized.

Export re-binds observations to the final route HTML, derives SHA-256 source hashes and deterministic node IDs, and includes only reductions that preserve the wrapper and target boxes within one pixel at every recorded viewport. Missing, stale, malformed, unsafe, and over-limit observations are omitted. `layout-geometry-report.json` records accepted reductions and omission counts, and the report is included in the artifact `reports` list.
