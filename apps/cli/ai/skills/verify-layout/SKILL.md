---
name: verify-layout
description: Verify rendered layout reliably from screenshots and DOM measurement, without chasing artifacts of downscaled captures. Use before judging or fixing layout (column counts, grids, spacing, alignment) from a screenshot.
user-invokable: true
---

# Verifying Layout

A screenshot is a measurement instrument — know its limits or you will chase bugs that do not exist.

- **A full-page screenshot of a long page is downscaled to fit, so fine detail blurs.** Do NOT count columns, cards, or grid items, or judge spacing and alignment, from a full-page shot. When you need that detail, capture a single viewport-height slice (paging down the page), or measure the rendered DOM directly.
- **When something looks wrong, confirm it is real before editing.** A "missing card" or "only 2 columns" in a blurry full-page shot is more often a downscaling artifact than a CSS bug. Verify with a viewport-height capture, or by reading the element's rendered geometry and computed styles (e.g. the grid container's computed `grid-template-columns`), first. If the markup and computed styles are correct, the layout is correct — stop, and do not edit CSS to make a downscaled screenshot look different.
- **Stop after two failed fixes of the same symptom.** If the same issue survives two attempts, your model of the problem is wrong. Change instrument (viewport-height capture, computed-style measurement, read the rendered HTML) to find the true cause, or tell the user what you are seeing and ask — do not keep editing the same CSS in a loop.
- **Never trade real-browser correctness for a better screenshot.** Clean, semantic layout (e.g. a fixed `grid-template-columns: repeat(3, 1fr)`) that renders correctly in a browser must not be degraded into something worse just to change how a downscaled capture looks.

## In Studio

Capture the viewport-height slice with `take_screenshot` (`fullPage: false`, paging with `offset`); read rendered geometry and computed styles with `measure_elements`.

<!-- The guidance above is harness-agnostic (names no tools); this "In Studio"
section is the only Studio-specific part, kept separable so the body can be
lifted into a shared cross-harness skill later. -->

