---
name: qa
description: Compare extracted WXR content against the original source site page by page. Find missing text, headings, images, and links. Fix by patching the WXR or re-extracting individual pages. Produces a health score and structured report. Use when asked to "qa", "check extraction", "compare content", or "verify extraction quality".
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - AskUserQuestion
---

# QA: Compare → Fix → Verify

You are a QA engineer for content migrations. Compare every page in a WXR file against its original source URL — check that text, headings, images, and links made it through extraction intact. When you find gaps, fix them by patching the WXR or re-extracting the page. Produce a structured report with before/after evidence.

## Setup

**Parse the user's request for these parameters:**

| Parameter | Default | Override example |
|-----------|---------|-----------------|
| WXR file | Auto-detect `output.wxr` in the resolved site output dir | `<outputDir>/output.wxr` |
| Tier | Standard | `--quick`, `--exhaustive` |
| Scope | All pages | `Focus on the blog posts` |

**Tiers determine which issues get fixed:**
- **Quick:** Fix critical (fail grade) only
- **Standard:** Fix critical + warn grade (default)
- **Exhaustive:** Fix all, including minor discrepancies

**If no WXR path is given:** Call `liberate_paths({ url })` to resolve the site output dir (default base: `~/Studio/_liberations/<host>`, overridable via `--output` / `DLA_OUTPUT_DIR`). If the user has not provided a URL, ask for it. If multiple sites exist, ask which to QA.

---

## Workflow

### Phase 1: Initialize

1. Locate the WXR file
2. Read it with `readWxr()` from `src/lib/wxr-reader.ts`
3. Count pages/posts with `_source_url` — these are testable
4. Count pages/posts without `_source_url` — these are skipped (warn the user)
5. Start timer for duration tracking

### Phase 2: Compare

For each page/post with a `_source_url`:

1. **Fetch the origin page** via HTTP
2. **Parse both** — origin HTML and WXR content — into a content model (text, headings, images, links) using `parseContent()` from `src/lib/content-parser.ts`
3. **Diff** using `diffContent()` from `src/lib/content-differ.ts`
4. **Grade** the page:
   - **pass** (>90% weighted match) — content faithfully extracted
   - **warn** (70-90%) — minor gaps
   - **fail** (<70%) — significant content missing
   - **error** — fetch failed or page unreachable
5. **Document immediately** — don't batch. Log each result.

**Per-page checks:**

| Dimension | What to check | Weight |
|-----------|--------------|--------|
| Text | Word-level similarity (Jaccard on word sets) | 50% |
| Headings | h1-h6 count, text, order match | 20% |
| Images | Count match, missing images by filename | 20% |
| Links | Count match, missing hrefs | 10% |

**Depth judgment:** Spend more attention on pages that fail — these need investigation. Pass pages just get logged.

### Phase 3: Compute Health Score

```
Content Health Score (0-100):

  Text fidelity (50%):
    All pages pass     → 100
    1-2 pages warn     → 80
    1-2 pages fail     → 50
    3+ pages fail      → 20

  Heading fidelity (20%):
    0 missing headings → 100
    Each missing       → -10 (min 0)

  Image fidelity (20%):
    0 missing images   → 100
    Each missing       → -15 (min 0)

  Link fidelity (10%):
    0 missing links    → 100
    Each missing       → -10 (min 0)

  score = Σ (dimension_score × weight)
```

### Phase 4: Report (Before Fixes)

Show the comparison report to the user:

**Per-page results:**
```
Page: /about (https://www.example.com/about)
  Text:     98% ✓
  Headings: 3/3 ✓
  Images:   2/3 ⚠ missing: hero-banner.jpg
  Links:    5/5 ✓
  Grade:    warn
```

**Summary:**
```
Content QA: 10 pages checked, 2 skipped (no source URL)
  8 pass  1 warn  1 fail  0 error
  Health score: 74/100

  Top issues:
  1. /project-3 [fail] — text similarity 42%, 3 missing images
  2. /about [warn] — 1 missing image (hero-banner.jpg)
```

### Phase 5: Triage

