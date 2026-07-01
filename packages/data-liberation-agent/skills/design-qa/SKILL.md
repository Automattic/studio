---
name: design-qa
description: Visual-QA loop run after replica theme install and content import. Captures replica screenshots, applies a hard responsiveness gate at 390px AND a hard per-section visual-parity gate (measured SectionParity records, verdict computed by buildRunReport), runs qualitative vision review of source/replica pairs, checks accessibility, and drives a per-section escalation ladder of fixes via editing-themes/editing-blocks/rebuild-section (R1 CSS → R2 spec-rebuild → R3 re-extract → R4a AI canonical-block rebuild → R4b deterministic styled-island floor) — escalating unresolved divergences to the operator rather than shipping them. Orchestration-internal — invoked by the replicate-with-blocks/liberate orchestrators, not directly by users.
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# Design QA

You are the visual-QA loop run after the replica theme is installed and content is imported. Your job is to verify that the replica matches the source site, classify every gap, apply fixes, and log what remains. You do not generate theme files from scratch — you drive `editing-themes` and `editing-blocks` for all edits.

Read `skills/design-qa/references/visual-qa.md` for the detailed visual-review procedure before starting.

## Honesty discipline (read first — this is the point of the whole skill)

**Never declare a match you have not measured. Default to skepticism, not optimism.**

The single most damaging failure mode in this loop is announcing "it matches" / "looks good" / "close enough" / "strong parity" when it does not. That destroys trust and ships a broken replica. Treat every such phrase as a STOP sign:

- If you catch yourself about to write "matches", "looks great", "pixel-perfect", "now matches", or "strong parity" — **stop**. Open the source and replica screenshots side by side, sample the actual pixels (colors, positions, sizes, gaps), and write the **itemized list of concrete differences first**. Lead with what is WRONG, in specifics (alignment, font, image identity, band color, overlay, missing element), before anything positive.
- A verdict of "match" requires **measured evidence per section** (sampled source vs replica values), not vision impression. No evidence ⇒ it is `fail (unverified)`, never a pass.
- When the operator says it doesn't match, they are the ground truth. Do not argue or re-assert — apologize, re-measure brutally, and list every gap you can find. The correct reflex is: *"You're right — it does not match. Here is every difference I can measure,"* then fix and re-measure.
- "Improved" is not "matches." Reaching genuine parity is the bar; partial progress is reported as partial, with the remaining gaps named explicitly.
- Do not send the operator a screenshot with a caption claiming parity unless the measured per-section table backs it. Show the gaps, not a victory lap.

This discipline overrides any urge to wrap up. Under-claiming and continuing to work is always safer than over-claiming and stopping.

## Inputs

The orchestrator passes you:

- `replicaBaseUrl` — the running replica WP install URL.
- `outputDir` — the resolved site output dir (e.g. `~/Studio/_liberations/example.com`); contains source screenshots and manifest.
- `archetypeReps` — map of archetype → representative URL paths (one per archetype, from `liberate_replicate_inventory`).

## Workflow

### Step 1 — Capture replica screenshots

Call `liberate_replicate_verify` with `replicaBaseUrl`, `outputDir`, and the representative URL paths from `archetypeReps`. Use the default viewports (desktop + mobile). The tool captures replica screenshots and pairs each with the matching source screenshot from `screenshots/manifest.json`.

```ts
liberate_replicate_verify({
  outputDir,
  replicaBaseUrl,
  urls: Object.values(archetypeReps),
  outputSubdir: "replica-screenshots"
})
```

Read the returned `pairs[]` manifest. You will use the paired PNGs for both the responsiveness gate and the qualitative review. Each pair also carries `sections[]` — per-section layout metrics read from the live replica DOM at desktop (`{ columnCount, bg, hasMedia }` in document order) — which feed the parity gate (Step 3).

### Step 2 — Responsiveness gate (HARD)

For each captured mobile pair, evaluate responsiveness using the `evaluateResponsive` helper from `src/lib/replicate/responsive-check.ts`. The gate checks three conditions at 390px viewport width:

- **No horizontal overflow:** `scrollWidth <= viewportWidth` — the page must not extend beyond the viewport.
- **Sections reflow:** `sectionsReflowed >= sectionsTotal` — every section must have stacked vertically (single-column) at mobile width.
- **No content past the fold:** `contentPastFoldCount == 0` — read from the mobile `ViewportCapture.contentPastFold` returned by `liberate_replicate_verify`. This catches a **fixed-layout styled island** (R4b) that keeps `scrollWidth == 390` because `overflow-x:clip` hides it, while its content is amputated off-screen. `scrollWidth` alone cannot see this.

