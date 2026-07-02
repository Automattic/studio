# How `/liberate` Works

The **liberate** process points the tool at a closed-platform website (Wix, Squarespace, Shopify, …) and produces a faithful, editable **WordPress block-theme replica** plus a portable WXR/Woo export.

It is built from two cooperating layers:

- a **deterministic core**: plain TypeScript MCP tools and pure functions that do the precise, repeatable work (fetch, extract, render, gate, score), and
- an **AI orchestration layer**: Claude Code skills where an agent makes judgments (reading section structure, choosing block types, doing visual QA) and sequences the deterministic tools.

> Derived from the code as of 2026-05-27. The page-content path documented here is the current **per-page `liberate_reconstruct_pages`** flow. An older **cluster-skeleton + `compose_instantiate`** path still exists in `skills/liberate/SKILL.md` (steps 8–11) but is superseded for page *content*; clustering still earns its keep for sitewide-chrome dedup and posts/products templates.

## Conventions

Every diagram uses the same visual language:

```mermaid
flowchart LR
    a["AI reasoning: an agent/skill makes a judgment"]:::ai
    d["Deterministic: a pure MCP tool or TS function"]:::det
    g{"Gate: deterministic pass/fail that BLOCKS progress on failure"}:::gate
    c{"Decision: routes flow based on a condition"}:::dec
    h(["Human-in-the-loop checkpoint"]):::human
    f["Artifact / data on disk"]:::art

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#2e1065;
    classDef det fill:#dbeafe,stroke:#2563eb,color:#0c2a66;
    classDef gate fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef dec fill:#fef3c7,stroke:#d97706,color:#713f12;
    classDef human fill:#dcfce7,stroke:#16a34a,color:#14532d;
    classDef art fill:#f1f5f9,stroke:#64748b,color:#0f172a;
```

- **Parallel work** is drawn inside a subgraph whose title names the concurrency.
- Two **gates are security/quality trust boundaries** and reappear throughout: `validate_artifacts` (escaping + injection + provenance) and the `@390px` responsiveness check.

## Contents