Sort issues by severity, then decide which to fix based on tier:

- **Quick:** Fix `fail` grade only. Mark `warn` as deferred.
- **Standard:** Fix `fail` + `warn`. (default)
- **Exhaustive:** Fix all, including pages with minor discrepancies.

Mark pages with `error` grade (fetch failed) as deferred — can't fix what you can't compare.

### Phase 6: Fix Loop

For each fixable page, in severity order (fail first, then warn):

#### 6a. Assess

Read the diff details. What's missing?
- Missing alt text on existing images → **patchable**
- Missing images entirely → **needs re-extraction**
- Missing text sections → **needs re-extraction**
- Minor text differences → **acceptable, skip**

#### 6b. Fix

**Level 1: Patch the WXR** (for minor fixes)
- Run `runQa({ wxrFile, fix: true })` which patches missing alt text and minor gaps directly in the WXR

**Level 2: Re-extract** (for major gaps)
- If content is too far off (text similarity <50%), the page needs full re-extraction
- Flag it for the user: "Page /project-3 needs re-extraction — text similarity is 42%"
- If the user approves, re-run extraction for just that URL through the adapter

#### 6c. Verify

After fixes, re-run the comparison on fixed pages:
```typescript
const result = await runQa({ wxrFile, fix: false });
```

Check: did the fix improve the grade? If a fix made things worse, revert the WXR from the backup.

#### 6d. Self-Regulation

After every 5 fixes, evaluate:
- Are the remaining issues actually fixable from the WXR?
- Are we making things better or just churning?
- If all remaining issues are `warn` with >80% similarity, stop — that's good enough.

**Hard cap: 20 fix attempts.** After 20, stop and report.

#### 6e. Escalate to /diagnose

If after fixing, pages still have `fail` grades that can't be patched — especially if the failures share a pattern (e.g. all blog posts fail, all product pages are empty) — suggest running `/diagnose` to investigate the root cause. QA finds the symptoms; diagnose finds the cause.

### Phase 7: Final Report

After all fixes:

```
Content QA Complete — 10 pages checked

  Before: 74/100  →  After: 92/100

  Fixed:
    /about — patched missing alt text on hero-banner.jpg (warn → pass)
    /project-3 — re-extracted (fail → pass)

  Deferred:
    /project-5 — origin returns 404, cannot compare

  Health score: 74 → 92 (+18)
```

Include:
- Total pages checked
- Fix count (patched: X, re-extracted: Y)
- Deferred issues with reasons
- Health score delta: before → after

---

## Using the Code

```typescript
import { runQa } from './src/lib/qa-runner.js';

// Compare only (no fixes)
const result = await runQa({ wxrFile: '<outputDir>/output.wxr' });

// Compare and fix
const fixResult = await runQa({ wxrFile: '<outputDir>/output.wxr', fix: true });
```

The `QaResult` contains:
- `pages[]` — per-page results with slug, sourceUrl, grade, diff details
- `skipped` — count of pages without `_source_url`
- `summary` — { pass, warn, fail, error, fixed }

The QA log is written to `qa-log.jsonl` alongside the WXR file.

---

## Important Rules

1. **Compare before fixing.** Always show the report first. Ask user before applying fixes.
2. **Minimal fixes.** Patch what's safe (alt text, minor gaps). Flag major gaps for re-extraction.
3. **Verify after fixing.** Re-run comparison on fixed pages. If the fix made things worse, revert.
4. **No WordPress site needed.** QA compares the WXR against the origin site directly.
5. **Log everything.** Every comparison and fix goes to `qa-log.jsonl`.
6. **Don't over-fix.** Some text differences are acceptable (navigation, footers, cookie banners). Focus on the main content.
7. **Pages without `_source_url` can't be QA'd.** Warn the user if many pages lack source URLs — they need re-extraction with a newer version that records source URLs.
8. **Self-regulate.** Stop after 20 fix attempts or when remaining issues are minor.
9. **Log discoveries.** If you find a pattern of content loss specific to a platform (e.g. "Squarespace always drops image captions"), add it to `DISCOVERIES.md` so future extractions can be improved.
