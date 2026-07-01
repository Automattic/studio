# Data Liberation — How It Works

> A plain-English tour of how `data-liberation-agent` turns a site on a closed platform into a WordPress site you own. It covers *what* happens and *why*, in order, and where the work is done by predictable code versus AI judgment. It's about the shape of the system, not the code. Exact tool and file names live in the **"Under the hood"** asides so they stay out of the way.

---

## The big idea

You point the tool at a site built on a closed platform — Wix, Squarespace, Shopify, Webflow, GoDaddy, Hostinger, HubSpot, or Weebly — and it hands you back a WordPress site you control: the words and images as a standard import file, the products as a WooCommerce spreadsheet, and the *look* of the site rebuilt as a WordPress theme.

It works in two movements:

1. **Extraction** pulls the content, media, and design measurements out of the source. This part is pure, predictable code — no AI. Run it twice and you get the same result, and you can stop and resume it any time.
2. **Reconstruction** rebuilds the pages as a real WordPress site. Code lays down the structure and content, AI closes the gap on how it *looks*, and automated checks keep both honest.

In between sits one decision only a person can make — *how* to rebuild the site — and the tool asks it early, right after a quick survey and before the slow extraction work, so you're still at the keyboard when it matters.

One rule sits above everything: **never lose or invent content.** Real text is copied word-for-word or left as a clearly marked placeholder — never reworded — and a check rejects anything that can't be traced back to what was actually on the source page.

---

## Two phases, one boundary

```
┌─────────────── PHASE 1 · EXTRACTION ───────────────┐
│  Predictable code — same result every time, resumable │
│  Detect → Discover                                   │
└──────────────────────────────────────────────────────┘
                        ↓
   ╔══════ YOU CHOOSE HOW TO REBUILD (required) ══════╗
   ║  A hard stop after the quick survey, before the   ║
   ║  slow work. The tool shows what it found and a    ║
   ║  recommendation, then waits for your answer.      ║
   ║  It never picks for you.                           ║
   ╚═══════════════════════════════════════════════════╝
                        ↓
┌─────────── PHASE 1 (cont.) — after you choose ───────┐
│  Extract → Download media → Capture (screenshots +    │
│  measurements). Capture feeds every rebuild path.     │
└──────────────────────────────────────────────────────┘
                        ↓
┌─────────────── PHASE 2 · RECONSTRUCTION ─────────────┐
│  Code builds structure + content; AI closes the visual │
│  gap; checks verify both. Produces a running WP site.  │
└──────────────────────────────────────────────────────┘
```

The most important idea in the whole system is the line between **predictable code** and **AI judgment**:

- **Code handles anything with a correct, lookup-able answer:** which platform this is, which pages exist, the text/images/prices on a page, the colors/fonts/breakpoints in the CSS, where each section starts and stops, how to turn a column layout into block markup, whether the output reflows on a phone, and whether every word traces back to the source.
- **AI handles anything needing interpretation or a look at the result:** turning raw color measurements into a coherent design system, building a section that captures the *intent* of the original, comparing source and rebuild side-by-side and nudging until they match, and rebuilding a genuinely one-off section.

In one line: **code gets the structure and content right, AI closes the visual gap, and checks verify both.** Throughout this doc, ⚙️ marks a step done by code and 🤖 marks a step done by AI.

---

## Three ways to run it

All three share the same core code.

- **The `/liberate` skill — the main way.** An AI agent runs the whole pipeline: it surveys the site, stops to ask you how to rebuild it, then does the extraction and hands off to the matching rebuild path. This is the intended path — the agent *is* the runtime, and each AI step ships as a skill rather than as model calls baked into the code.
- **The command line (`data-liberation <url>`).** Headless and CI-friendly. It runs the extraction half only (screenshots included by default). Rebuilding is agent-only; there is no headless rebuild.
- **The MCP server.** Exposes each predictable step as a tool that the skills — or any MCP client — can call.

> **Under the hood:** tools are named `liberate_*` (e.g. `liberate_detect`, `liberate_extract`). The MCP server is one long-lived process, so editing the source doesn't hot-reload it — a newly added tool only appears after a restart. The shared core lives in `src/lib/` and `src/adapters/`.

