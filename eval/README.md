# Agent Evaluation

[PromptFoo](https://www.promptfoo.dev/) eval suite for the Studio Code agent. Runs the real agent via `startAiAgent()` and asserts on tool calls, permissions, and output.

## Usage

```bash
studio auth login
npm run eval
npm run eval:view
```

`npm run eval -- -n 1` to run a single test.

## Tests

### Agent-behavior tests (real tools, real sites)

- **identity** — Agent identifies itself correctly (verified by an LLM judge).
- **site-creation** — Agent calls `site_create` and it succeeds.
- **security** — Agent requests permission before writing outside `~/Studio`.

### Prompt-rule regression tests (prose-only, no tool execution)

Each case pins a specific rule that's silently regressed before. The prompt asks the agent to narrate an answer in prose — assertions grep `d.textSegments.join('\n')` for the load-bearing substrings. No real site, no filesystem side effects, fast to run.

- **wp-cli-no-shell-syntax** — filtering goes through `wp_cli eval`, never pipes / `$(...)` / `&&`.
- **phase2-cp-stylesheet** — PHASE 2 stylesheet comes from `cp` on the prototype, not a fresh `Write`.
- **button-paint-inner-link** — all button paint goes on `.wp-block-button.<name> .wp-block-button__link`, wrapper carries zero paint.
- **theme-json-neutralize-button** — `styles.elements.button` is neutralized (transparent bg, 0 padding/border/radius).
- **theme-json-content-widths** — `settings.layout.contentSize` / `wideSize` match the prototype's intended max-widths.
- **hero-decompose-svg-only** — sections with an inline SVG decompose into native blocks with `core/html` wrapping only the SVG.
- **card-decompose-native-blocks** — a card `<div>` becomes `core/group` + `core/heading` + `core/paragraph` + `core/buttons` + `core/button`, no `core/html`.
- **apply-content-abspath-eval** — page content is applied via `wp_cli eval` + `ABSPATH` + `file_get_contents`, never `--post_content-file=<host path>` (silently no-ops in WASM).
- **phase1-style-skeleton** — the first prototype `style.css` `Write` is a <2KB skeleton of anchor comments with `tokens` first.
- **phase2-blockify-first** — the first Phase 2 tool call after an approved Phase 1 screenshot is the `blockify` skill.

## Adding tests

Tests live in `promptfoo.config.yaml`. The runner returns raw JSON (`toolCalls`, `toolResults`, `textSegments`, `questions`) — write assertions in the YAML, not in the runner. Parse `output` with `JSON.parse(output)` and grep the fields directly; for text-based rules join `d.textSegments` and match against the string.

To keep a new case fast and self-contained, phrase the prompt as narration — e.g. *"answer in prose only, do not call any tools"* — and assert on `textSegments` instead of `toolCalls`. Reserve real-tool runs for assertions that can only be observed via tool call sequencing (like the `security` case).

The grader (`grader-provider.mjs`) handles `llm-rubric` assertions via the WP.com AI proxy. No extra API key needed if you're logged into Studio.
