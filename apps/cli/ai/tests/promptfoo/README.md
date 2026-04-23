# AI agent prompt regression tests

This suite uses [promptfoo](https://promptfoo.dev/) to guard against silent
regressions in the WordPress Studio AI agent prompt. Each case is a single-turn
evaluation: a user question is sent to Sonnet 4.5 with the **live** system
prompt (built from [`apps/cli/ai/system-prompt.ts`](../../system-prompt.ts))
plus every installed skill, and the response is graded against one specific
rule.

These tests are intentionally mechanical and deterministic. Do not use them to
test taste, multi-turn behavior, or visual fidelity — those still belong in
manual session audits.

## What's covered

| #  | Rule | Why it exists |
| -- | ---- | ------------- |
| 1  | `wp_cli` takes literal args; filter via `wp_cli eval`, never shell syntax (pipes, `$(...)`, `&&`). | `wp_cli` runs inside the WASM wrapper, which does not execute shell metacharacters. Shell syntax hangs or silently corrupts output. |
| 2  | In PHASE 2, the theme stylesheet is copied from the prototype with `cp`, not regenerated via `Write`. | Regenerating drifts from the screenshot-approved prototype and wastes 60–90s of silent generation. |
| 3  | Button paint belongs on `.wp-block-button.<name> .wp-block-button__link`, not the outer wrapper. | The outer wrapper is layout-only; `wp-element-button` provides default paint on the inner link. Putting paint on the wrapper produces doubled borders/backgrounds. |
| 4  | `theme.json` neutralizes `styles.elements.button` (transparent bg, 0 padding, 0 border, 0 radius). | Without this, WP's default `wp-element-button` paint leaks through and fights the className rules. |
| 5  | `theme.json` `settings.layout.contentSize` / `wideSize` match the prototype's max-widths. | WordPress's `.is-layout-constrained > *` clamps every constrained child to this value. If it doesn't match the prototype, content renders narrower than designed. |
| 6  | A section with a non-convertible child (SVG) is decomposed; `core/html` is isolated on the SVG only. | Wrapping the whole section in `core/html` breaks editability and loses the className-backed CSS hooks. |
| 7  | A card `<div>` becomes `core/group` + `core/heading` + `core/paragraph` + `core/buttons` + `core/button`, no `core/html`. | Every element with a native block equivalent must be converted. |
| 8  | Apply page content with `wp_cli eval` + `ABSPATH` + `file_get_contents`, never `--post_content-file=<host path>`. | `wp` runs inside the WASM filesystem and cannot read host paths — `--post_content-file` silently applies empty content. `ABSPATH` resolves to `/wordpress/`, which maps to the site root. |
| 9  | PHASE 1 prototype stylesheet starts as a <2KB skeleton of anchor comments, `tokens` anchor first. | Skeleton-first filling makes each turn small and screenshot-friendly. Tokens must be defined before any section uses them. |
| 10 | The first Phase 2 tool call after an approved Phase 1 screenshot is invoking the `blockify` skill. | Block markup written without the blockify translation rules loaded produces `core/html` dumps and misaligned selectors. |

## Running locally

Requires the Node version pinned in [`.nvmrc`](../../../../../.nvmrc) (24.x).
The helper imports [`system-prompt.ts`](../../system-prompt.ts) directly, which
relies on Node 24's native TypeScript support — no `tsx`/`ts-node` needed.

```sh
# From the repo root:
cd apps/cli/ai/tests/promptfoo

# One-off run (API key required)
export ANTHROPIC_API_KEY=sk-ant-...
npx promptfoo@latest eval

# Open the last run in the HTML UI (no API key needed)
npx promptfoo@latest view
```

On an Anthropic Pro/Max subscription you can alternatively rely on an active
Claude Code session instead of a raw API key — see the
[Anthropic provider docs](https://www.promptfoo.dev/docs/providers/anthropic/).

### Cost

Every run sends the full system prompt (~9.5K input tokens after skills are
concatenated) plus a short user message (~200 tokens) per test case, and
receives ~500–1500 output tokens per case. With the default Sonnet 4.5 provider
that comes out to roughly **$0.40–$0.55 per full run** (10 tests) — well below
the $1 ceiling. Rerunning within 5 minutes amortizes most of the input via
Anthropic's prompt cache.

To quickly sanity-check the harness without spending API credits, run against
a single test:

```sh
npx promptfoo@latest eval --filter-description "no shell syntax"
```

## Adding a new test case

1. Open [`promptfoo.config.yaml`](./promptfoo.config.yaml).
2. Add a new entry under `tests:` with a `description`, a `vars.userPrompt`,
   and one or more `assert:` entries. Prefer `contains` / `not-contains` /
   `regex` over `llm-rubric` — they're deterministic and free to evaluate.
3. If you need to parse JSON or apply multi-step logic, use
   `type: javascript` with `value: |` and return either a boolean or
   `{ pass, reason }`. The raw model response is available as `output`.
4. Run the suite locally, then commit.

The test target should be a specific, mechanical rule that can silently
regress — not a matter of taste. "Output matches the right block tagName" is
in scope; "the design is tasteful" is not.

## When regressions gate merge

The CI workflow at
[`.github/workflows/prompt-eval.yml`](../../../../../.github/workflows/prompt-eval.yml)
runs this suite on every PR that touches:

- `apps/cli/ai/system-prompt.ts`
- `apps/cli/ai/plugin/skills/**`
- `apps/cli/ai/agent.ts`
- `apps/cli/ai/tests/promptfoo/**`

A failure blocks merge. To triage:

1. **Download the HTML report artifact** from the failed job (`promptfoo-report`)
   and open it — it shows the exact model response that failed an assertion,
   the assertion itself, and why it failed.
2. **Figure out whether the PR broke the rule or the test.** If the PR
   intentionally relaxed or changed the rule, update the corresponding test
   in the same PR. If the PR broke the rule accidentally, restore the rule.
3. **Don't disable tests to unblock merges.** Either fix the prompt or, if the
   rule is genuinely obsolete, delete the test (and explain why in the PR).

## Rotating `ANTHROPIC_API_KEY`

The workflow reads the API key from the `ANTHROPIC_API_KEY` repository secret
(Settings → Secrets and variables → Actions). To rotate:

1. Generate a new key at <https://console.anthropic.com/settings/keys>.
2. Update the `ANTHROPIC_API_KEY` secret.
3. Re-run the latest failed prompt-eval job to confirm the new key works
   (Actions → prompt-eval → Re-run failed jobs).
4. Revoke the old key in the Anthropic console.

## Layout

```
apps/cli/ai/tests/promptfoo/
├── promptfoo.config.yaml   # Provider + test case definitions
├── prompt.mjs              # Builds system+user messages from the live TS source
├── README.md               # You are here
└── .gitignore              # Ignores promptfoo's local output/cache dirs
```