There are **three rebuild paths**. Two start from a live platform and are chosen at the checkpoint inside `/liberate`; the third starts from files you already have on disk. They're covered in [Phase 2](#phase-2--reconstruction).

---

# Phase 1 — Extraction

This half is a clean, restartable state machine. Nothing here calls an AI. Stop it whenever you like and it picks up where it left off (see [Resume & state](#resume--state)). It runs five steps: the first two are a cheap survey, then it pauses for your decision, then the three expensive steps run.

> **Under the hood:** progress is tracked by an `ImportSession` that moves through `discovering → [you choose] → extracting → downloading-media → screenshotting → finalizing → complete` (any stage can fall to `error`). The headless CLI skips the pause and runs straight through.

### 1. Detect — which platform is this? ⚙️

The tool identifies the platform with a layered fingerprint, most-confident signal first: the URL pattern (e.g. a `*.myshopify.com` address), then the HTTP response headers, then markers in the HTML (CDN hostnames, platform JavaScript), and finally a few fallback probes. It judges by domain and fingerprint, never by guessing from the URL path.

> **Under the hood:** `liberate_detect` → `{ platform, confidence, signals }`.

### 2. Discover — what pages exist? ⚙️

The tool builds an inventory: it walks the sitemap, reads the navigation, and collects every URL, sorting each into a type — homepage, post, product, gallery, event, or page. The result is the full page list with counts per type, the nav structure, and basic site info (title, tagline, language).

This is the point where Phase 1 pauses for you. Detect and discover are cheap and already tell the tool everything it needs to recommend a rebuild path, so the choice comes *now*, before the slow work. See [Choosing how to rebuild](#choosing-how-to-rebuild).

> **Under the hood:** `liberate_discover`.

### 3. Extract — pull the content ⚙️

For each page, the platform's **adapter** fetches and parses it into clean, structured content: title, slug, body, excerpt, date, image references, categories and tags, author, and type. A shared loop handles the cross-cutting concerns:

- **Naming** — derive each page's WordPress slug from its URL, adding a numeric suffix if two collide.
- **Fetch in parallel, write in order** — pages download in batches but are written sequentially for a consistent file, with timing-based throttling that adapts as it goes.
- **Fair limiting** — when you cap the number of pages, it spreads the cap across content types so products don't crowd out pages, and always keeps the main-nav pages so the rebuilt menu still works.
- **Streaming** — content can be flushed per page so memory stays flat on big sites.

The result is a standard WordPress import file covering pages, posts, products, attachments, menus, categories, tags, and authors.

**Shopify is a special case.** Without an admin token, products come from Shopify's public API. *With* one, the tool uses Shopify's richer admin API — resumable, safe to re-run, and falling back to the public API if anything goes wrong.

> **Under the hood:** `liberate_extract` → `output.wxr` (WXR 1.2). Shopify's admin path uses the Admin GraphQL API pinned to `2025-04`, paginating via stored cursors and tracking emitted handles for idempotent output.

### 4. Download media — grab every image ⚙️

Every referenced image and PDF is downloaded once, de-duplicated, and saved locally (colliding filenames get a numeric suffix). Each asset's status is tracked with a retry cap so media survives a crash and resumes cleanly. Later steps swap the source's CDN links for the local copies.

> **Under the hood:** statuses live in `media-stubs.json`; local copies are recorded **root-relative** (`/wp-content/uploads/…`), not as `localhost:<port>` URLs, so the mapping still works when the rebuild is served from a different site or port.

### 5. Capture — photograph and measure every page ⚙️

This is the bridge from "content" to "design," and it's what makes rebuilding the *look* possible. For each page, the tool:

- opens it in a real browser at desktop (1440×900) and phone sizes, dismisses cookie banners, and lets lazy images load;
- saves full-page screenshots, plus a scrolled-down shot for long pages;
- optionally saves the rendered HTML;
- breaks the page into **sections** and records each one's styling, size, role (hero, columns, gallery, review grid, price list, product row, …), brightness, images, and a pointer back to where it lives in the original page;
- notes the page's structural landmarks (header, nav, main, footer);
- and rolls up **site-wide design tokens**: the dominant colors, the fonts in use, and the screen widths the site's CSS actually responds to.

Nothing from this step is written into the content file. Instead a manifest maps each URL to its screenshots and measurements, and later tooling matches them up by URL.

> **Under the hood:** `liberate_screenshot` (Playwright). The per-section measurements are a `SectionSpec[]`, each with a CSS `selector` back into the source DOM; they plus the landmark census are cached per page at `sections/<slug>.json` (capture-once, schema-versioned). Tokens land in `palette.json`, `typography.json`, `breakpoints.json`; the URL join is `screenshots/manifest.json`. Defaults: 6 pages at a time, the browser restarts every 100 pages to bound memory, and every captured URL must share the entry URL's origin.

> **Everything in Phase 1 is deterministic.** The same source site gives you the same content, media, screenshots, and measurements every time. That reproducible foundation is what the AI half builds on.

---

# Phase 2 — Reconstruction

Now the captured material becomes a living WordPress site. This is where AI enters — but always fenced in by checks that *measure* rather than eyeball. The path was already chosen back at the checkpoint; Phase 2 simply runs the rebuild path you picked.

## Choosing how to rebuild

After the survey (detect + discover) and **before** the slow extraction, the tool stops and asks you how to rebuild. This is a required, non-skippable decision — your answer is the only thing that authorizes the rest of the run. It's placed early on purpose: the survey already gives the tool what it needs to recommend a path, so you commit while you're still paying attention rather than after a long extraction has finished (or after you've walked away).

The tool shows what it found, a rough scope/cost estimate, and a platform-informed recommendation, then asks you to pick. The recommendation is only a hint — even with a strong signal, the tool never chooses for you.

| You pick | You get | Products |
|---|---|---|
| **Blocks + products** | Editable WordPress blocks, navigation, and WooCommerce — the best starting point for a redesign | Product **pages** rebuilt |
| **Theme replication** | The highest-fidelity visual copy of the source | Product **data** imported; product pages use the default WooCommerce layout |

A rough rule: a store with lots of products leans toward **blocks**; a fixed-layout marketing site with no store, where pixel-fidelity matters most, leans toward **theme replication**. The choice costs nothing to change — capture is reusable, so re-running `/liberate` on an already-captured site jumps straight back to this question and you can try the other path without re-capturing.

> **Under the hood:** the question is an `AskUserQuestion` with the recommended option marked `(Recommended)`. "Blocks + products" dispatches the `replicate-with-blocks` skill ([Path A](#path-a--blocks-replicate-with-blocks)); "theme replication" dispatches `replicate-theme` ([Path B](#path-b--theme-replication-replicate-theme)). Both run inline (shared context) and own their rebuild → install → QA → report. The third path, [Path C](#path-c--convert-a-site-you-already-own-liberate_convert_local_site), is a separate entry point for files you already have, not an option at this checkpoint.

## Editable HTML islands — a building block all three paths share

Sometimes a chunk of the original page has no clean equivalent in WordPress blocks. Rather than lose it, the tool carries that chunk's HTML across nearly verbatim. Such a chunk is called an **island**. The theme-replication path is islands by design; the blocks path only drops to an island when rebuilding a section properly would lose content.

The old way to carry an island was a plain HTML block, but that has a real downside: WordPress renders it in a sealed-off frame in the editor, so it shows up unstyled and can only be edited through a raw-HTML toggle — effectively invisible on the canvas. So now **every island becomes an editable block instead**, by default, on all three paths.

That editable block:

- **Shows up styled, right on the editor canvas** — and it's listed by name in the editor's outline.
- **Is actually editable:** you can edit its text, swap its images, or open a sidebar panel to edit the raw HTML directly.
- **Outputs the exact original HTML** on the front end — byte-for-byte. The conversion only changes what the *editor* shows, never what visitors see.

What it is **not**: an island is still one HTML block, not a tidy tree of column/cover/gallery blocks. (Breaking a section into real blocks is what the blocks path does *before* it would ever fall back to an island.)

> **Under the hood:** the block is `dla/editable-html`, shipped as a tiny build-less plugin (`dla-editable-html`) that's installed and activated once per run when any island converts. Its content is a "frame" model that splits the HTML into static parts, never-touch raw subtrees (SVG, scripts), and editable text/image leaves; the same serializer runs in the block's save and in the server, which is why the front-end output is identical by construction. Only true raw-HTML islands convert — one wrapping nested block markup is left alone. Opt out with `editableIslands: false` (or `EDITABLE_ISLANDS=0` on the carry driver) to keep plain HTML blocks.

## Path A — Blocks (`replicate-with-blocks`) · ⚙️ + 🤖

**Goal:** rebuild the site as *editable* WordPress blocks — columns, groups, cover images, galleries — styled by the theme, so you get a real, maintainable site rather than a frozen snapshot. This path leans on code for structure and AI for judgment.

The backbone is deterministic. A code emitter rebuilds **every** page from that page's own measurements, so the two AI-heavy steps are optional helpers, not load-bearing: grouping pages by layout is just informational, and the AI "builder" fan-out is skipped unless a section is genuinely too bespoke for the emitter to handle. Header and footer come from the theme, not the builders.

The path runs roughly these steps:

**6. Design foundation 🤖** — Read the captured colors, fonts, and breakpoints and infer a coherent *design system*: which color is the brand primary, the type scale, the spacing. This is the one place raw measurements become design *intent* ("this green is the brand color," not "this hex appears 40 times"). The result is frozen as a site-wide brief that every later step defers to. *Why AI:* grouping near-identical greens into one brand color is interpretation, not lookup. Code pre-fills the obvious roles first so the AI only fills the genuinely interpretive gaps.

**7. Create the theme ⚙️** — Translate that frozen brief into a scaffolded WordPress block theme: settings, styles, templates, and self-hosted fonts, including templates that give imported posts and pages a proper title. A mechanical translation, checked by a lint gate.

**8. Group pages by layout ⚙️ *(informational)*** — Cluster pages that share the same sequence of section types, so a layout could be built once and reused. It's exact-match and it gates nothing; where a platform makes layouts look identical, it simply doesn't matter.

**9. Detailed section specs ⚙️ *(helper)*** — For a representative page of each group, write out per-section specs (role, verbatim text, images, background) that act as the strict contract for the AI builders — they may only use what's in the spec.

**10. Build patterns 🤖 *(helper, off by default)*** — When needed, an AI builder reads the brief plus a section's spec and produces a block layout with the content filled in. Builders run in parallel, each in its own workspace. **The hard rule:** every visible word is copied verbatim or left as a placeholder — never reworded. Reworded copy fails the gate later.

**11. Assemble the pages ⚙️** — The heart of the path. For every page, the emitter turns its measured sections into real blocks, fills them with the exact source text, and styles them with the design-system tokens (not hardcoded colors, so the editor doesn't fight them). If rebuilding a section properly would drop content, that section falls back to an [editable island](#editable-html-islands--a-building-block-all-three-paths-share) instead — faithful, just not broken into blocks — and flags itself for follow-up. Whether a section spans the full width or sits in a column **follows the source**.

> **Under the hood:** `liberate_reconstruct_pages` writes `patterns/page-<slug>.php` plus collapsed templates registered in the theme, and patches `output.wxr` to match. Two warning-level diagnostics make the fallbacks actionable without blocking install: `fallback-diagnostics.json` (one record per island — why it fell back, with a suggested fix) and `region-audit.json` (reconciles the source's landmarks against what was placed, flagging any whole landmark — e.g. a dropped `<nav>` — that survived nowhere).

**12. Validate ⚙️ — the hard gate.** Nothing installs unless it passes. It checks that all source text is properly escaped, that there's no injected PHP/JavaScript/event-handler code, that every word traces back to the source (the anti-invention check), that no link still points at the source CDN, and that the block markup is valid. A second check re-parses the markup with WordPress's own parser to confirm it round-trips.

**13. Install ⚙️** — Write the theme into a local WordPress (Studio), import the content and products, activate the theme, set the front page. Now there's a running site to look at.

> **Under the hood:** `liberate_install_theme` / `liberate_import` / `liberate_preview`. A media-heavy import can trip Studio's ~120-second silence timeout (it looks like a database error); the fix is a per-item heartbeat in the importer, and some flows install media separately.

**14. Visual QA loop 🤖 + ⚙️** — The closing loop that makes the result actually *look right*. It screenshots the rebuilt site and runs three checks: a **responsiveness gate** (no horizontal overflow, sections reflow on a phone — failure stops the run), a **visual-parity gate** that *measures* each section against the source (background-color difference, column count, images present, styled-vs-unstyled) and backs every verdict with the evidence behind it, and **accessibility checks** that warn but don't block. The measured results produce the run's verdict.

When a section is off, the tool tries the cheapest fix first and escalates:

| Rung | Fix | By |
|------|-----|----|
| **R1** | Tweak the CSS/theme (a band color, some spacing) | 🤖 small |
| **R2** | Rebuild the block markup from the spec (restore flattened columns) | 🤖 |
| **R3** | Re-measure the section — the spec itself was wrong | ⚙️ |
| **R4a** | AI rebuild from richer inputs (source + styled HTML, screenshots, tokens), which must pass four gates including a re-measured match | 🤖 |
| **R4b** | Last resort: carry the section as a styled [editable island](#editable-html-islands--a-building-block-all-three-paths-share) — pixel-faithful, just not broken into blocks | ⚙️ |

After about five attempts on one section, a circuit-breaker stops and asks you what to do (spend more, accept the gap, or abandon it). The system refuses to quietly ship a degraded section as if it matched — accepting a known gap is an explicit human decision.

## Path B — Theme replication (`replicate-theme`) · ⚙️ (🤖)

**Goal:** the closest possible visual copy, accepting that the page body stays as one [editable island](#editable-html-islands--a-building-block-all-three-paths-share) rather than a tree of blocks (still text- and image-editable on the canvas, just not decomposed). Instead of rebuilding each page as blocks, this path carries the source's own rendered HTML across nearly verbatim and re-uses the source's own CSS, scoped so it can't leak between pages.

It does **not** capture — it relies on a `/liberate` run having already captured the site. If the inputs are missing it stops and tells you to run `/liberate <url>` first, rather than silently re-capturing.

Roughly, for each page it: carries the header, body, and footer across as islands; scopes the source CSS (site-wide for shared chrome, per-page for the body) and trims unused rules; rewrites internal links to local ones; and self-hosts every image so nothing still loads from the source CDN. It then writes a genuine WordPress block theme, swaps each page's content into the import file, and activates everything.

> **Under the hood:** `liberate_reconstruct_pages_carry` writes the `<site>-carry` theme and `output-carry.wxr`. Provisioning uses a media-free slimmed import to dodge the Studio timeout, then installs media separately. Link rewriting and media self-hosting reuse the same shared helpers as Path A. Parity is scored by `liberate_compare` into `run-report-carry.json`.

**What this path does well:** images are self-hosted, internal links work locally, blog posts are carried too, and the output is a real block theme. The body is the only carried island.

**Where it still struggles** (these get stated honestly in the report, never dressed up as success):

- **Missing section background fills (Wix)** — currently the biggest remaining gap. Background colors that Wix paints via JavaScript don't make it into the carried CSS, so some bands render white.
- **Scale offset (Wix)** — carried layouts can render a bit larger than the source (Wix's sizing is JavaScript-driven). Once the dominant issue, now mostly fixed by smarter CSS scoping and matching the source's body classes (desktop parity rose from ~0.72 to ~0.88, mobile from ~0.62 to ~0.73).
- **No animations** — scripts are stripped, so carousels and scroll effects don't move.
- **Some background images in CSS files** can still point at the source if their URL doesn't match cleanly.
- **Sites with no real header/footer tags** (common on Wix/Squarespace) can't be split into separate header/footer parts; the whole body rides in one island.

## Path C — Convert a site you already own (`liberate_convert_local_site`) · ⚙️ (🤖)

**Goal:** turn a static or JavaScript site **you already own** — a folder of HTML files — into a native WordPress block theme. This is a **separate entry point**, not a choice at the rebuild checkpoint: there's no platform to detect, and it skips Phase 1's live extraction and capture entirely. Because you own the source, the strict anti-invention check (built for scraping a closed platform) relaxes — but a **conservation check** still guards against silently dropping the source's own styling or content.

Unlike theme replication, this path's *first* choice is real blocks, not islands — it only drops to an editable island when a section won't map cleanly. It runs in four stages:

1. **Ingest ⚙️** — walk the folder's HTML files, derive stable names (and refuse to overwrite on a name clash), build a navigation graph from the internal links, and split each page into chrome (header/nav/footer) and body sections.
2. **Emit blocks ⚙️** — map each element to the matching core block (headings, paragraphs, images, buttons, lists) wrapped in groups; anything unrecognized degrades to a paragraph and lowers a confidence score so the downgrade is visible. A section that won't map cleanly becomes an editable island. The assembled page must pass a block round-trip check.
3. **Build the theme + carry the source styling ⚙️** — write a real block theme with a header derived from the nav graph, a design foundation inferred from the source's own CSS, and title-bearing page templates. Then carry the designer's own stylesheet and scripts so the class-preserving blocks render under the original CSS. (Optionally, scroll/sticky behaviors can be rebuilt as native interactive blocks instead of carrying the JavaScript — you get one or the other, not both.)
4. **Install + verify ⚙️ (AI optional)** — provision the Studio site, write and activate the theme, create the pages (safe to re-run), and set the front page. Optionally screenshot and score parity, with a repair loop. A conservation check flags any class-level styling or content that got dropped.

**Optional extras** kick in only when their inputs are present: HTML forms can be converted to Jetpack forms, and a data model can turn JavaScript-mounted card grids into a real custom post type with native query loops (validated, and skipped rather than aborted if the model is bad).

This path is **heavily deterministic** — a code-driven conversion plus the carried CSS, with no AI fan-out by default. AI enters only through the orchestrating skill and the optional data model.

> **Under the hood:** `liberate_convert_local_site` (with `liberate_ingest_local_site` underneath), driven by the `liberate-local` skill. The conservation check writes `normalize-report.json`.

## Which path should I use?

| | **Blocks** (`replicate-with-blocks`) | **Theme replication** (`replicate-theme`) | **Local convert** (`liberate_convert_local_site`) |
|---|---|---|---|
| Starts from | A live platform (via `/liberate`) | A live platform (via `/liberate`) | A folder of HTML you own |
| Output | Editable WordPress blocks + theme styling | One editable island per page + the source's own CSS | Native blocks (islands only where a section won't map) + carried CSS |
| Editable in WP? | **Yes** — real blocks | **Yes** — text/image edits on the island, not broken into blocks | **Yes** — blocks, with island fallbacks |
| Visual fidelity | High, and guaranteed to reflow on phones | Very high on desktop, but inherits source quirks | High — class-preserving blocks under the source's own CSS |
| Phone reflow | Guaranteed by a hard gate | Whatever the source CSS does | Whatever the source CSS does |
| Products | Product pages rebuilt | Product data only; default product layout | n/a (optional custom post type via a data model) |
| Code/AI | ⚙️ emit + 🤖 polish, gated | ⚙️ carry + 🤖 comparison | ⚙️ convert + carried CSS (🤖 optional) |
| Best for | A real WordPress site you'll keep editing | A pixel-faithful copy / comparison baseline | Migrating a static site you own into editable WordPress |

**An honest note on blocks vs. theme replication:** which one "wins" depends on the site. On dynamic (Wix/JavaScript) sites the pixel comparison is often a *tie within measurement noise* — re-screenshotting the *same* built site can swing the score by more than the gap between paths. But not always: on one recent Wix site theme replication beat blocks decisively (homepage 0.995 vs. 0.26). So the reports separate **correctness wins** (self-hosted media, working local links, posts rendering — each verifiable) from **pixel-score wins** (sometimes real, sometimes noise). Theme replication doubles as a fidelity ceiling that calibrates how good the blocks rebuild is.

---

## Resume & state

Extraction is built to survive crashes. A few files cooperate, all written under one lock:

- **`extraction-log.jsonl`** — the source of truth for "have we already done this URL?" (append-only).
- **`session.json`** — the current stage, options, and counts. A corrupt copy is preserved, never silently deleted.
- **`media-stubs.json`** — per-asset status with a retry cap.
- **`products.jsonl`** — product output that *appends* on resume.
- **`sections/<slug>.json`** — the cached per-page measurements, so the expensive browser step doesn't re-run; the rebuild reads this and only re-measures on a miss.

That's why a run can always be killed and restarted: extraction records exactly what it has done, and the rebuild checkpoints as it goes.

---

## The fidelity contract

Three layered rules enforce "faithful, nothing lost, nothing invented":

1. **Verbatim or placeholder** — builders never reword source prose.
2. **Provenance** — every emitted word must trace back to captured source text; invented prose fails before install.
3. **Measured parity + coverage** — a section that drops content or fails a *measured* check is caught and either fixed up the ladder or carried as a faithful island, with the gap recorded. It is never quietly flattened and shipped as a match.

The stance is deliberate: the system would rather **show you an honest gap** than quietly degrade quality.

---

## Quick reference — files in the output directory

> The default output folder is `~/Studio/_liberations/<host>`. Override it with the `DLA_OUTPUT_DIR` env var, the `outputDir` tool argument, or the `--output` CLI flag. Run `liberate_paths` to resolve the real path.

| File / folder | When | What it is |
|---|---|---|
| `output.wxr` | Extract | WordPress import file (pages/posts/products/media/menus) |
| `products.csv` / `products.jsonl` | Extract | WooCommerce product import |
| `media/` + `media-stubs.json` | Media | Downloaded assets + per-asset status |
| `extraction-log.jsonl`, `session.json` | Resume | What's done + run state |
| `redirect-map.json` | Extract | Old URL → new slug |
| `screenshots/` + `manifest.json` | Capture | Page renders + the URL→files join |
| `html/<slug>.html` | Capture | Rendered source HTML (feeds the carry path) |
| `palette.json`, `typography.json`, `breakpoints.json` | Capture | Aggregated design tokens |
| `sections/<slug>.json` | Capture | Cached per-page section measurements + landmarks |
| `design-foundation.json` + `design.md` 🤖 | Foundation | The inferred design system (blocks path) |
| `theme/` | Theme | The generated block theme (blocks path) |
| `<site>-carry` + `output-carry.wxr` | Theme | The theme-replication theme + content-swapped import |
| `cluster-map.json` | Cluster | Pages grouped by layout |
| `specs/<rep>/section-*.md` | Section specs | The builder contract |
| `patterns/`, `templates/` | Assemble | Rebuilt page markup |
| `fallback-diagnostics.json` | Assemble | Why each island fell back (blocks path, warning) |
| `region-audit.json` | Assemble | Dropped landmarks (blocks path, warning) |
| `dla-editable-html` plugin | Assemble/Theme | The editable-island block, shipped when any island converts |
| `normalize-report.json` | Local convert | Per-section confidence + dropped styling/content |
| `run-report.json` / `run-report-carry.json` | QA | Verdict + per-section parity |

---

## Stage at a glance — code vs. AI

| Stage | Tool / skill | Code/AI |
|---|---|---|
| Detect platform | `liberate_detect` | ⚙️ |
| Discover URLs | `liberate_discover` | ⚙️ |
| Extract content | `liberate_extract` | ⚙️ |
| Download media | (media install) | ⚙️ |
| Capture screenshots + measurements | `liberate_screenshot` | ⚙️ |
| Infer the design system | `design-foundations` | 🤖 |
| Scaffold the theme | `creating-themes` | ⚙️ |
| Group pages by layout *(informational)* | `liberate_cluster_pages` | ⚙️ |
| Detailed section specs *(helper)* | `liberate_section_extract` | ⚙️ |
| Build patterns *(helper)* | `generating-patterns` | 🤖 |
| Assemble pages *(main blocks path)* | `liberate_reconstruct_pages` | ⚙️ |
| Validate (gate) | `liberate_validate_artifacts` | ⚙️ |
| Install + import | `liberate_install_theme`, `liberate_import` | ⚙️ |
| Visual QA + escalation | `design-qa`, `match-page`, `match-section`, `rebuild-section` | 🤖 + ⚙️ |
| Carry-and-scope rebuild | `liberate_reconstruct_pages_carry` | ⚙️ |
| Parity comparison | `liberate_compare` | 🤖 + ⚙️ |
| Convert a local site | `liberate_convert_local_site`, `liberate-local` | ⚙️ (AI optional) |

---

## How the AI steps are built (skills & patterns)

The AI half ships as Claude Code **skills**, each assembled from reusable *skill-patterns* — named techniques for staying grounded, self-critical, and composable (full catalog: [skillpatterns.ai](https://skillpatterns.ai/)). A handful of patterns do most of the work:

- **Tool offloading is everywhere.** Whenever a skill calls a `liberate_*` tool or a shared helper instead of redoing the logic itself, it's handing predictable work to code and saving its own attention for judgment. This *is* the code/AI boundary, expressed as a habit.
- **The QA skills lean hardest on honesty.** `design-qa`, `match-section`, `match-page`, `rebuild-section`, and `qa` all share "measure, don't assert; lead with what's wrong" — built from *Prove it works*, *Gap-to-target scoring*, and *Anti-sycophancy*.
- **The orchestrators own composition.** `liberate`, `replicate-with-blocks`, `replicate-theme`, and `match-page` are built from *Decomposition*, *Skill chaining*, *Specialist fan-out*, *Circuit breaker*, and *Externalized working state*. `liberate` adds *Bounded option generation* + *Human in the loop* for the rebuild-path choice.
- **The theme/block skills share conventions.** `creating-themes`, `editing-themes`, `editing-blocks`, and `generating-patterns` cluster on *Scoped conventions*, *Trusted sources*, and *Scope guardrails*.
- **Memory is a file.** *Long-term memory* shows up as `DISCOVERIES.md`, the running log of platform quirks the skills append to.

| Skill | Role | What it does | Key patterns |
|---|---|---|---|
| `liberate` | Orchestrator | Front door: survey → ask how to rebuild → extract → dispatch | Decomposition, Bounded option generation, Human in the loop |
| `replicate-with-blocks` | Orchestrator | The blocks path, end to end | Specialist fan-out, Schema-locked output, Gap-to-target scoring |
| `replicate-theme` | Orchestrator | The theme-replication path | Decision capture, Anti-sycophancy, Confidence calibration |
| `liberate-local` | Orchestrator | Convert a folder you own into a block theme | Decomposition, Tool offloading, Scope guardrails |
| `match-page` | Orchestrator | Whole-page parity with a replayable log | Externalized working state, Self-tuning, Circuit breaker |
| `design-foundations` | Builder | Infer the design system from captures | Schema-locked output, Confidence calibration, Trusted sources |
| `generating-patterns` | Builder | One section spec → one block pattern | Trusted sources, Anti-sycophancy, Exemplars over instruction |
| `compose-page-blocks` | Builder | Misfit-page fallback: HTML → page content | Schema-locked output, Encoded reasoning, Scope guardrails |
| `creating-themes` | Builder | Scaffold a block theme from the foundation | Scoped conventions, Trusted sources, Scope guardrails |
| `design-qa` | QA | Post-install responsiveness + parity + escalation | Prove it works, Stakes-scaled rigor, Human in the loop |
| `match-section` | QA | Per-section apply → render → look → fix | Prove it works, Disconfirmation, Failure mode preloading |
| `rebuild-section` | QA | Rebuild one section into editable blocks (R4a) | Encoded reasoning, Schema-locked output, Graceful degradation |
| `qa` | QA | Compare extracted content vs. source and fix | Gap-to-target scoring, Circuit breaker, Human in the loop |
| `adapt` | Platform | Build an adapter for a new platform | Decomposition, Scoped conventions, Clarification gate |
| `diagnose` | Maintenance | Debug failed or low-quality extractions | Signal vs. noise, Disconfirmation, Prove it works |
| `editing-themes` | Maintenance | Minimal, targeted edits to a block theme | Scope guardrails, Characterization baseline |
| `editing-blocks` | Maintenance | Minimal, targeted edits to a block | Scope guardrails, Characterization baseline |
