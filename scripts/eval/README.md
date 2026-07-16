# Agent Evaluation

[PromptFoo](https://www.promptfoo.dev/) eval suite for the Studio Code agent. Runs the real agent via `startAiAgent()` and asserts on tool calls and output.

## Usage

```bash
studio auth login
npm run eval
npm run eval:view
```

`npm run eval -- -n 1` to run a single test.

Run one named test with `npm run eval -- --filter-pattern "preview sites"` (regex against the test description). Note: the flag is `--filter-pattern`, **not** `--filter-description` (which is not a valid promptfoo flag).

## Tests

- **identity** — Agent identifies itself correctly (verified by an LLM judge).
- **site-creation** — Agent calls `site_create` and it succeeds.
- **screenshot-all-timing** — Agent creates a minimal site and visually verifies the homepage on desktop and mobile. Asserts the agent uses one `take_screenshot` call with `viewport: "all"`, returns valid desktop/mobile PNG payloads, and keeps the screenshot tool under 15s.
- **single-page-build-turn-cadence** — Agent builds a simple one-page site. Asserts (a) every individual turn stays under 60s (wall-clock between successive assistant messages) and (b) no `wp_cli` call uses `--post_content-file=` (which silently fails inside PHP-WASM).
- **jetpack-catchall-slideshow** — Agent reaches for Jetpack on a slideshow request. Asserts the generated page content uses a `jetpack/*` block (i.e. the catch-all rule fired instead of the agent falling back to raw HTML).
- **differentiate-preview-vs-remote** — Regression for STU-1775. Seeds one connected WordPress.com remote site and one preview site for a local site, then asserts the `site_connected_remote_sites` and `preview_list` tools tag their output with a `type` discriminator (`wpcom-remote` / `preview`) and that the agent's prose keeps the two categories distinct (preview sites are never described as connected WordPress.com remote sites).
- **section-uses-theme-palette** — Agent adds sections to a site that keeps its default theme. Asserts the section block markup colors are drawn from the theme palette (color-slug attributes like `{"backgroundColor":"accent-1"}` or `var(--wp--preset--color--*)` in CSS) rather than hardcoded hex values. `theme.json` is excluded from the hex check since a palette is legitimately defined there.
- **single-fact-no-widgets** — With desks widgets force-enabled (`forceChatArtifacts: true`), a single-fact question ("what's my site's URL?") must be answered in prose with zero `studio_present` calls. Guards the `smallest-useful-widget` presentation rule.

## Adding tests

Tests live in `promptfoo.config.yaml`. The runner returns raw JSON (`toolCalls`, `toolResults`, `toolEvents`, `textSegments`, `questions`, `turnDurationsMs`) — write assertions in the YAML, not in the runner.

### Seeding fixtures

Set a `seed` var on a test to pre-populate config files before the agent turn — useful for flows that depend on connected remote sites or preview sites without making a real WordPress.com connection or preview. The seed accepts `localSite` (written to `cli.json`), `connectedWpcomSites` (written to `shared.json`, requires `studio auth login`), and `snapshots` (written to `cli.json`). Everything seeded is removed automatically after the turn so reruns start clean.

The grader (`grader-provider.mjs`) handles `llm-rubric` assertions via the WP.com AI proxy. No extra API key needed if you're logged into Studio.
