---
id: wave-1-studio-skill-plumbing
wave: 1
title: Map Studio Code's skill / MCP / slash-command plumbing end-to-end
---

# Goal

Produce a complete, evidence-backed map of how a slash command in `studio code` becomes an actual agent action today, so we know exactly where a `/migrate` command for DLA would plug in. The synthesizer needs to be able to answer: "if we add DLA via approach X, here's the precise file we change."

Scope is `apps/cli/` and `tools/common/`. Anything that requires changes in `apps/studio/` (Electron) must be flagged but not investigated further.

# Questions to answer

## Slash commands

1. How does the `studio code` chat loop dispatch slash commands? (Trace from user input in `apps/cli/commands/ai/index.ts` through `AI_CHAT_SLASH_COMMANDS` to either a JS `handler` or `buildSkillInvocationPrompt`.)
2. What's the difference between a "handler" slash command and a "skill" slash command? Where is each defined? What does each contract require?
3. How does a skill name in `AI_SKILL_COMMANDS` (in `tools/common/ai/slash-commands.ts`) become a discoverable skill at runtime? What ties the entry to the on-disk `apps/cli/ai/plugin/skills/<name>/SKILL.md`?
4. What does `buildSkillInvocationPrompt('foo')` produce, and how does the Claude Agent SDK turn that into actually executing `SKILL.md`? Is the SDK's "Skill tool" a built-in? Does it require any specific frontmatter fields (`name`, `description`, `user-invokable`)? What happens if the skill is missing or has bad frontmatter?

## Skills on disk

5. List every existing skill in `apps/cli/ai/plugin/skills/`, with the contents of its `SKILL.md` frontmatter (just the frontmatter, not the full body) and a one-line summary. Also note which ones are listed in `AI_SKILL_COMMANDS` and which aren't (any orphans?).
6. What auxiliary code/files do skills bring (e.g., `apps/cli/ai/performance-audit.ts`, `seo-audit.ts`, `inspector/`)? How does a `SKILL.md` reach into those (via MCP tool calls? Bash invocation? both)?
7. Where is the `plugin/` directory loaded? (Look for `plugins: [{ type: 'local', path: ... }]` in `apps/cli/ai/agent.ts` and any related config.) What does the SDK do with `.claude-plugin/`-style manifests vs a bare `skills/` directory?

## MCP servers

8. How is the in-process `studio` MCP server defined and registered (`createStudioTools`, `createSdkMcpServer` from `@anthropic-ai/claude-agent-sdk`)? What does `mcpServers: { studio: ... }` in `agent.ts` actually wire?
9. Can `mcpServers` accept stdio-transport servers (i.e., a child process speaking MCP), or only in-process SDK MCP servers? Quote the SDK's `mcpServers` type definition (look in `node_modules/@anthropic-ai/claude-agent-sdk`).
10. The MCP stdio server in `apps/cli/ai/mcp-server.ts` and the MCP command `apps/cli/commands/mcp/...` — what are these used for (external clients connecting in?), and is there a precedent for Studio Code *consuming* a third-party MCP server today?

## Bundling / runtime

11. How is `apps/cli/ai/plugin/` bundled into the published CLI? (Check `apps/cli/vite.config.*.ts`, especially any `vite-plugin-static-copy` config.) Does the build copy the whole tree, or only specific globs?
12. Where does the CLI live at runtime when shipped via npm vs inside Electron's resources? (Quick read of `dist/cli/` layout and `electron-vite` packaging in `apps/studio/electron.vite.config.ts` — just the bundling path; don't propose changes there.)
13. Are there any existing examples in the codebase of *spawning a child process* that backs a slash command (e.g., `/preview` runs a real CLI command)? How is process management done?
14. What auth / token plumbing is already available to a slash command? (Look at `readAuthToken`, `prepareAiProvider`, `resolveAiEnvironment` and how `/preview` and provider switching work.)

# Suggested approach

- Start at the chat loop: `apps/cli/commands/ai/index.ts` (lines around `AI_CHAT_SLASH_COMMANDS.find` already noted in research-plan).
- Read end-to-end: `apps/cli/ai/slash-commands.ts`, `tools/common/ai/slash-commands.ts`, `apps/cli/ai/agent.ts`, `apps/cli/ai/tools.ts` (just enough to characterize tool registration), `apps/cli/ai/mcp-server.ts`, and one full `SKILL.md` (e.g. `need-for-speed`).
- For SDK semantics, open `apps/cli/node_modules/@anthropic-ai/claude-agent-sdk/dist/...` (or the package's `index.d.ts`) and quote the relevant type signatures (`Plugin`, `McpServerConfig`, `query.options`).
- Check Vite static-copy config: `apps/cli/vite.config.dev.ts`, `vite.config.prod.ts`, `vite.config.npm.ts`, `vite.config.base.ts`.
- Use `git log --oneline -- apps/cli/ai/plugin/` to spot recent skill additions and how they were wired (the diff that added `need-for-speed` is probably the cleanest end-to-end example).

# Deliverable

A markdown report as your final message containing:

1. **Lifecycle diagram** (text/ASCII fine) — user types `/foo` → … → tool/skill executes. Two flows: handler-based and skill-based.
2. **Inventory** of existing skills with frontmatter snippets and a note on each one's tooling dependencies.
3. **MCP plumbing** — exact contract for adding a new MCP server entry to `mcpServers`, with the SDK type signature quoted, and a yes/no on stdio child-process MCP support.
4. **Bundling story** — exactly which files in `apps/cli/ai/plugin/` ship with the npm CLI, and how to add new ones.
5. **`/migrate` plug-in points** — an exhaustive enumeration: at which file/lines we'd add (a) a skill entry, (b) an MCP server entry, (c) a handler-based slash command, (d) a child-process invocation pattern. Pure mapping; no recommendations.
6. **Anything Electron-side** — flag (don't investigate) any wiring that lives in `apps/studio/` and would be touched.

# Out of scope

- Don't propose which integration approach to use — that's synthesis.
- Don't actually add a `/migrate` skill or any code.
- Don't run the desktop app.

