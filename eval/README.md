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
- **single-page-build-turn-cadence** — Agent builds a simple one-page site. Asserts (a) every individual turn stays under 60s (wall-clock between successive assistant messages) and (b) no `wp_cli` call uses `--post_content-file=` (which silently fails inside PHP-WASM).
- **jetpack-catchall-slideshow** — Agent reaches for Jetpack on a slideshow request. Asserts the generated page content uses a `jetpack/*` block (i.e. the catch-all rule fired instead of the agent falling back to raw HTML).

## Adding tests

Tests live in `promptfoo.config.yaml`. The runner returns raw JSON (`toolCalls`, `toolResults`, `textSegments`, `questions`, `turnDurationsMs`) — write assertions in the YAML, not in the runner.

The grader (`grader-provider.mjs`) handles `llm-rubric` assertions via the WP.com AI proxy. No extra API key needed if you're logged into Studio.
