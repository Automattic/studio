# Build operation experiment

Question: can the plugin replace routine agent orchestration with one tracked
operation while keeping the current harness, image tools, and Studio CLI?

Use Node 24, then prepare this source checkout:

```sh
git switch try-build-orchestration
npm ci
npm run cli:build
export SITE_BUILD_HOME=/absolute/path/to/site-builder-engine
```

The engine checkout must provide the capabilities listed below. Confirm them
with `php "$SITE_BUILD_HOME/bin/build.php" --protocol`. This experiment does not
install itself into an agent's plugin cache; run the source adapter directly.
Copy the request example from the linked reference into your own request JSON,
select your current harness, and use a fresh absolute operation directory:

```sh
npm run prototype:build -- run /absolute/fresh-operation /absolute/request.json
npm run prototype:build -- status /absolute/fresh-operation
```

The request and callback commands are documented in
[the build skill reference](skills/build-site/references/build-operation.md).
The build skill routes to this adapter on this experimental branch; it does not
load the full manual Studio build workflow as well.

The complete build adapter requires site-builder-engine at runtime. The trial
uses engine `feature/studio` commit `5c833666`, which supplies `studio-prepare`
and `harness-images`; those capabilities are absent from the local engine trunk
checked for this experiment. The adapter code is in Studio, but deployment of
the complete build flow therefore has a cross-repository dependency. The CLI's
publication workflow and privacy safeguards run independently of the engine.

The operation owns preflight, subscription transport selection, one engine run,
concurrent Studio preparation, image claim/delivery bookkeeping, final import,
page rendering checks, desktop/mobile screenshots in light/dark, and timings.
An optional publication request continues through destination preflight, the
existing CLI push, export-setting restoration, and remote content/media/access
verification. The adapter exposes phases and returns success only after checks.
The calling agent handles creative judgment and commissioned image generation.
It must inspect screenshots before claiming visual acceptance.

State is deliberately persisted here because status and image callbacks run
in separate processes. One foreground run writes status atomically. Image
claims and deliveries use exclusive creation; the engine still owns budgets.
The operation does not edit Studio config directly.

This is source-checkout prototype code. It is not installed into the active
plugin cache, integrated into MCP, or a production background service.
Partial-engine resumption is not automated. Publication receipts bind the source,
operation, destination and requested visibility. An uncertain transfer permits
verification without replay; an explicitly requested republish creates a new
receipt only after the previous publication was verified. The CLI restores local
visibility and Coming Soon options immediately after export, before upload.
The complete staged access settings are read back before export. Recovery
cleanup uses the same source-site operation lock as export. Existing remote visibility
must match again after transfer, including an anonymous browser check.
Private publication must be confirmed before import, but that path has no live
trial evidence yet. Plugin version deduplication remains separate work.

Validation:

```sh
npm test -- scripts/build-operation.test.mjs apps/cli/lib/tests/publish-operation.test.ts apps/cli/lib/tests/publish-services.test.ts apps/cli/commands/tests/sync-tracks.test.ts
```

The tests exercise overlap and failure boundaries using controlled command
drivers. A real-engine smoke run is recorded separately, when available.
The existing Studio Code routing eval targets the internal agent workflow;
it does not certify that an external harness followed this plugin skill.

Technical smoke trial: generation, one harness image callback, Studio import,
page rendering, and desktop/mobile light/dark screenshots completed in 127.676s
at http://localhost:8887/. The adapter prepared Studio during generation.
All 68 targeted tests and ESLint passed. Independent review covered receipt
identity, replay races, cancellation, recovery and visibility metadata; fixes
have regression tests. The existing live upload also passed the adapter's
verify-only checks: two page hashes, one image, and anonymous Coming Soon.

Full typecheck is not clean: unchanged code has missing archiver declarations
and test typing errors; borrowed workspace dependencies also produce portable
type errors. The npm-based agent eval could not fetch promptfoo through the
configured proxy. See [the validation receipt](build-operation-validation.json).
The generated trial retains WordPress's Sample Page. The validation receipt
records the measured republish separately from the first manual publishing run.

The measured republish completed transfer in 223.923s (previous wrapper:
230.257s). The adapter returned failure after 232.464s because its anonymous
check detected visible homepage content despite cached Coming Soon metadata.
This is not a successful end-to-end speed benchmark. Manual dashboard recovery
set the site Private and fresh anonymous requests confirmed the homepage was
blocked. The trial's access barrier required manual recovery, so this run does
not demonstrate automatic recovery or a successful publishing speedup.

The corrected code stages both Coming Soon flags alongside `blog_public`, reads
them back before export, restores original or absent local options, and clears
previous success on a failed subsequent attempt. Independent review passed the
delta; its corrected live publishing trial remains pending.

Additional privacy guards check actual anonymous access during planning and
immediately before transfer. They check every published permalink in an isolated
browser context with a fresh request. Known WordPress.com access-denied document
structures are required; ordinary page copy such as "Coming Soon" is insufficient.
Unknown or customized barrier templates fail closed. Loaded generated media and
exposed content also fail the check, and screenshots are retained on failure.

The local production-export proof confirmed that the SQL archive contains
`blog_public=0`, `wpcom_coming_soon=0`, and `wpcom_public_coming_soon=1`, and that
the original local settings are restored afterward. It made no remote requests.
The stricter read-only preflight also passed against the existing Private
staging site. A corrected remote transfer has not been run.

User evaluation remains pending. Delete the prototype or absorb the validated
operation contract after that trial.
