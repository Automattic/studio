# Visual QA

Mandatory final step (step 14 of `/liberate`). Deploy the generated theme to Automattic Studio (required — install at https://developer.wordpress.com/studio/ if absent), screenshot the rendered result, and iterate until the diff against the captured source passes. Do not declare the site complete without this step.

## Contents

1. Deploy with Automattic Studio
2. Screenshot the Studio URL
3. Diff
4. Responsiveness gate (hard acceptance bar)
5. Contrast and accessibility checks
6. Motion QA
7. Failure classes (A / B / C)
8. Iteration budget
9. Run-report output
10. When the `core/cover` white-text bug bites

## 1. Deploy with Automattic Studio

Our preview runtime is **Automattic Studio** (required; install at https://developer.wordpress.com/studio/ if absent).

0. Run the artifact validator and fix any failures before launching WordPress:

   Call `liberate_validate_artifacts` MCP tool for the site output directory. It asserts:
   - All source-derived text is escaped (`esc_html` / `esc_attr` / `esc_url`)
   - No raw `<?php` / `<script>` / `on*=` handlers in emitted markup (defends PHP injection + stored XSS, including builder prompt-injection via source content)
   - Emitted text is a subset of the section spec's captured text (provenance check)
   - No remote CDN URLs in patterns (all assets must be uploaded WP-library URLs or theme-shipped `assets/`)
   - No placeholder text ("Your headline here", "Placeholder heading", etc.)

   Fix all gate failures before proceeding. Do not skip the validator.

1. Install the generated theme into a Studio site using `liberate_install_theme` (passes `themeFiles[]` as strings — no file-copy step needed). On a full re-run, provision a fresh Studio site or wipe the replica's content first. On resume, keep the existing site.

2. Import WXR and `products.csv` via `liberate_import` once the theme is active.

3. Read the local Studio URL from the site status. Do not assume a fixed port.

After editing `theme/patterns/*.php` or `theme/style.css`, reinstall via `liberate_install_theme` and reload the Studio URL — no manual file copy needed.

## 2. Screenshot the Studio URL

Use the Playwright MCP tools (`mcp__plugin_playwright_playwright__*`) to navigate to the Studio local URL and capture full-page screenshots.

```
browser_navigate { url: "<studio-local-url>" }
browser_resize { width: 1280, height: 1400 }
# Wait ~2s for WP to hydrate fonts + images, then capture:
browser_take_screenshot { fullPage: true, path: "<outputDir>/wp-result-desktop.png" }
```

For mobile:
```
browser_resize { width: 390, height: 844 }
browser_take_screenshot { fullPage: true, path: "<outputDir>/wp-result-mobile.png" }
```

After capture, check the actual screenshot dimensions. Some Wix layouts keep a fixed wide canvas on a 390px viewport, so the rendered content stays ~`980`/`1280px` and gets clipped (an ancestor's `overflow-x:clip` keeps `scrollWidth == 390` while real content sits off-screen). **This is a responsiveness FAILURE, not something to preserve** — do NOT reproduce the source's fixed width with a theme-scoped `min-width` (that ships an amputated mobile layout). A fixed-coordinate page-builder section that renders past the fold (`contentPastFold > 0`) must be rebuilt via **R4a** (`rebuild-section` → reflowing core blocks); the raw styled island (R4b) is a desktop-only floor. See [[project_r4b_styled_island_responsiveness]].

If the screenshot returns before the page is fully painted, increase the wait to 4-5 s or scroll to the bottom and back to trigger lazy hydration.

## 3. Diff

The pixel-diff is a **signal only** — use `liberate_compare` (our `diff-pngs` tool) to generate a diff image and percentage score. It is not the acceptance gate. Use it to spot obvious regressions between iterations, not as a pass/fail threshold.

Read the screenshots side-by-side. Walk the page section by section from top to bottom. For each section check:

| Check | Pass condition |
| --- | --- |
| Section order | Same sections appear in the same vertical order |
| Background colors | Each section's bg matches within a visible-difference threshold (don't obsess over 2-LAB-unit deltas; obvious wrong colors only) |
| Typography | Heading sizes and weights are in the same ballpark; serif vs sans-serif matches; caps/lowercase matches |
| Image placement | Every image in the source capture has a corresponding image in the WP result at the same grid position |
| Image content | Uploaded images are the same images as the source (not placeholder gray) |
| Button presence | CTAs appear where they did in the source, with matching labels |
| Footer | Same layout, same copyright line, same social links if present |

Repeat against the mobile pair.

## 4. Responsiveness gate (hard acceptance bar)

This is the **hard acceptance gate**. The pixel-diff score is a signal; this gate is a pass/fail condition that must be satisfied before the site is considered complete.

**All three conditions must pass:**

1. **No horizontal overflow at 390px.** Capture the page at 390px wide. `document.documentElement.scrollWidth` must equal `window.innerWidth` (≤ 390). Any overflow indicates a layout that doesn't reflow correctly on mobile.

2. **Sections reflow at 390px.** Multi-column sections must collapse to a single column (or a readable narrower layout). A fixed-width canvas that merely scales down is a failure.

3. **No content past the fold.** `scrollWidth == 390` is necessary but NOT sufficient: `overflow-x:clip` makes a clipped fixed-width island report `scrollWidth == 390` while its content is amputated off-screen. Measure leaf content (text/img) whose `getBoundingClientRect().right > innerWidth` — a non-zero count fails. Fix via R4a rebuild, not CSS.

Check both conditions on every iteration. A site that passes the pixel-diff but fails the responsiveness gate is not complete.

## 5. Contrast and accessibility checks

Run these checks on the deployed Studio site. They are **warnings, not hard failures** — they go into the run-report but do not block completion on their own.

**Contrast (WCAG AA):**
- All text / background combinations should meet WCAG AA (4.5:1 for normal text, 3:1 for large text ≥ 18pt or bold ≥ 14pt).
- Use `browser_evaluate` to run a contrast audit or inspect computed styles against the palette.
- Log any failing pairs in the run-report under "Contrast warnings". Warn, but do not treat as a hard gate failure.

**Missing alt text:**
- Images without meaningful alt attributes are flagged in the run-report under "Accessibility notes".
- Decorative images with empty `alt=""` are acceptable.
- Images where the spec provided alt text but the pattern omitted it are class-B failures (fix the template).

## 6. Motion QA

For sites with detected animation signals or a motion profile that isn't `none`, run a separate motion check:

| Check | Pass condition |
| --- | --- |
| Entry state | First viewport does not hide content or flash a blank state |
| Direction | Simple reveal/parallax/marquee direction matches the source |
| Timing | Duration feels close to captured `animationDurationMs` / `transitionDurationMs` |
| Final state | Settled WP frame matches the source settled screenshot |
| Mobile | Hover-only content is visible or tappable without hover |
| Reduced motion | `prefers-reduced-motion: reduce` disables non-essential animation and leaves content readable |

A site targeting high UI match cannot pass with a motion `fail`; either preserve the simple motion or document a deliberate framework fallback in the run-report.

## 7. Failure classes

### Failure class A — spec file was wrong

The `<outputDir>/specs/section-<n>-<type>.md` file has a value that doesn't match what the site actually shows. Re-run the section extraction tool for that section's Y band, update the spec, regenerate the pattern (step 10 of `/liberate`), reinstall, screenshot again.

If the extractor and the screenshot disagree, the screenshot wins. Page builders can expose hidden or off-band DOM content that is technically extractable but not visually present in the capture. Mark those cases in the spec's "Notes for the pattern generator" and either omit the visible output or preserve only its vertical rhythm.

### Failure class B — pattern template dropped information

The spec was correct, but the block-markup template in `references/section-mapping.md` doesn't have a placeholder for the information that's missing (e.g. the spec listed a `{{SECONDARY_BUTTON}}` but the `cover-with-headline` template only has one button). Fix the template in `section-mapping.md`, regenerate the pattern, reinstall, screenshot again.

### Failure class C — WP rendering differs from expected

The spec and generation are both correct but WP produces a different visual than expected (e.g. `core/cover` is adding unwanted padding, `core/gallery` is applying unexpected gap). Document as a known gap in the run-report — do not hack the pattern around it. If the gap is important, file it as a follow-up.

## 8. Iteration budget

Budget **3 iterations** per site. If after 3 reinstalls the diff and responsiveness gate still don't pass, stop and write a failure entry in the run-report with the list of outstanding discrepancies. Do not keep iterating indefinitely.

Each iteration: fix the highest-impact failure class first (A before B before C). Re-run `liberate_validate_artifacts` after each fix before reinstalling.

## 9. Run-report output

At the end of the QA loop, the `design-qa` skill emits `<outputDir>/run-report.json`. Required fields:

```json
{
  "site": "<url>",
  "iterations": [
    { "n": 1, "changes": "<what broke, what was fixed>", "pixelDiffPct": 0.0 },
    { "n": 2, "changes": "..." },
    { "n": 3, "changes": "..." }
  ],
  "finalScore": "pass | partial | fail",
  "motionScore": "pass | partial | fail | n/a",
  "responsivenessPass": true,
  "contrastWarnings": ["<selector>: ratio X:1 on bg <hex>"],
  "missingAlt": ["<image-path>"],
  "remainingGaps": ["<gap 1>", "<gap 2>"],
  "buildCost": { "subagents": 0, "clusters": 0, "elapsedMs": 0 }
}
```

The run-report is the primary deliverable of the QA step. It feeds into the golden-fixture CI regression harness.

## 10. When the `core/cover` white-text bug bites

Symptom: hero text is invisible in the deployed screenshot because the light base color + `core/cover` combination forces white text. This is a known issue documented in `references/section-mapping.md` under "The brightness rule".

**Fix in place** — update `patterns/section-<n>.php` to use the `core/group` variant of `cover-with-headline` from `section-mapping.md`. Reinstall via `liberate_install_theme`. This should always be a class-B (template) fix, never a class-A (spec) fix.