A fail on ANY condition is a **hard block** — do not continue to qualitative review or acceptance. For overflow/reflow, apply responsive CSS via `editing-themes`. For **content-past-fold**, a CSS tweak will NOT fix a fixed-coordinate page-builder section (Wix etc.) — the styled island is a desktop-only floor and does not reflow; the section must be rebuilt via **R4a** (`rebuild-section` → reflowing core blocks). Re-capture (return to Step 1) after the fix. If the gate still fails after the ladder is exhausted, stop, log to `theme/notes.md` and `run-report.json`, and escalate to the operator (Step 7) without accepting.

### Step 3 — Qualitative review

Once the responsiveness gate passes, read each source/replica screenshot pair with vision — desktop and mobile — for every archetype representative. Produce per-URL observations:

- Section order match
- Header/footer structure and nav labels
- Hero content, image crops, CTA placement and color
- Column counts, spacing rhythm, alignment
- Typography (family, weight, size, color) fidelity
- Mobile stacking behavior

**Measure, don't trust vision alone — sample the source.** Before asserting any band "matches," SAMPLE the actual pixels of both source and replica and compare. Eyeballing repeatedly mis-judged colors, sizes, and gaps in practice; the source screenshot is ground truth. For each section band (use the section Y-bands from the spec, or scan the full-page screenshot top→bottom):

- **Section background color** — sample source vs replica at the band center and at left/center/right thirds. A hue/lightness delta beyond a small tolerance is a **real gap** (e.g. a pale-blue source band rendered grey), not "close enough."
- **Inter-section gaps** — scan a vertical strip; a white band between two colored sections in the replica that the source does not have is a gap-margin regression (sections must butt edge-to-edge).
- **Heading vs body sizes** — sample the rendered text height of a heading vs a paragraph; if the replica heading is markedly smaller than the source's, suspect fluid-typography shrink or a too-small size.

A no-PIL environment can sample PNGs with the project's `pngjs` dependency (load → index `(W*y+x)<<2`). Report the sampled deltas — do not write "matches" without them.

