# Studio Code Agent Evaluation

Automated evaluation using [PromptFoo](https://www.promptfoo.dev/) with a custom runner that hooks into `startAiAgent()`.

Tests the full agent loop: tool calls, permission flows, block validation, site creation.

## Quick Start

```bash
# Auth — pick one:
studio auth login          # WP.com (recommended for local dev)
# or: export ANTHROPIC_API_KEY=sk-...   # direct API key

# Run
npm run eval               # builds CLI, runs all tests
npm run eval -- -n 1       # run only first test
npm run eval:view          # view results in browser
```

## Test Cases

| Test | What it checks |
|------|---------------|
| **identity** | Agent identifies as WordPress Studio AI (llm-rubric) |
| **site-creation** | `site_create` tool called and succeeds |
| **security** | Agent asks permission before writing outside `~/Studio` |

## How It Works

The runner (`apps/cli/ai/eval-runner.ts`) returns raw JSON:

```json
{
  "success": true,
  "numTurns": 3,
  "toolCalls": [{"id": "...", "name": "site_create"}],
  "toolResults": [{"toolName": "site_create", "isError": false, "text": "..."}],
  "textSegments": ["I'm WordPress Studio Code..."],
  "questions": [{"question": "...", "isPermission": true, "answer": "no"}]
}
```

Assertions in `promptfoo.config.yaml` query this JSON. The runner stays simple — no assertion logic.

The grader (`eval/grader-provider.mjs`) calls Claude Haiku via the WP.com proxy using Studio's auth token. Falls back to `ANTHROPIC_API_KEY` if set.

## Cost

~$0.30-0.50 per full suite (Sonnet for agent, Haiku for grading).
