# Studio Code Agent Evaluation

Automated evaluation of the Studio Code AI agent using [PromptFoo](https://www.promptfoo.dev/).

## Quick Start

```bash
# Install promptfoo
npm install -g promptfoo

# Run evaluation
npx promptfoo eval -c eval/promptfoo.config.yaml

# View results in browser
npx promptfoo view
```

## What This Tests

| Test | What it evaluates |
|------|------------------|
| **create-theme** | Can the agent create a valid WordPress block theme? |
| **create-page** | Does the agent follow block content guidelines? |
| **fix-blocks** | Can the agent identify and fix invalid block markup? |

## Configuration

The evaluation uses the `anthropic:claude-agent-sdk` provider, which runs the Claude Agent SDK directly. This tests the agent's reasoning and code generation without the full Studio toolchain (site management, WP-CLI, etc.).

### Prerequisites

- `ANTHROPIC_API_KEY` environment variable set, or `studio auth login` completed
- Node.js 22+

### Running with Studio tools

For full end-to-end evaluation with Studio's MCP tools (site creation, WP-CLI, screenshots), you need:

1. Build the CLI: `npm run cli:build`
2. Create a test site: `node apps/cli/dist/cli/main.mjs site create "eval-site"`
3. Start the site: `node apps/cli/dist/cli/main.mjs site start "eval-site"`
4. Point `working_dir` in the config to the site's directory

### Cost estimates

Each evaluation run costs approximately:
- **create-theme**: ~$0.20-0.40 (Sonnet)
- **create-page**: ~$0.10-0.20
- **fix-blocks**: ~$0.05-0.15

## Adding Test Cases

1. Create a prompt file in `eval/prompts/`
2. Add a test entry in `eval/promptfoo.config.yaml` under `tests:`
3. Use assertions to validate the output:
   - `llm-rubric`: AI judge for semantic evaluation
   - `javascript`: Custom logic for structural checks
   - `cost`: Budget thresholds
   - `contains`: Simple substring matching

## CI Integration

To run evaluations on PRs that modify the system prompt or tools:

```yaml
# .github/workflows/eval.yml
on:
  pull_request:
    paths:
      - 'apps/cli/ai/system-prompt.ts'
      - 'apps/cli/ai/tools.ts'
      - 'skills/**'
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx promptfoo eval -c eval/promptfoo.config.yaml --output eval/results.json
      - run: npx promptfoo view --yes --output eval/report.html
```

## Extending

- **New providers**: Compare models by adding provider entries (e.g., `claude-opus-4-6`)
- **Repeat runs**: Set `repeat: 3` in `defaultTest.options` to measure variance
- **Red teaming**: Add security-focused prompts that test guardrails
- **Regression tracking**: Use `promptfoo share` to create shareable result URLs
