---
id: wave-1-claude-plugin-mechanics
wave: 1
title: Anthropic Claude Agent SDK — plugin / MCP / skill loading semantics
---

# Goal

Document the **rules** the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk@^0.2.117`, used by Studio Code) imposes on plugins, skills, and MCP servers. The synthesizer needs to know which DLA surfaces are mechanically compatible with how Studio Code already loads its agent — and which would require us to fork or wrap them.

We are not investigating DLA's repo here. We are investigating the host runtime: what kinds of plugins/skills/MCP entries can `studio code` plug into its existing `query({ options: { plugins, mcpServers, ... } })` call, what the file-layout contract looks like, and what gotchas exist.

# Questions to answer

## Plugin loading

1. What does `plugins: [{ type: 'local', path: <dir> }]` actually do at runtime? Does it scan for `.claude-plugin/plugin.json` (or similar), `skills/<name>/SKILL.md`, `commands/`, `prompts/`? What's required vs optional in that directory layout?
2. Are there other supported `type:` values besides `'local'`? (npm package? URL? marketplace?) Quote the type definition.
3. Can multiple `local` plugins be loaded in the same `query` call? Do they share namespace, or are skills/commands scoped per-plugin? What happens on name collision?
4. How are `.claude-plugin/plugin.json` (manifest) fields interpreted by the SDK — name, version, MCP servers, skills, commands, agents? Is the manifest required or can a bare `skills/` dir work?

## Skills

5. What are the required vs optional frontmatter fields in `SKILL.md`? (We see `name`, `description`, `user-invokable` in Studio's existing skills — what else does the SDK accept?)
6. How is a skill *invoked*? Studio uses `buildSkillInvocationPrompt` ("Run the /<name> skill using the Skill tool."). Is "Skill" a built-in tool of the `claude_code` preset, or something the SDK injects when a plugin is loaded? If the latter, what enables it?
7. Can a skill ship its own MCP server / commands alongside it (i.e., a skill that needs a custom tool)? How is that wired?

## MCP servers

8. What's the full type of `mcpServers` in `Options`? What variants does it accept — in-process SDK servers (`createSdkMcpServer`), stdio child processes (`{ type: 'stdio', command, args, env }`), HTTP/SSE remote servers? Quote the type def.
9. Can a *plugin* declare MCP servers (e.g., via `.claude-plugin/plugin.json` `mcpServers` or a sibling `.mcp.json`)? If so, are those merged with the host's `mcpServers` at runtime? What's the merge order on conflicts?
10. Tool-name namespacing: if a plugin's MCP server exposes a tool `foo`, does it appear as `foo`, `<plugin>__foo`, `mcp__<plugin>__<server>__foo`, or something else? How does that interact with permission rules?

## Permissions / safety

11. Studio Code uses `permissionMode: 'auto'`. How does that interact with a third-party plugin's tools — does the agent auto-allow them, or are they classified per-tool by some heuristic?
12. Does loading a plugin grant it access to host tools (Bash, Read, Write, …)? Is there a way to scope a plugin's permissions?

## Versioning / compatibility

13. Has the plugin/MCP loader's API moved between recent SDK versions? Are there breaking changes between `0.2.x` minor releases that would matter (e.g., between Studio's `0.2.117` and whatever DLA targets)?
14. Does the SDK reload plugins on file change, or are plugins frozen at `query()` time? (Affects whether we'd need a CLI restart to pick up a DLA update.)

# Suggested approach

- Start in `apps/cli/node_modules/@anthropic-ai/claude-agent-sdk/`. Read the bundled `.d.ts` files (especially `Options`, `Plugin`, `McpServerConfig` / `McpServer` types). Quote the signatures.
- Find the SDK's runtime plugin loader (likely under `dist/` or `src/` inside the package) and skim it — just enough to answer (1)–(4). Don't try to reimplement.
- The SDK's GitHub repo (`anthropics/claude-agent-sdk-typescript` or similar — check the `package.json` `repository` field of the installed package) probably has docs and changelog. Use `WebFetch` if it's public, or `WebSearch` for "claude-agent-sdk plugins" / "claude-agent-sdk SKILL.md format".
- Cross-reference with the public Anthropic docs site if there are pages on Claude Code skills/plugins/MCP — tag any URLs.
- For (13), look at the SDK's CHANGELOG or release notes between `0.2.0` and the current Studio pin.

# Deliverable

A markdown report as your final message containing:

1. **Type signatures** — the exact `Options.plugins`, `Options.mcpServers`, `Plugin`, `McpServerConfig`/equivalent quoted from the installed SDK.
2. **Plugin layout contract** — what files the loader looks for, with required/optional flags.
3. **Skill contract** — frontmatter fields, invocation mechanism, what "Skill" tool actually is (preset built-in? plugin-injected?).
4. **MCP transport variants** supported by `mcpServers`, with a one-line example of each (in-process SDK server, stdio child process, HTTP/SSE if supported).
5. **Multi-plugin behavior** — collision rules, namespacing, merge order with host MCP servers.
6. **Compatibility risks** — anything in DLA's `.claude-plugin/`/`.mcp.json` that might *not* "just work" against Studio's pinned SDK version.

If a question can't be answered from the SDK source/docs, say so explicitly — don't guess.

# Out of scope

- DLA's repo (handled by `wave-1-dla-inventory`).
- Recommending an approach (synthesis).
- Studio's bundling/distribution (handled by `wave-1-bundling-distribution`).

