# Skills

Skills are guided multi-step workflows available when using data-liberation-agent as an AI plugin. Each skill walks the AI through a complete process with phases, decision points, and quality checks.

Skill definitions live in `skills/<name>/SKILL.md`.

## User-facing skills

These are the skills you invoke directly in Claude Code (or another agent).

### /liberate

**Front door — capture a site once, then choose the reconstruct path and dispatch the matching sub-skill.**

Flow (idempotent — re-running on an already-captured site skips straight to the path choice):
1. Detect the platform
2. Discover all content (sitemap, navigation, platform features like stores/bookings/forms)
3. Extract pages, posts, media, and products
4. Capture screenshots, design tokens (palette, typography, breakpoints), and rendered HTML per URL
5. Confirm + path checkpoint: show inventory + estimated scope/cost/time + a platform-informed recommendation, then choose the reconstruct path (picking one is the go-ahead):
   - **blocks + products** → dispatch `/replicate-with-blocks` (editable block theme + WooCommerce)
   - **theme replication** → dispatch `/replicate-theme` (high-fidelity carry-and-scope)
6. The chosen sub-skill reconstructs, installs into a local WordPress site, and produces its own run-report

Handles resume for interrupted runs. In agent mode, progress is the agent's own narration; the headless extraction CLI keeps its own Ink TUI. Flags platform-specific features that won't transfer automatically (with WordPress plugin recommendations).

### /qa

**Compare extracted WXR content against the original source site and fix discrepancies.**

QA workflow:
1. Parse the WXR and fetch each original source page
2. Compare text, headings, images, and links with weighted scoring
3. Grade each page (pass/warn/fail) and compute a health score (0-100)
4. Fix issues: patch minor gaps in the WXR, flag major gaps for re-extraction
5. Verify fixes improved quality, revert if not
6. Escalate to `/diagnose` if patterns of failure emerge

Tiers: quick (fix critical only), standard (fix critical + warnings), exhaustive (fix all).

### /diagnose

**Debug failed or low-quality extractions by analyzing logs and probing the source site.**

Diagnostic workflow:
1. Triage with `liberate_verify` for a structured overview, then dig into raw logs
2. Classify the problem (high failure rate, individual failures, low quality, crash, product issues)
3. Investigate root causes (rate limiting, bot detection, wrong adapter, content selectors, network issues)
4. Deep browser probe with `liberate_probe` via CDP (window globals, cookies, localStorage, network entries, platform identity) — useful for verifying auth state and finding alternate data sources
5. Fix at the right level (adapter code, configuration, data patches)
6. Verify the fix improved results
7. Document findings in DISCOVERIES.md

### /adapt

**Build a new platform adapter to extract content from an unsupported platform.**

Adapter development workflow:
1. Reconnaissance: platform detection signals, content discovery methods, extraction approach
2. API mapping with `liberate_map_apis` via CDP — automatically discovers all JSON API endpoints, categorizes them, captures sample responses and auth headers
3. Browser probing with `liberate_probe` — inspect window globals, localStorage, cookies, and platform identity for client-side data sources
4. Build the adapter implementing `PlatformAdapter` (detect, discover, extract)
5. Add product support if the platform has e-commerce
6. Register in the MCP server and CLI
7. Write tests with fixture data
8. Manual verification with `--dry-run --verbose`
9. Document in README.md and DISCOVERIES.md

## Orchestration-internal skills

The following skills are invoked **only by the orchestrator**, not by users — invoking them directly mid-session conflicts with the orchestrator's state. They are marked `disable-model-invocation` so they don't surface in `/`-discovery.

**The two reconstruct paths** `/liberate` dispatches to (the choice offered at the path checkpoint):

- **`replicate-with-blocks`** — block reconstruct: design-foundations → theme → clustering → section extraction → builder fan-out → assemble → validate → install → visual-QA loop → `run-report.json`. Editable WordPress block theme + WooCommerce.
- **`replicate-theme`** — carry-and-scope reconstruct: carries source markup into `core/html` islands, scopes the source CSS, installs a `<site>-carry` theme, compares → `run-report-carry.json`. High-fidelity, non-block-editable.

**The helper skills** these (and `design-qa`) call:

| Skill | Purpose |
|---|---|
| `design-foundations` | Analyze captured tokens + rep HTML + screenshots → `design-foundation.json` + frozen `design.md` brief |
| `creating-themes` | Scaffold `theme.json`, `style.css`, `functions.php`, parts, base templates, self-hosted fonts |
| `generating-patterns` | Builder (fanned out per cluster rep) → section layout skeletons as strings |
| `compose-page-blocks` | Misfit pages only — full page HTML/content → block `post_content` markup when deterministic slot-fill can't map cleanly |
| `design-qa` | Visual QA loop: replica vs source screenshots → A/B/C classification + fix directives + `run-report.json` |
| `editing-themes` / `editing-blocks` / `creating-blocks` | Apply QA fix directives to theme files or emit new embedded blocks |
| `testing-*` | Gate checks (build, validate-artifacts, responsiveness) run by the orchestrator at checkpoints |
