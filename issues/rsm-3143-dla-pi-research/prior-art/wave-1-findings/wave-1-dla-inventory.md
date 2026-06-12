---
task: wave-1-dla-inventory
wave: 1
status: complete
---

# Wave 1 — DLA Inventory

## 1. Elevator pitch

**`Automattic/data-liberation-agent` is a Node/TypeScript toolkit that extracts content from eight closed web platforms (GoDaddy Websites & Marketing, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix) and produces a WordPress-compatible WXR file plus a media directory, redirect map, and (for e-commerce sites) a WooCommerce-format products CSV.** It targets users who want to leave a closed platform but cannot get a clean export, and bills itself as a companion to WordPress.com's $4/mo Personal plan with MCP write-access. It is *not* an LLM agent itself — the extraction code is deterministic Node — but it is shipped pre-wired as a Claude Code plugin / Codex plugin / Gemini extension / generic MCP server / standalone CLI, plus standalone "prompts" you can paste into any AI assistant. (`README.md:1-31`, `AGENTS.md:1-9`)

## 2. Surfaces table

| Surface | Where it's defined | How a host invokes it | Recommended? |
|---|---|---|---|
| **Claude Code plugin / marketplace** | `.claude-plugin/plugin.json` (manifest), `.claude-plugin/marketplace.json` (marketplace), `.mcp.json` (server) | `claude plugin marketplace add Automattic/data-liberation-agent && claude plugin install data-liberation`, or `claude --add-plugin .` from a checkout. Plugin contributes the MCP server (`data-liberation`) and the `skills/` directory. | **Yes — README's first install path** (`README.md:32-46`) |
| **Codex plugin** | `.codex-plugin/plugin.json` — points at `./skills/` and `./.mcp.json` | `cd data-liberation-agent && codex` — the manifests register the MCP server and skills automatically. | Listed equal-rank in README (`README.md:56-63`) |
| **Gemini extension** | `gemini-extension.json` — declares `contextFileName: GEMINI.md`, `skills: ./skills/`, and the MCP server inline (`npx tsx ${extensionPath}${/}src${/}mcp-server.ts`) | `cd data-liberation-agent && gemini extension link .` | Listed equal-rank (`README.md:48-54`) |
| **MCP server (any client)** | `src/mcp-server.ts` (stdio transport, `@modelcontextprotocol/sdk` `Server` + `StdioServerTransport`) | `npx tsx src/mcp-server.ts` or `npm run mcp`. Same binary `.mcp.json` points at — `npx tsx ${CLAUDE_PLUGIN_ROOT}/src/mcp-server.ts`. | "Any MCP client" path in README (`README.md:65-75`) |
| **CLI** | `src/cli.ts` (the real CLI; ~177 lines of arg routing into `ui/*.tsx` Ink screens). `cli.js` at repo root is a separate **interactive bootstrap shell** (browser detection + cookie/profile probing) that ultimately runs the same flows. `start.sh` is the curl-pipe-bash bootstrap. `package.json` `"bin": { "data-liberation": "./dist/cli.js" }` — assumes `npm run build` (tsc) has been run. | `npm run liberate -- <url>`, `npm run inspect -- <url>`, `npm run import -- <wxr> --site …`, `npm run verify`, `npm run setup`. Subcommand `data-liberation mcp` also boots the MCP server (`src/cli.ts:14-15`). | README's "Quick start" + dedicated `docs/cli.md` |
| **npm package** | `package.json` `name: "data-liberation"`, `version: "0.1.0"`, `private`-by-omission (no `private: true` but no `publishConfig` either) | **Not published.** No `releases` and no `tags` returned by the GitHub API. Install path is `git clone` → `npm install`. | **Not** a recommended consumption path |
| **Library import** | `src/lib/*` and `src/adapters/*` — TypeScript modules consumed only via `mcp-server.ts` and `cli.ts`. Nothing in `package.json` exposes them as a public API. | Would require referencing the git repo as a dependency and running `tsc`. | **Not advertised** — `AGENTS.md:7` says "Three entry points — MCP server, CLI, and Claude Code plugin … all share `src/lib/` and `src/adapters/`". |

