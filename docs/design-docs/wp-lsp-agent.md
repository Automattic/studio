# wp-lsp in the Studio agent

Studio Code runs [wp-lsp](https://github.com/draganescu/wp-lsp), a WordPress
language server, next to the agent. It gives the agent exact answers about
WordPress semantics — which callbacks run on a hook, where a post type slug is
registered, which files make up a block — instead of grep matches, and it
reports WordPress-specific problems (unknown hook names, wrong callback
argument counts, deprecated hooks, text-domain mismatches) into the agent's
context right after every PHP edit, so the agent corrects itself in the same
turn.

## Architecture

```
wp-files/wp-lsp/                 the wp-lsp release archive, pinned in
                                 scripts/download-wp-server-files.ts and shipped
                                 read-only with the CLI bundle
apps/cli/ai/lsp/
  protocol.ts                    Content-Length framing, JSON-RPC types
  client.ts                      request/notify client, document sync, diagnostics cache
  pool.ts                        one server per site, spawn/idle-reap/exit lifecycle
  format.ts                      LSP results -> compact agent-readable text
  diagnostics.ts                 post-edit diagnostics collection
apps/cli/ai/tools/lsp.ts         the `Lsp` agent tool (nine operations)
apps/cli/ai/runtimes/pi/index.ts registers the tool (local sites only) and appends
                                 diagnostics to Edit/Write results
```

The server runs on Studio's bundled native PHP binary (any supported version
satisfies wp-lsp's 8.2+ requirement), falling back to `php` on `PATH`. One
server is spawned per site, keyed by the site root, kept warm across turns
inside the long-lived CLI process, and reaped after 10 minutes idle. Site
files live on disk for both the Playground and native-php runtimes, so the
integration is runtime-independent.

Environment overrides:

| Variable | Meaning |
| --- | --- |
| `STUDIO_WP_LSP_PATH` | Use a wp-lsp checkout instead of the bundled archive. Pointing it at an empty directory disables the integration entirely — this is the A/B switch. |
| `STUDIO_WP_LSP_PHP` | PHP binary for the server (default: bundled PHP, then `PATH`). |
| `DEV_CONFIG_DIR` | Relocates `~/.studio`, including the `wp-lsp-cache/` stub cache. |

## Measuring the positive impact

The LSP changes agent behavior through two mechanisms, and each one maps to
metrics that can be counted:

1. **Navigation**: one `Lsp` call replaces a grep-read-grep chain when tracing
   a WordPress identifier. Expected effect: fewer tool calls and fewer input
   tokens per code-tracing task, and correct answers where grep is ambiguous
   (`[ $this, 'method' ]` callbacks, slugs used far from their registration).
2. **Diagnostics**: WordPress mistakes surface in the same turn as the edit
   that introduced them. Expected effect: bugs fixed before the user (or a
   screenshot loop) ever sees them, and fewer defects in the final site.

### A/B evals (offline, deterministic)

The PromptFoo eval runner (`apps/cli/ai/eval-runner.ts`) already hooks
`runStudioAgentTurn()` and captures every tool call, tool result, and
assistant message. Run each eval prompt twice — once normally, once with
`STUDIO_WP_LSP_PATH` pointed at an empty directory — and diff the captured
runs. With the switch off, the tool is not registered and the system prompt
carries no LSP section, so the control arm is a true baseline.

Metrics to extract from the captured events, per prompt and arm:

- **Tool-call profile**: total calls; `Grep` + `Read` + `Glob` counts vs `Lsp`
  counts. The navigation win shows up as substitution, not addition.
- **Tokens and turns**: input/output token usage (on each assistant message)
  and number of agent iterations to completion.
- **Task success**: PromptFoo assertions on the final answer. For code-tracing
  prompts the assertion is an exact fact ("lists `Byline::render` as an `init`
  callback"), which grep-based agents get wrong at a measurable rate.
- **Wall time**: per-turn duration, so the diagnostics wait (up to ~3s per PHP
  edit, ~10s on the first edit while the site indexes) is counted against the
  wins rather than ignored.

Suggested eval set, exercising both mechanisms:

- *Generation*: "create a plugin with a `book` custom post type and a
  shortcode", "build a theme with a custom block bound to a view script" —
  prompts whose output contains hooks, slugs, and handles that diagnostics can
  catch.
- *Tracing*: "what runs on `init` in this plugin?", "where is the `book` post
  type registered?", "who listens to `acme_thing_saved`?" against a seeded
  fixture site — prompts with one exact correct answer.

Repeat each prompt N times per arm (agent runs are stochastic) and hold the
model constant; a model change invalidates cross-run comparisons.

### Grading the artifact, not the transcript

The strongest impact signal is defect density in what the agent produced.
After any site-generation run (eval or manual), score the site mechanically:

- **`php -l`** over every generated PHP file: parse-error count.
- **wp-lsp as grader**: `wp-lsp index <site>` runs the same indexer the agent
  used and reports the final state — count remaining `unknown-hook`,
  `accepted-args`, `deprecated-hook`, and `text-domain` findings. With
  diagnostics on, this number should approach zero; the LSP-off arm reveals
  how many such bugs the unaided agent ships.
- **Boot check**: site starts, homepage returns 200, `wp-content/debug.log`
  is free of warnings/fatals.
- **`validate_blocks` pass rate** for generated block content.

Because the grader is independent of the agent transcript, it works for both
arms and for historical sites.

### Counters in the wild (Tracks)

For production measurement, add per-turn properties to the existing AI Tracks
events (see `docs/design-docs/analytics-tracks.md`; naming follows
`TRACKS_EVENTS` in `packages/common/lib/record-tracks-event.ts`):

- `wp_lsp_available` (bool) — enables cohort comparison, since availability
  varies by install (missing PHP, stripped bundle).
- `wp_lsp_requests` and a per-operation breakdown — adoption: is the model
  actually preferring `Lsp` over `Grep` when it should?
- `wp_lsp_diagnostics_reported` — problems surfaced after edits.
- `wp_lsp_diagnostics_resolved` — of those, how many disappeared in a later
  successful edit of the same file within the session. This is the
  self-correction rate: each resolved diagnostic is a bug the user never saw.

The reported/resolved pair can also be computed retroactively from stored
session transcripts (`getSessionsDirectory()`), which record every tool result
including the appended diagnostics blocks — useful for analyzing sessions that
predate any new Tracks properties.

### What "positive impact" looks like

- Tracing prompts: higher exact-answer rate, fewer tool calls, fewer input
  tokens in the LSP arm.
- Generation prompts: equal or slightly higher wall time per edit, but a lower
  wp-lsp-graded defect count and fewer debug-log warnings in the artifact.
- In the wild: a self-correction rate well above zero (each resolved
  diagnostic is a shipped bug prevented), with `Lsp` adoption growing relative
  to `Grep` on PHP-heavy sessions.
