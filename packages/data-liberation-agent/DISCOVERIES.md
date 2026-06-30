# Discoveries

A living log of findings from real migrations. Newest entries at the top.

AI agents: when you contribute an improvement, add an entry here. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the required format.

---

## 2026-06-04 — getsnooz.com (Shopify) carry run: capture 429s, carry-path media-install timeout, carry-tool schema gap

**Found by:** Claude + Matt
**During:** A `/liberate` → theme-replication (carry-and-scope) pass on getsnooz.com (Shopify, ~99 URLs, 436 media).
**Type:** capture reliability + install-path bug + fix + MCP schema fix

### 1. CDP beats Shopify's 403, but capture concurrency 6 trips a 429 rate-limit
Memory said "Shopify capture needs CDP (headless 403s)" — true: a real Chrome over `--remote-debugging-port` captured cleanly where headless got 403s. But the *first* run still failed **168 capture ops** with `HTTP 429 Too Many Requests`, all clustered ~2 min in: the **default screenshot concurrency (6) × 2 viewports** hammered the origin fast enough that Shopify's edge throttled every subsequent `goto`. The capture loop does `attempt: 1` with **no 429 retry/backoff**, so once throttled the rest of the run cascaded into manifest stubs (slug+capturedAt, no PNG). **Workaround:** resume `liberate_screenshot` at `concurrency: 2` → 90 captured, **0 failed**. **Open fix:** add 429-aware retry/backoff (honor `Retry-After`) to `screenshotter.ts`, and/or lower the default capture concurrency for Shopify origins. (Extends the prior "default to CDP for Shopify" note.)