### Counts

- `commands/`: 8 files (`adapt.md`, `diagnose.md`, `import.md`, `inspect.md`, `liberate.md`, `qa.md`, `setup.md`, `verify.md`) — Markdown with YAML frontmatter, ~5 lines each, thin pointers into the matching skill or MCP tool.
- `prompts/`: 5 files (`godaddy-wm.md`, `shopify.md`, `squarespace.md`, `webflow.md`, `wix.md`) — long Markdown the user pastes into any AI assistant.
- `skills/`: 4 directories (`adapt`, `diagnose`, `liberate`, `qa`), each with one `SKILL.md` — Markdown with YAML frontmatter (`name`, `description`, optional `allowed-tools`), 8–12 KB each, multi-phase workflow instructions.

## 3. Manifest contents (verbatim)

`.claude-plugin/plugin.json`:
```json
{
  "name": "data-liberation",
  "description": "Extract content from closed web platforms (GoDaddy Websites & Marketing, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix) into WordPress-compatible WXR files. Inspect, extract, QA, and import to WordPress.",
  "version": "0.1.0",
  "author": { "name": "Automattic" },
  "homepage": "https://github.com/Automattic/data-liberation-agent",
  "repository": "https://github.com/Automattic/data-liberation-agent",
  "license": "GPL-2.0-or-later",
  "keywords": [...],
  "mcp": { "command": "npx", "args": ["tsx", "src/mcp-server.ts"] }
}
```

`.codex-plugin/plugin.json`:
```json
{
  "name": "data-liberation",
  "description": "...",
  "version": "0.1.0",
  ...,
  "skills": "./skills/",
  "mcpServers": "./.mcp.json"
}
```

`.mcp.json`:
```json
{
  "mcpServers": {
    "data-liberation": {
      "command": "npx",
      "args": ["tsx", "${CLAUDE_PLUGIN_ROOT}/src/mcp-server.ts"],
      "cwd": "${CLAUDE_PLUGIN_ROOT}"
    }
  }
}
```

`.claude-plugin/marketplace.json` declares the marketplace listing — name `data-liberation`, owner `Automattic`, single plugin pointing at `./` so `claude plugin marketplace add` resolves to this same repo.

## 4. MCP server

