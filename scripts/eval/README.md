# Agent Evaluation

[PromptFoo](https://www.promptfoo.dev/) eval suite for the Studio Code agent. Runs the real agent via `startAiAgent()` and asserts on tool calls and output.

## Usage

```bash
studio auth login
npm run eval
npm run eval:view
```

`studio auth login` is all the suite needs — the agent under test runs through the WP.com AI proxy like the real app, and every assertion is a deterministic JavaScript check. (There is no LLM grader; see "Graded assertions" below.)

`npm run eval -- -n 1` to run a single test.

Run one named test with `npm run eval -- --filter-pattern "preview sites"` (regex against the test description). Note: the flag is `--filter-pattern`, **not** `--filter-description` (which is not a valid promptfoo flag).

## Tests

- **identity** — Agent identifies itself correctly (verified by an LLM judge).
- **global-instructions** — Agent follows the user's global instructions (`~/.studio/knowledge/instructions.md`). Seeds the file with a sentinel-token rule and asserts the reply carries the token; the file's prior content is restored after the turn.
- **site-creation** — Agent calls `site_create` and it succeeds.
- **screenshot-all-timing** — Agent creates a minimal site and visually verifies the homepage on desktop and mobile. Asserts the agent uses one `take_screenshot` call with `viewport: "all"`, returns valid desktop and mobile image payloads, and keeps the screenshot tool under 15s.
- **single-page-build-turn-cadence** — Agent builds a simple one-page site. Asserts (a) the default flow scaffolds a fresh blank theme (`scaffold_theme` without `parentTheme`, successfully), (b) every individual turn stays under 60s (wall-clock between successive assistant messages) and (c) no `wp_cli` call uses `--post_content-file=` (which silently fails inside PHP-WASM).
- **jetpack-catchall-slideshow** — Agent reaches for Jetpack on a slideshow request. Asserts the generated page content uses a `jetpack/*` block (i.e. the catch-all rule fired instead of the agent falling back to raw HTML).
- **differentiate-preview-vs-remote** — Regression for STU-1775. Seeds one connected WordPress.com remote site and one preview site for a local site, then asserts the `site_connected_remote_sites` and `preview_list` tools tag their output with a `type` discriminator (`wpcom-remote` / `preview`). A companion `llm-rubric` assertion that graded the agent's prose (that it keeps the two categories distinct) was removed — see "Graded assertions" below.
- **child-theme-for-installed-theme** — Regression for STU-2017. Agent customizes a site running the installed Ollie theme. Asserts it scaffolds a child theme (`scaffold_theme` with `parentTheme: "ollie"`, successfully) and that no `Write`/`Edit`/mutating `Bash` call touches `themes/ollie/`.
- **section-uses-theme-palette** — Agent adds sections to a site that keeps its default theme. Asserts the section block markup colors are drawn from the theme palette (color-slug attributes like `{"backgroundColor":"accent-1"}` or `var(--wp--preset--color--*)` in CSS) rather than hardcoded hex values. `theme.json` is excluded from the hex check since a palette is legitimately defined there.
- **inline-block-constrained-alignment** — Agent builds a hero with a shrink-wrapped eyebrow/pill label. Asserts no CSS rule sets an inline-level `display` on a bare class used as a block `className` — that detaches the block from constrained-layout alignment (auto margins do nothing on inline-level boxes) so the label escapes the content column. The sanctioned pattern is a flex row group wrapper.

## Adding tests

Tests live in `promptfoo.config.yaml`. The runner returns raw JSON (`toolCalls`, `toolResults`, `toolEvents`, `textSegments`, `questions`, `turnDurationsMs`) — write assertions in the YAML, not in the runner. Each `toolResults` entry carries the result's text block plus any image content blocks (`images`, base64) and structured `details` (e.g. `studioArtifacts`).

### Seeding fixtures

Set a `seed` var on a test to pre-populate config files before the agent turn — useful for flows that depend on connected remote sites or preview sites without making a real WordPress.com connection or preview. The seed accepts `localSite` (written to `cli.json`), `connectedWpcomSites` (written to `shared.json`, requires `studio auth login`), `snapshots` (written to `cli.json`), and `globalInstructions` (written to `~/.studio/knowledge/instructions.md`; the file's prior content — or absence — is restored after the turn). Everything seeded is removed automatically after the turn so reruns start clean.

### Graded assertions

The suite currently has **no LLM-graded (`llm-rubric`/`model-graded`) assertions** — every check is deterministic JavaScript over the runner's structured output.

There used to be a custom grader (`grader-provider.mjs`) that reused the Studio WP.com login through the AI proxy. The proxy's Studio lane now rejects plain judge calls: `studio-assistant*` requests are refused unless they carry the Studio Code agent envelope (a `system` prompt + `tools`) *and* the system prompt contains Studio Code's own identity. A grader is a bare single-turn judge, so it legitimately has neither — and faking them to pass would mean copying Studio's anti-abuse signature into a non-agent call, defeating a control that exists to stop exactly that. Rather than ship a grader that can't authenticate, the one `llm-rubric` assertion and the grader were removed.

To reintroduce graded assertions, give the grader an auth path that doesn't abuse the Studio lane: back it with an `ANTHROPIC_API_KEY` (calling `api.anthropic.com` directly), or ask #ai-ops for a dedicated eval-grader feature slug exempt from the agent-envelope/identity checks.
