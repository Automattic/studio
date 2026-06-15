---
name: visual-fidelity
description: The numeric visual repair loop shared by the html-to-blocks and blocks-to-theme skills. Run compare_html (or playground_render), measure layout geometry first to identify the drifted element, drill into it, repair in priority order, and iterate until rendered and editor surfaces both pass the thresholds. Invoked from within the other two skills during repair.
user-invokable: true
---

# Visual Fidelity

Use this skill to run the visual repair loop that both the `html-to-blocks` and `blocks-to-theme` skills depend on. The comparison tools return metrics and images; you decide what to fix. This skill is normally invoked from within those two during their repair phase, not on its own.

The thresholds are fixed: `maxMismatchPercent <= 1` and `maxHeightDelta <= 8`, on BOTH the rendered and the editor surface, for EVERY page. Passing them is the only success state.

## The Loop

1. Serialize/scaffold the current source (`serialize_wordpress_blocks` in stage 1, `scaffold_block_theme` + `validate_block_theme` in stage 2). Refresh the editor instance with `create_block_editor_preview` when a tree changed.
2. Run the comparison: `compare_html` in stage 1, `playground_render` in stage 2.
3. When it fails, run `measure_layout` FIRST, then inspect the screenshots and diff images to confirm.
4. Write the page's repair-tasks file with concrete, implementation-level tasks.
5. Fix the tasks as code changes — one targeted edit at a time.
6. Repeat until both rendered and editor thresholds pass on every page.

## Measure First

Pixel diffs LOCALIZE ("something is red near the footer"); DOM measurements IDENTIFY ("the footer h4 lost its 14px margin"). Always measure before staring at pixels.

1. `measure_layout` mockup vs rendered (default selector = sections + footer) at both viewports. Find the first row where `deltaTop` starts accumulating — the divergence lives between that row and the previous one.
2. Re-run with a narrower selector (`".section-x > *"`, then `".component > div > *"`) until the drift names one element. Drill from sections to children with progressively narrower selectors.
3. If geometry matches but pixels still differ, probe computed styles on the suspect element (font-size, line-height, letter-spacing, white-space, margins) and compare line rects — a 1px baseline offset or a different line count at equal heights is invisible in geometry tables but obvious in computed styles.
4. Re-run against the editor (`candidateKind: "editor"`); it applies the same comparison CSS the screenshot uses, so what it measures is what the diff sees.

A uniform `deltaTop` on every row below some point is ONE bug at that point, not many. Fix the first divergence and re-measure before touching anything below it.

## Repair Order

Repair from large to small. Do not spend a pass on minor spacing while obvious missing buttons, stacked button groups, broken layouts, wrong grid geometry, or fake forms remain.

1. **Content / semantic** — missing, duplicated, escaped, or wrong content; fake forms, missing links, wrong buttons, lost labels.
2. **Macro layout** — section order, hero geometry, major grids, asymmetry.
3. **Responsive structure** — columns, button rows, wrapping, mobile order.
4. **Editor-surface drift** — `edit()` wrapper tree, RichText tag/class parity, disabled form geometry, editor-only helper markup, editor-specific CSS.
5. **Component scale** — marquees, cards, forms, buttons, media objects, wrappers, selectors.
6. **Spacing / color / type polish** — last, never first.

## Task Format

Tasks must be implementation-level, not "make it look right":

    - [ ] Priority: high
      Area: header
      Issue: Source has a visible "Book a booth" pill; rendered hides it on desktop after pass 1.
      Cause: Repair CSS hides the third header button group at both breakpoints.
      Fix: Remove the hiding rule, restore the .site-header three-zone layout, style the third button as the yellow booking pill.
      Verify: Desktop rendered screenshot shows the pill; mobile matches source.

Each task names the visible issue, the target file/selector/block, the cause, the exact fix, and a verification check.

## Choosing the Surface to Fix

- **Both rendered and editor fail in the same area** — fix the shared block tree, custom-block data model, shared CSS, or block structure first; both surfaces converge together.
- **Rendered passes but editor fails** — fix custom-block `edit()` output, editor-only classes, or block-owned editor CSS. Do not change `save()` or frontend CSS unless the shared structure is genuinely wrong.
- **Editor passes but rendered fails** — fix `save()` output, support attributes, or frontend scoped CSS without adding editor-only differences.
- Treat editor-surface diffs as first-class failures, not noise, when the frontend looks right but the editable canvas drifts. Do not convert a core section to a custom section block solely to improve editor parity.

## Editor-Canvas Pitfalls

The editor preview demotes WordPress editor CSS into a low-priority cascade layer, so unlayered workspace CSS wins at any specificity — the canvas inherits your document rhythm like the frontend, and no margin/line-height restatement is needed. What can still legitimately differ:

- **Sticky elements engage their offset at scroll 0** inside the editor scroll context and render displaced. Add an editor-only override: `.your-bar.block-editor-block-list__block { position: static; }`.
- **Disabled inputs/textareas need `opacity: 1` and `-webkit-text-fill-color` set to the frontend text color** in the block CSS, or the browser greys them and the diff lights up.
- **RichText-editable `<button>` elements must keep `line-height: normal`** like real buttons; an inherited document line-height makes the canvas button 1-2px taller than the saved one.
- **Plain non-RichText text rendered by `edit()`** (helper blurbs, counts) should have its line-height pinned in block CSS, not inherited through editor wrappers.
- **The cascade-layer demotion beats editor STYLESHEETS but not editor INLINE styles.** RichText sets `white-space: pre-wrap; min-width: 1px` as inline styles, so text the mockup lets overflow on one line can letter-wrap in the canvas. Only `!important` author rules win against inline styles (e.g. `white-space: nowrap !important` on oversized display words). The fingerprint is an editor-surface height delta that is an exact multiple of one element's line-height, with rendered passing clean.
- Editor wrappers (`.block-editor-block-list__block`) ARE the block elements for apiVersion 3 blocks; write editor-only overrides as `tag.block-editor-block-list__block.your-class` next to the base rule they adjust.

## Stopping Rule

- Passing the thresholds is the ONLY successful end state. Do not stop because the result is visually close, structurally close, or because further tweaks feel like overfitting.
- If a repair improves one surface and regresses another, REVERT that repair and choose a different task.
- Do not accept a lower pixel score by hiding a source-visible element to dodge the diff.
- If CSS repairs are fighting prior CSS, replace the repair stylesheet instead of stacking patches.
- Use block-tree changes for missing content, wrong order, wrong block choice, broken editability, or wrong semantics. Use CSS only when structure and content are correct but visual mapping is off.
- If repeated concrete repairs cannot reduce the metrics, mark the run BLOCKED and name the blocker with the current metrics. Do not call it done.

Before returning control to the calling skill, read the comparison report and quote `aggregates.rendered` and `aggregates.editor` (stage 1) or the per-page `aggregate`/`editorValidation` (stage 2). Only report success when every aggregate passes on every page.
