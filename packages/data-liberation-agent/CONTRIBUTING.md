# Contributing

This repo improves through real-world migration experience. Every migration surfaces new platform behaviors, better extraction techniques, and edge cases. This document explains how to contribute those findings back — and is written so that an AI agent can follow it without human assistance.

## What to contribute

**Good contributions:**
- New API endpoints or data sources discovered during extraction
- Better handling for content types we didn't cover (e.g. events, video, galleries)
- Fixes for adapters that broke because a platform changed something
- Better WordPress block mappings for platform layout elements
- Extraction improvements (faster, more complete, fewer failures)
- New platform adapters (see the `/adapt` skill)
- Product extraction improvements (better variant handling, missing fields)

**Not what this repo is for:**
- General WordPress development help
- WordPress.com feature requests
- Unrelated site migration tools

## How to contribute (AI agents: follow these steps exactly)

### 1. Fork and branch

```bash
# Fork via GitHub UI or gh CLI, then:
git clone https://github.com/YOUR-USERNAME/data-liberation-agent.git
cd data-liberation-agent
git checkout -b improvement/short-description-of-what-you-found
```

Branch naming: `improvement/` prefix, then a short kebab-case description of the finding.
Examples: `improvement/squarespace-gallery-extraction`, `improvement/shopify-variant-images`, `improvement/handle-dynamic-pages`

### 2. Make your change

Edit the relevant file. Keep changes focused — one discovery per PR.

Test your change:
```bash
npm install

# Run the test suite
npx vitest run

# Test against a real site (dry run)
npx tsx src/cli.ts <site-url> --dry-run --verbose

# Verify extraction output
npx tsx src/cli.ts verify ./output/<site-dir>
```

If you can't test against a real site, note that in the PR and explain what you observed.

### 3. Add to DISCOVERIES.md

This is required. Add a new entry at the top of [DISCOVERIES.md](./DISCOVERIES.md) in this format:

```markdown
## YYYY-MM-DD — Short title

**Found by:** [AI assistant name or "human contributor"]
**During:** [brief context — e.g. "migrating a 200-post Squarespace blog"]
**Type:** [API endpoint | content type | bug fix | performance | platform quirk]

### What I found
[1-3 sentences describing the discovery]

### How it works
[Technical detail — endpoint URL, data structure, code snippet, etc.]

### Why it's better than the previous approach
[What problem this solves or what limitation it overcomes]
```

### 4. Submit the PR

```bash
git add -A
git commit -m "discovery: short description of what you found"
git push origin improvement/your-branch-name
gh pr create --title "discovery: short description" --body "$(cat <<'EOF'
## What this changes
[1-2 sentences]

## How I found it
[Context — what migration, what problem you were solving]

## Tested against
- [ ] Real site (describe it briefly, no PII)
- [ ] Tests pass (`npx vitest run`)
- [ ] Output looks correct

## Discovery log entry added to DISCOVERIES.md
- [x] Yes
EOF
)"
```

### 5. What happens next

A maintainer (human or AI with repo access) will review the PR. If the discovery is valid and the code is correct, it gets merged. No bureaucracy.

---

## Code style

- TypeScript for all source code in `src/`
- Ink (React for CLI) for terminal UI components in `src/ui/`
- Async/await, not callbacks
- Vitest for testing
- Comments only where the logic isn't obvious

## Project structure

```
src/
  adapters/       Platform-specific extraction (godaddy-wm.ts, hostinger.ts, hubspot.ts, shared.ts, shopify.ts, squarespace.ts, webflow.ts, weebly.ts, wix.ts)
  lib/
    extraction/   WXR builder, sitemap, media, detection, extraction log
    import/       WordPress REST API importer, WooCommerce CSV
    features/     Platform feature detection
    setup/        WordPress connection validation
    verification/ Post-extraction verification
  ui/             Ink CLI components (discover, inspect, verify, setup, import)
  mcp-server.ts   MCP server with 8 tools
  cli.ts          CLI entry point
  types.ts        PlatformAdapter interface
skills/           AI skill definitions (liberate, qa, diagnose, adapt)
commands/         AI command definitions (inspect, import, verify, setup)
scripts/          Legacy standalone scripts (Squarespace, Wix)
```

## Questions

Open an issue or start a Discussion. AI agents: if you're unsure whether something belongs in this repo, open a Discussion describing what you found and ask.