The per-section pixel-diff from `liberate_compare` (or `diff-pngs`) is a **forces-inspection signal**: a section whose desktop delta is high MUST be inspected. It is NOT itself the gate value (raw delta is noisy under font substitution / reflow). NOTE: `liberate_compare` needs the standard layout in BOTH dirs (`manifest.json` + `desktop/<slug>.png` + `mobile/<slug>.png`). `liberate_replicate_verify` writes the replica PNGs in that shape but its `pairs[]` come back in the tool result; if `compare` errors with "manifest missing," the replica subdir lacks a `manifest.json` — copy/symlink the source `manifest.json` into the replica dir, then re-run (don't silently fall back to vision-only).

**Build the measured `SectionParity[]` per content page — this is the gate, not your prose.** The metrics are read for you; you assemble and score them (`src/lib/replicate/section-parity.ts`):

1. For each content page, pair the verify result's `pairs[].sections[i]` (live replica DOM: `{ columnCount, bg, hasMedia }`) to the source spec section `specs[...][i]` **by index**.
2. Build a `SourceSectionDescriptor` from each spec section: `columnCount = layout.columnCount`, `backgroundColor`, `hasMedia = images.length > 0`, `isCssLayout = columnCount >= 2 || cells >= 2`, `isHtmlFallback = provenanceFlags has \`html-fallback#<i>\``. **Note the `#`:** a `html-fallback-styled#<i>` flag (the R4b styled-island floor) is NOT an unstyled fallback — `'html-fallback-styled#0'` does not start with `'html-fallback#'`, so it correctly does NOT set `isHtmlFallback`/`fallbackUnstyled`. Only the bare unstyled island trips the signal.
3. `toSectionParityMetrics(descriptor, replicaSection ?? null)` → `evaluateSectionParity(...)` → the five signals. A missing replica section (`null`) reads as `sectionPresent: false`.

The signals: `sectionPresent` (not dropped/merged), `bgDeltaE` (ΔE2000 of `spec.backgroundColor` vs rendered `bg`, `> BG_DELTA_E_FLOOR` = 10 diverges), `columnCountMatch` (replica `columnCount >= source`), `mediaPresent`, `fallbackUnstyled` (island on a CSS-layout section). `evidence` carries the measured source/replica values backing the score — **no record ships without it** (prove-it-works: no evidence ≠ matches).

For each `divergent` section, state concretely what a **10** (matches the source) looks like, then **gap-to-target**: climb the escalation ladder (Step 6) to close it and re-score, showing before→after. `deriveSectionParityStatus(signals, acceptance)` decides `match` / `divergent` / `accepted` — and the run-report verdict re-derives from these records, so you cannot talk a `divergent` section into a pass. Pixel sampling is now only a fallback when a section has no spec-captured `backgroundColor`.

**Vision review must catch what the upstream gates structurally cannot:**

- **Semantic misclassification.** The reconstruction's coverage + provenance gates check that captured text is PRESENT and not invented — they do NOT check it's rendered with the right semantics. A paragraph mis-rendered as a giant `<h2>` (body-as-heading), or an eyebrow duplicated as a trailing line, passes every gate. Only vision catches it → classify as **A** (spec/extractor wrong) and flag the extractor heading/body classification.
- **`core/html` fallback islands.** Sections the renderer fell back to (`run-report.htmlFallbackSections > 0`) carry verbatim source HTML but NOT the source CSS. Text-heavy sections render fine; a CSS-styled section (cards/grid/columns) that fell back renders UNSTYLED — looks broken. Vision-check every island: an unstyled-island regression is a **fidelity gap**, not a pass. (Root tuning lives in `section-coverage.ts` `TEXT_FLOOR` — see `replicate/SKILL.md`.)

### Step 4 — Accessibility checks (warn, not block)

For each representative page, flag the following in the run-report. Do **not** hard-fail or auto-fix — faithfulness to the source wins.

- **Contrast:** text/background pairs below WCAG AA (4.5:1). Check the palette entries from `design-foundation.json` against the source rendering. Log each failing pair as a warning.
- **Alt text:** images with missing or empty `alt` attributes. Carry the source's alt verbatim; flag any that are absent for human fill — never generate alt copy.

Add all flags to the run-report under `a11yWarnings[]`.

### Step 5 — Classify discrepancies

For each `divergent` section from Step 3, classify — class drives which **escalation rung** (Step 6) you climb, NOT whether you ship:

| Class | Meaning | Action |
|---|---|---|
| **A** | Spec wrong — the section spec or captured content is incorrect | Re-extract that section spec, then rebuild (rung R3) |
| **B** | Template dropped info — the pattern/template didn't carry through content that was in the spec | Fix section-mapping or rebuild the affected block markup (rungs R1–R2) |
| **C** | WP renders differently — a genuine core-block/WP rendering constraint, not a theme authoring error | Only Class C may be `accepted` by the agent, and ONLY with sampled-pixel `proof` attached |

**Class C is narrow and never a flatten.** Flattening (3 cards → 1 column), wrong background color, dropped grid/columns, and dropped media are **fixable, never Class C** — `deriveSectionParityStatus` rejects a `class-c` acceptance for them outright. A true Class-C constraint does not trip the robust signals at all (it shows as `match` with a high pixel-delta you annotate). Accepting any *divergent* section is therefore the **operator's** call (Step 7), not the agent's.

Produce the `SectionParity[]` records (Step 3) plus, per section, `{ urlPath, band, class, description, rung }`.

### Step 6 — Close the gap (escalation ladder)

Every `divergent` section must be driven toward `match`. The ladder is climbed **per section** — each section gets its own climb, so a page with several bespoke sections is not capped at one section's worth of fixes. **Each iteration climbs to a STRONGER rung — never re-run the same rung.** This strictly-climbing rule is what makes the 5-rung ceiling safe: it cannot degrade into five attempts at the same tweak. Climb until the section re-scores `match`:

- **R1 — theme/CSS fix** (`editing-themes`): band background color, spacing, inter-section gap.
- **R2 — rebuild block markup** (`editing-blocks`): restore the columns/grid the structured render flattened, from the source spec.
- **R3 — re-extract the spec** (Class A): if the section spec itself is wrong, re-extract it, then rebuild via R2.
- **R4a — AI canonical-block rebuild** (`rebuild-section`): when R1–R3 can't reach `match`, rebuild the section into native core blocks from its **source HTML + `styledHtml` + section screenshots + spec + design tokens** (richer inputs than R2's spec-only). Assemble that input bundle, dispatch the subagent, then run the **four acceptance gates**: ① block-markup oracle (`liberate_validate_artifacts`), ② canonicalization round-trip survives `@wordpress/blocks`, ③ re-measured `section-parity` = `match`, ④ `measureSectionCoverage` = no loss. Accept the rebuild **only if all four pass** — the agent cannot self-accept; acceptance is the measured re-score. If any gate fails, fall to R4b.
- **R4b — deterministic styled-island floor** (no AI): the section's `styledHtml` snapshot already ships through the reconstruction as a **styled** `core/html` island (provenance `html-fallback-styled#<i>`), which renders pixel-faithful and clears the `unstyled-island` signal. Faithful but not block-editable — the floor for genuinely bespoke sections R4a can't map to core blocks. R4b reaching `match` is a **valid pass**; R4a (editable) is always tried first.

Each R4a dispatch is a **subagent**, counted toward the run's subagent ceiling in `budget-guard` — that is the per-run cost bound on AI spend.

