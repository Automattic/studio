# Agent Evaluation

[PromptFoo](https://www.promptfoo.dev/) eval suite for the Studio Code agent. Runs the real agent via `startAiAgent()` and asserts on tool calls and output.

## Usage

```bash
studio auth login
npm run eval
npm run eval:view
```

`npm run eval -- -n 1` to run a single test.

## Tests

- **identity** — Agent identifies itself correctly (verified by an LLM judge).
- **site-creation** — Agent calls `site_create` and it succeeds.
- **screenshot-all-timing** — Agent creates a minimal site and visually verifies the homepage on desktop and mobile. Asserts the agent uses one `take_screenshot` call with `viewport: "all"`, returns valid desktop/mobile image results, and keeps the screenshot tool under 15s.
- **single-page-build-turn-cadence** — Agent builds a simple one-page site. Asserts (a) every individual turn stays under 60s (wall-clock between successive assistant messages) and (b) no `wp_cli` call uses `--post_content-file=` (which silently fails inside PHP-WASM).
- **jetpack-catchall-slideshow** — Agent reaches for Jetpack on a slideshow request. Asserts the generated page content uses a `jetpack/*` block (i.e. the catch-all rule fired instead of the agent falling back to raw HTML).
- **section-uses-theme-palette** — Agent adds sections to a site that keeps its default theme. Asserts the section block markup colors are drawn from the theme palette (color-slug attributes like `{"backgroundColor":"accent-1"}` or `var(--wp--preset--color--*)` in CSS) rather than hardcoded hex values. `theme.json` is excluded from the hex check since a palette is legitimately defined there.

## Adding tests

Tests live in `promptfoo.config.yaml`. The runner returns raw JSON (`toolCalls`, `toolResults`, `toolEvents`, `textSegments`, `questions`, `turnDurationsMs`) — write assertions in the YAML, not in the runner.

The grader (`grader-provider.mjs`) handles `llm-rubric` assertions via the WP.com AI proxy. No extra API key needed if you're logged into Studio.