1. [The big picture: two phases](#1-the-big-picture-two-phases)
2. [Platform detection (decision tree)](#2-platform-detection-decision-tree)
3. [The extraction loop (parallelism + decisions)](#3-the-extraction-loop-parallelism--decisions)
4. [Shopify product path (decision tree)](#4-shopify-product-path-decision-tree)
5. [Screenshot capture + design-token aggregation (parallel)](#5-screenshot-capture--design-token-aggregation-parallel)
6. [The design contract: foundation + theme scaffold](#6-the-design-contract-foundation--theme-scaffold)
7. [Clustering + the parallel build fan-out](#7-clustering--the-parallel-build-fan-out)
8. [Section → block-template routing (decision tree)](#8-section--block-template-routing-decision-tree)
9. [Per-page reconstruction + the artifacts gate](#9-per-page-reconstruction--the-artifacts-gate)
10. [The QA loop (deterministic gates, AI verdicts)](#10-the-qa-loop-deterministic-gates-ai-verdicts)
11. [Archetype routing (decision tree)](#11-archetype-routing-decision-tree)
12. [Resume state + artifact handoffs](#12-resume-state--artifact-handoffs)

---

## 1. The big picture: two phases

The agent is the conductor: it narrates and sequences the run and makes the judgment calls, but each numbered step below is either a deterministic tool call or an inline AI sub-skill. **Phase 1 (Liberate)** pulls content out into portable form; a **human confirm checkpoint** gates spend; **Phase 2 (Replicate)** rebuilds the site as a block theme.

```mermaid
flowchart TD
    start(["Operator runs /liberate on a site URL"]):::human

    subgraph EX["PHASE 1 - LIBERATE: extract content (deterministic core, agent narrates)"]
        direction TB
        det1["liberate_detect - platform fingerprint"]:::det
        det2["liberate_discover - sitemap + nav + archetype counts"]:::det
        ai1["Agent: interpret inventory, recommend WP plugins for non-transferable features"]:::ai
        det3["liberate_extract - per-URL extraction loop"]:::det
        det4["media download + dedupe to WP library URLs"]:::det
        det5["liberate_screenshot - desktop + mobile capture"]:::det
        det6["SiteAnalysisAggregator - palette / typography / breakpoints"]:::det
        det1 --> det2 --> ai1 --> det3 --> det4 --> det5 --> det6
    end

    confirm{{"CONFIRM checkpoint: show inventory, scope, cost - wait for go-ahead"}}:::human

    subgraph RE["PHASE 2 - REPLICATE: reconstruct as a WP block theme"]
        direction TB
        df["Design contract (det scaffold + AI fill + gates)"]:::ai
        cl["Cluster pages + section-extract (deterministic)"]:::det
        build["BUILD fan-out: generating-patterns subagents (parallel)"]:::ai
        rp["liberate_reconstruct_pages - PURE per-page renderer"]:::det
        va{"validate_artifacts gate"}:::gate
        inst["install theme + import WXR / products"]:::det
        qa["QA loop - responsive gate + AI vision verdict"]:::ai
        report["buildRunReport - run-report.json"]:::det
        df --> cl --> build --> rp --> va
        va -->|ok| inst --> qa --> report
        va -->|fail| rp
    end

    start --> EX --> confirm
    confirm -->|go| RE
    confirm -->|stop| stopn(["Stop - report inventory only"]):::human
    report --> done(["Live replica URL + run-report.json"]):::human

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#2e1065;
    classDef det fill:#dbeafe,stroke:#2563eb,color:#0c2a66;
    classDef gate fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef dec fill:#fef3c7,stroke:#d97706,color:#713f12;
    classDef human fill:#dcfce7,stroke:#16a34a,color:#14532d;
    classDef art fill:#f1f5f9,stroke:#64748b,color:#0f172a;
```

The single most important AI/deterministic boundary: **the renderer (`page-reconstruct.ts`) is pure**. Specs in, gated block markup out, fully unit-tested. AI judgment lives on *both sides* of it (section interpretation upstream, visual QA downstream), never inside it.

---

## 2. Platform detection (decision tree)

`liberate_detect` walks four tiers from cheapest to most invasive, stopping at the first hit. URL and HTTP-header matches are high-confidence; HTML markers are medium; active path probes are a last resort. No match means no adapter, which is a hard stop.

```mermaid
flowchart TD
    u["site URL"]:::det
    t1{"hostname matches URL_PATTERNS? (wixsite, squarespace, myshopify, weebly)"}:::dec
    t2{"homepage HTTP headers match HTTP_SIGNALS? (x-wix-request-id, Server: squarespace, x-shopid)"}:::dec
    t3{"homepage HTML markers? (wixstatic.com, cdn.shopify.com, generator metas)"}:::dec
    t4{"active path probes - HEAD status / Location substring"}:::dec
    hi1["platform - confidence HIGH"]:::det
    hi2["platform - confidence HIGH"]:::det
    me["platform - confidence MEDIUM"]:::det
    hi3["platform - confidence HIGH"]:::det
    un["unknown - no adapter - ERROR"]:::gate

    u --> t1
    t1 -->|match| hi1
    t1 -->|no| t2
    t2 -->|match| hi2
    t2 -->|no| t3
    t3 -->|match| me
    t3 -->|no| t4
    t4 -->|match| hi3
    t4 -->|no| un

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#2e1065;
    classDef det fill:#dbeafe,stroke:#2563eb,color:#0c2a66;
    classDef gate fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef dec fill:#fef3c7,stroke:#d97706,color:#713f12;
```

---

## 3. The extraction loop (parallelism + decisions)

`liberate_extract` is bracketed by a PID lockfile so only one run touches an output directory at a time. Page **fetches run in parallel** (an adaptive tuner picks 1–3 concurrent based on observed latency), but **per-page writes are sequential** because the WXR builder and the append-only log are single-writer. Media downloads fan out again into concurrent chunks (start 6, range 1–12, AIMD-tuned).

```mermaid
flowchart TD
    a["acquire .liberation-lock (one run per output dir)"]:::det
    b["adapter.discover() - fetchSitemap + classifyUrl + nav"]:::det
    c{"resume?"}:::dec
    d["filter already-processed URLs from extraction-log.jsonl"]:::det
    e["fresh start: purge media/, logs, stubs, redirect-map"]:::det
    f["stratifiedUrlSlice - apply --limit, homepage first, pin primary-nav"]:::det

    subgraph batch["per-batch loop - PARALLEL page fetch (concurrency 1-3, adaptive)"]
        direction TB
        g["extractPage(url) x batch via Promise.all"]:::det
    end

    subgraph perpage["per page - SEQUENTIAL (WXR + log are single-writer)"]
        direction TB
        h0{"media shouldAttempt? (not success/ignored/over-cap of 3 retries)"}:::dec
        h["download media - PARALLEL chunks (concurrency 6, range 1-12)"]:::det
        j{"resolve type: detectedType > inventory > classifyUrl + JSON-LD post promotion"}:::dec
        k{"product?"}:::dec
        l["csvBuilder.addProduct - products.jsonl"]:::det
        m["wxr.addPost / addPage - claimSlug + redirect-map"]:::det
        h0 -->|yes| h --> j
        h0 -->|skip| j
        j --> k
        k -->|yes| l
        k -->|no| m
    end

    n["checkpoint session.json every 10 items"]:::det
    more{"more URLs?"}:::dec
    o["add nav menu items to WXR"]:::det
    p["finalize: flush media-stubs, serialize output.wxr"]:::det

    a --> b --> c
    c -->|yes| d --> f
    c -->|no| e --> f
    f --> batch --> perpage --> n --> more
    more -->|yes| batch
    more -->|no| o --> p

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#2e1065;
    classDef det fill:#dbeafe,stroke:#2563eb,color:#0c2a66;
    classDef gate fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef dec fill:#fef3c7,stroke:#d97706,color:#713f12;
```

`classifyUrl` is the type decision feeding `j`: `/` → `homepage`; `blog|post|article|news|journal` paths → `post`; `products|store|shop` → `product`; `gallery|portfolio` → `gallery`; `event(s)` → `event`; everything else → `page`. Same-origin is enforced on every fetched URL and re-validated on each media redirect (SSRF guard).

---

## 4. Shopify product path (decision tree)

Shopify is the one adapter with two extraction strategies. With an admin token against a `*.myshopify.com` host it uses the Admin GraphQL API (resumable via `endCursor`); otherwise it falls back to the public JSON API + URL loop. Any GraphQL failure also falls back. Sale pricing is derived from `compareAtPrice` semantics.

```mermaid
flowchart TD
    s["Shopify extract"]:::det
    d{"adminToken set AND not dry-run?"}:::dec
    hh{"host resolves to *.myshopify.com?"}:::dec
    gql["Admin GraphQL API 2025-04 - paginate endCursor (resumable)"]:::det
    err["throw - needs explicit shopDomain"]:::gate
    json["public JSON API + URL loop"]:::det
    fb["fall back to JSON loop"]:::det
    sale{"compareAtPrice > price?"}:::dec
    s1["compareAtPrice becomes regularPrice; price becomes salePrice"]:::det
    s2["price becomes regularPrice"]:::det

    s --> d
    d -->|no| json
    d -->|yes| hh
    hh -->|no| err
    hh -->|yes| gql
    gql -.->|any GraphQL error| fb
    fb --> sale
    gql --> sale
    json --> sale
    sale -->|yes| s1
    sale -->|no| s2

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#2e1065;
    classDef det fill:#dbeafe,stroke:#2563eb,color:#0c2a66;
    classDef gate fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef dec fill:#fef3c7,stroke:#d97706,color:#713f12;
```

GraphQL pagination is sequential with two guards: `MAX_PAGES = 10000` and a non-advancing-cursor check, both of which throw rather than loop forever.

---

## 5. Screenshot capture + design-token aggregation (parallel)

When screenshots are enabled (CLI default; `liberate_screenshot` opt-in via MCP), URLs are captured in parallel batches of 6 (clamped to 1–10). The Playwright browser restarts every 100 URLs, but only at batch boundaries, to bound memory. After all captures, a single aggregation pass derives the site-wide design tokens.

```mermaid
flowchart TD
    subgraph cap["capture - PARALLEL batches (concurrency 6, clamp 1-10)"]
        direction TB
        u["processUrl(url) x batch - desktop + mobile viewports"]:::det
        sc{"scrollHeight > viewport*1.5 + viewport?"}:::dec
        s2["also capture scrolled-state PNG"]:::det
        s3["skip scrolled (silent, not a failure)"]:::det
        u --> sc
        sc -->|yes| s2
        sc -->|no| s3
    end
    rst{"urlsSinceRestart >= 100 AND work remains?"}:::dec
    rb["restart browser at batch boundary"]:::det
    agg["SiteAnalysisAggregator - merges prior-run aggregates on resume"]:::det
    out["palette.json + typography.json + breakpoints.json + computed-styles.json + screenshots/manifest.json + html/slug.html"]:::art

    cap --> rst
    rst -->|yes| rb --> cap
    rst -->|no, done| agg --> out

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#2e1065;
    classDef det fill:#dbeafe,stroke:#2563eb,color:#0c2a66;
    classDef gate fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef dec fill:#fef3c7,stroke:#d97706,color:#713f12;
    classDef art fill:#f1f5f9,stroke:#64748b,color:#0f172a;
```

Cross-origin stylesheets are skipped silently during analysis (their `cssRules` throw); same-origin CSS contributes. The `manifest.json` is the filesystem-only join key between a URL and its screenshots/HTML. Nothing is injected back into the WXR.

---

## 6. The design contract: foundation + theme scaffold

This is where the **site-wide visual contract** is frozen. A deterministic scaffold pre-fills the obvious token roles from the aggregates; the `design-foundations` **AI skill** fills the judgment roles (accent, muted text, display font, gradient roles) from HTML+CSS evidence; a validate gate refuses to proceed while any required role is still null. The frozen `design.md` becomes immutable downstream (only a late QA iteration may amend it; see §10). The theme scaffold itself is explicitly pure (no vision, no reasoning) and is guarded by a theme.json lint gate.

```mermaid
flowchart TD
    agg["aggregates: palette / typography / breakpoints / computed-styles"]:::art
    sc["liberate_design_foundation_scaffold - pre-fill obvious roles (surface, text, body font)"]:::det
    fill["design-foundations (AI) - fill accent/muted/display/gradient roles from evidence; record openQuestions"]:::ai
    val{"foundation validate - schema ok AND no required skillTodo left null?"}:::gate
    save["save design-foundation.json + freeze design.md (site-wide contract)"]:::det
    th["liberate_theme_scaffold (PURE) - theme.json, style.css, functions.php, parts, templates, fonts, source logo+nav"]:::det
    lint{"lintThemeJson - schema v3 + no activation-fatal?"}:::gate
    next["proceed to clustering and build"]:::det

    agg --> sc --> fill --> val
    val -->|fail| fill
    val -->|ok| save --> th --> lint
    lint -->|fail| th
    lint -->|ok| next

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#2e1065;
    classDef det fill:#dbeafe,stroke:#2563eb,color:#0c2a66;
    classDef gate fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef dec fill:#fef3c7,stroke:#d97706,color:#713f12;
    classDef art fill:#f1f5f9,stroke:#64748b,color:#0f172a;
```

If a source font is commercial/uncapturable, the deterministic pipeline auto-substitutes a free font and records an `openQuestion` rather than failing or guessing.

---

## 7. Clustering + the parallel build fan-out

This is the **only true multi-agent parallel step**. Pages are grouped by exact layout signature and the richest representative per cluster is extracted in full (computed styles, interaction model, verbatim text, media URLs, and CSS-geometry **layout signals**; see §9). Then one `generating-patterns` **subagent per cluster representative** runs concurrently (cap ~4–6) to produce section block-skeletons. The fan-out is safe because subagents are **read-only**: they receive paths and return strings, and only the orchestrator writes to disk.

```mermaid
flowchart TD
    cl["liberate_cluster_pages - group by exact layout signature, pick richest rep"]:::det
    se["liberate_section_extract (full) - per rep: styles, interaction model, brightness, verbatim text, media + layout signals (placement, padding, alignment)"]:::det
    rc{"spec ready? model + styles + local media + brightness"}:::dec

    subgraph fan["BUILD fan-out - PARALLEL: one subagent per cluster rep (cap ~4-6; SEQUENTIAL on Codex/Gemini)"]
        direction LR
        b1["generating-patterns rep 1"]:::ai
        b2["generating-patterns rep 2"]:::ai
        b3["generating-patterns rep N"]:::ai
    end

    env{"parseBuilderEnvelope - valid patterns + flags + notes?"}:::gate
    persist["orchestrator persists patterns (single-writer; subagents never touch disk)"]:::det

    cl --> se --> rc
    rc -->|fix spec| se
    rc -->|ready| fan
    fan --> env
    env -->|ok| persist
    env -->|retry once, then sequential fallback| fan

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#2e1065;
    classDef det fill:#dbeafe,stroke:#2563eb,color:#0c2a66;
    classDef gate fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef dec fill:#fef3c7,stroke:#d97706,color:#713f12;
```

The macro-pipeline is otherwise strictly sequential: each stage consumes the prior stage's artifact, and the single-writer `session.json` (atomic rename) serializes cluster persistence even though builders run in parallel.

---

## 8. Section → block-template routing (decision tree)

Inside each builder, every captured section is matched against the `section-mapping.md` template catalog by its interaction model. A match yields a specific, high-fidelity template; **no match falls back to a faithful generic layout** (`columns`/`group`) plus a run-report flag. A section is never forced into the wrong specific template.

```mermaid
flowchart TD
    s["section spec (interaction model)"]:::det
    dd{"matches a catalog template?"}:::dec
    t1["product-card-row"]:::ai
    t2["review-grid"]:::ai
    t3["cover-with-headline / hero"]:::ai
    t4["FAQ accordion (wp:details)"]:::ai
    t5["app-download / media-text"]:::ai
    gg["faithful generic (columns / group) + run-report flag"]:::ai

    s --> dd
    dd -->|match| t1
    dd -->|match| t2
    dd -->|match| t3
    dd -->|match| t4
    dd -->|match| t5
    dd -->|no match| gg

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#2e1065;
    classDef det fill:#dbeafe,stroke:#2563eb,color:#0c2a66;
    classDef gate fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef dec fill:#fef3c7,stroke:#d97706,color:#713f12;
```

---

## 9. Per-page reconstruction + the artifacts gate

`liberate_reconstruct_pages` reconstructs **every content page from its own specs** (not just cluster reps) using the pure `page-reconstruct.ts` renderer, and gates each page through `validate_artifacts` before it is kept. Layout is **CSS-geometry-driven and deterministic**: section-extract measures bounding boxes and computed styles to record image-beside-text placement (`mediaLayout` image-left/right), geometric inner padding, and content/icon alignment, and the renderer reproduces those (e.g. a 2-column media-text row) instead of defaulting to a stack. Missing media becomes a sized placeholder + provenance flag; copy that is not present verbatim in the spec is omitted or marked, **never paraphrased**, because the provenance check hard-fails invented prose.

```mermaid
flowchart TD
    sp["per-page section specs (every content page) + CSS-derived layout signals"]:::det
    lay{"source layout from CSS geometry?"}:::dec
    mt["media-text 2-col (image-left / image-right) + gallery for extras"]:::det
    gal["gallery grid"]:::det
    cov["cover / hero (text over image)"]:::det
    stk["stacked group"]:::det
    rp["page-reconstruct.ts - PURE renderer to block markup; reproduces geometric padding + content/icon alignment"]:::det
    img{"image slot has a local or WP URL?"}:::dec
    ph["sized placeholder + provenanceFlag (warn)"]:::det
    txt{"copy is in spec headings / bodyText / reviews?"}:::dec
    omit["omit slot or '[copy not captured]' + flag"]:::det
    va{"validate_artifacts (per page): escaping + injection allowlist + provenance subset of spec + no remote URL + no placeholders"}:::gate
    keep["pattern + post_content + variant templates + _wp_page_template + icon SVGs written"]:::det
    skip["page NOT installed - reported with gateErrors (fix tooling/spec, never ship carried HTML)"]:::gate

    sp --> lay
    lay -->|image beside text| mt
    lay -->|images gridded, no text| gal
    lay -->|text over image| cov
    lay -->|else| stk
    mt --> rp
    gal --> rp
    cov --> rp
    stk --> rp
    rp --> img
    img -->|yes| txt
    img -->|no| ph --> txt
    txt -->|yes| va
    txt -->|no| omit --> va
    va -->|ok| keep
    va -->|fail| skip

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#2e1065;
    classDef det fill:#dbeafe,stroke:#2563eb,color:#0c2a66;
    classDef gate fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef dec fill:#fef3c7,stroke:#d97706,color:#713f12;
```

`validate_artifacts` runs **twice**: once per page here, and again as the standalone pre-install gate. It is the single trust boundary against prompt-injection from source content and AI-invented copy. (This is also the gate now reinforced by the official-WP-parser block-markup structural check.)

---

## 10. The QA loop (deterministic gates, AI verdicts)

After install, QA alternates **deterministic gates** with **AI judgment**. The `@390px` responsiveness check is a hard pass/fail function; pixel-diff is a *signal only*; the qualitative A/B/C verdict is AI vision. Fixes are AI edits. The loop is capped at 3 iterations per archetype; a third iteration may amend the frozen `design.md`, which cascades a full rebuild.

```mermaid
flowchart TD
    inst["install theme + import WXR/products, set front page"]:::det
    verify["liberate_replicate_verify - capture replica, pair with source"]:::det
    resp{"evaluateResponsive @390px - no h-overflow AND sections reflow?"}:::gate
    fixR["apply responsive CSS (editing-themes)"]:::ai
    stopn["after 3 tries still failing - STOP, log, cannot pass"]:::gate
    cmp["liberate_compare - pixel diff = SIGNAL ONLY"]:::det
    qa["design-qa (AI vision) - classify each gap"]:::ai
    cls{"gap class?"}:::dec
    aFix["A: spec wrong - re-extract that section"]:::ai
    bFix["B: template dropped info - fix mapping / regenerate"]:::ai
    cLog["C: WP renders differently - log only, no fix"]:::ai
    iter{"gaps remain AND iteration < 3?"}:::dec
    amend["iteration 3 may amend design.md - invalidates theme + all clusters - re-enter the design contract (sec 6)"]:::ai
    report["buildRunReport - run-report.json (verdict, summary, details)"]:::det

    inst --> verify --> resp
    resp -->|fail| fixR --> verify
    resp -->|fail x3| stopn --> report
    resp -->|pass| cmp --> qa --> cls
    cls -->|A| aFix --> iter
    cls -->|B| bFix --> iter
    cls -->|C| cLog --> iter
    aFix --> verify
    bFix --> verify
    iter -->|yes| verify
    iter -->|no| report
    iter -.->|cascade| amend

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#2e1065;
    classDef det fill:#dbeafe,stroke:#2563eb,color:#0c2a66;
    classDef gate fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef dec fill:#fef3c7,stroke:#d97706,color:#713f12;
```

A page that fell back to a carried `wp:post-content` block is an automatic **C/FAIL**, never "pass-with-notes"; the whole point is faithful reconstruction. A separate **budget guard** can pause at any checkpoint and ask the operator to continue / stop / raise the ceiling when subagent, cluster, or elapsed-time limits are hit.

---

## 11. Archetype routing (decision tree)

Not everything is reconstructed page-by-page. Only homepage and standalone pages get per-page section reconstruction; posts and products are handled by **WordPress-native templates + loops**, so a 500-post blog produces two templates rather than 500 reconstructions.

```mermaid
flowchart TD
    disc["discover archetype counts"]:::det
    a{"archetype?"}:::dec
    hp["homepage + pages - per-page section reconstruction"]:::det
    po["posts - single.html + archive + Query Loop (no per-post reconstruction)"]:::det
    pr["products - single-product + archive-product + WooCommerce"]:::det
    z["count == 0 - skip silently"]:::det
    none["no page archetype at all - templates-only run"]:::det

    disc --> a
    a -->|homepage / page| hp
    a -->|post| po
    a -->|product| pr
    a -->|count 0| z
    a -->|none| none

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#2e1065;
    classDef det fill:#dbeafe,stroke:#2563eb,color:#0c2a66;
    classDef gate fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef dec fill:#fef3c7,stroke:#d97706,color:#713f12;
```

---

## 12. Resume state + artifact handoffs

### Resume is filesystem state, not memory

Four cooperating files make a run resumable; together they let any stage pick up where a crash left off (see `CLAUDE.md` for the authoritative contract):

| File | Role | Resume behavior |
|---|---|---|
| `extraction-log.jsonl` | append-only per-URL dedupe | source of truth for "did we process this URL" |
| `session.json` | stage, opts, counts, adapter cursors | single-writer, atomic rename; corrupt files quarantined |
| `media-stubs.json` | per-asset status + retry cap (3) | failures persist immediately; successes buffered |
| `products.jsonl` | streaming Woo output | appended (not truncated) on resume |

### What passes between AI and deterministic steps

The arrows below are the **handoffs**, plus the two frozen contracts where an AI judgment becomes immutable downstream input.

```mermaid
flowchart LR
    disc["discover inventory"]:::det --> conf(["AI confirm"]):::human
    ext["extract"]:::det --> wxr["output.wxr + media (WP URLs) + products.jsonl"]:::art
    shot["screenshot + aggregate"]:::det --> tok["palette/typography/breakpoints/computed-styles + html/slug.html"]:::art

    tok --> found["design-foundations (AI fill + gates)"]:::ai
    found --> dm["design.md + design-foundation.json  [FROZEN CONTRACT]"]:::art
    dm --> theme["theme scaffold + lint gate"]:::det --> bundle["theme bundle"]:::art

    bundle --> spec["section-extract (full)"]:::det --> specs["specs/rep/section-N.md  [EXTRACTION->BUILD CONTRACT]"]:::art
    specs --> gen["generating-patterns (AI, parallel)"]:::ai --> rpages["reconstruct_pages (pure)"]:::det
    rpages --> gate{"validate_artifacts"}:::gate --> live["install -> live Studio replica"]:::art
    live --> qa["replicate_verify + responsive gate + AI vision QA"]:::ai --> rep["run-report.json + replica URL"]:::art

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#2e1065;
    classDef det fill:#dbeafe,stroke:#2563eb,color:#0c2a66;
    classDef gate fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef human fill:#dcfce7,stroke:#16a34a,color:#14532d;
    classDef art fill:#f1f5f9,stroke:#64748b,color:#0f172a;
```

The **two frozen contracts** are where AI judgment hardens into deterministic input: `design.md` (only a QA-iteration-3 amendment can change it, at the cost of a full rebuild) and the per-rep `specs/*.md` files (the extraction→generation handshake).

**Final deliverables:** a running Studio replica at a local URL, and `run-report.json`, a verdict-first report whose per-page grades and gaps are produced by the deterministic `buildRunReport`.
