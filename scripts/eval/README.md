# Agent Evaluation

[PromptFoo](https://www.promptfoo.dev/) eval suite for the Studio Code agent. Runs the real agent and judges the outcome: the site it leaves behind, the sites it leaves alone, and what it tells the user. Which tools the agent used, and in what order, is not judged.

## Usage

```bash
studio auth login
npm run eval
npm run eval:view
```

`studio auth login` is all the suite needs — the agent under test runs through the WP.com AI proxy like the real app, and every assertion is a deterministic JavaScript check in `outcome.mjs`. (There is no LLM grader; see "Graded assertions" below.)

`npm run eval -- -n 1` to run a single test.

Run one named test with `npm run eval -- --filter-pattern "preview sites"` (regex against the test description). Note: the flag is `--filter-pattern`, **not** `--filter-description` (which is not a valid promptfoo flag).

## How a case is judged

After the turn, the runner captures what it left (`apps/cli/ai/eval-outcome.ts`) into the result's `outcome`:

- **Each site the turn created, and the seeded active site:** active theme and parent, active plugins, every published page, post, template, template part, navigation and pattern (content plus block counts), registered block style variations, the merged theme palette and styles, saved Global Styles, custom CSS, `DESIGN.md`, the active theme's files, its screenshot's real format, and which theme files differ from their WordPress.org release. The home page is rendered (status, PHP errors, navigation links, element ids), and every published page, template and part is validated in the site's own block editor.
- **Every other site:** whether the turn changed or removed it, by its `wp-content` modification time. Each case runs against its own site registry holding two stopped sites the request is not about ("Portfolio" and "Client Work"), so concurrent cases and the user's real sites stay out of the comparison.

The checks in `outcome.mjs` read that state. A case names the site it asks for in `vars.siteName`; the runner deletes a leftover from an earlier run before the turn, so prompts read the way a user would write them. Most site cases also assert `siteWorks` (renders without PHP errors, all blocks valid) and `otherSitesUntouched`.

## Cases

- **identity** — The reply identifies as WordPress Studio.
- **global-instructions** — The reply carries the sentinel token from the seeded global instructions (`~/.studio/knowledge/instructions.md`, restored after the turn).
- **site-creation** — The requested site exists and works.
- **screenshot-all-timing** — The model saw a desktop and a mobile capture of the home page, in under 15s of screenshot time. Runs on the `balanced` tier, since text-only models get files instead of image payloads.
- **single-page-build-turn-cadence** — A one-page build: a static front page with blocks, the site's own theme (self-hosted fonts that exist, a real JPEG or PNG screenshot), a palette that carries the `DESIGN.md` colors, and no turn over 60s.
- **one-page-nav-anchor-links** — The rendered navigation's section links work from every page: home-relative (`/#contact`, not `#contact`), and each target id exists on the home page.
- **differentiate-preview-vs-remote** — Regression for STU-1775. The reply describes the seeded preview as a preview and the connected site as a WordPress.com remote site.
- **push-confirms-target** — The seeded remote no longer exists. No push ran and the reply asks the user for a target.
- **jetpack-catchall-slideshow** — Jetpack is active and the front page uses a `jetpack/*` block.
- **woocommerce-shop-setup** — WooCommerce is active with published products.
- **child-theme-for-installed-theme** — Regression for STU-2017. The active theme is a child of Ollie, Ollie still matches its WordPress.org release file for file, and headings have a font family.
- **section-uses-theme-palette** — The site keeps Twenty Twenty-Five, and what the turn added (pages, saved templates, custom CSS, theme files changed from the release) uses palette colors with no hardcoded hex.
- **inline-block-constrained-alignment** — No CSS rule gives a block wrapper class an inline-level `display`, which escapes the constrained layout's centering.
- **repeated-treatment-uses-block-style** — A registered block style variation is applied at least twice, and no raw font size repeats three or more times.
- **active-site-reused** — A plan-only request on the active site creates no new site.
- **active-site-different-name** — With an active site and a request naming another site, no site is created or changed and the reply asks whether to use the active site or a new one.
- **design-system-annotation** — `DESIGN.md`'s primary color changed, and the active theme's palette carries the new value.
- **template-part-db-override** — Regression for STU-2155. The header WordPress renders opens submenus on click and keeps the user's Site Editor tagline, or the agent asked about the customization.
- **global-styles-db-override** — Regression for STU-2155. The rendered background is the requested color with the saved line height intact, or the agent asked about the saved styles.

Studio asks the user before irreversible calls (push, pull, delete, destructive WP-CLI) and before a request changes a second site. The scripted user approves each of those questions, and the result lists them in `confirmations`.

## Running the runner directly

`node apps/cli/dist/cli/eval-runner.mjs "<prompt>" "" '{"vars":{"timeoutMs":1800000}}'` runs one turn outside promptfoo and prints `EVAL_RUNNER_RESULT_FILE=<path>`. Environment variables: `STUDIO_EVAL_MODEL` picks the model (`fast`, `claude-sonnet-5`, …), `STUDIO_EVAL_SESSION_DIR` persists the session JSONL in that directory instead of memory, and `STUDIO_EVAL_AUTO_CONTINUE=<n>` resumes a turn that ended with an empty assistant message (some hosted tiers stop that way when their reasoning budget runs out) with `continue`, up to `n` times; the result reports the count as `autoContinues`.

## Adding tests

Cases live in `promptfoo.config.yaml`; checks live in `outcome.mjs` and are referenced as `value: file://outcome.mjs:<check>`, with parameters in the case's `vars`. Judge the state a user would see, not the route to it. When a check needs state the capture lacks, add it to `eval-outcome.ts` rather than reading tool calls. The runner also returns the transcript (`toolCalls`, `toolResults`, `toolEvents`, `textSegments`, `confirmations`, `turnDurationsMs`, and `inspections` when the seed asks for them) for reasons and debugging.

### Seeding fixtures

Set a `seed` var on a test to pre-populate config files before the agent turn — useful for flows that depend on connected remote sites or preview sites without making a real WordPress.com connection or preview. The seed accepts `localSite` (written to `cli.json`), `activeSite` (creates a real stopped site under `~/Studio/`, with optional `files` written into it by path relative to the site root, and prefixes the prompt with the `[Active site: …]` line the app and CLI picker add — without one, the prompt starts with `[Active site: none]`, as it does when no site is open; the site is deleted after the turn. `wpCli` is a list of WP-CLI argv arrays run on it after the files are written, for state that lives in the database, such as activating a theme or saving Site Editor customizations; a command fails the seed when it exits non-zero or prints `SEED_ERROR`, since `wp eval` exits 0 on PHP warnings. `inspect` is a list of WP-CLI argv arrays run after the turn, before the site is deleted; their output lands in the result's `inspections` for assertions on the final site state), `connectedWpcomSites` (written to `shared.json`, requires `studio auth login`), `snapshots` (written to `cli.json`), and `globalInstructions` (written to `~/.studio/knowledge/instructions.md`; the file's prior content — or absence — is restored after the turn). Everything seeded is removed automatically after the turn so reruns start clean.

### Graded assertions

The suite currently has **no LLM-graded (`llm-rubric`/`model-graded`) assertions** — every check is deterministic JavaScript over the runner's structured output.

There used to be a custom grader (`grader-provider.mjs`) that reused the Studio WP.com login through the AI proxy. The proxy's Studio lane now rejects plain judge calls: `studio-assistant*` requests are refused unless they carry the Studio Code agent envelope (a `system` prompt + `tools`) *and* the system prompt contains Studio Code's own identity. A grader is a bare single-turn judge, so it legitimately has neither — and faking them to pass would mean copying Studio's anti-abuse signature into a non-agent call, defeating a control that exists to stop exactly that. Rather than ship a grader that can't authenticate, the one `llm-rubric` assertion and the grader were removed.

To reintroduce graded assertions, give the grader an auth path that doesn't abuse the Studio lane: back it with an `ANTHROPIC_API_KEY` (calling `api.anthropic.com` directly), or ask #ai-ops for a dedicated eval-grader feature slug exempt from the agent-envelope/identity checks.