### 2. Carry-path media install hit the SAME Studio 120s timeout that import-wxr.php already fixed
`liberate_reconstruct_pages_carry` returned `mediaInstalled: 0` with every entry erroring `install-media.php failed: … No activity for 120s`. Root cause is identical to the 2026-05-27 `import-wxr.php` finding below: `install-media.php` calls `wp_generate_attachment_metadata()` (thumbnail regen) per file and **emits no output until after the loop**, so a large media set (here the run's full 992-file map installed on the first page) runs silently past Studio's 120s IPC-silence kill — leaving carried `<img>` on the source CDN (carry's "self-hosted media" promise broken). **Fix (applied, uncommitted):** mirror `import-wxr.php` in `src/lib/preview/scripts/install-media.php` — `add_filter('intermediate_image_sizes_advanced','__return_empty_array')` + a `WP_CLI::log` heartbeat inside the loop (printed before the `DLA_INSTALL_MEDIA_JSON_BEGIN` sentinel, so `media-install.ts`'s marker-delimited slice ignores it). Result after fix: **mediaInstalled 992, 0 errors**; homepage island went from all-CDN to 88 local `/wp-content/uploads/` refs (7 CDN left = known CSS-`url()` limit). Lesson: the thumbnail-skip + heartbeat pattern belongs in **every** vendored WP-CLI script that loops over media, not just `import-wxr.php`.

### 3. `liberate_reconstruct_pages_carry` MCP schema under-declared `htmlSlug` + `postType`
The handler reads `p.htmlSlug` (cached-HTML stem: `html/<htmlSlug>.html`) and `p.postType` (`page`|`post`), but the tool's `inputSchema.pages.items` only declared `slug`/`sourceUrl`/`title`/`isHome`. The server happens to pass args raw (no strip), so it worked — but the schema lied about the contract, and without `htmlSlug` every page (e.g. `about` whose file is `pages--about.html`) would silently fall back to a live fetch of `sourceUrl`. **Fix (applied):** added `postType` (enum page/post) + `htmlSlug` to the schema in `src/mcp-server.ts` so it matches the handler.

---

## 2026-05-28 — corneliusholmes.com (Wix) re-run: content-width band layers + verify `__name` tooling bug

**Found by:** Claude + Matt
**During:** A second `/liberate` pass on corneliusholmes.com. After the prior fixes, content pages STILL rendered flat-white and every captured section `backgroundColor` was `rgb(255,255,255)`.
**Type:** reconstruction fidelity + tooling bug

### 1. Section bands missed because the colored layer is content-width, not full-bleed
The descendant bg-layer scan in `section-extract.ts` (`pickEffectiveBg`) required the colored child to span **≥90% width AND ≥90% height**. A live DOM probe showed Wix paints each band's tint on an **~810px-of-1440 (~56%) inner column** beside a photo (peach `#fadcd6`, blue `#b6d1d9`, sage `#d5e1ca`, warm-grey `#f0eded`), so the ≥90%-width gate skipped them and the section recorded white. **Fix:** accept a *content-width band* — `width ≥ 50%` when it still spans `height ≥ 90%` of the section (full-height ⇒ it's the band, not a small card); largest-area still wins. 40/40 `section-extract.test.ts` pass. Re-extracting with `refresh:true` restored the pastel bands across all content pages. (Extends fix #5 below.)

### 2. `liberate_replicate_verify` section-metrics crash: `__name is not defined`
Every desktop capture's `measureReplicaSectionsInBrowser` `page.evaluate` threw `ReferenceError: __name is not defined` — esbuild/tsx's `keepNames` helper (`__name`) is referenced inside the function body but isn't defined in the page context. This silently disables the automated `SectionParity` live-DOM metrics, forcing QA onto the vision+pngjs fallback. **Still open** — the browser-evaluated function needs to be self-contained (no bundler-injected helpers). Screenshots themselves capture fine.

### 3. Card-grid flatten (prior "still open") — hand-fixed per-page for the homepage
The 3-card numbered service row and the two-tone My-Approach/About-Me blocks still flatten (geometry classifier reads them as `static`, no `cells[]`). For this run they were rebuilt as an R2 per-page `post_content` patch (3 peach cards in a columns row; peach+coral two-tone cards), and the homepage hero was rebuilt as a `wp:cover` (the captured hero `<img>` src came back empty, so the structured render fell back to a black band with an invisible black-on-black title). The underlying **card-grid / cover-hero classifier** gap remains the right systemic fix.

---

## 2026-05-28 — Visual-parity fixes from the corneliusholmes.com (Wix) rebuild: gapless sections, exact captured colors, fluid-off, suffix-tolerant font match, QA sampling

**Found by:** Claude + Matt
**During:** A long parity pass on the corneliusholmes.com homepage where the block reconstruction looked significantly different from the source (muddy/dark hero, saturated-wrong card colors, flattened tiles, white gaps between sections). Root retro → 5 systemic fixes.
**Type:** reconstruction fidelity + scaffold defaults + QA workflow

### What was wrong (and the meta-lesson)
Core-block reconstruction re-derives a bespoke design with generic blocks and *inferred* values, and the agent compounded that by **guessing colors/sizes and declaring "parity" before measuring**. Almost every fix came from MEASURING the source (sampling screenshot pixels, reading the SectionSpec) instead of eyeballing. Treat that as the default: sample, don't guess; lead with the differences.

### Fixes shipped
1. **Suffix-tolerant captured-font matching** (`font-capture.ts` `matchCapturedFamily`). The capture pipeline derives a suffix-free family (`futura-lt-w01`) while the computed style carries a weight/style suffix or builder hash (`futura-lt-w01-book`, `avenir-lt-w01_35-light1475496`). The old EXACT match failed, so the substitution path wrongly fired and replaced the real self-hosted source font with Inter. Now falls back to comparing weight/style/hash-stripped base names. Also reordered `theme-scaffold.ts buildFontFamilies` so a real captured family beats the free substitute.
2. **Fluid typography OFF for replicas** (`theme-scaffold.ts`). `settings.typography.fluid:true` silently rewrote the reconstruction's exact px sizes into shrinking `clamp()`s (a captured 36px heading rendered ~22px). Faithful px wins over fluid scaling.
3. **Gapless full-bleed section stacking** (`page-reconstruct.ts wrapSection`). White gaps between sections came from WP's default top-level block-gap. Every section now zeroes its top/bottom margin so bands butt edge-to-edge; all vertical rhythm comes from each section's own captured padding (`padTopPx`/`padBottomPx`, which the spec already carried).
4. **Paint the exact captured band color** (`page-reconstruct.ts`). A band now renders its real captured tint (e.g. pale-blue `#e8eff1`) instead of the generic `surface-raised` grey approximation. Guarded: near-white and low-alpha (<0.6) and near-neutral-grey tints fall back to the token (don't over-saturate).
5. **Capture the band's real background from a full-span DESCENDANT layer** (`section-extract.ts` `pickEffectiveBg`). Page builders (Wix) paint a section's color on a full-span child (`colorUnderlay`/bgLayers) div, not the `<section>` or its ancestors — so the own→ancestor→sibling walk reported the page white and missed the real band color. Added a geometry-based descendant scan (≥90% width AND height of the section) when own+ancestors give no color or near-white.
6. **design-qa now samples + gates per-section** (`skills/design-qa/SKILL.md`). The skill must sample source-vs-replica pixels per band (colors, inter-section gaps, heading/body sizes), report a per-section delta table, and treat a high structural delta as disqualifying — not declare "matches" from vision alone.

### Still open (next)
- **Card-grid DETECTION.** The 3-card service row flattened to stacked text because the geometry classifier read it as flat `static` (so no `cells[]` were captured → no card bgs). The cell-bg walk already handles descendants; the gap is detecting the grid in the first place. Needs a stronger card-grid/​hero-cover/​pill-row/​testimonial-grid classifier + `section-mapping` templates.
- **Set the html-first expectation up front.** Core-block reconstruction can't pixel-match a bespoke Wix design (absolute positioning, full-bleed image backgrounds, container-query scaling). The skill should say so early and offer the carried-CSS html-first path when the user prioritizes pixel fidelity over editable blocks.

### Verification
`font-capture` / `theme-scaffold` / `font-substitution` (82), `page-reconstruct` / `validate-block-markup` / `compose-instantiate` (71), `section-extract` (40) unit suites pass, incl. new cases (suffix-tolerant match, gapless margins, exact-tint paint, grey-skip). Browser-eval (`pickEffectiveBg` descendant scan) needs a live re-extract to exercise; the MCP server must be restarted to pick up `src/` changes.

---

## 2026-05-28 — Wix `/liberate`: scaffold drops valid captured fonts to Inter; updating post_content in a Studio site needs the VFS path

**Found by:** Claude + Matt
**During:** Migrating https://www.corneliusholmes.com/ (Wix therapy practice — 18 pages, 32 posts).
**Type:** theme-scaffold behavior + Studio CLI operational gotcha

### Finding 1 — `liberate_theme_scaffold` substituted self-hostable source fonts with a generic
The source uses commercial Wix faces — **Futura LT** (display) and **Avenir LT** (body). The scaffold's font pipeline successfully downloaded BOTH as valid woff2 into `theme/assets/fonts/` (verified `file` → "Web Open Font Format (Version 2), TrueType"), yet `theme.json` bound the `body` AND `display` families to **Inter** via `fontSubstitutions` (`arial→Inter`, `futura-lt-w01-book→Inter`). Net effect: the source's geometric-display / humanist-body contrast collapses into one neutral face. The design-foundation's intended substitutes (Jost/Mulish) were also ignored.

**Workaround this run:** hand-rebound `theme.json` `body`→`avenir-lt-w01_35-light1475496` and `display`→`futura-lt-w01` (the real captured woff2, with Jost/Mulish kept as fallback in the stack). Worth tightening the substitution logic: when a captured woff2 is present and valid, prefer self-hosting the real face (or the foundation's chosen substitute) over a generic Inter fallback. Note licensing — Futura/Avenir are commercial; fine for a local benchmark replica, flag for publication.

### Finding 2 — `studio wp post update <id>` can only read files via the `/wordpress` VFS path
QA edits to a page's `post_content` (re-carding the homepage service row) failed two ways before working:
- `post update 208 /abs/host/path.html` → `Error: Unable to read content from '...'` (Studio's PHP sandbox can't see arbitrary host paths).
- `post update 208 - < file.html` (STDIN) → reports `Success` but silently sets `post_content` to **empty** (the proxy doesn't forward stdin).

**Working method:** copy the content file INTO the site dir (`~/Studio/<site>/<file>`) and reference it by its VFS path — Studio mounts the site at `/wordpress`, so `studio wp --path <site> post update <id> /wordpress/<file>`. This mirrors how `studio.ts` drives WXR import (`toVfsPath` + `eval-file`). Always verify with a follow-up `post get <id> --field=post_content | wc -c` — the STDIN path's false success is the dangerous one.

### Why it matters
Both bite any agent-driven Wix replica: Finding 1 silently flattens type identity on sites whose fonts ARE capturable; Finding 2 can blank a reconstructed page during QA touch-ups while reporting success.

---

## 2026-05-22 — `liberate_extract_one` clobbered the WXR (same bug as the 2026-04-30 resume fix, second site of)

**Found by:** Claude + Matt
**During:** Migrating https://www.swiftlumber.com/ — first full extract produced 6 pages; retrying the single failed `/projects` URL via `liberate_extract_one` left the WXR with only that one (failed) page, destroying the other 6.
**Type:** extraction infrastructure bug

### What I found
The 2026-04-30 fix only patched the resume path of `liberate_extract` (`handlers/extract.ts`). `handlers/extract-one.ts` — the agent-first single-URL tool — has the *same* shape: it constructs a fresh `WxrBuilder`, extracts one URL into it, and calls `wxr.serialize(wxrPath)`, atomically overwriting whatever multi-page WXR was already there. Its own comment even flagged the limitation ("v1 extract-one writes a per-call WXR that the watch CLI is expected to merge if needed"), but when the tool is driven directly (not through the watch CLI's shared in-memory builder), nothing merges — so every `extract_one` against an existing extraction truncates it to one item.

### How it's fixed
Extracted the rehydrate-before-serialize logic into a shared helper `src/lib/extraction/wxr-rehydrate.ts` (`rehydrateBuilderFromWxr(wxr, wxrPath)`): reads the prior WXR, copies authors/categories/tags/terms/comments/redirects + non-`nav_menu_item` items onto the fresh builder, and reseeds `_nextId` past the largest retained id. `nav_menu_items` are dropped because the extraction loop regenerates them deterministically each run. Missing prior WXR → no-op; corrupt prior WXR → treated as a fresh start (builder untouched).

- `extract.ts` now calls the helper on `args.resume` (replacing its inline block).
- `extract-one.ts` calls it unconditionally — every `extract_one` is an append to an existing extraction.

Covered by `wxr-rehydrate.test.ts` (merge/nav-drop/id-reseed, missing-file no-op, corrupt-file no-op) and `extract-one.test.ts` (prior pages survive a single-URL append). The latter reproduces the swiftlumber data loss: red before the fix (only `['new']` survived), green after (`['about','contact','home','new']`).

### Why it matters
`extract_one` is the agent-first streaming primitive — the orchestrator calls it repeatedly, once per URL. Pre-fix, any multi-call agent run kept only the *last* URL's item in the WXR. The bug was masked in the watch CLI (shared builder via `processOneUrl`) but active for every direct MCP/agent caller.

---

## 2026-05-22 — Wix Pro Gallery pages fail extraction with "Execution context was destroyed"

**Found by:** Claude + Matt
**During:** Migrating https://www.swiftlumber.com/ — the `/projects` page (a "GALLERY" nav item) failed both in the full extract and on single-URL retry, identically: `page.evaluate: Execution context was destroyed, most likely because of a navigation`.
**Type:** Wix adapter limitation

### What I found
`/projects` returns HTTP 200 (no server redirect) and is a Wix **Pro Gallery** page — `pro-gallery` appears ~876× in the served HTML, with `ProGallery` widgets and inline `window.location` / `location.href` handlers. During hydration the gallery fires a client-side navigation (route/lightbox state), which invalidates the JS execution context just as the adapter's in-page `page.evaluate` extraction script runs. Result: deterministic failure, no HTML capture, no screenshot, no content for that page. All other pages on the site extracted at high quality.

### How it's fixed (2026-05-23)
Layered defense in `src/adapters/wix.ts` so the page survives the navigation-destroys-context race instead of erroring out. All four layers were shipped because the failure is **intermittent and timing-dependent** (under concurrent load the gallery's deferred navigation lands mid-evaluate; in isolation it often doesn't fire at all) — no single layer is reliable on its own:

1. **Route pinning before navigation.** `addInitScript(ROUTE_PIN_INIT_SCRIPT)` no-ops `history.pushState`/`replaceState` and swallows `location.assign`/`replace` writes for the page's lifetime, so the gallery can't navigate away during extraction. Best-effort (the native `location` setter can't always be overridden), installed inside try/catch.
2. **Settle before evaluate.** `goto('domcontentloaded')` → bounded `waitForLoadState('networkidle')` (6s, best-effort — Wix telemetry never truly idles) → fixed 4s delay → a lazy-load scroll pass (so below-the-fold gallery thumbnails enter the DOM) → re-settle. This lets the gallery finish hydrating *before* we read it.
3. **Retry once on destroyed context.** Every in-page `page.evaluate` (globals/JSON-LD/meta, rendered content, blog-archive probe) goes through `evaluateWithRetry`, which on a `isExecutionContextDestroyed(err)` match re-settles and re-runs the evaluate exactly once. The globals read — historically the *unguarded* call that crashed the whole URL — now degrades to an empty shell on a second failure instead of throwing.
4. **Served-HTML fallback.** When the live path fails (or `page.content()` is unreadable), we plain-GET the URL (`fetchHtml`) and run `extractGalleryFromHtml`, which recovers the title, an og:description/heading content shell, and the gallery image URLs from full `static.wixstatic.com/media/...` links *and* the bare `<hash>~mv2.<ext>` media tokens in the `wix-warmup-data` JSON (promoted to canonical CDN URLs). This runs on every page (folding any token-derived URLs the live scan missed into `mediaUrls`), so a Pro Gallery page is never dropped entirely.

New exported, unit-tested helpers: `isExecutionContextDestroyed`, `extractGalleryFromHtml`, `ROUTE_PIN_INIT_SCRIPT`. Covered by `test/adapters/wix-pro-gallery.test.ts` (12 tests, fixture `test/fixtures/wix-pro-gallery.html`): error-classification (matches Playwright + bare CDP phrasings, rejects unrelated errors), gallery image recovery (img src / background-image / og:image / warmup tokens, all normalized to absolute CDN URLs, de-duped), title-suffix stripping, content-shell assembly, and no-false-positives on plain markup.

### Verified live (2026-05-23)
Ran the real `wixAdapter.extract` against just `https://www.swiftlumber.com/projects`:
- **No "execution context destroyed" error escaped** (`thrown: null`); URL logged as `processed` with `qualityScore: high`.
- `pagesExtracted: 1, failed: 0`; WXR item `type: page`, `title: "GALLERY"`, content length 6419 with **25 `<img>` tags** (descriptive alt text) plus heading/body text.
- **72 media collected / 70 image files downloaded** (the gallery photos).
- The served-HTML fallback, exercised in isolation against the live 1 MB markup with **zero JS execution**, independently recovered the title, a content shell, and **33 absolute gallery image URLs** — so even in the worst case (context destroyed, `page.content()` unreadable) the page still yields content + images.

### Honest reliability assessment
**Best-effort, not a guarantee — but the page is no longer dropped.** The live `page.evaluate` path now succeeds on the runs I observed (the destroyed-context error did not reproduce in isolation at the time of the fix; the site may hydrate faster now, or the race only triggers under the concurrent load of a full multi-page + screenshot run). Layers 1–3 widen the window where the live read succeeds; layer 4 guarantees that *if* the live read still fails, the page is salvaged from the served HTML (title + content shell + gallery image URLs) rather than failing the whole URL. The remaining gap vs. a clean live extract is **layout fidelity in the worst case**: the HTML fallback yields the images and a thin content shell, not the full rendered gallery markup. The images themselves — the gallery's actual value — are recovered in every path.

---

## 2026-04-30 — `--resume` overwrites the existing WXR with only newly-extracted items

**Found by:** Claude + James
**During:** Migrating https://www.corneliusholmes.com/ — first run extracted 16 pages, the resume run for 2 remaining failures left only those 2 pages in the final WXR
**Type:** extraction infrastructure bug

### What I found
The `liberate_extract` MCP handler in `src/mcp-server.ts` constructs a fresh `WxrBuilder` on every invocation and calls `wxr.serialize(wxrPath)` at the end, which `writeFileSync`s the WXR (overwriting whatever's there). The `runExtractionLoop` correctly filters URLs already in `extraction-log.jsonl` on `--resume`, so the in-memory builder ends each resume run with *only the newly-extracted items*. Serialize then atomically replaces the prior multi-item WXR with whatever was extracted this run.

Concretely on the test site:
- Run 1 (fresh): extracted 16 pages → `output.wxr` contains 16 pages.
- Run 2 (`--resume`, retrying 2 previously-failed URLs): builder sees 2 new pages → `output.wxr` rewritten with 2 pages, the prior 16 destroyed.

This makes resume worse than useless — it actively damages the prior output. The user thought they were extending the extraction; they were truncating it.

### How it works
On resume, rehydrate the `WxrBuilder` from the existing `output.wxr` *before* calling `adapter.extract`. The repo already has `readWxr` (`src/lib/extraction/wxr-reader.ts`) which produces typed `WxrItem[]` / `Author[]` / etc. matching the builder's public fields. Direct field assignment + reseed `_nextId` past the max existing ID.

`nav_menu_item`s are dropped on load because the extraction loop regenerates them deterministically from the current inventory's navigation each run; keeping the prior ones would produce duplicates.

```ts
if (typedArgs.resume && existsSync(wxrPath)) {
  try {
    const prior = readWxr(wxrPath);
    wxr.authors = prior.authors;
    wxr.categories = prior.categories;
    wxr.tags = prior.tags;
    wxr.terms = prior.terms;
    wxr.comments = prior.comments;
    wxr.redirects = prior.redirects;
    wxr.items = prior.items.filter((i) => i.type !== 'nav_menu_item');

    let maxId = 0;
    for (const it of wxr.items) maxId = Math.max(maxId, it.id);
    // ...same for authors/categories/tags/terms/comments
    wxr._nextId = maxId + 1;
  } catch {
    // Corrupt prior WXR: fall through and treat as a fresh run.
  }
}
```

### Why it's better than the previous approach
Before: `--resume` was destructive — every resume run shrank the WXR to whatever was extracted in that single invocation, even though the underlying log correctly recorded all prior URLs as processed. Users who hit per-page failures and re-ran lost the bulk of their extraction silently.
After: resume is genuinely incremental — prior items survive, only new URLs are added, the WXR grows monotonically until extraction is complete.


## 2026-04-28 — Wix authenticated content endpoints — catalogue

**Found by:** Claude + human contributor
**During:** Mapping Wix's authenticated traffic during a parallel Wix
migration project; needed a reference for the *content* endpoints (vs.
the dashboard infrastructure endpoints already documented)
**Type:** API endpoint | content type

### What I found
The 2026-03-31 *Wix Dashboard API reverse engineering via CDP* entry
covers auth (cookie + XSRF + per-app JWT), window globals, and the
infrastructure endpoints a Wix dashboard hits at load (account,
premium-status, feature-flag, alerts, etc.). What it does not
catalogue is the ten *content* endpoints a logged-in editor or
dashboard hits to read the data the public renderer doesn't expose:
CMS Data Collections including drafts, contacts, members, full-variant
products, form submissions, bookings, blog drafts with Ricos
`richContent` source, full-resolution media originals, and hidden /
password-protected pages.

### How it works
Added a new reference doc at `docs/wix-content-endpoints.md` listing
the ten endpoints with URL, response shape, what public scraping
misses, and per-endpoint gotchas (e.g. CMS items needing
`SANDBOX_PREFERRED` + `includeDraftItems: true` for drafts; signed
media URLs expiring in ~10 minutes; Stores `manageVariants` true/false
branching; three distinct forms-product variants). Linked from
`README.md`.

### Why it's better than the previous approach
Today's adapter relies entirely on rendered HTML + JSON-LD +
opportunistic API capture from public navigation. The reference doc
gives future contributors a baseline of "here's what exists behind
auth, here's what each endpoint returns, here are the traps" — so
subsequent authenticated-mode work doesn't restart from scratch.

## 2026-04-28 — Wix splits hosted media across three CDN hosts

**Found by:** Claude + human contributor
**During:** Migrating Wix sites; noticed platform assets (icons,
decorative imagery) weren't being downloaded
**Type:** platform quirk

### What I found
All Wix-hosted media uses one of three CDN hostnames:

- `static.wixstatic.com` — images, documents (the well-known one)
- `static.parastorage.com` — platform assets: icons, decorative
  imagery, pattern fills used by Wix templates
- `video.wixstatic.com` — video content (already covered by the
  existing `wixstatic.com` term)

The image-CDN regex in `extractImageUrls()` only matched
`wixstatic.com` / `wixmp.com`. `parastorage.com` was silently dropped
during the "only keep image-looking URLs" filter, so platform
decorative assets never made it into the media-download set.

### How it works
Add `parastorage\.com` to the `imageCdns` regex inside
`extractImageUrls()` in `src/adapters/wix.ts`. Comment documents all
three hosts so the next reader doesn't have to re-discover them.

### Why it's better than the previous approach
Before: any URL on `static.parastorage.com` was filtered out unless it
also passed the file-extension check, missing extension-less or
query-param-styled CDN URLs. After: all three Wix CDN hosts are
recognised consistently.

## 2026-04-28 — Wix appends " Main" to every site name

**Found by:** Claude + human contributor
**During:** Migrating multiple Wix sites; noticed every WordPress import
ended up with a site title like "My Studio Main"
**Type:** platform quirk

### What I found
Wix's editor appends a literal " Main" suffix to every site's name. It
shows up in two places:

- `<meta property="og:site_name">` content ends in " Main" (e.g.
  "Gilded Carat Main")
- `document.title` follows the pattern `Page Title | Site Name Main`

The suffix is a Wix internal label (probably the default page-set
name, "Main"). It is never part of the agency's actual site name.

### How it works
At the homepage `siteTitle` extraction site in `discover()`, take the
substring after the last ` | ` and strip a trailing ` Main`:

```js
const t = document.title;
const pipeIdx = t.lastIndexOf(' | ');
const sitePart = pipeIdx > 0 ? t.slice(pipeIdx + 3).trim() : t;
return sitePart.replace(/ Main$/, '').trim();
```

The per-page title stripping in `runExtractionLoop` (slice everything
after ` | `) already handles per-page titles correctly — the trailing
" Main" suffix goes with the site-name half. The bug was site-level
only.

### Why it's better than the previous approach
Before: WordPress imports landed with site titles like
"Home | Gilded Carat Main". After: clean "Gilded Carat".

## 2026-04-28 — Wix product pages expose stable `data-hook` selectors

**Found by:** Claude + human contributor
**During:** Migrating Wix Stores sites where JSON-LD was malformed or
missing AND the products API call hadn't been captured during navigation
**Type:** platform quirk | content type

### What I found
Wix product pages tag key elements with `data-hook="..."` attributes
that have been stable across every Wix Stores site we've tested. When
JSON-LD is missing or malformed *and* the products API call hasn't
been captured, the rendered DOM is still extractable via these hooks —
no need to give up on the product.

| Element | Selector |
|---|---|
| Product title | `[data-hook="product-title"]` |
| Product price (clean) | `[data-hook="formatted-primary-price"]` |
| Product price (wrapper, includes SR "Price") | `[data-hook="product-price"]` |
| Product gallery root | `[data-hook="product-gallery-root"]` |
| Main product image | `[data-hook="main-media-image-wrapper"] img` |
| Thumbnail images | `[data-hook="thumbnail-image"] img` |
| Product description | `[data-hook="product-description"]` |
| Product options | `[data-hook="product-options"]` |

The `[data-hook="product-price"]` wrapper contains a screen-reader span
(`[data-hook="sr-formatted-primary-price"]`) with the literal word
"Price" — use `[data-hook="formatted-primary-price"]` for the clean
value.

### How it works
Added a third fallback path in `extractWixProduct()` after the
JSON-LD and captured-API paths. When both upstream paths fail, parse
the rendered HTML using the hooks above. Required adding an optional
`pageHtml` field to `PageData` so the raw HTML (already captured for
media-URL extraction) is available to the product extractor.

### Why it's better than the previous approach
Before: `extractWixProduct()` returned `null` whenever JSON-LD was
missing AND the product API call wasn't captured (e.g. cached
navigation, slow hydration, throttled requests). After: name, price,
description, and gallery images recover from the rendered DOM —
typically the worst-case path that still yields a usable product
record.


## 2026-04-28 — Wix's `networkidle` never resolves; use `domcontentloaded` + delay

**Found by:** Claude + human contributor
**During:** Building a Wix → WordPress.com migration tool against ~12 live Wix sites
**Type:** platform quirk | bug fix

### What I found
Using `page.goto(url, { waitUntil: 'networkidle' })` against Wix sites
times out on roughly half of product pages. Wix's analytics, chat
widgets, and tracking pixels keep firing requests indefinitely, so the
network never goes idle inside the 30s budget.

### How it works
Switch the wait strategy from `networkidle` to `domcontentloaded` and
add a fixed `await p.waitForTimeout(4000)` afterwards. The 4s delay
covers Wix's client-side hydration of lazy content (Thunderbolt
rendering engine). Applied at all three navigation sites in the Wix
adapter (page extraction, homepage crawl fallback, navigation
extraction).

### Why it's better than the previous approach
Validated empirically across multiple live Wix sites: with
`networkidle`, ~50% of product pages timed out and emitted partial or
empty extractions. With `domcontentloaded` + 4s delay, the same pages
extract reliably and the 30s budget is no longer exhausted by
background telemetry.

## 2026-04-17 — Dedupe Wix URLs across child sitemaps

**Found by:** Claude + human contributor
**During:** Testing the Wix adapter against a range of live Wix sites
**Type:** bug fix

### What I found

`fetchSitemapPw()` pushed every non-XML URL found in each sitemap child into a flat `sitemapUrls` array with no deduplication. Wix sites commonly list the same URL in multiple child sitemaps — most often `/blog` appears in both `pages-sitemap.xml` (as a regular site page) and `blog-categories-sitemap.xml` (as the blog category index). The URL then gets processed twice, and the WXR ends up with two items sharing the same slug, which breaks WordPress import (the importer either rejects the second or silently appends a suffix, leaving inconsistent URLs).

Observed on roughly 24% of tested sites — always the same `/blog` duplication pattern.

### How it works

Added two dedupe Sets in `discover()`:

```ts
const seenUrls = new Set<string>();
const seenSitemaps = new Set<string>();

async function fetchSitemapPw(sitemapUrl, depth = 0) {
  if (depth > 3) return;
  if (seenSitemaps.has(sitemapUrl)) return;
  seenSitemaps.add(sitemapUrl);
  // …existing fetch / parse…
  for (const loc of locs) {
    if (loc.endsWith('.xml')) {
      await fetchSitemapPw(loc, depth + 1);
    } else if (!seenUrls.has(loc)) {
      seenUrls.add(loc);
      sitemapUrls.push(loc);
    }
  }
}
```

`seenUrls` rejects identical URLs across sibling sitemaps. `seenSitemaps` prevents re-fetching a sitemap index file if it appears more than once (defensive — not observed during testing but cheap to add).

### Why it's better than the previous approach

Tested on an affected site after the fix: the WXR no longer contains two items with `slug=blog`. Content coverage unchanged — the URL is still extracted, just once.

---

## 2026-04-17 — Dedupe Wix URLs across child sitemaps

**Found by:** Claude + human contributor
**During:** Testing the Wix adapter against a range of live Wix sites
**Type:** bug fix

### What I found

`runExtractionLoop()` in `src/adapters/shared.ts` had a type-promotion fallback: if `classifyUrl()` returned `page` or `homepage`, it would re-check via a regex `/@type.*BlogPosting|NewsArticle|Article|SocialMediaPosting/` run across the full `pageData.content` string. Any occurrence anywhere in the HTML promoted the item to `post`.

The problem: blog *listing* pages (`/blog--categories--X`, `/blog`) commonly embed `BlogPosting` JSON-LD cards for each post they display in their index. The regex happily matched those embedded cards and promoted the listing page to `post` — producing authorless "posts" in the WXR whose content was a list of links to other posts. Observed on multiple tested sites: one jewellery ecommerce site had 6 of 15 "posts" misclassified; an interior-design blog had 11 of 96; a furniture store had 2 of 7.

### How it works

Replaced the raw-content regex with a structured check using `pageData.jsonLd` (the array of already-parsed JSON-LD objects the adapter returned):

```ts
const BLOG_TYPES = new Set(['BlogPosting', 'NewsArticle', 'Article', 'SocialMediaPosting']);
const isRealBlogPost = Array.isArray(pageData.jsonLd) && pageData.jsonLd.some((ld) => {
  if (!ld || typeof ld !== 'object') return false;
  const obj = ld as Record<string, unknown>;
  const atType = obj['@type'];
  if (typeof atType !== 'string' || !BLOG_TYPES.has(atType)) return false;
  const mep = obj.mainEntityOfPage;
  if (mep && typeof mep === 'object') {
    const mepRec = mep as Record<string, unknown>;
    const mepUrl = typeof mepRec.url === 'string' ? mepRec.url :
                   typeof mepRec['@id'] === 'string' ? mepRec['@id'] as string : null;
    if (mepUrl && mepUrl !== url) return false;
  }
  return true;
});
```

Two tightenings: (1) `@type` must be at the top level of a JSON-LD object, not anywhere in the raw HTML; (2) when `mainEntityOfPage` is present, its URL must match the current page URL — so embedded-card JSON-LD (whose `mainEntityOfPage` points to *other* posts) can't promote the current page.

Also added `jsonLd?: unknown[]` to the `ExtractedPage` interface and piped `pageData.jsonLd` through the Wix adapter's `extractPage` callback so the shared loop has the parsed objects available.

### Why it's better than the previous approach

Tested on a food-blog site alongside the sibling URL-classifier fix that stops bare `/blog` from classifying as `post`: the `/blog` listing page is now correctly a `page` with its listing content, and no longer promoted to a post by its embedded BlogPosting cards for indexed posts.

## 2026-04-17 — Wix sitemap discovery silently loses child sitemaps under CDN pressure

**Found by:** Claude + human contributor
**During:** Testing the Wix adapter against multiple live sites in parallel
**Type:** bug fix

### What I found

`fetchSitemapPw()` in the Wix adapter's `discover()` wrapped `p.goto(sitemapUrl)` in `try { … } catch { /* sitemap fetch failed */ }` with a silent early-return on `!resp.ok()`. When Playwright timed out or the Wix CDN returned a transient error on a child sitemap (e.g. `pages-sitemap.xml`, `blog-posts-sitemap.xml`), the failure was swallowed — no log, no retry, no end-of-discovery warning. The extraction proceeded with whatever URLs happened to arrive before the failure, producing a WXR with (often) zero real pages.

Observed on roughly 20% of sites during parallel-worker testing: several produced zero-content WXRs outright (media downloaded, pages empty), while others had `pages-sitemap.xml` children silently skipped while other sitemaps (store-products, blog-posts) went through.

Re-running the affected sites sequentially (outside the parallel run) extracted them cleanly — confirming the failures were transient, not deterministic, and the old code gave the user no way to know they'd lost data.

### How it works

Wrapped the `p.goto` call in an up-to-3-attempt retry loop with exponential backoff (500ms × attempt number):

```ts
const RETRIES = 3;
for (let attempt = 1; attempt <= RETRIES; attempt++) {
  try {
    const resp = await p.goto(sitemapUrl, { timeout: 15000 });
    if (!resp || !resp.ok()) {
      lastErr = resp ? 'HTTP status-not-ok' : 'no response';
      if (attempt < RETRIES) { await sleep(500 * attempt); continue; }
      console.warn(`[wix:discover] sitemap fetch failed after ${RETRIES} attempts: ${sitemapUrl} (${lastErr})`);
      sitemapFailures.push({ url: sitemapUrl, reason: lastErr });
      return;
    }
    // …parse and recurse as before, then `return` on success
  } catch (err) {
    // …same retry pattern on thrown errors
  }
}
```

On final failure the URL + reason is logged via `console.warn` and appended to a `sitemapFailures` array. After the recursive discovery completes, an end-of-phase summary warns if any fetches failed — so the operator sees that inventory may be incomplete rather than silently getting partial data.

### Why it's better than the previous approach

Tested on a small Wix business site with a dry run (clean discovery, no retries needed). The previous silent-failure behavior turned transient network blips or CDN rate-limits into silent data loss; now the same blips are retried and — if persistent — surfaced as visible warnings.



## 2026-04-17 — Site-level JSON-LD leaks into Wix category-page content

**Found by:** Claude + human contributor
**During:** Testing the Wix adapter against a range of live Wix sites
**Type:** bug fix

### What I found

`deriveContent()` step 3 accepted `description` from *any* JSON-LD object on the page. Wix ecommerce templates commonly include a site-level JSON-LD block — `@type: "FurnitureStore"`, `"Organization"`, `"LocalBusiness"`, `"Restaurant"`, etc. — whose `description` field is a generic store tagline written once by the site owner. Every page that falls through to step 3 (Wix category archives whose product grids are JS-rendered, for example) ends up with the same site-wide tagline as its body content.

Observed on a tested furniture-store site: 49 of 58 pages (84%) had the identical 266-character site-tagline as `<content:encoded>` — because each `/category/…` page has no static content (the product grid is rendered client-side) so derivation fell through API → DOM → and grabbed the `FurnitureStore` JSON-LD description. When imported to WordPress, the category pages are indistinguishable.

### How it works

Two changes to `deriveContent()`:

1. **`@type` allow-list for JSON-LD description**: introduced `CONTENT_LD_TYPES = {Article, BlogPosting, NewsArticle, SocialMediaPosting, Product, ItemPage, Event, Recipe, Course, Book, Movie}`. The JSON-LD `description` fallback now only accepts a match whose top-level `@type` is in the allow-list. `articleBody` remains universally accepted (it's inherently content-level).

2. **`og:description` fallback** (new step 4): when steps 1–3 fail, use `pageData.meta.ogDescription || pageData.meta.description` if ≥ 50 chars. `og:description` is per-page (written by the site owner for sharing), so pages that share the old site-level fallback now carry their own per-page description instead.

The accessibility-tree fallback moves from step 4 to step 5; empty from 5 to 6.

### Why it's better than the previous approach

Tested on two category pages from the affected site: both now derive content from `og:description` instead of the shared `FurnitureStore` block, so the category pages produce distinct content rather than identical boilerplate.

---

## 2026-04-17 — Wix API responses leak `<link>`/`<meta>` tags as page content

**Found by:** Claude + human contributor
**During:** Testing the Wix adapter against a range of live Wix sites
**Type:** bug fix

### What I found

`deriveContent()` in the Wix adapter tries API-call responses first, using `findHtmlContent()` to walk JSON bodies for keys named `html`/`richText`/`body`/`content`/`text`/`plainText` containing HTML-like strings. The existing validator (after the earlier tag-manager fix) strips `<script>` and `<style>` tags before accepting, but this still admits HTML fragments whose only "content" is `<link>` or `<meta>` elements — e.g. a module-preload manifest's body field populated with a pile of `<link rel="modulepreload" href="…chunk.js">` elements, or a Mapbox widget's bootstrap fragment containing just a single `<link href="…mapbox-gl.css" rel="stylesheet">`.

Observed on two tested sites where every single page (100% — an art portfolio's 28 pages and a glass-studio site's 15 pages) was written to the WXR with these head-fragment leaks as the full `<content:encoded>` body — making the imported WordPress pages completely unusable.

### How it works

Extended the post-match validator:
1. Strip `<link>`, `<meta>`, and `<noscript>` tags in addition to `<script>` and `<style>`.
2. Require the stripped remainder to contain at least one body-level tag from a fixed list (`p`, `h1-h6`, `ul`, `ol`, `li`, `div`, `section`, `article`, `img`, `figure`, `blockquote`, `table`). A "high-quality" content source must look like a page body, not a head or metadata fragment.

If either check fails the adapter falls through to the next source in the derivation chain (rendered DOM, JSON-LD, accessibility tree) — so pages that previously got nothing-but-junk now pull real body content from the DOM instead.

### Why it's better than the previous approach

Tested on both affected sites. All pages now carry real body content from the rendered DOM (headings, paragraphs, images) instead of head-only `<link>` fragments. Builds on the earlier tag-manager validator by extending the strip list to `<link>`/`<meta>` and requiring body-level tags.

---

## 2026-04-17 — Wix blog URL classification: `/single-post/` and bare `/blog` listings

**Found by:** Claude + human contributor
**During:** Testing the Wix adapter against a range of live Wix sites
**Type:** bug fix

### What I found

Two separate URL-classification bugs in `classifyUrl()` in `src/lib/extraction/sitemap.ts`:

1. **Older Wix Blog format** uses `/single-post/<slug>` URLs (distinct from newer `/post/<slug>` or `/blog-1/post/<slug>` patterns the classifier already matched). One sizeable Wix blog encountered during testing had ~1000 blog posts at `/single-post/*` URLs; every single one was written to the WXR as `wp:post_type=page` — the whole blog archive landed in WordPress as pages.

2. **Bare `/blog`, `/news`, `/articles`** were classified as `post` because the regex `/\/(blog|post|posts|...)(\/|$)/` allowed end-of-string after the keyword. These URLs are the blog *listing* pages, not individual posts. They got written to WXR as authorless "posts" with titles like "Our blog" — polluting the post archive. Seen on multiple tested sites where the `/blog` URL was listed in both `pages-sitemap.xml` and `blog-categories-sitemap.xml`.

### How it works

Two changes to the classifier regex:

- Added `if (/\/single-post\//.test(path)) return 'post';` for the older Wix Blog URL pattern.
- Changed the main blog-keyword regex from `(\/|$)` to `\/[^/]` — require a non-slash character after the keyword's trailing slash. This means `/blog/my-post` still matches (post), but bare `/blog` and `/blog/` now fall through to the `page` default (listing page).

### Why it's better than the previous approach

Tested on the affected sites: blog archives now classify correctly (individual posts as `post`, bare `/blog` as `page`). The existing `classifies blog paths as post` test was updated to remove the now-wrong `/blog → post` expectation, and two unit tests were added covering both new patterns.

---

## 2026-04-16 — Wix Tag Manager poisons content extraction

**Found by:** Claude + human contributor
**During:** Migrating a 45-page Wix ecommerce site (bestiehugs.com)
**Type:** bug fix

### What I found
Wix's Tag Manager API (`/_api/tag-manager/api/v1/tags/sites/...`) returns a field named `content` containing analytics `<script>` blocks. `deriveContent()` matches this first (key="content", >50 chars, contains "<"), returns qualityScore "high", and never consults the rendered DOM — which has the real page content in `[data-testid="richTextElement"]` elements. After `stripNonContentTags()` removes the script, the WXR gets empty `content:encoded`.

### How it works

Added a post-match validation step: after `findHtmlContent()` returns a match from an API call, strip `<script>` and `<style>` tags and verify >50 chars of real HTML remain. If not, skip and continue to the next content source (rendered DOM, JSON-LD, accessibility tree).

### Why it's better than the previous approach

Tested against 7 live Wix sites. 5 of 7 had tag-manager responses that triggered this bug, producing completely empty page content. After the fix, all 5 extract real content (424–5684 chars) from the rendered DOM. The 2 unaffected sites remain unchanged.


## 2026-04-16 — Wix Product JSON-LD uses non-standard casing

**Found by:** Claude + human contributor
**During:** Migrating a Wix ecommerce site (20 products)
**Type:** bug fix

### What I found
Wix emits Product JSON-LD with non-standard casing: `"Offers"` (uppercase O) instead of schema.org's `"offers"`, and `"Availability"` (uppercase A) instead of `"availability"`. Product images use `"contentUrl"` (per schema.org ImageObject spec) but the adapter only checked for `"url"`. Result: all product prices, images, and stock status were silently lost.

### How it works

Changed `extractWixProduct()` to check both cases for offers (`obj.offers || obj.Offers`) and availability (`offer.availability || offer.Availability`), and to accept both `url` and `contentUrl` for image objects.

### Why it's better than the previous approach

Tested against 2 live Wix Stores. Before: price="" and images=0 on every product. After: site recovers price=200 (ILS) and 5 images; site recovers price=1295 (GBP) and 11 images. Stock status also corrected (hoodie correctly shows OutOfStock).

## 2026-04-16 — Wix /product-page/ URLs misclassified as pages

**Found by:** Claude + human contributor
**During:** Migrating a Wix ecommerce site 
**Type:** bug fix

### What I found

Wix uses `/product-page/<slug>` URLs for store products. `classifyUrl()` only matched `/(products?|store|shop)/`, so product pages were classified as regular pages. This caused them to be added to the WXR as empty page items in addition to the products.csv, cluttering the WordPress Pages list on import.

### How it works

Added `product-page` to the product URL regex in `classifyUrl()`. The Wix adapter already had its own `/product-page/` check for CSV routing, but the shared URL classifier needed it too so the extraction loop skips adding products as WXR pages.

### Why it's better than the previous approach

Product pages are now correctly routed to WooCommerce CSV only, not duplicated as empty WordPress pages. No regressions on other URL patterns (blog, shop, product, gallery, event, homepage all unchanged).

## 2026-04-13 — GoDaddy Websites & Marketing hydrates blog bodies from `window._BLOG_DATA` (Draft.js)

**Found by:** Claude + Matt (adding the `godaddy-wm` adapter against cruisewarehouse.com and skywaydiner.com)
**During:** Building the GoDaddy W+M adapter for lonestardomains' 300-post blog migration
**Type:** platform architecture | content format

### What I found

GoDaddy's legacy Websites & Marketing platform (aka "Go Daddy Website Builder", the pre-Airo builder) renders blog post **pages** as static HTML, but the post body itself is **not** in the rendered DOM. Meta tags (`og:*`, `<title>`), navigation chrome, and header/footer are server-rendered normally — but the actual post content lives inside a `window._BLOG_DATA={...}` JSON blob embedded in a `<script>` tag near the end of the document, and hydrates client-side.

The blob shape:

```js
window._BLOG_DATA = {
  head: { title, meta: [{type, key, value}, ...] },
  post: {
    blogId, postId,
    title, slug,
    date, publishedDate,
    content,          // truncated plain-text excerpt (~200 chars, ends in "...")
    fullContent,      // JSON-encoded Draft.js ContentState — THE REAL POST BODY
    featuredImage,    // full-resolution img1.wsimg.com URL
    categories: ["Category A", ...],
    hideCommenting, featureFlags, socialSharing
  }
}
```

`post.fullContent` is a **Draft.js** ContentState (`{blocks: [...], entityMap: {...}}`). Blocks use the standard Draft.js types: `unstyled`, `header-one` through `header-six`, `unordered-list-item`, `ordered-list-item`, `blockquote`, `code-block`, and `atomic` (used for images via an `IMAGE` entity). Inline styles (`BOLD`, `ITALIC`, `UNDERLINE`, `STRIKETHROUGH`, `CODE`) and entity ranges (`LINK`, `IMAGE`) are standard Draft.js.

**Pages** (non-blog-post URLs) behave differently — they're fully server-rendered into the DOM, no JSON blob. Section titles and hero images are tagged with stable `data-aid` attributes like `ABOUT_SECTION_TITLE_RENDERED` and `ABOUT_IMAGE_RENDERED0`, so page extraction can strip them reliably.

### How the adapter uses this

The `godaddy-wm` adapter detects `_BLOG_DATA` at the start of `extractPage`. If present, it:

1. Parses the JSON blob
2. Parses `post.fullContent` as Draft.js ContentState
3. Drops the first block if it's an atomic image matching `post.featuredImage` (otherwise the body would lead with the same image that's already captured via mediaUrls)
4. Converts blocks to HTML: `unstyled` → `<p>`, `header-N` → `<h1..6>`, list items wrapped in `<ul>`/`<ol>`, atomic IMAGEs → `<figure><img/></figure>`, plus inline style and LINK entity application
5. Uses `post.title`, `post.publishedDate`, `post.categories`, and `post.featuredImage` as the canonical source of truth (all higher-fidelity than scraping HTML meta tags)

See `src/adapters/godaddy-wm.ts` — `draftToHtml()`, `parseBlogData()`, and the blog-post branch of `extractPage`.

### Gotchas

- **`post.content` is a truncated excerpt**, not the real body. It's the first ~200 characters of `fullContent` with a trailing `...`. Don't use it as post content — use `fullContent` and convert. Do use a cleaned version of `content` as the excerpt / `seoDescription`.
- **The first Draft.js block is almost always an atomic image of the featured image.** If you also add `post.featuredImage` to `mediaUrls` (you should, for attachment tracking), dedupe by dropping the Draft.js block.
- **`classifyUrl` doesn't recognize W+M's blog URL shape.** Blog posts live at `/<section-slug>/f/<post-slug>` (e.g. `/news%2C-updates-and-reviews/f/do-people-steal-your-towel`). That path doesn't match the generic `/blog/`, `/post/`, `/news/` regex. The adapter works around this by fetching `sitemap.blog.xml` and `sitemap.website.xml` individually in `discoverWmUrls` and tagging URLs by source sitemap rather than relying on `classifyUrl`.
- **The sitemap index always lists `sitemap.ols.xml`** (GoDaddy Online Store) even on sites without a store. Don't trust the index — fetch the sub-sitemap and check for a 404.
- **Detection fingerprints:** `<meta name="generator" content="...Go Daddy Website Builder...">` in page source is the strongest signal. Also `img1.wsimg.com/isteam/` CDN pattern in source and `X-SiteId` / `dps_site_id` cookie from GoDaddy's DPS infrastructure. Custom domains mean URL-based detection is useless.

### Media fidelity: the isteam CDN URL upgrade trick

W+M's `img1.wsimg.com/isteam` CDN encodes image transforms directly in the URL path after a `/:/` segment marker — e.g. `/isteam/ip/<uuid>/<filename>.jpg/:/rs=w:370,cg:true,m`. The `rs=` specifies resize, `cr=` crop, `cg:true` preserves aspect. Extracting images straight from the live DOM gives you whatever small variant was rendered on the page (usually 370–1200px wide).

**Stripping the `/:/<transforms>` suffix does NOT give you the original.** `https://img1.wsimg.com/isteam/ip/<uuid>/<filename>.jpg` returns a default ~600px thumbnail. The CDN has no "no transform = original" mode.

**What works:** append `/:/rs=w:4000,cg:true`. The CDN caps at 3840px wide (more specifically, 3840×3840 for square-cropped stock images, 3840×<aspect-preserved-height> for user-uploaded images). Requesting larger widths still returns 3840. Dropping `cg:true` caps at 1732. Without any transform you get ~600px. So `rs=w:4000,cg:true` is the universal "give me the biggest thing you've got" form.

For a real user-uploaded image: without transform → 45KB / 602×345; with `rs=w:4000,cg:true` → 500KB / 3840×2201. ~10× the file size, ~6× the linear resolution.

**Two places this must be applied consistently** — the WP importer rewrites media URLs via exact string match, so the `<img src>` that ends up in post/page body HTML must equal the URL stored on the media attachment. Rewrite at *both* the adapter's `mediaUrls` collection *and* wherever body HTML is generated (Draft.js atomic block renderer + cheerio `img[src]`/`source` rewriter for pages).

**Responsive `srcset` is unsalvageable by parsing.** W+M emits `<picture><source srcset="...1x, ...2x, ...3x"><img src>...</picture>` where the URLs inside `srcset` contain their own commas (from crop params like `cr=t:12.53%25,l:0%25,w:100%25,h:74.93%25`). A naive comma-split corrupts the URLs. Rather than write a URL-aware srcset parser, the adapter **drops `srcset` and `data-srcsetlazy` entirely** and promotes the lazy URL into `src`. WordPress regenerates its own srcset from the uploaded media on import, so nothing is lost — the body still displays at the right size, it just lets WP control the variants.

**The shared media downloader also needed a fix.** It derives the local filename via `basename(urlObj.pathname)` — fine for ordinary URLs, but broken for URLs with `/:/` transforms because the last path segment becomes the transform spec itself (e.g. a file literally named `rs=w:4000,cg:true`). `src/lib/extraction/media.ts` now looks for the `/:/` marker and uses the segment before it as the filename source, falling back to a content-type-derived extension when the derived name has none (e.g. `/isteam/getty/1142417322` → filename `1142417322.jpg`).

### v1.1 follow-ups

- **OLS product extraction** — W+M sites with a GoDaddy Online Store surface products via `sitemap.ols.xml`. Not yet implemented because neither test site (cruisewarehouse.com, skywaydiner.com) actually has a store despite advertising the sub-sitemap.
- **Authenticated fidelity mode** — a Playwright-based variant that uses a user-provided `dashboard.godaddy.com/websites` session to intercept W+M's internal JSON APIs could rescue draft posts, accurate publish dates, and original-resolution media. Only worth building if scraped fidelity turns out to be insufficient.

---

## 2026-04-13 — HubSpot CMS platform adapter

**Found by:** Claude + human contributor
**During:** Adding HubSpot CMS as a new supported platform
**Type:** platform adapter

### What I found

HubSpot CMS Hub powers a wide range of sites from SMB marketing pages to enterprise content hubs. Sites run on custom domains and use a well-structured class naming convention that makes detection and extraction straightforward once you know the patterns.

**Detection signals:**
- `<meta name="generator" content="HubSpot">` is the only reliable signal. Many non-HubSpot sites embed HubSpot marketing scripts (CTAs, forms, tracking), so `hubspot.com`, `hs-scripts.com`, and `hsforms.net` references in page source are NOT sufficient. For example, eplan.co.za has all the HubSpot scripts but its generator tag says TYPO3 — it's a TYPO3 site using HubSpot for marketing.

**Content structure:**
- `<body>` class identifies content type:
  - `hs-blog-post` on blog post pages (authoritative — used for classification)
  - `hs-site-page page` on regular pages
- Blog post content: `div.post-body` (clean article body)
- Regular pages: `div.body-container` (strip nav/header/footer)
- Content modules wrap in `div.hs_cos_wrapper` with `_type_rich_text`, `_type_form`, `_type_cta`, etc.
- Marketing widgets to strip during extraction: `.hs-cta-wrapper`, `.hs-cta-node`, `hs_cos_wrapper_type_form`, `hs_cos_wrapper_type_blog_comments`, AddThis social widgets
- Blog titles render as `<h1>` inside content — strip to avoid duplication with `post_title`
- Navigation: `.hs-menu-wrapper` with `.hs-menu-item`, `.hs-menu-depth-*`

**Blog post metadata:**
- Date: byline text "by Author, on Dec 6, 2024 6:57:40 PM" (parsed by adapter), plus `article:published_time` meta tag fallback
- Author: `<a href="/*/author/{name}">{display name}</a>`
- Topics (tags): `<a href="/*/topic/{slug}">{display name}</a>` in post footer

**Media hosts:**
- `/hubfs/*` paths on the site itself (HubSpot's file manager)
- `hubspotusercontent-*.net` CDN (regional, e.g. `-na1`, `-eu1`)
- `fs1.hubspotusercontent-*.net` for files

**Sitemaps:** Standard `/sitemap.xml`, auto-generated, comprehensive. Includes image sitemap extensions with alt text.

### How it works

The adapter follows the established fetch-and-scrape pattern:
1. `detect()` is URL-less — relies on the Hubspot generator meta tag in `detect-platform.ts`
2. `discover()` fetches the homepage + sitemap, extracts site metadata from OG tags and `<html lang>`, classifies URLs (with common HubSpot blog paths like `/blog/`, `/news/`, `/insights/` treated as posts — individual pages are reclassified at extract time via body class)
3. `extract()` uses `runExtractionLoop()` with a HubSpot-specific `extractPage` that:
   - Reads the `<body>` class to classify post vs page (overrides URL-based classification via `detectedType`)
   - Extracts blog content from `.post-body`, page content from `.body-container` with chrome stripped
   - Strips HubSpot marketing widgets (CTAs, forms, comments, AddThis) from content
   - Parses date from byline text when `article:published_time` isn't present
   - Extracts author from `/author/` link text, topics (tags) from `/topic/` link text
   - Strips the embedded `<h1>` title to prevent duplication with `post_title`
   - Resolves relative URLs so WordPress can match attachment URLs during import

### Known limitations

Tags are extracted from topic links and returned as post tags, but they don't currently land as WordPress taxonomy terms on import. The WXR builder writes the taxonomy section at `openStream()` time, before posts are extracted, so late-registered `<wp:tag>` entries aren't persisted in streaming mode. This is a shared-code gap affecting all adapters that pass tag slugs directly through `addPost`. Topics still appear as inline linked text in imported post content.

### Why it's better than the previous approach

HubSpot CMS was not previously supported. Adds coverage for a widely-deployed CMS used by large enterprises (Avast, FlightAware, Wattpad, HubSpot itself) and many mid-market companies. Tested end-to-end against eflexsystems.com (156 URLs: 32 pages, 124 posts, 930 media references) and maus.com (185 URLs). The 124 blog posts imported into WordPress with correct titles, dates, authors, and clean content bodies; title duplication avoided.

---

## 2026-04-13 — Hostinger Website Builder platform adapter

**Found by:** Claude + human contributor
**During:** Adding Hostinger Website Builder as a new supported platform (fastest-growing proprietary builder per w3techs: +103.9% YoY)
**Type:** platform adapter

### What I found

Hostinger Website Builder (formerly Zyro) is built on Astro and serves images from a dedicated CDN. Sites run on custom domains only — there's no `hostinger.com` subdomain pattern to key detection off of.

**Detection signals:**
- `zyrosite.com` references in page source (strongest signal — every Hostinger site loads images from `assets.zyrosite.com` via Cloudflare Image Resize)
- `<meta name="generator" content="Hostinger Website Builder">` tag (reliable fallback for sites with no inline images)
- `astro-island` / `astro-slot` custom elements confirm the Astro-based build but aren't needed for detection

**Content structure:**
- Content rendered as a series of `<section class="block ...">` elements with chrome (sticky bars, headers, footers) using distinguishing modifier classes (`block-sticky-bar`, `block-header`, `block--footer`, `block-blog-header`)
- Generic `class="block"` sections contain real content; modifier-class sections are site chrome
- `<main>` wraps ALL page sections including chrome, so main-based extraction pulls in site furniture — must extract by section classes instead
- Blog posts include rich JSON-LD `Article` schema with `headline`, `datePublished`, `articleSection` (categories), and `author.name`
- Product pages include JSON-LD `Product` schema and render the product block with `class="block-product-wrapper"`
- Blog templates render the post title as `<h1 class="block-blog-header__title">` inside the content — must be stripped to avoid duplicate titles when WordPress renders `post_title`
- Images served from `assets.zyrosite.com/cdn-cgi/image/format=auto,w=N,h=N,fit=crop/SITE_ID/hash.png` — the `/cdn-cgi/image/PARAMS/` prefix is a Cloudflare Image Resize transformation; stripping it yields the original asset URL
- CSS class names are hashed/obfuscated (e.g. `globalClass_2ebe`) — not useful as targeting selectors

**Sitemaps:** Standard XML sitemaps at `/sitemap.xml` with pages, blog posts, and category landing pages.

**Blog URL convention:** `/blog-post1`, `/blog-post2`, ... (sequential numeric slugs) — used for blog post classification.

### How it works

The adapter follows the established fetch-and-scrape pattern:
1. `detect()` is URL-less — relies on HTTP fingerprinting via `zyrosite.com` source signal and generator meta tag in `detect-platform.ts`
2. `discover()` fetches the homepage + sitemap, extracts site metadata from OG tags and `<html lang>`, classifies URLs (with `/blog-post*` and `/blog/*` treated as posts)
3. `extract()` uses `runExtractionLoop()` with a Hostinger-specific `extractPage` that:
   - Parses JSON-LD for Article metadata (headline, date, author, categories) and Product data
   - Extracts content by collecting non-chrome `<section class="block">` blocks
   - Strips the embedded `<h1>` title to prevent duplication with `post_title`
   - Resolves relative `src`/`href` attributes to absolute URLs so WordPress can match attachments during import
   - Signals product pages via `detectedType: 'product'` so they route to `products.csv` instead of being imported as pages
4. A per-URL `productCache` lets the adapter pre-extract WooProduct data from JSON-LD (which lives in `<head>`, outside our extracted content) and hand it to the shared loop's `extractProduct` callback

Content extraction uses `<section class="block">` blocks as the primary strategy with `<article>`, `<main>` (chrome-stripped), and `<body>` fallbacks. Media URLs are normalized by stripping the Cloudflare Image Resize prefix so byte-identical images aren't downloaded multiple times with different resize parameters.

### Why it's better than the previous approach

Hostinger Website Builder was not previously supported. This adds coverage for the fastest-growing proprietary website builder per w3techs data (+103.9% YoY, +2.16 daily sites gained), making it a high-value migration target for users who chose Hostinger's free/cheap tier and want to move to WordPress. Tested end-to-end against 5 live sites (content blog, multi-language villa site, AI marketing site, small bakery, commerce-enabled affiliate site) with pages, posts, products, and media all importing into WordPress correctly.

---

## 2026-04-13 — Weebly platform adapter

**Found by:** Claude + human contributor
**During:** Adding Weebly as a new supported platform
**Type:** platform adapter

### What I found

Weebly sites use a consistent HTML structure across all sites with reliable fingerprints for detection. Key findings from analyzing multiple live Weebly sites:

**Detection signals:**
- URL pattern: `weebly.com` subdomains
- CDN: All Weebly sites load assets from `editmysite.com` (cdn1/cdn2)
- HTML markers: `wsite-` class prefix on all structural elements, `_W.configDomain` JS variable referencing `weebly.com`

**Content structure:**
- Main content container: `#wsite-content`
- Navigation: `li.wsite-menu-item-wrap > a.wsite-menu-item` with flyout submenus in `.wsite-menu-wrap`
- Blog posts: Minimal semantic markup — titles in `<h2>` with anchor links, dates as plain text in MM/DD/YYYY format, categories linked via `/blog/category/slug`
- Products: `.wsite-product` with commerce backed by Square (Weebly's parent company)
- No JSON-LD or structured data on any tested sites

**Sitemaps:** Standard XML sitemaps available at `/sitemap.xml` with pages, blog posts, products, and category pages.

### How it works

The adapter follows the same fetch-and-scrape pattern as the Webflow adapter:
1. `detect()` matches `weebly.com` in the URL
2. `discover()` fetches the homepage HTML + sitemap, extracts navigation from the `wsite-menu` structure, and classifies URLs (with special handling for `/blog/` paths as posts)
3. `extract()` uses `runExtractionLoop()` with a Weebly-specific `extractPage` function that pulls content from `#wsite-content`, media from `editmysite.com`/`weeblycloud.com` CDN URLs, and blog metadata from category links and date text

Platform detection in `detect-platform.ts` uses two source signals: `editmysite.com` in page source (high confidence) and `wsite-` class markers or `_W.configDomain` variable (medium confidence). Custom domain sites without `weebly.com` in the URL are detected via these HTTP fingerprints.

### Why it's better than the previous approach

Weebly was not previously supported. This adds the fifth platform adapter, covering another significant website builder with a large install base of small business sites.

---

## 2026-04-02 — Squarespace admin extraction via CDP

**Found by:** Claude + human contributor (live testing against a Squarespace site)
**During:** Building the Squarespace extraction pipeline
**Type:** API endpoint | architecture

### What I found

Connected to a logged-in Chrome session via CDP and intercepted Squarespace's admin API calls and `__NEXT_DATA__` hydration state. Key findings:

**Admin API endpoints discovered:**
- `/api/catalog-preview/` — page catalog with IDs, URLs, visibility status
- `/api/content/` — page content with structured sections
- `/config/pages` — page configuration and navigation structure

**`__NEXT_DATA__` hydration:** Squarespace's admin uses Next.js. The `window.__NEXT_DATA__` object contains page props with structured content, descriptions, and metadata that aren't available through the public API.

**Public `?format=json` API:** Squarespace exposes a no-auth JSON API by appending `?format=json` to any public URL. Returns collection metadata, item counts, tags, categories, and content. Useful as a fallback but lacks draft/unlisted pages and admin-only metadata.

### How it works

The extraction pipeline uses a three-tier fallback chain:
1. **Admin API interception** — CDP captures JSON responses from admin navigation, filtered to only include data relevant to the target page (excludes `/api/context/`, `/api/billing/`, user profile data)
2. **Admin `__NEXT_DATA__` hydration** — extracts structured page data from Next.js hydration state
3. **Public DOM extraction** — falls back to parsing the published page's DOM via the accessibility tree

Smart fallback heuristics trigger the public fallback when admin extraction produces <80 chars of content, <=1 section, or contains admin UI artifacts.

### Why it's better than the previous approach

The public `?format=json` API misses draft pages, unlisted content, and structured section data. Admin extraction via CDP captures everything the site owner can see, with the browser handling authentication automatically.

---

## 2026-03-31 — Wix Dashboard API reverse engineering via CDP

**Found by:** Claude + human contributor (live probing against Brave browser)
**During:** Building the probe tool against a real Wix account
**Type:** API endpoint | window global | architecture

### What I found

Connected to a live Brave browser session via CDP (port 9222) and probed both the Wix Dashboard (`manage.wix.com`) and Editor (`editor.wix.com`) pages. Key findings:

**Auth pattern**: Wix uses cookie-based auth + `X-XSRF-TOKEN` header + per-app `authorization` tokens (signed JWTs unique to each Wix "app" like blog, chat, etc.). The XSRF token comes from the `XSRF-TOKEN` cookie. The authorization tokens are embedded in the page at load time and are app-scoped.

**Key API endpoints discovered (all returning 200)**:
- `/_api/account-server/v1/users/my_accounts` — lists all user accounts
- `/_api/premium-store/plans/premiumStatus?metaSiteId=...` — shows plan type (FREE, PREMIUM, etc.)
- `/_api/site-actions/topology` — static asset URLs and service versions
- `/_api/header-server/init` — massive experiments config + feature flags
- `/_api/items-selection-service/v1/items-selection/installed-providers` — all installed Wix apps/providers (11KB+ of data)
- `/_api/notifications-widget-server/alerts` — site alerts
- `/_api/wix-laboratory-server/v1/laboratory/platform/conductAllInScope` — feature flag values per scope
- `/_api/dealer-offers-serving-service/v1/dealer/serving/offers/bulk` — 50KB of UI offers/placements

**Window globals of note**:
- `Wix` — object with `getSiteInfo`, `Dashboard`, `Utils`, `Settings`, `SuperApps`
- `__MEDIA_TOKEN__` — JWT for media CDN access (314 chars)
- `__WIXEXP_OWNER_ACCOUNT_ID_` / `__WIXEXP_LOGGED_IN_USER_ID_` — account UUIDs
- `__CAIRO_EXPERIMENTS__` — editor experiment flags
- `WIXCKEDITOR` — CKEditor instance (editor page only)

**What didn't work**: Calling `/_api/site-properties-service/properties` requires the metaSiteId as a specific header (not query param), and the blog API (`/_api/communities-blog-node-api/_api/posts/list`) requires a blog-specific `instanceId` different from the main site auth token.

### How it works

The `probe.js` script connects to a running browser via `playwright.chromium.connectOverCDP()`, then for each Wix page:
1. Scans `window` for all `__*` / `wix*` globals
2. Extracts JSON-LD structured data
3. Lists cookies and localStorage
4. Reads performance API entries for API endpoint discovery
5. Extracts site identity (metaSiteId, account IDs)

For deeper probing, we reload pages while the CDP Network domain captures full request/response pairs including auth headers and response bodies.

### Why it's better than the previous approach

Direct API probing against the user's own authenticated browser session means:
- No need to reverse-engineer auth — the browser already has valid cookies
- Response bodies captured via `Network.getResponseBody` give clean JSON
- The user-agent matches perfectly because it IS the user's browser
- Each Wix "app" (blog, store, forms) has its own auth token scoped to that app — intercepting during navigation is the reliable way to capture these per-app tokens

---

## 2026-03-31 — Initial extraction strategy

**Found by:** Human contributor (initial research)
**During:** Building this repo
**Type:** API endpoint | window global | architecture

### What I found
Wix sites make structured JSON API calls to their own backend during page load. Intercepting these calls gives cleaner data than parsing the rendered HTML output. Key endpoints include `/_api/wix-blog-frontend-server/`, `/_api/wix-public-data-webapp/`, and `www.wixapis.com`.

### How it works
Using Playwright's `page.on('response', ...)` handler to capture all `application/json` responses from `/_api/*` and `wixapis.com` URLs during normal page load. The responses contain structured blog post bodies, page metadata, CMS collection data.

### Why it's better than the previous approach
HTML scraping requires parsing Wix's heavily nested, obfuscated markup. API interception gives you clean JSON with semantic field names, correct dates, author information, and structured content — everything you'd want for a clean migration.

---

## 2026-05-27 — Shopify capture bot-blocks the headless browser (getsnooz.com)

**Found by:** Claude + Matt
**During:** getsnooz.com migration (Shopify, Tier 1, /liberate full pipeline)
**Type:** platform quirk | workaround for blocked content

### What I found
HTTP/JSON extraction worked fine, but the Playwright **capture** phase was bot-blocked by Shopify: at concurrency 6, ~70 navigations returned `HTTP 403` and ~32 hit `goto` timeouts (only 31/133 captures succeeded). That left `palette/typography/breakpoints` unwritten and most `html/<slug>.html` missing — silently degrading the whole design phase.

### How it works
Re-run `liberate_screenshot` with `cdpPort` pointed at a **real headful Chrome** (`--remote-debugging-port=9222 --user-data-dir=/tmp/dla-chrome-cdp`). A real (non-headless) fingerprint sails past Shopify's detection: getsnooz went from 31/133 to 90/97 at concurrency 2. The section-spec cache (`sections/<slug>.json`) is written during this pass, so `liberate_reconstruct_pages` reads from cache afterward — no re-navigation, no further 403.

### Why it matters
Headless capture on Shopify is unreliable. Default to CDP-with-real-Chrome for Shopify (mirror the Squarespace CDP guidance) and consider a lower default capture concurrency for Shopify origins.

---

## 2026-05-27 — Studio WXR import times out on media-heavy sites; install bugs

**Found by:** Claude + Matt
**During:** getsnooz.com migration (939 media)
**Type:** architecture | install-path bug + fix

### What I found
`liberate_preview` died on the 939-image import with Studio's "No activity for 120s" IPC-silence kill. The import already serves media locally (no CDN refetch), so the time sink is WordPress regenerating every intermediate image size (`wp_generate_attachment_metadata`) for 939 attachments in one synchronous WP-CLI call. This blocks **every** install path (`preview`, `install_theme`, `reconstruct_pages` — all need an imported Studio site).

### Fix
Added `add_filter('intermediate_image_sizes_advanced', '__return_empty_array')` before `WP_Import::import()` in `src/lib/preview/scripts/import-wxr.php`. Thumbnails aren't needed for a faithful replica (full-size renders fine; regenerate later via `wp media regenerate`). Import then completes in seconds. Applied this run, left uncommitted for review.

### Adjacent install gotchas found same run
- **cover-with-headline drops the background image.** The homepage hero spec carried `images[0].kind:"background"` + `fullBleed:true` and the file installed to the media library, but `liberate_reconstruct_pages` rendered a constrained group on white and omitted the image. The handler should emit a `wp:cover` when the spec has a `kind:background` image. (Fixed manually for the homepage.)
- **front-page renders `wp:post-content`, not the pattern file.** The homepage reconstruction `slug` must equal the imported WP page slug (`homepage`, not `home`) or `postContentUpdated` is silently `false`. Edits must go to the page's `post_content` in the DB; editing `patterns/page-<slug>.php` changes nothing. `studio wp post update` can't read host `/tmp` paths — stage the file inside the site dir and pass the `/wordpress/...` VFS path.

- **Re-provisioning a FRESH Studio site from an existing extraction silently skips ALL media install.** `media-stubs.json` stamps every stub with `wpPostId`/`localUrl` from the first install; `installMediaForUrl` trusts the stamp and short-circuits, so the new site gets the URL-rewrite map (driver still prints `mediaInstalled=N`) but zero files/attachments — every island image 404s and `enrich-product-marketing` sees an empty media map (0 `_dla_source_url` attachments → all-island product bodies). Workaround: back up `media-stubs.json` and strip the `wpPostId`/`localUrl` fields, then re-run the reconstruct. Real fix: validate the stamp against the TARGET site (or key stamps by site path). (getsnooz dogfood, 2026-06-09)

- **Verify lifted headers on CONTENT pages, not just store/native templates.** PR #78's header lift was verified on product + blog single (tagName:header part wrappers) — but page templates render header parts with `tagName:div` (display:contents), where the `header.wp-block-template-part` rescue never fires, so the carried Dawn `header{display:none!important}` hid the header on all 29 content pages + front page. Fixed by emitting the rescue rules under a second `.wp-block-template-part` scope. (getsnooz dogfood, 2026-06-09)

---

*This log grows with every migration. If you find something, add it.*