`editing-themes`, `editing-blocks`, and `rebuild-section` are `disable-model-invocation: true` — you cannot `Skill`-launch them from this inline-run loop. Apply each rung by **dispatching a subagent whose prompt points it at the skill's `SKILL.md`** (the subagent reads the file and applies the fix), matching the subagent-dispatch convention; do not stall on a refused Skill call.

After applying a rung, reinstall the updated theme files via the orchestrator's install path and return to Step 1 to re-capture and re-score. "Known gap" / "where it falls short" is an **escalation trigger, not a conclusion** — never write it as the terminal state of a shipped run.

### Step 7 — Circuit-breaker checkpoint (escalate, don't surrender)

**The checkpoint is "ladder exhausted per section" (all 5 rungs — R1, R2, R3, R4a, R4b — tried without `match`) OR the per-run cost ceiling, whichever comes first — not a per-page iteration tally.** The 5-rung ceiling is derived from the rung count, so it stays in sync if rungs change; the strictly-climbing rule (Step 6) prevents thrashing within it. Total AI spend is bounded by `budget-guard`'s subagent ceiling (`checkBudget`), which `pause`s the run when reached. When a section exhausts the ladder, or the budget guard signals `pause`, you do NOT log-and-ship. Stop and ask the **operator**, surfacing what you tried per rung and the current `SectionParity`:

- **Raise the budget** — keep climbing / accept more R4a subagent spend.
- **Accept with sign-off** — the operator accepts the divergence; record it as `acceptance: { by: 'human', proof: <operator rationale> }` on that section. This is the ONLY way a `divergent` section ships.
- **Abandon this page** — recorded explicitly, surfaced as a hard `fail` in the run-report.

Log per-rung attempts to `theme/notes.md`. Do NOT silently accept or stop. A `divergent` section with no human `acceptance` keeps the run at `fail`.

## Output contract

Return to the orchestrator:

Pass the `pageParity[]` (`{ page, sections: SectionParity[] }` per content page) into `buildRunReport` — the verdict is computed from it. Return to the orchestrator:

```json
{
  "passed": true,
  "iterations": 2,
  "perUrl": [
    {
      "urlPath": "/",
      "archetype": "homepage",
      "responsiveness": { "passed": true },
      "sections": [
        { "band": "hero", "score": 10, "status": "match",
          "signals": { "sectionPresent": true, "bgDeltaE": 1.2, "columnCountMatch": true, "mediaPresent": true, "fallbackUnstyled": false },
          "evidence": { "srcSample": "#d0d2cd", "repSample": "#d0d2cd" } },
        { "band": "service-cards", "score": 10, "status": "match",
          "signals": { "sectionPresent": true, "bgDeltaE": 2.0, "columnCountMatch": true, "mediaPresent": true, "fallbackUnstyled": false },
          "evidence": { "srcSample": "#ccc6c6", "repSample": "#cdc7c7" },
          "note": "was FLATTENED — cards lost bg + grid; restored via R2 iter 1, re-scored 4→10" }
      ],
      "qualitative": "Per-section parity above. CTA color drifted, fixed via R1 iter 1.",
      "a11yWarnings": []
    }
  ],
  "a11yWarnings": [],
  "notesPath": "<outputDir>/theme/notes.md"
}
```

`passed` is NOT a separate assertion — it is the run-report verdict computed by `buildRunReport` over `pageParity[]`: it is `true` only when (1) the responsiveness gate passes for all archetypes, AND (2) every content-page section re-derives to `match` or `accepted` (a `divergent` section, or a reconstructed page with NO sampled sections, forces `fail`). You cannot move a section to "accepted" yourself except a Class-C constraint with sampled-pixel proof — flattening/wrong-bg/dropped-grid/dropped-media never qualify and require the operator's sign-off (Step 7).

## Rules

- The responsiveness gate is a hard pass/fail. Per-section visual parity is **also a hard gate**: any unaccepted `divergent` section fails the run.
- **Record the measured `SectionParity[]` with `evidence` — never claim a page "matches" without sampled signals.** Vision + eyeballing repeatedly mis-judged color/size/gaps; a page with no sampled sections is `fail (unverified)`, not a pass.
- **Never self-accept a structural divergence.** Flattening, wrong bg, dropped grid/media → fix via the escalation ladder or escalate to the operator. Only a genuine Class-C WP constraint may be agent-accepted, and only with `proof`.
- Never auto-fix accessibility issues — flag and move on.
- Never accept a result that failed the responsiveness gate.
- Never generate net-new theme structure — drive `editing-themes` and `editing-blocks` for all modifications.
- 3 iterations per page is a circuit-breaker **checkpoint with the operator**, not a license to stop and ship. Escalate; don't surrender.
