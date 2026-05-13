---
task: wave-1-vendor-as-agenttools
wave: 1
status: complete
dla_head_sha: 17219c42b0420267302b138bf402930508006e0e
dla_head_date: 2026-05-07
---

# Wave 1 — Vendor DLA's `src/lib/` as Studio-owned pi AgentTools

## Verdict (TL;DR)

**Works with caveats — recommended as the primary integration path, with the unblockers spelled out below.**

DLA's `src/lib/` and `src/adapters/` are technically vendor-able: no Ink/UI imports leak in, the MCP `Server` only appears as a **type-only** import used for an optional `sendLoggingMessage` callback (already coded defensively with `?.`), and the `delegate: true` contract is implemented entirely inside `src/mcp-server.ts` — the underlying library functions know nothing about it, so re-implementing the delegate manifest in Studio's wrappers is straightforward.

However, three concrete blockers must be solved before this lands:

1. **DLA has no build output and no `prepare` script.** `dist/` is gitignored, `package.json` has no `main`/`exports`/`module`, and there is no `prepare`/`prepack` hook to run `tsc` on install. A `github:Automattic/data-liberation-agent#<sha>` dependency would deliver only `.ts` files. Node cannot import them directly, and Studio's `vite.config.base.ts` externalizes anything listed in `apps/cli/package.json` `dependencies` — so Vite will not transpile them either. **Unblocker:** PR upstream a `"prepare": "tsc"` script (or use `tarball` URLs of pre-built artifacts).
2. **Schema duplication.** DLA's tool schemas live inline as plain JSON-Schema objects inside `src/mcp-server.ts:48-234`. They are not exported. Studio's `defineTool` consumes typebox — the schemas have to be re-authored. Drift risk is real but bounded; the surface is small (13 tools).
3. **Output shape duplication.** Several tool responses (`liberate_inspect`, `liberate_extract`, `liberate_setup`/`liberate_import` with `delegate: true`, `liberate_discover`) are assembled inside `src/mcp-server.ts`'s request handler — not inside `src/lib`. Studio's wrappers re-implement that assembly, with the same drift risk.

Once those are addressed, vendoring is meaningfully cheaper than the MCP-bridge path: no IPC, no child process, no `tsx` runtime dependency, no Playwright postinstall surprise (Studio already depends on `playwright@^1.52.0` in `apps/cli/package.json:53`), and direct access to types like `DetectionResult`, `StartPreviewResult`, `VerificationReport`.

Strength of recommendation: **medium-high.** If the upstream `prepare`-script PR is acceptable to DLA's maintainers, vendor-as-AgentTools is the clean answer. If not, the MCP-bridge path (Brief 2) is the fallback.

## 1. `src/lib/` inventory

Module-by-module export catalog with coupling notes, all paths relative to DLA's repo root at SHA `17219c4`.

### `src/lib/extraction/`

| File | Key exports | Touches | Coupling notes |
|---|---|---|---|
| `detect-platform.ts` (193 LOC) | `detect(url): Promise<FullDetectionResult>`, `detectFromUrl`, `detectFromHttp`, `PATH_PROBES` (test-injection only), types `DetectionResult` / `FullDetectionResult` | `fetch()` (10s + 15s timeouts) | **Clean.** Pure function + HTTP fetch. No filesystem, no globals, no MCP types. Safe to vendor as-is. |
| `sitemap.ts` (154 LOC) | `parseSitemapXml`, `classifyUrl(url): UrlType`, `fetchSitemap(baseUrl): Promise<string[]>` | `fetch()` (15s timeout) | **Clean.** Pure functions over strings + HTTP. SSRF-guarded by same-origin check. |
| `extraction-log.ts` (164 LOC) | `class ExtractionLog`, types `ProcessedEntry` / `FailedEntry` / `LogSummary` | `fs.appendFileSync`, `readFileSync`, lockfile via `process.kill(pid, 0)` | **Stateful, filesystem-bound.** Writes `extraction-log.jsonl` and `.liberation-lock` under `outputDir`. The lockfile uses PID-pinning — owned by whichever process holds it. Constructor takes the outputDir; safe to use from a Studio process, but the lock semantics need care if pi runs multiple tool calls concurrently. |
| `import-session.ts` (171 LOC) | `class ImportSession`, types `ImportStage`, `EntityProgress` | `fs` writes under outputDir | Stateful per-extraction. Used only inside adapters' extract paths. Not called from MCP handlers directly. |
| `media.ts` (130 LOC) | `safeFilename`, `resolveMediaPath`, `deriveFilenameFromUrl`, `extensionFromContentType`, `downloadMedia` | `fetch`, `fs.writeFile` | **Clean.** Pure helpers + HTTP fetch + media file write. |
| `media-stubs.ts` (130 LOC) | `class MediaStubStore`, `MediaStatus`, `MediaStub` | `fs` (per-output JSONL) | Stateful per-output dir; same pattern as `ExtractionLog`. |
| `wxr-builder.ts` (791 LOC) | `class WxrBuilder` + ~20 interface exports (`SiteMeta`, `Author`, `Category`, `Tag`, `MediaItem`, `PageItem`, `PostItem`, `MenuItem`, `Redirect`, `Comment`, `Term`, `ValidationResult`, `WxrItem`) | `fs.writeFileSync` (only inside `.serialize()`) | **Clean.** In-memory builder; serializes XML on demand. No MCP/CLI coupling. |
| `wxr-reader.ts` (326 LOC) | `readWxr(path): WxrData`, type `WxrData` | `fs.readFileSync` | **Clean.** Pure XML parser. |
| `content-parser.ts` (~) | `parseContent(html, scopeToContent?)`, type `ContentModel` | cheerio | **Clean.** Pure. Used by qa-runner. |
| `adaptive-tuner.ts` (~) | `class AdaptiveTuner`, `TUNER_DEFAULTS`, types `AdaptiveTunerConfig` / `TunerState` / `TunerDecision` | none | **Clean.** Pure state machine. |
| `shopify-graphql.ts` (277 LOC) | (Shopify-specific helpers, exports unaudited — only used inside the Shopify adapter) | `fetch` against Shopify Admin GraphQL API | Internal to the shopify adapter. Not on the MCP-tool path directly. |

