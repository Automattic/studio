---
id: wave-1-pi-extensibility-surface
wave: 1
title: Map pi-coding-agent's third-party extensibility ceiling
---

# Wave 1 — pi-coding-agent extensibility surface

## Goal

Establish, with evidence from the installed `@mariozechner/pi-coding-agent@0.70.2` and `@mariozechner/pi-agent-core` packages, exactly what extension points pi exposes to third-party tool surfaces — both via the public `createAgentSession` API used by `apps/cli/ai/runtimes/pi/index.ts`, and via the lower-level `AgentSessionRuntime`/`AgentSessionServices`/agent-loop APIs that Studio currently does not use.

This is the foundation every other wave-1 brief leans on. Get it right and the other briefs collapse to focused mechanical questions; get it wrong and they will speculate.

## Questions

1. **Public-API ceiling.** What can a caller of `createAgentSession(options)` actually plug in? Confirm the shapes of `customTools`, `tools` allowlist, `noTools`, `resourceLoader`, `settingsManager`, `sessionStartEvent`, `scopedModels`, `authStorage`, `modelRegistry`. Are there hooks I'm missing — extensions, plugins, sources, slash-command registration, MCP-anything?
2. **Lower-level ceiling.** What does `AgentSessionRuntime` / `AgentSessionServices` / `createAgentSessionFromServices` / `createAgentSessionRuntime` add on top of the public path? Is there a way to register an `extension` programmatically (`ExtensionFactory`, `ExtensionRunner`, `discoverAndLoadExtensions`, `wrapRegisteredTools`, `wrapRegisteredTool`, `defineTool` from extensions/index), and what does that buy us — slash commands, source-info wiring, runtime API, anything else?
3. **Permission gating.** Does any public or lower-level surface expose `beforeToolCall` / `afterToolCall` (the hooks in `AgentLoopConfig` from `pi-agent-core/dist/types.d.ts`)? If not at `createAgentSession`, is there a path through `createAgentSessionFromServices` or the runtime builder? If neither, what's the realistic shape of per-tool permission policy in Studio (today the runtime has none — verify that)?
4. **Slash commands & skills.** Pi has its own slash-command + skill loader (`@mariozechner/pi-coding-agent`'s `core/skills.ts`, `core/extensions/...`); Studio currently disables them via `noSkills: true` on `DefaultResourceLoader` and runs its own skill loader (`apps/cli/ai/skills.ts`) + slash-command registry (`apps/cli/ai/slash-commands.ts`). Confirm this is still the case on trunk and document **why** Studio overrode pi's own surfaces. Note any constraints this puts on a `/migrate` slash command (i.e. the existing pattern is the `AI_SKILL_COMMANDS` registry from `tools/common/ai/slash-commands.ts` that triggers the Skill tool via `buildSkillInvocationPrompt`).
5. **MCP support.** Search the entire pi package surface (`grep -r "[mM][cC][pP]"`) and confirm there is no MCP client/server slot — neither as a tool source, nor as an extension type, nor as a session-start input. Document the absence concretely. (We expect "no", but state the bound explicitly.)
6. **Sources, system prompt, context.** What does `resourceLoader` actually load, and what does `noSkills`/`noExtensions`/`noPromptTemplates`/`noThemes`/`noContextFiles` (all currently set to `true` in `apps/cli/ai/runtimes/pi/index.ts`) suppress? If we wanted a wrapper-skill or DLA's `AGENTS.md`/`GEMINI.md` content injected into the system prompt, what's the right surface — `systemPrompt` override, `resourceLoader`, or a Studio-side prompt-builder change?
7. **Versioning & churn risk.** Capture the exact installed version, and note any features that look unstable or marked experimental in the typings (search for `@deprecated`, `experimental`, `internal`, `unstable`). The bridge / vendor approach we end up choosing rides on these surfaces — knowing which are load-bearing matters.

## Suggested approach

- Start from `apps/cli/ai/runtimes/pi/index.ts` and audit every pi symbol it imports.
- Walk every `*.d.ts` in `node_modules/@mariozechner/pi-coding-agent/dist/` and `node_modules/@mariozechner/pi-agent-core/dist/`. The public re-exports live in `pi-coding-agent/dist/index.d.ts`; the deeper hooks live in `pi-agent-core/dist/types.d.ts` (especially `AgentLoopConfig`) and `pi-coding-agent/dist/core/`.
- For each candidate hook, trace whether it's actually reachable from `createAgentSession` or only from the lower-level builders (`createAgentSessionRuntime`, `createAgentSessionFromServices`).
- Confirm or refute MCP support with `grep -rn "[mM][cC][pP]\|McpServer\|MCPServer\|ModelContextProtocol" node_modules/@mariozechner/pi-coding-agent/dist/ node_modules/@mariozechner/pi-agent-core/dist/`.
- Cross-check against Studio's current usage in `apps/cli/ai/runtimes/pi/index.ts`, `apps/cli/ai/mcp-server.ts` (note: that's Studio *exposing* its tools as MCP — not consuming MCP), `apps/cli/ai/skills.ts`, `apps/cli/ai/slash-commands.ts`, `tools/common/ai/slash-commands.ts`, and `apps/cli/ai/tools/skill.ts`.
- Skim the pi GitHub repo (or npm changelog if no public repo) for the 0.70.2 changelog if you can find it — confirms whether MCP support is on the roadmap or has been deferred.

## Deliverable

A markdown file at `issues/rsm-3143-dla-pi-research/wave-1-findings/wave-1-pi-extensibility-surface.md` with frontmatter (`task`, `wave`, `status`) and sections:

1. **Extensibility map (public API)** — table of every extension point exposed by `createAgentSession`, with its type signature, what it accepts, and what it lets you do.
2. **Extensibility map (lower-level)** — same, but for `createAgentSessionRuntime`, `createAgentSessionFromServices`, and any related builders.
3. **Hook inventory** — `beforeToolCall`, `afterToolCall`, session/turn events, extension events: which exist, which are reachable from where, with a verdict on whether each can be used for Studio per-tool permission policy.
4. **Slash-commands & skills mechanism** — what pi ships natively, what Studio currently overrides, and what seams a `/migrate` slash command should plug into (the `AI_SKILL_COMMANDS` registry pattern).
5. **MCP support** — a one-paragraph "confirmed: no MCP surface in pi 0.70.2" with the search evidence.
6. **Suppressed surfaces** — table of which `Default*Loader` flags suppress what, and which would have to flip to bring DLA content into pi's prompt/context (vs. being injected via a Studio-side prompt builder).
7. **Versioning & churn risk** — installed version, anything deprecated/experimental that's load-bearing.

## Out of scope

- Investigating DLA's surfaces. Use `prior-art/wave-1-findings/wave-1-dla-inventory.md`.
- Picking an approach. That's the research-lead's job after all five briefs land.
- Modifying any code. This is a survey.
- Following pi-coding-agent's interactive-mode-only surfaces (`InteractiveMode`, `RpcClient`, etc.) unless they unexpectedly expose tool-extension hooks.
