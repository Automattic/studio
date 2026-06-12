---
id: wave-1-vendor-as-agenttools
wave: 1
title: Evaluate vendoring DLA's src/lib as Studio-owned AgentTools
---

# Wave 1 — Vendor DLA's `src/lib/` as Studio-owned pi AgentTools

## Goal

Determine whether Studio can skip DLA's MCP surface entirely and instead consume DLA at the library level — importing `data-liberation/src/lib/...` (and `src/adapters/...`) directly and writing Studio-owned pi `AgentTool` definitions that call those internals.

This skips the IPC overhead and the JSON-Schema-to-typebox dance, but pays maintenance cost: DLA's `AGENTS.md` explicitly notes the three entry points (MCP, CLI, plugin) all share `src/lib/` — but `src/lib/` is **not advertised** as a public API, and the package is not published on npm.

## Questions

1. **What's in `src/lib/`?** Walk the directory and enumerate the public-shaped exports. For each platform adapter (Wix, Shopify, Squarespace, Webflow, Weebly, Hostinger, GoDaddy, HubSpot) and each cross-cutting lib (WXR generator, media downloader, redirect mapper, content normalizer, etc.), identify:
   - Function/class signatures.
   - Whether they're called *only* from `src/mcp-server.ts` and `src/cli.ts`, or also from `src/adapters/...` / each other (i.e. is the lib genuinely standalone, or is it scaffolding around the MCP server's session state?).
   - Side effects: do they write to disk, spawn child processes, open browsers, hit the network, mutate global state? Anything that's tightly bound to the CLI's `ui/*.tsx` Ink screens or to the MCP server's session/cwd is a coupling smell.
2. **Coverage of the MCP tool surface.** Map each of DLA's 13 MCP tools (from `prior-art/wave-1-findings/wave-1-dla-inventory.md`, section 4) to the `src/lib` entry points that back it. Are all 13 cleanly reachable as library calls, or do some of them live inside the MCP server's request handlers without a clean lib equivalent?
3. **Schema reuse.** DLA's MCP server defines input schemas inline for each tool (probably as zod or JSON Schema). When wrapping the lib as Studio AgentTools, would we copy those schemas into typebox manually (drift risk), import them from DLA (if exported), or re-derive them from each lib function's TypeScript signature?
4. **Output adaptation.** DLA's MCP tools return `{content: [...], structuredContent: {...}}`. The underlying `src/lib` functions return raw TypeScript values. Confirm — does the structure live in `src/lib` or only in `src/mcp-server.ts`'s response shaping? If the latter, Studio's Studio-side tool wrappers reimplement DLA's response shaping in TypeScript (drift risk).
5. **Sub-agent / delegation.** DLA's MCP `delegate: true` contract (per the prior research) lets DLA's MCP server delegate to a sub-agent. If we vendor at the lib level, do we lose this — and does that matter for the `/migrate` workflow? Concretely: which DLA workflows depend on `delegate: true`, and what would Studio have to reimplement to compensate?
6. **Maintenance contract.** DLA's `AGENTS.md` notes `src/lib/` is shared scaffolding, not a public API. The risk: DLA's maintainers may rename / restructure / break it without semver. Quantify the risk — how active is DLA development, how often does `src/lib/` change, and what's the cost of pinning to a specific commit vs. tracking HEAD? (Use the recent commit log from DLA.)
7. **Build-time integration.** DLA is written in TypeScript and built with `tsc` (per `wave-1-dla-inventory.md`, sec 2). To import its `src/lib/` source into Studio's `vite build` pipeline, what's required — let DLA build itself first (`npm run build` in `node_modules/data-liberation`) and import from `dist/`, or have Vite transpile the source on-the-fly? Are there transpilation hazards (decorators, top-level await, dynamic import, etc.)? Tarball vs. `github:` dep tradeoffs.
8. **Slash-command + wrapper-skill plumbing.** Same as Bridge brief, sub-question 8: confirm `/migrate` integrates via the `AI_SKILL_COMMANDS` registry pattern. The wrapper-skill itself is identical between Bridge and Vendor — the only thing that changes is which tools the skill instructs the agent to call.
9. **Permission gating.** Same as Bridge brief, sub-question 6: how does Studio enforce per-tool permission buckets when pi has no `canUseTool`? Vendoring puts policy *inside Studio's `execute`* — does that simplify the story, or does it just shift the same code from a wrapper to a wrapper-with-imports?

## Suggested approach

- `git clone https://github.com/Automattic/data-liberation-agent` into a scratch directory (or read its tree via the GitHub API / `gh repo view`).
- For each `src/lib/<module>.ts`, read the file and note its exports + dependencies.
- Cross-reference `src/mcp-server.ts`'s tool handlers — which lib functions does each call?
- Cross-reference the prior-art `wave-1-dla-inventory.md` for the full MCP tool list.
- Sketch one concrete `liberate_detect` AgentTool implementation using lib imports (the simplest tool), and one `liberate_inspect` (one of the most structured) — TypeScript-flavored pseudocode is fine.
- Check DLA's recent commit log for `src/lib/` churn (a `git log --oneline -- src/lib/` for the last 30–60 days is informative).
- Document the install path: `"data-liberation": "github:Automattic/data-liberation-agent#<sha>"` in `apps/cli/package.json` is the obvious starting point; quantify what that means for `npm install`, cache pinning, and Studio's lockfile.

## Deliverable

A markdown file at `issues/rsm-3143-dla-pi-research/wave-1-findings/wave-1-vendor-as-agenttools.md` with frontmatter and sections:

1. **`src/lib/` inventory** — table of exports per module, coupling notes.
2. **MCP tool → lib mapping** — table mapping each of DLA's 13 MCP tools to its lib entry point(s); flag any tools that don't have clean lib equivalents.
3. **Schema reuse strategy** — chosen approach + drift risk.
4. **Output adaptation strategy** — chosen approach + drift risk.
5. **`delegate: true` impact** — what's lost and whether it matters.
6. **Maintenance contract risk** — DLA churn rate, pinning strategy, sustainability.
7. **Build-time integration** — concrete `package.json` install path + Vite transpilation notes.
8. **Concrete sketches** — one simple tool + one structured tool, end-to-end.
9. **Verdict** — works / works-with-caveats / blocked + recommendation strength.

## Out of scope

- Implementing the vendoring (no code changes — sketches only).
- Re-investigating DLA's tool list. Use `prior-art/wave-1-findings/wave-1-dla-inventory.md`.
- Bundling/distribution — that's Brief 5 (this brief covers the `package.json` install path only).
- Permission policy bucket content — reused as-is from `prior-art/rsm-3139-spec.md`.
- Mechanically wrapping every DLA tool. One simple + one structured sketch is enough to evaluate the shape.