### `src/lib/preview/`

| File | Key exports | Touches | Coupling notes |
|---|---|---|---|
| `playground-server.ts` (342 LOC) | `startPreview(opts): Promise<StartPreviewResult>`, `stopPreview`, `playgroundDir`, `pidFilePath`, `logFilePath`, `blueprintFilePath`, `lockFilePath`, `ensurePlaygroundDir`, `writePidFile`, `readPidFile`, `deletePidFile`, `isPidAlive` | `spawn('npx', ['wp-playground-cli', 'server', ...])`; PID file management; calls `isStudioAvailable()` and falls through to `startStudioPreview()` if `studio` binary is on PATH | **Spawns child processes.** Crucially, when `isStudioAvailable()` is true it shells out to `studio site create`. Embedding DLA inside Studio CLI would cause **recursion** (studio code → DLA → `studio site create`). Studio wrappers should either pass `_noStudio: true` (an internal flag the function exposes, `playground-server.ts:160`) or skip the Studio branch by calling `startStudioPreview` directly with a Studio-side site-orchestration variant. |
| `studio.ts` (377 LOC) | `startStudioPreview(opts)`, `isStudioAvailable`, `makeStudioSiteName`, `toVfsPath`, `stageArtifacts`, `StudioSite` | `execFileSync('studio', ['--version'])`, `execFileAsync('studio', [...])`, `fs.cpSync` / `copyFileSync` / `rmSync`, `process.env.STUDIO_SITES_DIR`, `homedir()` | **Tightly coupled to the `studio` CLI binary on PATH** — the very binary we'd be running inside. Same recursion concern as above. The vendored PHP scripts at `src/lib/preview/scripts/import-wxr.php` and `import-products.php` are resolved via `fileURLToPath(import.meta.url)` (`studio.ts:36-52`) — Studio's Vite bundling must preserve them adjacent to the compiled JS at runtime. |
| `blueprint-builder.ts` (124 LOC) | `buildBlueprint`, `persistBlueprint`, `BlueprintMode`, `Blueprint`, `BlueprintStep`, `VFS_MOUNT_DIR`, `IMPORT_COMPLETE_MARKER`, `BuildBlueprintOpts` | `fs.writeFileSync` | **Clean.** Pure builder + one filesystem write. |
| `media-url-map.ts` (69 LOC) | `buildMediaUrlMap`, `rewriteWxrAttachmentUrls`, `MediaUrlMap` | `fs` reads/writes | **Clean.** Pure with one in-place WXR rewrite. |
| `lockfile.ts` (97 LOC) | `acquireLock(path, opts)`, `LockTimeoutError` | `fs.openSync` (O_EXCL), polling | **Clean.** Self-contained advisory lock. |
| `port-picker.ts` (41 LOC) | `pickFreePort(range)`, `DEFAULT_PORT_RANGE`, `PortRangeExhaustedError` | `net.createServer` | **Clean.** |
| `types.ts` | `PreviewPhase`, `PreviewPidRecord`, `StartPreviewOpts`, `StartPreviewResult`, `StopPreviewResult`, `PreviewSource` | none | Pure types. |
| `boot-spinner.tsx` | (Ink/React component) | Ink, React | **Ink-bound.** This is the only `lib/` file that imports React/Ink — it's referenced exclusively by `src/ui/preview.tsx`. A Studio vendor would not import it. |

### `src/lib/import/`

| File | Key exports | Touches | Coupling notes |
|---|---|---|---|
| `wp-importer.ts` (794 LOC) | `importToWordPress(opts): Promise<ImportResult>`, types `ImportOptions`/`ImportResult` | `fetch` against WP REST | **Clean.** Pure REST-import orchestrator; takes an `onProgress` callback for streaming progress. |
| `wp-rest-client.ts` (212 LOC) | `class WpRestClient`, `WpRestClientOptions` | `fetch` | **Clean.** |
| `resolve-site-url.ts` (45 LOC) | `resolveSiteUrl(site)`, `resolveSiteUrlSync(site)` | `fetch` for redirect probes | **Clean.** |
| `http-client.ts` (95 LOC) | (internal HTTP helpers) | `fetch` | **Clean.** |
| `woo-csv-reader.ts` (114 LOC) | (WooCommerce CSV reader) | `fs` | **Clean.** |
| `woo-product-csv.ts` (304 LOC) | `class WooProductCsvBuilder`, `WooProduct` types | `fs` | **Clean.** |
| `woo-rest-client.ts` (148 LOC) | (WC REST client) | `fetch` | **Clean.** |

### `src/lib/qa/`, `setup/`, `verification/`, `features/`, `probe/`

| File | Key exports | Touches | Coupling notes |
|---|---|---|---|
| `qa/qa-runner.ts` (257 LOC) | `runQa(opts): Promise<QaResult>`, types `QaOptions`/`PageResult`/`QaResult` | `fs` (writes `qa-log.jsonl`), `fetch` (with 429 retry) | **Clean.** Optional `onProgress` callback for streaming. |
| `qa/content-differ.ts` (135 LOC) | `diffContent`, type `ContentDiff` | none | **Clean.** Pure diff. |
| `setup/wp-setup.ts` (128 LOC) | `validateWpConnection(input): Promise<WpSetupReport>`, types `WpSetupInput`/`WpSetupReport` | `fetch` + Basic Auth (10s timeout) | **Clean.** |
| `verification/verify.ts` (116 LOC) | `verifyExtraction(outputDir): Promise<VerificationReport>`, type `VerificationReport` | `fs.readFileSync`, `readdirSync` | **Clean.** Pure post-hoc filesystem scan. |
| `features/detect-features.ts` (156 LOC) | `detectFeatures(platform, urls, ...)`, type `PlatformFeature` | none | **Clean.** Pure URL pattern matcher. |
| `probe/browser-probe.ts` (201 LOC) | `probeBrowser(cdpPort, siteUrl?): Promise<ProbeResult[]>`, type `ProbeResult` | Playwright via `getPlaywright()` from `adapters/shared.ts` | **Clean,** but **requires Playwright** at runtime — see `getPlaywright()` lazy-import in `adapters/shared.ts:108-117`. Studio already depends on `playwright`. |
| `probe/map-apis.ts` (344 LOC) | `mapApis(opts): Promise<ApiMapResult>`, types `ApiEndpoint`/`ApiMapResult` | Playwright | Same. |

