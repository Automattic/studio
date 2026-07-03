# Verification Loop

The verify pass is the difference between a theme that *looks plausible* and a theme that *actually replicates the source*. This reference covers what gets measured, how to interpret results, and when to stop iterating.

## What `liberate_replicate_verify` measures

Three scalar similarity scores in `[0, 1]`, plus a list of human-readable issues.

### structuralScore

How close is the rendered DOM shape to the source's? Computed by:

1. Parse both DOMs.
2. Strip text content (you're measuring structure, not copy).
3. Project each tree onto a structural fingerprint: tag sequences, depth distribution, sibling counts, layout role tags (`<main>`, `<header>`, `<footer>`, `<section>`).
4. Compute a normalized edit distance between fingerprints.

**Threshold guidance:**
- Homepage: 0.75 (visible structure must be close)
- page/post: 0.70 (some variance OK)
- product (Woo): 0.60 (Woo block templates differ structurally from custom storefronts)
- gallery/event: 0.65

Below threshold means **you missed a section, swapped a column count, or used the wrong wrapper element.** Look at the issues list for hints.

### paletteScore

How well does the rendered page use the same dominant colors as the source? Computed by:

1. Sample a 24-color dominant palette from each rendered page (same algorithm as the screenshotter).
2. For each source-palette color, find the nearest replica-palette color (LAB color distance).
3. Aggregate weighted by frequency (rare source colors don't matter).

**Threshold guidance:** 0.85 for all archetypes. Color is the most visible token — drift here is jarring.

Below threshold means **`theme.json` palette slugs aren't being applied where you expect.** Most often: a pattern hardcoded a hex instead of using a slug, or a slug was misnamed. Grep the patterns for raw hex.

### typographyScore

How close are the font families and rough size scale? Computed by:

1. For each visible text element, capture computed `fontFamily`, `fontSize`, `fontWeight`.
2. Bucket by selector class (h1, h2, h3, p, button, nav).
3. Compare bucket-by-bucket against the source.

**Threshold guidance:** 0.80 for all archetypes, except 0.70 if `design-foundation.json` flagged a commercial font in `openQuestions` (substituting Reckless → Fraunces will never hit 0.80 — the metrics know this isn't your fault).

Below threshold means **font families aren't loading**, **font sizes don't match**, or **the wrong family was applied to a selector**. Check `enqueue_block_assets` in `functions.php` — fonts must load in editor + frontend.

## issues — the operative output

The numeric scores tell you *that* something's off. The `issues[]` list tells you *what*. Examples:

- `"hero CTA color drifted: source #00a4bd, replica #1a8fa3"` — palette slug not applied. Find the pattern, replace inline color with slug.
- `"footer columns 4→3"` — pattern's `wp:columns` count is wrong. Edit pattern.
- `"product card image aspect ratio: source 1:1, replica 4:3"` — the Woo product-image-gallery default doesn't match. Add CSS in `theme.json` styles for the block.
- `"H1 family: source 'Reckless', replica 'Inter'"` — display family substitution. If foundation flagged this, accept it. Otherwise re-check `theme.json` fontFamilies.
- `"missing testimonials section"` — homepage has a testimonials section that wasn't replicated. Add the pattern.

**Each issue is actionable.** If you can't tell what to do with an issue, that's a bug in the verifier — surface it as an `openQuestion` and don't loop on it.

## The loop

```
verify → score below threshold or has issues?
  yes → pick the highest-impact issue
       → fix theme.json or pattern or template
       → reinstall (call liberate_replicate_install with delta files)
       → verify again
  no → done
```

**Iteration cap:** 3 passes per URL. After 3, accept the current state and add an `openQuestion` describing what couldn't be fixed.

**Why cap:** verification is expensive (browser launch, screenshot, DOM analysis). Most issues fix in 1-2 passes. Issues that survive 3 passes usually need a human (commercial font substitution, structural difference that requires a custom block, content the source has that the WXR doesn't include).

## Diff order

When multiple issues are reported per URL, fix in this priority:

1. **Palette issues** — fastest, most visible, often cascade-fix multiple URLs at once.
2. **Typography issues** — usually one `theme.json` edit or one `functions.php` enqueue line.
3. **Structural issues** — pattern edits. Slowest because patterns are PHP files with block markup, but high-impact.
4. **Per-block style issues** (aspect ratios, gaps, paddings) — last, because they're cosmetic.

Do not fix all issues in parallel. Fix the highest-priority one, reinstall, re-verify. The next pass may auto-resolve other issues.

## When the score is high but you still aren't satisfied

The scores are heuristics. They can pass while the page looks visibly off, especially when:

- The source has a custom font that's substituted — typography score may pass on family count without matching glyph metrics.
- The source uses a hero video — the verifier sees a static frame and may score it higher than reality.
- The source has heavy JS animations — the verifier captures the post-JS state, but timing differences mean replicas without animation can score similarly.

**If the agent's vision says "this still looks wrong" despite a passing score**, trust vision. Add what's missing and re-verify. The score is a tool, not the verdict.

## When the score is low and you're stuck

After 3 iterations and the score is still below threshold:

1. **Verify your inputs.** Did you read the right screenshot? Did you reference the right design-foundation slug?
2. **Verify install.** Maybe theme files aren't actually being loaded. Sanity-check by visiting the replica URL and viewing source — your CSS classes should be present.
3. **Surface as openQuestion.** Describe what you observed, what you tried, and what you'd want a human to investigate.

Example openQuestion:
```json
{
  "id": "homepage-hero-image",
  "question": "Source homepage hero uses a full-bleed video background; replica uses a static cover image. Verifier scores 0.62 structurally because the video element is missing. Should we add a custom 'video-hero' block, or accept the static image as a faithful-enough replica?",
  "blocksReplica": false
}
```

## Verifying without the MCP tool

If `liberate_replicate_verify` isn't available, do it manually:

1. For each archetype, screenshot the replica URL via Playwright browser commands against the Studio local URL.
2. Save replica screenshots next to source: `<outputDir>/screenshots/desktop/<slug>.png` (source) and `<outputDir>/replica/screenshots/desktop/<slug>.png`.
3. Read both screenshots into vision and produce a side-by-side analysis. Use the same categories (structural, palette, typography) so the result is comparable.
4. Write a `verify-result.json` next to the screenshots with the issues list and scalar scores (your best estimate).
5. Iterate based on the issues list.

This is slower and less reproducible than the MCP tool, but it works for one-shot verification.