- **File**: `src/mcp-server.ts` (~620 LOC). Built with `@modelcontextprotocol/sdk@^1.27.0`. Stdio transport (`new StdioServerTransport()`).
- **Spawn**: every manifest spawns it the same way — `npx tsx src/mcp-server.ts` from the repo root, child process / stdio.
- **Tools exposed (13 total** — README's "11 tools" claim at `README.md:75` is stale; preview tools were added in PR #39 on 2026-04-18):
  1. `liberate_detect` — fingerprint platform from a URL.
  2. `liberate_discover` — sitemap + nav inventory; returns `platformFeatures` and (Shopify) `shopDomain`.
  3. `liberate_inspect` — combined detect + sitemap + sample probe + feature flags.
  4. `liberate_extract` — full extraction → WXR + media + redirect map + (optional) products CSV. Holds an extraction-log lock for the duration.
  5. `liberate_status` — read progress from extraction-log files in an output dir.
  6. `liberate_map_apis` — CDP-based API mapping (used during `/adapt`).
  7. `liberate_probe` — CDP-based browser probe of window globals/cookies/localStorage.
  8. `liberate_qa` — diff WXR against origin, optionally patch fixable issues.
  9. `liberate_verify` — post-extraction health report (stale CDN URLs, failed pages/media, quality scores).
  10. `liberate_setup` — validate WP REST connection. **Has a `delegate: true` mode that returns a manifest of requirements without doing anything** (`src/mcp-server.ts:441-454`).
  11. `liberate_import` — REST-API import of WXR into WordPress (and WooCommerce CSV if WC keys passed). **Also has a `delegate: true` mode that returns a structured manifest of file paths** (`wxrFile`, `outputDir`, `mediaDir`, `productsCsv`, `redirectMap`, `importAuthors`) for hosts that handle the import themselves (`src/mcp-server.ts:467-489`).
  12. `liberate_preview` — spawn a local WP preview of an output dir. Auto-detects `studio` CLI on PATH, otherwise falls back to WordPress Playground. Returns `{ url, port, status, source: 'studio'|'playground', warnings, siteName? }`.
  13. `liberate_preview_stop` — stop a running Playground preview by output dir.

## 5. CLI (`src/cli.ts`, `cli.js`, `start.sh`)

- `src/cli.ts` is the real CLI: a thin arg router that dynamically imports Ink-based UIs (`ui/inspect.tsx`, `ui/qa.tsx`, `ui/verify.tsx`, `ui/setup.tsx`, `ui/preview.tsx`, `ui/import.tsx`, `ui/discover.tsx`). The `mcp` subcommand simply re-imports `mcp-server.js` (`src/cli.ts:14-15`).
- `cli.js` at the repo root (~22 KB, JS) is a separate **interactive bootstrap** that detects browsers/cookies and offers to launch Chrome with `--remote-debugging-port` for CDP-driven extraction (`cli.js:9-12,65-120`). It's the one `start.sh` exec's into.
- `start.sh` is a curl-pipe-bash one-liner that checks for Node ≥18, clones the repo, runs `npm install`, runs `npx playwright install chromium`, then runs `cli.js` (`start.sh:9-63`).
- **Credentials it requires:**
  - **No Anthropic / OpenAI / Claude API key anywhere.** A grep of `src/` and `cli.js` for `ANTHROPIC`, `OPENAI`, `claude` returned nothing. The CLI is a deterministic migration runner, not an AI-agent harness — the AI part lives in the *consumer* (Claude Code, Gemini, etc.) which orchestrates calls to the MCP tools.
  - `--token` / `LIBERATION_TOKEN` for platforms requiring auth (Webflow today; conceptually Shopify Tier 2 etc.).
  - `--admin-token` / `SHOPIFY_ADMIN_TOKEN` for Shopify Admin GraphQL.
  - `--site` / `--username` / `--token` (or `WP_APP_PASSWORD`) for the **import** path only — these are WP Application Passwords, not WordPress.com OAuth.

## 6. Sample command/prompt/skill (verbatim)

**Command** (`commands/liberate.md`, full file):
```markdown
---
name: liberate
description: Extract content from a website into a WordPress-compatible WXR file
---

Run the liberate skill to extract content from a closed web platform.
```
All eight commands follow the same shape — frontmatter + a one-sentence body that points at the matching skill or MCP tool.

**Prompt** (`prompts/wix.md:1-9`):
```markdown
# Wix to WordPress Migration Prompt

Copy everything below this line and paste it into your AI assistant (Claude, ChatGPT, Gemini, etc.).

---

I want to migrate my website from Wix to WordPress. My Wix site URL is: **[PASTE YOUR WIX URL HERE]**

I have (or will create) a WordPress site. Please help me migrate using the playbook at https://github.com/Automattic/data-liberation-agent — read AGENTS.md first for full instructions.
```

**Skill** (`skills/liberate/SKILL.md:1-9`):
```markdown
---
name: liberate
description: Extract content from a closed web platform (GoDaddy Websites & Marketing, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix) into a WordPress-compatible WXR file
---

# Liberate a website

Help the user extract their content from a closed web platform.

## Workflow
...
```
The skills are substantial (~200 lines each for `liberate`, `qa`, `diagnose`, `adapt`) with phased instructions, decision points, and quality gates.

## 7. Source code

- **Total**: ~17.6 K LOC across 67 `.ts`/`.tsx` files in `src/` (including colocated `*.test.ts` files; vitest is the test runner).
- **Layout**:
  - `src/cli.ts` (177 LOC) — CLI router.
  - `src/mcp-server.ts` (~620 LOC) — MCP server.
  - `src/types.ts` — shared types (`PlatformAdapter`, etc.).
  - `src/adapters/` — 9 files, one per platform plus `shared.ts`.
  - `src/lib/`:
    - `extraction/` — sitemap, content parser, WXR builder/reader, extraction log, import session, media + media stubs, Shopify GraphQL, adaptive-tuner, platform detect.
    - `import/` — WP REST client, WooCommerce REST client, WP-importer driver, Woo CSV reader/writer, site URL resolver.
    - `preview/` — `playground-server.ts` (Playground harness), `studio.ts` (Studio CLI driver), `blueprint-builder.ts`, `media-url-map.ts`, `lockfile.ts`, `port-picker.ts`, vendored PHP `scripts/import-wxr.php` and `scripts/import-products.php`.
    - `qa/` — `content-differ.ts`, `qa-runner.ts`.
    - `setup/`, `verification/`, `features/`, `probe/` — supporting modules.
  - `src/ui/` — 9 Ink (React-for-CLI) screens.
- **Major dependencies** (`package.json:27-44`):
  - `@modelcontextprotocol/sdk@^1.27.0` — MCP server.
  - `@wp-playground/cli@^3.1.20` — **PHP-WASM WordPress Playground (heavy; same engine Studio CLI uses)**.
  - `playwright@^1.44.0` + `postinstall: playwright install chromium` — **headless Chromium download is part of `npm install`**.
  - `cheerio`, `fast-xml-parser`, `papaparse` — HTML/XML/CSV parsing.
  - `ink` + `react@19` + `ink-spinner` — terminal UI.
  - `tsx` (dev) — runs TypeScript without a build step. The MCP server, CLI, and plugin manifests all rely on it.
- **No native modules**, no Anthropic/OpenAI SDKs, no `wpcom` / WordPress.com OAuth library.

## 8. Runtime requirements

- **Node**: `.nvmrc` says `22`. `package.json` `engines.node: ">=18"`. README's troubleshooting block confirms Node 18+ required (`README.md:138`).
- **Postinstall side-effect**: `playwright install chromium` downloads ~150 MB of browser binaries into Playwright's cache.
- **Subprocesses spawned at runtime**: Playwright Chromium for Wix and Squarespace adapters; `@wp-playground/cli` for Playground previews; `studio` CLI for Studio previews (via `execFile`); `open` / `xdg-open` / `start` to open browser/Studio app on `--open`.
- **Filesystem writes**:
  - All extraction artifacts go under `--output` (default `./output/<site-hostname>/`): `output.wxr`, `media/`, `redirect-map.json`, `extraction-log.jsonl`, `session.json`, `media-stubs.json`, `products.csv`, `products.jsonl`, `.discovery-complete`, `.liberation-lock`. (`docs/cli.md:42-63`, `README.md:107-119`)
  - Playground path also writes `<outputDir>/playground/{blueprint.json, blueprint.studio.json, preview.pid, preview.log, .lock}` (`docs/cli.md:213-218`).
  - **Studio path stages files into the Studio site directory itself** — `wp-content/uploads/liberation/` for media + WXR, `<sitePath>/.dla-scripts/` for vendored PHP (`src/lib/preview/studio.ts:13-19`). It also `rmSync`'s an orphan Studio site dir before re-creating, but only if the path is under `defaultStudioRoot()` (`src/lib/preview/studio.ts:266-279`).
- **Network calls**: HTTP fetches against the source platform (sitemaps, JSON APIs, media); Shopify GraphQL Admin API (`2025-04` pinned); WordPress REST API (`/wp-json/wp/v2/*`) for non-delegate import; WooCommerce REST when WC keys are passed.
- **Environment vars**: `LIBERATION_TOKEN`, `SHOPIFY_ADMIN_TOKEN`, `WP_APP_PASSWORD`, optional `STUDIO_APP_CMD` (Linux launch fallback).
- **Host-tool dependencies**: skills assume the LLM host provides `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `AskUserQuestion` (declared in `skills/qa/SKILL.md` `allowed-tools`). The skills also reference an `import-liberated-data` skill *in the host environment* and a `wp_cli` tool — when present, the skill calls `liberate_setup` / `liberate_import` with `delegate: true` and lets the host do the actual import (`skills/liberate/SKILL.md:24,66`).

## 9. Migration mechanics (end-to-end)

**Inputs:**
- Source site URL.
- Optional platform tokens (`LIBERATION_TOKEN` for Webflow; `SHOPIFY_ADMIN_TOKEN` + auto-detected `shopDomain` for Shopify Tier 2).
- Optional CDP port (Squarespace admin extraction, advanced Wix workflows).
- For built-in import: a target WP site (domain), username, and Application Password.

**Pipeline (driven by the `liberate` skill calling MCP tools, or by `npm run liberate`):**
1. `liberate_detect` → platform identity from URL fingerprinting.
2. `liberate_discover` → sitemap + navigation + platform features + (Shopify) shop domain.
3. `liberate_extract` → adapter walks discovered URLs, populates a `WxrBuilder`, downloads media, streams Woo products to `products.jsonl`. Resume-safe via four cooperating files (`extraction-log.jsonl`, `session.json`, `media-stubs.json`, `products.jsonl`) — `AGENTS.md:20-29` is the source of truth on this.
4. `liberate_verify` → quality + completeness report.
5. **Preview** — `liberate_preview` boots a local WP. **Crucial fact for Studio Code wiring (per `AGENTS.md:51`)**: Studio preview imports the WXR via the `importWxr` blueprint step (LiteralReference, WXR contents inlined into `blueprint.studio.json`) **during** `studio site create`, *not* via `studio wp import` afterward — to avoid Studio's WP-CLI IPC bridge 120s no-activity timeout. Product CSV import does run after, via `studio wp wc product_importer`.
6. `liberate_setup` + `liberate_import` → either via REST (with credentials) or **`delegate: true`** to hand off a structured manifest to the calling environment. Studio Code is the canonical "calling environment" — the skill explicitly mentions "`import-liberated-data` skill, or `wp_cli` tool" as the delegate target.

**Outputs (per `README.md:107-119`):**
```
output/<site>/
  output.wxr               WordPress eXtended RSS file
  media/                   downloaded images and attachments
  redirect-map.json        old paths -> new WordPress slugs
  extraction-log.jsonl     per-URL log
  session.json             stage + cursors
  media-stubs.json         per-asset retry state
  products.csv             WooCommerce-compatible product CSV (if applicable)
  products.jsonl           raw product stream
```

**What the user sees:** Ink-based progress UI (or MCP `sendLoggingMessage` events when called via MCP), then a verification report, then either a preview URL (Studio site at `localhost:<port>` or Playground at `127.0.0.1:9400-9499`) or an import progress stream.

## 10. Versioning / release cadence

- **No tags. No releases.** `gh api repos/.../tags` returns `[]`; `gh api repos/.../releases` returns `[]`. Version pinned at `0.1.0` in three places (`package.json`, both plugin manifests).
- **Not published to npm.** Install is by `git clone` or the marketplace path that re-clones it.
- **Cadence**: Repo created **2026-03-31**. Last push **2026-04-28T17:04:21Z** (5 commits that day). The 2026-04 commit history shows bursty work — 10 commits on 2026-04-16 alone, then steady single-digit days, then a cluster on the 28th. Latest 5 PRs are all `discovery:` (Wix-extraction tweaks); slightly older are `feat(detect-platform)`, `fix(preview)`, `feat(preview)` adding the Studio/Playground preview path (PR #39 on 2026-04-18). The two most recent open PRs (#50 add EmDash CMS adapter, #46 desktop+mobile screenshot capture) hint at near-term direction. Stargazers: 29.
- **Recent landing of preview** (PR #39 → "feat(preview): local WP preview via Studio/Playground before import | BIGR-614") is what makes Studio integration interesting today — DLA already has working `studio site create` + `studio wp eval-file` plumbing.

## Risks / unknowns for Studio CLI integration

1. **Tools/load-bearing host assumptions in skills**: `skills/qa/SKILL.md` declares `allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion`. Studio CLI's `studio code` agent needs to expose a compatible toolset (or skill execution will silently degrade).
2. **DLA already invokes `studio` CLI directly via `execFile`** (`src/lib/preview/studio.ts:71,105,114,133,282`). If Studio Code wants to *embed* DLA rather than have DLA shell out to Studio, the preview path would need a different mode (or to be skipped).
3. **`tsx` at runtime**: `.mcp.json` and both plugin manifests run `npx tsx src/mcp-server.ts` directly — there is no compiled artifact in version control (`dist/` is gitignored). Anyone embedding DLA's MCP server has to ship `tsx` + the TypeScript source, or build first. `package.json bin` points at `./dist/cli.js` which doesn't exist until `npm run build` runs.
4. **Playwright postinstall (Chromium download)** is not behind a flag. Any Studio-side install path that pulls in DLA will pay the ~150 MB browser cost even for users who only migrate from API-only platforms (Hostinger, HubSpot, Shopify Tier 1).
5. **Vendored PHP scripts** (`src/lib/preview/scripts/import-wxr.php`, `import-products.php`) are loaded by absolute path resolved from `import.meta.url` — must be present alongside the JS at runtime. If Studio CLI bundles DLA, the bundle has to preserve that asset layout.
6. **README "11 tools" claim is stale** — the server has 13. Anyone scoping integration off the README's tool list will miss `liberate_preview` / `liberate_preview_stop`.
7. **Private repo + no published artifact** — Studio CLI cannot today depend on DLA via npm. Options: git submodule, `git+ssh:` dep with a deploy key, vendoring, or waiting for a public/published version.
8. **`delegate: true` mode is the natural integration shape** for Studio Code — `liberate_setup`/`liberate_import` already return a structured manifest (`{ wxrFile, outputDir, mediaDir, productsCsv, redirectMap, importAuthors }`) explicitly designed for "local dev tools with direct database/CLI access" (`src/mcp-server.ts:204`).
9. **Single repo, single version** — DLA isn't versioned, so any Studio-side pin will be a git SHA, and breakage from `main` lands the moment it lands upstream. No deprecation contract.
10. **Auto-cleanup of orphan Studio sites**: `startStudioPreview` will `rmSync` a directory under `defaultStudioRoot()` if it exists on disk but isn't listed by `studio site list` (`src/lib/preview/studio.ts:266-279`).

## Sources

- DLA repo cloned shallowly via `gh repo clone Automattic/data-liberation-agent --depth=1` (private) and read locally; full read of `README.md`, `AGENTS.md`, `package.json`, `.nvmrc`, all four manifest files (`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, `gemini-extension.json`, `.mcp.json`); `src/mcp-server.ts` (full); `src/cli.ts` (full); sampled `src/lib/preview/studio.ts`, `src/ui/discover.tsx`; `commands/liberate.md`, `commands/inspect.md`, `commands/import.md`; `prompts/wix.md`; `skills/liberate/SKILL.md`, `skills/qa/SKILL.md`; `docs/cli.md`, `docs/mcp.md`, `docs/skills.md`.
- GitHub API: `gh api repos/Automattic/data-liberation-agent` (metadata), `releases` ([]), `tags` ([]), commits, PRs, languages.