### `src/adapters/`

The shape every adapter implements is `PlatformAdapter` from `src/types.ts:5-16`:

```ts
export interface PlatformAdapter {
  id: string;
  detect(url: string): boolean;
  discover(url: string, opts: Record<string, unknown>): Promise<unknown>;
  extract(
    inventory: unknown,
    wxr: WxrBuilder,
    opts: Record<string, unknown>,
    context: { log: ExtractionLog; server: Server }
  ): Promise<unknown>;
  probe?(url: string, urls: string[], opts: Record<string, unknown>): Promise<unknown[]>;
}
```

**Critical: `context.server` is typed as `Server` from `@modelcontextprotocol/sdk/server/index.js`**, but it's used only optionally via `server?.sendLoggingMessage?.(…)` — see `src/adapters/shared.ts:368-374` and `src/adapters/shopify.ts:1028-1031`. Every adapter imports the type, but every call-site protects against undefined. **Vendor implication:** pass either `undefined` or a small shim object `{ sendLoggingMessage: (msg) => …forwardToStudioProgress }`, and the adapters work. The MCP SDK is still on Studio's dep tree (`apps/cli/package.json:33`), so the type import resolves; no shim needed for types.

Adapter sizes: `wix.ts` 1041 LOC, `shopify.ts` 1305 LOC, `squarespace.ts` 817 LOC, `hubspot.ts` 769 LOC, `godaddy-wm.ts` 744 LOC, `weebly.ts` 574 LOC, `hostinger.ts` 532 LOC, `webflow.ts` 337 LOC, `shared.ts` 734 LOC. None import Ink/React or UI-layer code.

## 2. MCP tool → lib mapping

Each of DLA's 13 MCP tools, with the `src/lib` (or `src/adapters`) call(s) that back it and whether response assembly lives in lib or in the MCP handler.

| MCP tool | Library entry points | Response built in lib? | Notes |
|---|---|---|---|
| `liberate_detect` | `detect(url)` from `lib/extraction/detect-platform.ts` | **Yes** (returns `FullDetectionResult`) | One-liner. `src/mcp-server.ts:242-245` is a pass-through. |
| `liberate_discover` | `detect(url)` + `findAdapter(detection.platform).discover(url, opts)` + `detectFeatures(...)` from `lib/features/detect-features.ts` | **No — handler assembles** `{ ...inventory, platformFeatures }` from two calls (`src/mcp-server.ts:247-271`) | Drift risk. |
| `liberate_inspect` | `detect(url)` + `fetchSitemap(url)` + `classifyUrl()` (per-URL count) + `adapter.probe?(url, urls.slice(0,3), opts)` + `detectFeatures(...)` | **No — handler assembles** a 9-field result object in `src/mcp-server.ts:273-311` | Substantial structured assembly; this is the canonical "structured" tool to sketch. |
| `liberate_extract` | `detect` + `adapter.discover` + `new WxrBuilder()` + `readWxr` (on resume) + `adapter.extract(inventory, wxr, opts, {log, server})` + `wxr.serialize()` + `wxr.validate()` + `log.getSummary()` | **No — handler assembles** a multi-section summary (`pagesExtracted`, `postsExtracted`, …, `qualityScores`, `failures`, `wxrValidation`) in `src/mcp-server.ts:313-429` | Plus owns the extraction-log lock around the whole call. Most complex shape; partially feasible to vendor but heavy. |
| `liberate_status` | `new ExtractionLog(outputDir).isLockActive()` + `.getSummary()` | **No — handler assembles** a 7-field status record (`src/mcp-server.ts:553-569`) | Trivial reassembly. |
| `liberate_map_apis` | `mapApis(opts)` from `lib/probe/map-apis.ts` | **Yes** (handler is pass-through, `src/mcp-server.ts:446-455`) | |
| `liberate_probe` | `probeBrowser(cdpPort, url)` from `lib/probe/browser-probe.ts` | **Yes** (pass-through, `src/mcp-server.ts:457-464`) | |
| `liberate_qa` | `runQa({wxrFile, fix, onProgress})` from `lib/qa/qa-runner.ts` | **Yes** (pass-through, `src/mcp-server.ts:431-444`) | Progress callback wires `server.sendLoggingMessage`; for Studio, route to Studio's own progress channel. |
| `liberate_verify` | `verifyExtraction(outputDir)` from `lib/verification/verify.ts` | **Yes** (pass-through, `src/mcp-server.ts:466-470`) | |
| `liberate_setup` | If `delegate`: handler returns a static manifest object. Else: `validateWpConnection({site, username, token})` from `lib/setup/wp-setup.ts` | **No — both branches assembled in handler** (`src/mcp-server.ts:472-496`) | `delegate` shape is fixed text + 3-bullet requirement list; trivial to copy. |
| `liberate_import` | If `delegate`: handler synthesizes `{wxrFile, outputDir, mediaDir, productsCsv, redirectMap, importAuthors}` via `existsSync()` probes. Else: `resolveSiteUrl` + `importToWordPress(opts)` from `lib/import/wp-importer.ts` (+`resolve-site-url.ts`) | **No — both branches assembled in handler** (`src/mcp-server.ts:498-551`) | `delegate` is ~15 lines of `existsSync(...) ? path : null` checks — also trivial to copy. |
| `liberate_preview` | `startPreview(opts)` from `lib/preview/playground-server.ts` + a 30-line `--open` branch that `spawn`s `open`/`xdg-open`/`Studio` app (`src/mcp-server.ts:579-621`) | **Mostly pass-through** but the `--open` browser/Studio-app launch lives in the handler | Studio CLI will likely not want the `Studio.app` auto-launch branch (it IS Studio). Wrapper should hard-skip it. Also: `startPreview` itself prefers `studio site create` if `isStudioAvailable()` (lib/preview/playground-server.ts:160). When Studio CLI calls this, the result is the **studio code agent** invoking the studio CLI as a child process — recursion. The vendor wrapper must thread a `_noStudio: true` flag or call `startStudioPreview` directly via a Studio-owned site-orchestration path that bypasses spawning a sibling `studio` binary. |
| `liberate_preview_stop` | `stopPreview({outputDir})` from `lib/preview/playground-server.ts` | **Yes** (pass-through, `src/mcp-server.ts:625-629`) | |

