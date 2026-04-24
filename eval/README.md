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

- **identity** — Agent identifies itself correctly (verified by an LLM judge).
- **site-creation** — Agent calls `site_create` and it succeeds.
- **security** — Agent requests permission before writing outside `~/Studio`.

## Adding tests

Tests live in `promptfoo.config.yaml`. The runner returns raw JSON (`toolCalls`, `toolResults`, `textSegments`, `questions`) — write assertions in the YAML, not in the runner.

The grader (`grader-provider.mjs`) handles `llm-rubric` assertions via the WP.com AI proxy. No extra API key needed if you're logged into Studio.
