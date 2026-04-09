# STU-1439: HTML Block Checker - Findings & Lessons Learned

## Problem

The `studio ai` CLI agent generates `core/html` blocks when it should use native Gutenberg blocks (`core/group`, `core/heading`, `core/paragraph`, `core/columns`, etc.). This makes the generated content non-editable in the WordPress block editor. Prior attempt in PR #2976 used a prompt-only approach and failed.

## Approach: Deterministic Code Tool

Built `html-block-checker.ts` — a tool that parses block content via `wp.blocks.parse()` in a real browser (Playwright), identifies `core/html` blocks, analyzes their DOM content, and flags blocks whose descendants are all expressible as native Gutenberg blocks.

### How it works

1. Sends block content to the site's block editor page, calls `wp.blocks.parse()` to get the parsed block list.
2. For each `core/html` block, parses its `originalContent` with `DOMParser`.
3. Checks if the wrapper tag is in an "allowed" list (svg, form, script, canvas, iframe, video, audio, style, input, select, textarea) — if so, the HTML block is acceptable.
4. Otherwise, recursively checks if ALL descendant elements are "convertible" (div, section, header, footer, h1-h6, p, ul, ol, li, table, img, figure, blockquote, a, span, em, strong, br, hr, etc.) — if so, it flags the block and suggests native replacements.

### Integration

Merged the check into the existing `validate_blocks` tool via `Promise.all`, so both block markup validation and HTML block misuse detection run in a single call. A standalone `check_html_blocks` tool was also registered.

## What we tried and what happened

### 1. Standalone `check_html_blocks` tool (failed)

**What**: Registered as a separate tool the agent could call independently.
**Result**: The agent reliably called `validate_blocks` but consistently forgot to call `check_html_blocks`. It would validate markup, get a pass, and move on.
**Fix**: Merged both checks into `validate_blocks` so the HTML analysis runs automatically every time.

### 2. Prompt-only guidance (insufficient)

**What**: Updated system prompt with guidelines saying "don't use core/html" and listing when it's acceptable.
**Result**: The agent still defaulted to writing raw HTML sections wrapped in `<!-- wp:html -->`. It didn't know Gutenberg block syntax well enough to compose in native blocks from the start.
**Fix**: Added a "Core block patterns" reference section to the system prompt with concrete markup examples for core/group, core/heading, core/paragraph, core/columns, core/image, core/buttons, core/list, core/separator.

### 3. Agent gaming the checker with `data-*` attributes (exploited)

**What**: The original `isConvertibleContent()` function had a check: if any element had `data-*` attributes, treat the content as non-convertible (allowed HTML block).
**Result**: The agent learned to add fake `data-*` attributes (`data-decorative="true"`, `data-layout="grid"`, `data-animate="counters"`) to bypass the checker while still using `core/html` for structural content.
**Fix**: Removed the `data-*` attribute check entirely. Only tag names determine convertibility. Updated system prompt to explicitly state "Adding `data-*` attributes does NOT make a block acceptable."

### 4. Agent not planning block structure (pattern)

**What**: The workflow step 2 said "Plan the design" — the agent planned visual design (colors, typography, spacing) but never which Gutenberg blocks to use.
**Result**: The agent went straight to writing HTML and then wrapping it in blocks, rather than thinking in blocks from the start.
**Fix**: Updated step 2 to "Plan the design AND block structure" — requiring the agent to plan which sections use `core/group`, where to use `core/columns`, etc.

## Key observations

- **The agent treats `core/html` as an escape hatch**: When it doesn't know the correct block syntax, it defaults to writing HTML and wrapping it. Providing block syntax examples reduced this but didn't eliminate it.
- **Deterministic tools are more reliable than prompt instructions**: The agent can ignore or creatively reinterpret prompt guidance, but it can't bypass a tool that programmatically rejects its output.
- **The agent actively games checkers**: When given a rule with exceptions, the agent will manufacture conditions that trigger the exception. Any escape hatch in the checker becomes an exploit vector.
- **Merging checks into existing tools is more effective than adding new tools**: The agent has learned habits around which tools to call. Piggy-backing on those habits is more reliable than teaching new ones.
- **The checker threshold matters**: Setting `STRUCTURAL_BLOCK_THRESHOLD = 0` (any single convertible block = fail) was necessary. A higher threshold let too many structural blocks slip through.

## Files created/modified

- `apps/cli/ai/html-block-checker.ts` — Core analysis logic
- `apps/cli/ai/tools.ts` — Tool registration, merged into `validate_blocks`
- `apps/cli/ai/system-prompt.ts` — Block patterns, stricter guidelines
- `apps/cli/ai/tests/html-block-checker.test.ts` — 14 tests
- `apps/cli/ai/tests/tools.test.ts` — Mock for html-block-checker

## Open questions for next approach

- Is a post-generation check the right pattern, or should we prevent HTML block generation earlier in the pipeline?
- Should the block pattern examples be dynamic (pulled from the site's registered blocks) rather than hardcoded in the prompt?
- Would a block-by-block generation approach (generate one block at a time, validate immediately) be more effective than generating full page content and checking after?
- The checker catches the problem but relies on the agent to fix it — the agent sometimes generates the same core/html blocks again in the fix loop. Would an automatic conversion step (tool converts HTML blocks to native blocks) be more reliable?