**Conclusion:** All 13 MCP tools have clean lib entry points. **None** of them live entirely inside the MCP server's request handlers — but **6 of 13** (`liberate_discover`, `liberate_inspect`, `liberate_extract`, `liberate_status`, `liberate_setup`, `liberate_import`) require Studio to re-implement the response-assembly logic, and 1 (`liberate_preview`) carries an environment-bound side-branch (`--open` browser/Studio-app launch + the recursive-`studio` fallback inside `startPreview`).

## 3. Schema reuse strategy

DLA's tool input schemas are inline JSON-Schema objects inside `src/mcp-server.ts:48-234` — plain TypeScript object literals like `{ type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }`. They are not exported. There is no zod, no typebox, no JSON-Schema file on disk.

Studio's `defineTool` (`apps/cli/ai/tools/define-tool.ts:37-56`) expects a typebox `TProperties` object. The schemas have to be transcribed.

**Chosen approach: manual transcription, organized by tool, with one source-of-truth comment per field pointing at the DLA line range.**

```ts
// apps/cli/ai/tools/liberation/liberate-detect.ts
export const liberateDetectTool = defineTool(
  'liberate_detect',
  // Description verbatim from data-liberation src/mcp-server.ts:52
  'Detect the platform of a website (...)',
  {
    url: Type.String({ description: 'The URL of the website to detect' }),
  },
  async ({ url }) => { … }
);
```

**Drift risk: bounded.** 13 tools, ~30 fields total. The brief flagged "drift risk" — I rate it medium-low because (a) the schema shape is small, (b) DLA's schemas have been stable in the last 30 days of commits (one tool added two months ago, no field changes in the last 14 days per the `src/mcp-server.ts` git log), and (c) Studio's wrappers run integration tests that catch tool-call shape mismatches early.

**Rejected alternatives:**

- **Importing schemas from DLA** — they aren't exported. Would need an upstream PR to re-export them; even then, the JSON-Schema→typebox conversion is non-trivial (typebox doesn't accept plain JSON-Schema; you'd parse it at runtime).
- **Re-deriving from TypeScript signatures** — the lib functions take loose `Record<string, unknown>` opts (see `PlatformAdapter.discover`, `extract` signatures in `src/types.ts:5-16`). The MCP tools have tighter, well-described schemas than the lib does. The MCP schema is the source of truth, not the TS signature.

## 4. Output adaptation strategy

DLA's MCP tools return `{content: [{type: 'text', text: JSON.stringify(data, null, 2)}]}` via the `textResult()` helper at `src/mcp-server.ts:32-34` — meaning the actual JSON shape lives in `data`, and the MCP wrapper just stringifies it.

Studio's `defineTool` wraps the user handler in an `execute` that returns `{content: result.content, details: undefined}` (`define-tool.ts:51-54`). The handler must return `{content: [{type: 'text', text: …}]}`. The shape is identical to MCP's — Studio can directly reuse the `textResult` convention.

**For pass-through tools (7 of 13):** Wrappers call the lib function and stringify the result.

```ts
async ({ url }) => textResult( JSON.stringify( await detect( url ), null, 2 ) )
```

**For handler-assembled tools (6 of 13):** Wrappers re-implement the assembly from `src/mcp-server.ts` directly. The drift risk is the same surface as schema drift — comment each block with `// Mirrored from data-liberation/src/mcp-server.ts:273-311 (liberate_inspect handler)`.

