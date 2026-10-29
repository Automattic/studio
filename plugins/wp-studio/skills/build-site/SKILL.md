---
name: build-site
description: Build a whole local WordPress site. Use the local engine through the current harness when available, then preview in Studio. This branch includes an experimental operation adapter.
---

# Build a site

1. Preserve the brief's facts, art direction, pages, and functionality. Ask only
   for information needed to proceed.
2. For a new site, if the engine at `SITE_BUILD_HOME` or
   `../site-builder-engine` (relative to the Studio checkout) exists, use
   [the operation adapter](references/build-operation.md). It owns capability
   checks, early Studio preparation, polling, image bookkeeping, import,
   automated checks, publishing, and timing receipts. Use this session's harness.
3. Generate only claimed image commissions with the session's image tool, or
   Studio's image fallback. Preserve their full prompts and options.
4. Load feature guidance only for requested features outside the engine, a
   reported failure, or visual review. Reuse unchanged guidance already loaded.
   Do not repeat the manual design questionnaire alongside an engine build.
5. Report the local URL and concrete missing requirements. Publish only when
   requested to an explicit destination. A named destination need not be asked
   for again. Include the destination in the request so the adapter owns the
   complete workflow and preserves its visibility. Request private visibility
   only when the user asks for it; the adapter must confirm it before transfer.
6. Stop after required checks pass. Do not collect duplicate receipts, replay a
   failed build, or substitute providers and billing modes.

Existing-site changes retain Studio's existing-content workflow; the new-site
prototype must not replace their content.

Without a local engine, call `studio_instructions`, then call it with
`skill: "build-site"` and follow that workflow. If those tools are missing,
report the unavailable capability.
