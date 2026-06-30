# How It Works — an interactive course

A self-contained course on the intricacies and flows of `data-liberation-agent`, built as a
set of beautiful, printable HTML lessons. It teaches the system as a **conceptual scaffold**
first, then drills into the real machinery — every lesson cites real source files by
repo-relative path.

**The links below render the styled pages** via [htmlpreview.github.io](https://htmlpreview.github.io)
(GitHub itself shows `.html` as source). They resolve once these docs are on `main`. For full
interactivity (the quizzes) or offline reading, clone the repo and open
[`index.html`](./index.html) in a browser. If GitHub Pages is enabled for the repo, the course
also renders at its Pages URL.

> Note: in-page navigation (next/prev lesson, the stylesheet) is rewritten by htmlpreview
> automatically, so once you open any lesson below you can move through the whole course.

## Curriculum

### Part I · The Scaffold
1. [The Two-Phase Spine](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0001-the-two-phase-spine.html) — extract → reconstruct
2. [Three Entry Points, One Core](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0002-three-entry-points.html) — CLI watch · subcommands · MCP
3. [The Fork in the Road](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0003-fork-in-the-road.html) — blocks vs carry vs theme

### Part II · Extraction
4. [The Adapter Pattern](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0004-the-adapter-pattern.html) — detect/discover/extract, the two seams
5. [Capture & the SectionSpec](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0005-capture-and-sectionspec.html) — where design becomes data
6. [The Resume-State Contract](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0006-resume-state-contract.html) — the five capture-once stores

### Part III · Reconstruction
7. [The Tick Loop & Judgment Seam](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0007-the-tick-loop.html) — the agent-in-the-loop
8. [Blocks Reconstruction](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0008-blocks-reconstruction.html) — native blocks + legible diagnostics
9. [The Carry Path](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0009-the-carry-path.html) — verbatim source, scoped & self-hosted
10. [The Shared Blocks Engine](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0010-blocks-engine-adoption.html) — the DLA↔engine seam

### Part IV · Output & Quality
11. [Output Artifacts](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0011-output-artifacts.html) — WXR · Woo CSV · self-hosted media
12. [Quality Gates & Diagnostics](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0012-quality-gates.html) — gates vs diagnostics

### Part V · Advanced Capabilities
13. [The Local / Owned-Source Path](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0013-local-owned-source-path.html)
14. [Forms → Jetpack](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0014-forms-to-jetpack.html)
15. [Design Foundations](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0015-design-foundations.html)
16. [Variation Hoisting & the Block-Fixer](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0016-variation-hoisting.html)
17. [The Shopify GraphQL Path](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/lessons/0017-shopify-graphql.html)

## Reference shelf
- [Glossary](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/reference/glossary.html) — the canonical language
- [Pipeline Map](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/reference/pipeline-map.html) — the whole flow on one page (badged D/J/M)
- [Determinism Map](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/reference/determinism-map.html) — which steps are deterministic vs judgment
- [File Map](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/reference/file-map.html) — where each concern lives in `src/`

Or jump to the rendered [course home](https://htmlpreview.github.io/?https://github.com/Automattic/data-liberation-agent/blob/main/docs/how-it-works/index.html).

---

Companion to the prose docs in [`../how-it-works.md`](../how-it-works.md) and
[`../flow.md`](../flow.md).