**For `delegate: true` modes (`liberate_setup`, `liberate_import`):** These don't even touch DLA's lib — the manifest objects are pure literals in the handler. Studio copies them verbatim. Since `delegate: true` is the canonical Studio integration shape (per `wave-1-dla-inventory.md` risks #8 — `delegate: true` mode is designed for "local dev tools with direct database/CLI access"), Studio will likely **only** support `delegate: true` for setup/import and skip the REST-import branches entirely — Studio has its own site management, its own WP-CLI bridge, and shouldn't import through the source site's REST API.

**Drift risk: same as schema (medium-low).** Mitigation: integration tests that run each Studio wrapper and assert the response shape matches `JSON.parse(await dlaTool.callTool(args))` from a DLA HEAD pinned in a fixture.

## 5. `delegate: true` impact

**No loss in the vendored path.** The `delegate: true` contract is implemented **entirely inside `src/mcp-server.ts`** (lines 472-496 for setup, 498-520 for import). The underlying lib functions (`validateWpConnection`, `importToWordPress`) know nothing about it — `grep delegate src/lib src/adapters` returns no matches. Studio's wrappers re-implement the delegate manifest as 10-20 lines of literal-object construction, with the same `existsSync`-on-known-paths probes the MCP server does today.

**What `delegate: true` is actually doing:** It's a "give me the file paths, don't do the work" mode where DLA returns `{wxrFile, outputDir, mediaDir, productsCsv, redirectMap, importAuthors}` and the host environment (Studio, in our case) handles the import via its own site-management primitives — `studio site create --blueprint …` or `studio wp eval-file …`.

**Sub-agent delegation that the brief mentions ("delegate to a sub-agent"):** I see no evidence of this in DLA's code. `delegate: true` is purely a structured-manifest-return mode, not a sub-agent handoff. The `/migrate` workflow doesn't depend on DLA hosting its own sub-agent — it depends on the **calling agent** (in our case, Studio CLI's pi agent) orchestrating tool calls. Vendoring preserves that exactly because it puts the tools in the agent's `customTools` array.

**Verdict:** `delegate: true` is *easier* in the vendored path than in the MCP bridge path. The structured manifest is one less wire-format hop.

## 6. Maintenance contract risk

### Commit churn (60-day window, `src/lib/` only, measured at SHA `17219c4`)

- **17 commits** touch `src/lib/` in the last 60 days; **1 commit** in the last 14 days (a WP.com auth-fix in `lib/setup/wp-setup.ts`).
- Aggregate churn: **46 file-touches, 3,920 insertions, 151 deletions** in the last 30 days.
- Breakdown by subdir over 60 days: `extraction/` 13 commits, `import/` 4, `preview/` 2, `qa/` 2.
- Most of the bulk came from adapter onboarding (PRs #21, #23, #28 = Hostinger, Weebly, HubSpot, all April), the preview PR (#39, April 18), and the AIMD adaptive tuner (#38, April 16). The repo was created **2026-03-31** (6 weeks old at SHA `17219c4`), so almost all the lib code is brand-new — there's no long-term stability track record.

### Pinning strategy

- **DLA has no tags and no releases** (`gh api repos/Automattic/data-liberation-agent/{tags,releases}` both return `[]`). Pin must be by commit SHA, not by version.
- Recommended `apps/cli/package.json` entry: `"data-liberation": "github:Automattic/data-liberation-agent#17219c42b0420267302b138bf402930508006e0e"` (full SHA). npm 6+ resolves this to a `npm:` git URL with a tarball cached under `~/.npm/_cacache`; the SHA is recorded in `package-lock.json`.
- Lockfile implications: `package-lock.json` will gain a `node_modules/data-liberation` entry with `resolved: "git+ssh://git@github.com/Automattic/data-liberation-agent.git#17219…"` and an `integrity` hash. `npm ci` reproduces deterministically.
- Studio's `apps/cli/scripts/postinstall-npm.mjs` runs at install — should NOT need changes for DLA itself, but DLA's own `postinstall: playwright install chromium` will fire. **This is the second-largest practical concern after the no-build issue:** every `npm install` of Studio CLI will download ~150 MB of Chromium even for users who never run the migration command.
- Mitigation for the playwright download: either (a) PR upstream to gate `postinstall` behind an env var like `DLA_SKIP_PLAYWRIGHT=1`, (b) ship a Studio-owned fork with that gate, or (c) accept the cost.

### Sustainability rating

| Risk | Severity | Notes |
|---|---|---|
| `src/lib/` API breakage | Medium | No public-API contract is documented in `AGENTS.md` beyond "shared scaffolding". But the 17 lib commits over 60 days were mostly *additive* — new adapters, new tuner, new preview — not signature changes. The two function-signature changes I noticed were both additive optional params. Worst-case impact is bounded by Studio's wrapper layer: any breakage surfaces at the wrapper, not deep in user code. |
| Tool-list churn | Medium | 11→13 tools in last 90 days. Studio's wrapper list isn't auto-derived, so new tools require manual wrapper authoring — but never silent breakage. |
| Schema changes | Low | Schemas in `src/mcp-server.ts` have been stable for 14+ days. No deprecations observed. |
| Breaking adapter changes | Low | The `PlatformAdapter` interface in `src/types.ts:5-16` has not changed since the adapter system was introduced (PR #6). |
| DLA project abandonment | Low | Repo is actively developed (29 stars, weekly commits, two recent feature PRs #46 and #50 in flight). |

**Recommendation: track HEAD with SHA pinning, update on cadence (weekly to start, monthly once stable).** Set up a CI job that does `npm update data-liberation` weekly and runs the wrapper integration tests; if green, open a PR auto-bumping the pin. This is much cheaper than bridging via MCP because the wrapper integration tests give you a much tighter feedback loop than MCP wire-format tests would.

## 7. Build-time integration

### Install path

Recommended `apps/cli/package.json` addition:

```json
"dependencies": {
  …,
  "data-liberation": "github:Automattic/data-liberation-agent#17219c42b0420267302b138bf402930508006e0e"
}
```

### Blockers

**Blocker A: DLA has no compiled output and no `prepare` script.** Evidence:

- `dist/` is gitignored (`.gitignore:5`).
- `package.json` has no `main`, no `module`, no `exports`, no `files` whitelist. `bin` points at `./dist/cli.js` which doesn't exist on a fresh clone.
- No `prepare` or `prepack` script in `package.json:9-23`. `postinstall` runs Playwright only.

The `github:Automattic/data-liberation-agent#<sha>` install would deliver the unmodified repo (since no `files` whitelist exists, it ships everything not gitignored). The consumer receives `src/lib/extraction/detect-platform.ts` but no `.js`. Node cannot import `.ts` directly. **Studio's `vite build` cannot transpile it either, because `vite.config.base.ts:79-91` externalizes every entry in `apps/cli/package.json` `dependencies`** — including `data-liberation`. The bundled CLI would crash at runtime with `Cannot find module 'data-liberation/lib/extraction/detect-platform.js'`.

**Three unblock options:**

1. **(Recommended) Upstream a `"prepare": "tsc"` script.** With `"prepare"`, npm runs `tsc` after the dependency tree is installed, so `dist/` is materialized. Also add `"main": "./dist/cli.js"`, `"exports": { "./lib/*": "./dist/lib/*.js", "./adapters/*": "./dist/adapters/*.js" }`, and `"files": ["dist/", "scripts/"]` to publish a clean surface. Risk: requires DLA-maintainer cooperation, but it's a 5-line PR and benefits all three of DLA's integration paths.
2. **Studio runs DLA's build itself.** Studio's `apps/cli/scripts/postinstall-npm.mjs` (referenced at `apps/cli/package.json:71`) already runs custom install logic — it could `cd node_modules/data-liberation && npm install && npx tsc`. Cost: Studio CLI's npm install grows a `tsc` step (Studio doesn't currently depend on TypeScript at runtime — it's devDep-only). Also brittle because DLA's own deps include `typescript@^5.7.0` in devDependencies, which `--omit=dev` install will skip.
3. **Vendor copy.** Drop the `github:` dep and instead `git submodule add` (or `git subtree` import) DLA's `src/lib/` and `src/adapters/` under `apps/cli/vendor/data-liberation/`. Add `vendor` to Vite's `resolve.alias` and let Vite transpile the TS source on Studio's build. **No external dep, no postinstall surprise, no Playwright auto-install.** Cost: vendoring is a one-time copy + per-update manual sync; the SHA-pinning convenience is lost.

**Option 3 is my preferred unblocker** if (1) isn't immediately landable upstream. It plays to Studio's existing build pipeline strengths (Vite already transpiles TS) and sidesteps the Playwright postinstall problem entirely (Studio can lazy-import Playwright only when adapters need it, which they already do via `lib/adapters/shared.ts:108`).

**Blocker B: Recursion in `liberate_preview`.** As noted in section 2: `lib/preview/playground-server.ts:160` calls `isStudioAvailable()` → if the `studio` binary is on PATH, it shells out to `studio site create`. When DLA is embedded inside Studio CLI's `studio code` agent, this means Studio is spawning Studio. The brief is "out of scope" for full implementation, but the wrapper sketch in section 8 must pass `_noStudio: true` or thread a `previewMode: 'studio-in-process' | 'playground'` flag the wrapper sets explicitly.

**Blocker C: Playwright postinstall.** DLA's `postinstall: playwright install chromium` runs on every `npm install`. Studio already depends on `playwright@^1.52.0` (`apps/cli/package.json:53`) so the **JS dep** is shared, but the **Chromium browser binary** is downloaded per-package. Either upstream a `DLA_SKIP_PLAYWRIGHT` env-gate, vendor DLA into the build (option 3 above), or accept the cost.

### Vite transpilation hazards

DLA's TS source is straightforward — no decorators, no top-level await (besides `src/cli.ts:14-15` which is a CLI-only branch), uses dynamic `import()` extensively for lazy loading (e.g. `src/mcp-server.ts:265, 306, 432, 447, 458, 467, 489, 504, 524, 525, 572, 626`). Dynamic imports are well-supported by Vite, but they need the targets to be resolvable in the bundle. Under option 3 (vendor copy), Vite would handle this transparently. Under option 1 (DLA ships `dist/`), Vite externalizes everything so the issue doesn't arise.

### Asset preservation

`lib/preview/studio.ts:36-52` resolves vendored PHP scripts via `fileURLToPath(import.meta.url)` to `lib/preview/scripts/import-wxr.php` and `import-products.php`. **Any bundling strategy must preserve these PHP files alongside the compiled JS.** Under option 3 (vendor copy), Studio's existing `vite.config.base.ts:45-54` `writeBundle` hook can be extended to copy `vendor/data-liberation/lib/preview/scripts/` into `dist/cli/lib/preview/scripts/`. Under option 1, npm installs all files in `data-liberation/dist/` so the assets ship with the package.

### `tsx` runtime requirement

DLA's MCP server and CLI both run via `tsx` (`.mcp.json: ["tsx", "src/mcp-server.ts"]`, `package.json: "mcp": "tsx src/mcp-server.ts"`). **Vendoring sidesteps this entirely** — Studio's wrappers call the lib functions directly via Node's native ESM loader. The only places `tsx` shows up in DLA are the unused MCP-spawn paths and `package.json scripts`. None of these matter for the vendored AgentTool path.

## 8. Concrete sketches

### Simple sketch: `liberate_detect`

```ts
// apps/cli/ai/tools/liberation/liberate-detect.ts
import { Type } from 'typebox';
import { defineTool } from '../define-tool';
import { textResult } from '../utils';
// Vendor copy at apps/cli/vendor/data-liberation/lib/extraction/detect-platform.ts
// (or `data-liberation/dist/lib/extraction/detect-platform.js` if upstream ships dist/)
import { detect } from 'data-liberation/lib/extraction/detect-platform.js';

export const liberateDetectTool = defineTool(
  'liberate_detect',
  // Description verbatim from data-liberation src/mcp-server.ts:52
  'Detect the platform of a website (GoDaddy Websites & Marketing, Hostinger, HubSpot, ' +
    'Shopify, Squarespace, Webflow, Weebly, Wix, or unknown)',
  {
    url: Type.String( { description: 'The URL of the website to detect' } ),
  },
  async ( { url } ) => {
    const result = await detect( url );
    return textResult( JSON.stringify( result, null, 2 ) );
  }
);
```

That's the whole tool. 11 lines including the schema. The `detect()` function takes one string and returns `FullDetectionResult` — there's nothing Studio-specific to inject.

### Structured sketch: `liberate_inspect`

Mirrors `src/mcp-server.ts:273-311`:

```ts
// apps/cli/ai/tools/liberation/liberate-inspect.ts
import { Type } from 'typebox';
import { defineTool } from '../define-tool';
import { textResult } from '../utils';
import { detect } from 'data-liberation/lib/extraction/detect-platform.js';
import { fetchSitemap, classifyUrl } from 'data-liberation/lib/extraction/sitemap.js';
import { detectFeatures } from 'data-liberation/lib/features/detect-features.js';
// Static adapter import (alphabetical, matches src/mcp-server.ts:17-26)
import { godaddyWmAdapter } from 'data-liberation/adapters/godaddy-wm.js';
import { hostingerAdapter } from 'data-liberation/adapters/hostinger.js';
import { hubspotAdapter }    from 'data-liberation/adapters/hubspot.js';
import { shopifyAdapter }    from 'data-liberation/adapters/shopify.js';
import { squarespaceAdapter} from 'data-liberation/adapters/squarespace.js';
import { webflowAdapter }    from 'data-liberation/adapters/webflow.js';
import { weeblyAdapter }     from 'data-liberation/adapters/weebly.js';
import { wixAdapter }        from 'data-liberation/adapters/wix.js';
import type { PlatformAdapter } from 'data-liberation/types.js';

const ADAPTERS: PlatformAdapter[] = [
  godaddyWmAdapter, hostingerAdapter, hubspotAdapter, shopifyAdapter,
  squarespaceAdapter, webflowAdapter, weeblyAdapter, wixAdapter,
];

function findAdapter( platform: string ): PlatformAdapter | null {
  return ADAPTERS.find( ( a ) => a.id === platform ) ?? null;
}

export const liberateInspectTool = defineTool(
  'liberate_inspect',
  // Description verbatim from data-liberation src/mcp-server.ts:77
  'Probe a site to assess extractability: detect platform, check sitemap, probe sample pages',
  {
    url:     Type.String( { description: 'The URL of the website to inspect' } ),
    token:   Type.Optional( Type.String( { description: 'API token if needed' } ) ),
    cdpPort: Type.Optional( Type.Number( { description: 'CDP port for browser-based inspection' } ) ),
  },
  async ( { url, token, cdpPort } ) => {
    // Mirrored from data-liberation/src/mcp-server.ts:273-311 (liberate_inspect handler).
    // Keep this assembly in lock-step with upstream — see CONTRIBUTING.md.
    const detection = await detect( url );
    const result: Record< string, unknown > = {
      url,
      platform:               detection.platform,
      confidence:             detection.confidence,
      signals:                detection.signals,
      sitemapFound:           false,
      urlCount:               0,
      counts:                 {} as Record< string, number >,
      probeResults:           [] as unknown[],
      authRequired:           false,
      extractionFeasibility:  detection.platform === 'unknown' ? 'limited' : 'ready',
    };

    const urls = await fetchSitemap( url );
    result.sitemapFound = urls.length > 0;
    result.urlCount     = urls.length;

    const counts: Record< string, number > = {};
    for ( const u of urls ) {
      const type = classifyUrl( u );
      counts[ type ] = ( counts[ type ] || 0 ) + 1;
    }
    result.counts = counts;

    const adapter = findAdapter( detection.platform );
    if ( adapter && typeof adapter.probe === 'function' ) {
      result.probeResults = await adapter.probe( url, urls.slice( 0, 3 ), { token, cdpPort } );
    }

    const featureUrls = urls.length > 0 ? urls : [ url ];
    result.platformFeatures = detectFeatures( detection.platform, featureUrls, [] );

    return textResult( JSON.stringify( result, null, 2 ) );
  }
);
```

Both tools register through Studio's existing registry:

```ts
// apps/cli/ai/tools/liberation/index.ts
import { liberateDetectTool }  from './liberate-detect';
import { liberateInspectTool } from './liberate-inspect';
// …etc. for the other 11 tools

export const liberationToolDefinitions = [
  liberateDetectTool,
  liberateInspectTool,
  // …
];
```

```ts
// apps/cli/ai/tools/index.ts (edit existing file)
import { liberationToolDefinitions } from './liberation';

export const studioToolDefinitions = [
  // … existing 25 tools …
  ...liberationToolDefinitions,
];
```

### Slash-command + skill registration

```ts
// tools/common/ai/slash-commands.ts (edit existing array)
export const AI_SKILL_COMMANDS: SkillSlashCommand[] = [
  { name: 'annotate',       description: __( 'Annotate site elements visually in a browser' ) },
  { name: 'taxonomist',     description: __( 'Optimize category taxonomy with AI' ) },
  { name: 'need-for-speed', description: __( 'Run a performance audit on a site' ) },
  { name: 'rank-me-up',     description: __( 'Run an on-page SEO audit on a site' ) },
  // New entry
  { name: 'migrate',        description: __( 'Migrate a site from a closed web platform to WordPress' ) },
];
```

Then drop a wrapper-skill at `apps/cli/ai/skills/migrate/SKILL.md` (content reused as-is from `prior-art/rsm-3139-spec.md` — runtime-agnostic).

### Permission gating

pi has no `canUseTool` hook (per the research-plan context), so per-tool permission buckets land **inside** the wrapper's `handler`. The vendored path makes this slightly cleaner than the bridge path because the policy and the call are in the same file:

```ts
async ( { url } ) => {
  await requirePermission( 'liberate.network.read' ); // throws if unauthorized
  const result = await detect( url );
  return textResult( JSON.stringify( result, null, 2 ) );
}
```

Concrete permission-bucket content comes from `prior-art/rsm-3139-spec.md` and is **runtime-agnostic** per the research plan — Studio's `requirePermission` helper lives wherever the existing tools (like `runWpCliTool`) put their gating. Vendoring doesn't make this materially better or worse than the bridge — it just moves the same gating code from a generic MCP-wrapper to a tool-specific wrapper.

## 9. Verdict

**Works with caveats. Recommendation strength: medium-high.**

| Dimension | Assessment |
|---|---|
| Library-as-API self-containment | **Strong.** No Ink/UI leaks, no cwd dependence, MCP `Server` is type-only + optional at runtime, all 13 MCP tools have clean lib entry points. |
| Tool surface coverage | **Complete.** 13/13 tools have lib paths; 7 pass-through, 6 require ~15-50 lines of handler-mirroring code each. |
| Schema / output drift risk | **Medium-low.** Small surface (13 tools, ~30 fields), bounded by integration tests, the schemas have been stable for two weeks. |
| `delegate: true` preservation | **Better than bridge.** Pure literal-object construction in Studio's wrappers; no wire-format hop. |
| Maintenance contract | **Medium.** 17 lib commits in 60 days, but the trend is decelerating (1 commit in the last 14 days). Recommend SHA-pinning + weekly auto-update CI. |
| **Build-time integration** | **The blocker.** DLA ships no `dist/`, has no `prepare` script, no `exports` map, no `main`. Either (a) upstream a `prepare: tsc` + `exports` PR — easiest, requires maintainer cooperation; or (b) vendor DLA's source into `apps/cli/vendor/` and let Vite transpile it — Studio-owned, no upstream dependency, no Playwright postinstall surprise. Recommend (b) as the immediate-path. |
| Recursion in `liberate_preview` | **Caveat.** Studio wrappers must force the Playground branch or call `startStudioPreview` via a Studio-side site-orchestration path that doesn't shell out to a sibling `studio` binary. |
| Playwright postinstall | **Caveat.** ~150 MB Chromium download per Studio CLI install if DLA is a `github:` dep. Vendoring sidesteps this; otherwise mitigate via upstream env-gate or accept the cost. |

**Versus the MCP-bridge path (Brief 2):** Vendoring trades runtime simplicity (no child-process lifecycle, no `tsx` dep, no stdio parsing) for build-time integration work (the `prepare`-script blocker, the schema/output transcription). Once the build path is sorted, vendoring is the lighter ongoing path — schemas drift once per upstream change, vs. every tool-call paying the bridge tax forever.

**If DLA's maintainers will not accept a `prepare`-script PR within RSM-3143's timeline:** flip to **vendor-via-submodule** (option 3 in section 7). Studio owns the source. Updates become a manual sync — but that's a once-a-week, 10-minute task at DLA's current churn rate. The wrapper code (the actual surface Studio cares about) stays identical between vendor-via-`github:` and vendor-via-submodule.

## Sources

### DLA repo (cloned to `/tmp/dla-rsm-3143`, HEAD `17219c42b0420267302b138bf402930508006e0e`, dated 2026-05-07)

- `src/mcp-server.ts` (652 LOC) — full read.
- `src/cli.ts` (176 LOC) — full read.
- `src/types.ts` — full read.
- `src/lib/extraction/detect-platform.ts` (193 LOC) — full read.
- `src/lib/extraction/sitemap.ts` (154 LOC) — full read.
- `src/lib/extraction/extraction-log.ts` (164 LOC) — full read.
- `src/lib/extraction/wxr-builder.ts` (791 LOC) — exports surveyed.
- `src/lib/extraction/{adaptive-tuner,content-parser,import-session,media,media-stubs,shopify-graphql,wxr-reader}.ts` — exports surveyed.
- `src/lib/features/detect-features.ts` — exports surveyed.
- `src/lib/preview/{playground-server,studio,blueprint-builder,media-url-map,lockfile,port-picker,types}.ts` — exports + key functions read.
- `src/lib/preview/studio.ts` (377 LOC) — full read for recursion-into-Studio analysis.
- `src/lib/preview/playground-server.ts` (342 LOC) — top + `startPreview` body read.
- `src/lib/qa/{qa-runner,content-differ}.ts` — exports + qa-runner top read.
- `src/lib/setup/wp-setup.ts` (128 LOC) — full read.
- `src/lib/verification/verify.ts` (116 LOC) — full read.
- `src/lib/probe/{browser-probe,map-apis}.ts` — exports + browser-probe top read.
- `src/lib/import/{wp-importer,wp-rest-client,resolve-site-url,http-client,woo-csv-reader,woo-product-csv,woo-rest-client}.ts` — exports surveyed.
- `src/adapters/{shared,wix,squarespace,shopify,hubspot,hostinger,webflow,weebly,godaddy-wm}.ts` — `Server` import + `sendLoggingMessage` usage greps; `shared.ts` top + `sendLog` helper read.
- `package.json`, `tsconfig.json`, `.gitignore`, `AGENTS.md` — full reads.
- `git log --since="60 days ago" -- src/lib/`, `git log --since="30 days ago" --shortstat -- src/lib/`, `git log --since="14 days ago" -- src/lib/` — churn analysis.

### Studio CLI repo (worktree at `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3143-dla-pi-research/`)

- `apps/cli/package.json` — dep list + scripts.
- `apps/cli/vite.config.base.ts` (118 LOC), `vite.config.npm.ts` — externalization rules.
- `apps/cli/ai/tools/define-tool.ts` (56 LOC) — `defineTool`/`StudioAgentTool` shape.
- `apps/cli/ai/tools/index.ts` (96 LOC) — tool registry.
- `apps/cli/ai/tools/site-info.ts`, `apps/cli/ai/tools/utils.ts` — patterns for a typical AgentTool.
- `apps/cli/ai/mcp-server.ts` (~58 LOC) — Studio's outbound MCP server (for reference; not relevant to vendor path).
- `apps/cli/ai/runtimes/pi/index.ts:260-285` — `createAgentSession` call site showing `customTools` wiring.
- `apps/cli/ai/slash-commands.ts:541` — `...AI_SKILL_COMMANDS` registration.
- `tools/common/ai/slash-commands.ts` (17 LOC) — `AI_SKILL_COMMANDS` registry, the slash-command extension seam.

### Prior art

- `issues/rsm-3143-dla-pi-research/tasks/wave-1-vendor-as-agenttools.md` — task brief.
- `issues/rsm-3143-dla-pi-research/research-plan.md` — research framing.
- `issues/rsm-3143-dla-pi-research/prior-art/wave-1-findings/wave-1-dla-inventory.md` — DLA surface inventory.
