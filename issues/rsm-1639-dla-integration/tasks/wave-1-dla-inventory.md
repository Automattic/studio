---
id: wave-1-dla-inventory
wave: 1
title: Inventory DLA — what it is, what it exposes, how it runs
---

# Goal

Produce a concrete, evidence-backed inventory of the Data Liberation Agent so the rest of the investigation has solid ground. We want to know **what DLA actually is as a software artifact**, **what surfaces it exposes for a host like Studio Code to consume**, and **what it needs to run a migration end-to-end**.

# Repo

- `Automattic/data-liberation-agent` (private). Use `gh` (`gh api repos/...`, `gh repo clone`) — `WebFetch` will 404 since it's private.
- Default branch: `main`. Last pushed 2026-04-28. TypeScript.
- Top-level entries already observed: `.claude-plugin/`, `.codex-plugin/`, `.mcp.json`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `gemini-extension.json`, `DISCOVERIES.md`, `README.md`, `cli.js`, `start.sh`, `commands/`, `prompts/`, `skills/`, `src/`, `docs/`, `scripts/`, `test/`, `package.json`, `tsconfig.json`, `vitest.config.js`.

You may clone the repo locally for inspection (e.g. `gh repo clone Automattic/data-liberation-agent /tmp/dla` — keep it outside this worktree) but **do not modify it**. Read-only investigation.

# Questions to answer

1. **What is DLA, in one paragraph?** What does it do, what is its scope, what users does the README target?
2. **What artifact(s) does it produce/publish?** Is it published to npm? GitHub Packages? Distributed as a Claude Code plugin? A Gemini extension? All of the above? Quote the README's install/run instructions.
3. **Plugin manifests:** What's inside `.claude-plugin/`, `.codex-plugin/`, and `gemini-extension.json`? What does each manifest declare (name, version, entry points, exposed commands/skills/MCP servers)?
4. **MCP server:** What does `.mcp.json` declare? Where does the MCP server live (path to entry file)? What tools does it expose (names + brief description, no need to enumerate args exhaustively)? How is it spawned (stdio, HTTP, child process)?
5. **CLI:** What does `cli.js` (and `start.sh`) do? Is it a standalone migration runner, or is it a wrapper that boots the AI agent? Does it require an Anthropic API key, a WordPress.com token, both, neither?
6. **Commands / prompts / skills directories:** For each of `commands/`, `prompts/`, `skills/`: how many entries, what's the file format (Markdown with frontmatter? JSON? TS?), and what does a representative example look like? Quote one of each.
7. **Source code:** What's in `src/` — is it the runtime code for the MCP server, the CLI, both, or something else? Roughly how big (LOC, file count by module)? What are the major external dependencies in `package.json` (esp. anything heavy: PHP runtimes, browser automation, native modules)?
8. **Runtime requirements:** Node version (`.nvmrc`, `engines`), required env vars / credentials, network calls it makes, whether it spawns subprocesses, whether it expects a Claude Code host to provide tools (Bash, Read, Write, etc.), whether it needs filesystem write access outside its own dir.
9. **Migration mechanics:** What inputs does a migration need (source URL? credentials? a destination?) and what outputs does it produce (SQL? wp-content tar? a configured site? a report?)? Look at `docs/`, `DISCOVERIES.md`, and the prompts/skills for ground truth.
10. **Versioning / release cadence:** Does it tag releases? Publish to npm with a version? How often does `main` get updates? What's the latest commit message and the gist of recent PRs?

# Suggested approach

- `gh api repos/Automattic/data-liberation-agent/contents/<path>` to walk the tree, then `gh api repos/Automattic/data-liberation-agent/contents/<file>` (or `gh repo clone` once) to read files.
- Read `README.md`, `AGENTS.md`, `CLAUDE.md`, `package.json`, `.mcp.json`, `.claude-plugin/<manifest>`, `gemini-extension.json` first — these answer most of the questions.
- Skim `cli.js`, `start.sh`, and pick one example each from `commands/`, `prompts/`, `skills/`. Then sample 2–3 files from `src/` to see what the runtime looks like.
- `gh api repos/Automattic/data-liberation-agent/releases` and `gh api repos/Automattic/data-liberation-agent/commits?per_page=10` for release/cadence signal.

# Deliverable

A single markdown report posted back as your final message. No new files in the repo. Structure suggestion:

1. **One-paragraph elevator pitch** of what DLA is.
2. **Surfaces table** — for each public surface (Claude plugin / Codex plugin / Gemini extension / MCP server / CLI / npm package / library import), one row: what it is, where it's defined, how a host invokes it, and whether it's the recommended entry point per the README.
3. **Runtime + dependencies** — Node version, heavy deps, credentials, side effects.
4. **Migration flow** — what `/migrate`-style invocation looks like end-to-end from DLA's perspective: inputs, outputs, where files land, what the user sees.
5. **Risks / unknowns** — anything that looks load-bearing but undocumented (e.g., a hardcoded path, a host-tool dependency, a private API call).
6. **Quoted excerpts** — keep them short but include README install instructions, any manifest snippet, and the entry-point shape of `cli.js`.

# Out of scope

- Don't try to *use* DLA (no `npm install`, no agent runs).
- Don't propose Studio-side wiring — that's the synthesizer's job.
- Don't touch `apps/studio/` (Electron desktop). Stay in research mode.

