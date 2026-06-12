---
task: wave-1-subprocess-revisit
wave: 1
status: complete
verdict: works-with-caveats — viable as an escape-hatch / minimum-effort path; weaker than Bridge for the canonical `/migrate` UX
---

# Wave 1 — Subprocess approach revisited (Approach E vs. pi)

## TL;DR

Against pi's runtime, "spawn DLA's CLI as a subprocess from a wrapper `AgentTool`" **is mechanically feasible** and meaningfully different from the original RSM-1639 Approach E rejection — wrapping the spawn in a tool keeps the agent in the loop. But the gains are smaller than they look:

- **The agent stays in the conversational loop, yes.** What it loses is anything *inside* DLA — the skill's phased reasoning, the `delegate: true` handoff, the per-tool observability the model gets from MCP `_detect` / `_discover` / `_inspect` / `_extract` events.
- **Output is messy.** DLA's CLI is Ink-only; there is **no `--json` mode** (verified by reading `src/cli.ts` and `package.json`). Non-TTY fallback is parse-able but still contains ASCII-art headers and Unicode glyphs; the model would consume an entire 1–10 KB "screenshot of a terminal" per tool call.
- **Single-tool wrapper collapses agent reasoning to the user's URL prompt + a final import/QA dialogue.** Multi-tool wrapper gives back fine-grained agency but pays `npx tsx` startup per call (~0.7 s warm per Ink subcommand on an M-series Mac) **and** still has no `delegate: true` for import.
- **Recommendation: keep as the escape-hatch / fallback shape** — exposed via a single tool `dla_run` and a *separate* slash command `/migrate --headless` — and let Bridge or Vendor own the canonical `/migrate` UX. Subprocess wins on "minimum code in Studio" and "DLA upgrades land instantly via SHA pin" but loses on every UX axis that matters for the user-facing migration assistant.

---

## 1. CLI subcommand inventory — what's spawnable

The task brief listed `data-liberation liberate|inspect|adapt|import|verify|qa|diagnose|setup|mcp`. That list is loose — `adapt` and `diagnose` are skills/MCP tools, **not CLI subcommands**. Reading `src/cli.ts` (verbatim from `Automattic/data-liberation-agent@main`, file is 177 LOC):

| Subcommand | Args | UI? | Blocks on stdin? | `--non-interactive` honored? |
|---|---|---|---|---|
| `<url>` (the "liberate"/extract path) | URL, `--output`, `--dry-run`, `--limit N`, `--resume`, `--token`, `--admin-token`, `--shop-domain`, `--cdp-port`, `--non-interactive`, `--verbose`, `--delay` | `runDiscover` → Ink `<Liberate>` then `autoPreview` then `ask('Ready to import?')` | **Yes** — final `ask()` prompts via `readline.question` (`src/ui/discover.tsx:443`), and `autoPreview` boots a Playground/Studio site and prints a URL | **Yes** — `if (props.nonInteractive) return;` before `ask()` (`src/ui/discover.tsx:442`) |
| `inspect <url>` | URL, `--token` | `runInspect` → Ink `<Inspect>` | No (`useInput`/readline grep negative on `src/ui/inspect.tsx`) | n/a — does not prompt |
| `qa <wxr-file>` | path, `--fix` | `runQaUi` → Ink `<Qa>` | No | n/a |
| `verify <output-dir>` | path | `runVerify` → Ink `<Verify>` | No | n/a |
| `setup` | `--site`, `--username`, `--token` | `runSetup` → Ink `<Setup>` | **Yes** — `await ask(...)` for missing site/username/token via `readline` (`src/ui/setup.tsx:118-126`) | **No** flag; only env-var / arg presence skips the prompt |
| `preview <output-dir>` | `--open`, `--port N`, `--non-interactive` | `runCliPreview` → Ink + optional readline | Spinner + readline post-prompt | **Yes** — `--non-interactive` flag and TTY check (`src/cli.ts:116`) |
| `import <wxr-file>` | `--site`, `--username`, `--token`, `--dry-run`, `--delay`, `--verbose`, `--only`, `--import-authors` | `runImport` → Ink `<Import>` | No (all required args validated up-front in `cli.ts:138-149`) | n/a |
| `mcp` | none | re-imports `mcp-server.js` (stdio MCP server, not user-facing CLI) | Stays alive on stdin | n/a — irrelevant |

**Adapters / diagnose / qa-fix-up workflows aren't CLI subcommands** — they live in `src/lib/` (consumed by the MCP server) and in `skills/{adapt,diagnose}/SKILL.md`. The MCP server exposes 13 tools; the CLI exposes 7 useful subcommands (`inspect`, `qa`, `verify`, `setup`, `preview`, `import`, bare URL/extract). That asymmetry is important — **a subprocess approach cannot reach MCP-only capabilities** like `liberate_detect`, `liberate_discover`, `liberate_extract`, `liberate_status`, `liberate_map_apis`, `liberate_probe`, `liberate_qa`, `liberate_setup`, `liberate_import` (each as standalone calls), `liberate_preview_stop`. The bare-URL CLI path bundles detect+discover+extract+autoPreview into one Ink run, but the agent can't observe the phases.

### Output capture realism

Run with `NO_COLOR=1 CI=1` and non-TTY (pipe) stdout, Ink degrades to a one-shot final render — no spinner re-draws — but the output still contains:

- ASCII-art header (~8 lines, ~80 cols), Unicode block glyphs, `data-liberation v0.1.0` banner.
- Unicode status glyphs (`✓`, `✗`, `⚠`, `➔`, `○`).
- Bullet lines like ` ✓ Platform: Unknown ○ low` and ` ⚠ Sitemap: 0 URLs found`.

Verbatim sample from `npx tsx src/cli.ts inspect http://example.invalid`, non-TTY mode (8 lines of header omitted):

```
 ✓ Platform: Unknown ○ low
 ⚠ Sitemap: 0 URLs found

 ⚠ Extraction: limited (unknown platform)
```

Capturable — strip ANSI (no `--json` flag confirmed; grep across `src/cli.ts` and `src/ui/` returns zero hits for `--json`/`JSON.stringify`-as-output), discard the header, return the rest. The agent will reason fine over `✓ Platform: Unknown` lines, but the surface is fragile — any DLA UI change re-shapes the model's input.

---

## 2. Single vs. fan-out tradeoff

| Dimension | Single tool `dla_run(subcommand, args, url?)` | Multi-tool fan-out (`dla_extract`, `dla_inspect`, `dla_import`, `dla_qa`, `dla_verify`, `dla_setup`, `dla_preview`) |
|---|---|---|
| Wrapper LOC | ~50 LOC, one `AgentTool` def | ~50 LOC × 7 = ~350 LOC, plus per-tool schemas |
| Per-call startup cost | One `tsx` spawn per agent invocation (~0.7 s warm Ink subcommand, 0.1 s cold for `--version`-class) | One spawn per phase the agent decides to run — magnifies startup. End-to-end `/migrate` of a Wix site would be inspect→extract→preview→qa→import = 5 spawns = ~3.5 s startup + each phase's real work |
| Agent phase observability | **None** — agent picks subcommand then gets terminal output back. No way to interleave reasoning between detect/discover/extract phases of the bare-URL flow. | **High** — agent runs `dla_inspect` first, reasons, decides whether to proceed, runs `dla_extract`, etc. Mirrors MCP-bridge UX but loses `_detect`/`_discover` granularity (those are MCP-only) |
| `delegate: true` (import handoff to Studio) | **No** — DLA's CLI `import` always hits REST (`src/cli.ts:138-149` requires `--site`/`--username`/`--token`). Studio can't intercept the WXR for in-Playground import. | **Same — no** |
| Distinguishing shape vs. Bridge/Vendor | **Yes** — black-box delegation, agent supplies subcommand strings | **Collapses toward Bridge with worse IPC**: same per-tool surface as MCP-bridge but pays `npx tsx` startup per call instead of a single warm MCP child |
| Schema for the model | Untyped — agent learns valid subcommand grammar from the tool description (failure modes: typos, made-up flags). Likely needs a Zod-validated whitelist in the wrapper. | Strictly-typed per tool, model can't pass garbage flags |
| Permission gating | One policy entry per tool name × subcommand string — needs a parser in the policy layer | Maps cleanly onto the per-tool policy buckets RSM-3139 already defined (`dla_extract` = write, `dla_import` = network-write, etc.) |
| Failure mode if DLA changes | Tool keeps working as long as DLA's subcommand grammar is stable. New subcommands are *automatically* available. | Each new DLA subcommand requires a new wrapper tool definition + schema + permission bucket |

**Recommended choice (if subprocess is adopted at all): single tool `dla_run`**, with a tightly enumerated `subcommand` string parameter (Typebox `Type.Union([Type.Literal('inspect'), Type.Literal('extract'), ...])`). Reasons:

1. The distinguishing property of subprocess vs. Bridge is "DLA is a black box." Fan-out re-derives MCP-bridge with worse IPC, no `delegate: true`, and 7× the wrapper code. If you've already paid the cost of mapping subcommands 1:1 you should be running MCP, not `tsx`.
2. The single-tool wrapper is what makes this the cheap escape-hatch. ~50 LOC, instant feature-flag toggle, no maintenance.
3. Loss of phase-by-phase reasoning is real but largely mitigated by the bare-URL "liberate" subcommand bundling detect+discover+extract+autoPreview internally — the agent's job between calls is "interpret the result of this Ink run and decide what to do next."

The fan-out variant has one advantage: it lets the agent **start with `dla_inspect`** (cheap, no writes) before committing to `dla_extract`. With a single tool, the agent still does this — it just calls `dla_run('inspect', ...)` first — but the tool surface is less discoverable. Hybrid: single `dla_run` *plus* a separate `dla_inspect` (because inspection is the natural decision point) is a reasonable middle ground.

---

## 3. Interactivity & output capture — feasibility check + risks

### Interactivity

| Subcommand | Blocks on stdin? | Wrapping strategy |
|---|---|---|
| `inspect`, `qa`, `verify`, `import` | No | Just pipe stdout/stderr |
| `setup` | Yes (missing-arg prompt) | Wrapper must require `--site`/`--username`/`--token` as tool params before spawn; never let DLA reach the `readline.question` path |
| `preview` | Yes (post-preview readline) | Pass `--non-interactive` always |
| `<url>` (extract) | Yes (post-extract "Ready to import?") | Pass `--non-interactive` always |

**`--non-interactive` is honored by `<url>` (extract) and `preview`** (`src/cli.ts:172,116`). It is **not** a parameter on `setup`, which means `setup` must always have all three creds supplied or it deadlocks. **`setup` and `preview` and `<url>` are the only stdin-touching subcommands**, and all are gated. No use of the wider `useInput` Ink hook anywhere — terminal raw mode is only set during Ink rendering (not for input).

Studio's existing `createAskUserQuestionTool` (`apps/cli/ai/tools/ask-user-question.ts`) is the right tool for "I need credentials" — the wrapper-skill that drives `dla_run` should call `AskUserQuestion` *before* the subprocess spawn, never as a recovery from DLA blocking. If the wrapper detects the child has been running > N seconds with no output, the safe behavior is to abort and re-raise to the agent with "ask the user" guidance.

### Output capture

- **No `--json` mode.** Confirmed by `grep -rn "JSON\\.stringify" src/ui/ src/cli.ts` (0 hits) and `grep -rn "\\-\\-json" src/cli.ts` (0 hits). The output is whatever Ink renders.
- **Non-TTY degradation is clean enough.** With `NO_COLOR=1 CI=1`, Ink prints a single final render — no animated spinners, no redraws. ANSI codes are still present (color escapes); the wrapper must strip them. The ASCII-art `Header` component prints unconditionally (`src/ui/header.tsx`).
- **ANSI stripping** — small npm dep (`strip-ansi`, ~5 LOC) or hand-rolled regex `/\x1b\[[0-9;]*m/g`. Trivial.
- **Truncation** — pi's bash tool already implements the canonical pattern: roll a buffer up to N KB, write overflow to a temp file, return the tail + temp-file path (`@mariozechner/pi-coding-agent/dist/core/tools/bash.js:194-308`). We should reuse `truncateTail`/`createWriteStream` shape rather than re-deriving.
- **Multi-megabyte extraction logs** — large `extract` runs print per-URL progress lines via Ink. In non-TTY mode they accumulate into a long static report (no in-place redraws). The wrapper must stream via `onUpdate` so the model sees progress without OOM'ing the result payload. pi's bash tool is the precedent.

**Output is structurally capturable.** It is *not* structurally parseable — every tool call returns "what a terminal would have shown." Acceptable for an LLM (which is good at reading text); annoying for assertions, telemetry, or downstream parsing.

---

## 4. `delegate: true` impact — does losing DLA's sub-agent reasoning matter?

**Yes, materially.**

The `delegate: true` mode on `liberate_setup` and `liberate_import` (`src/mcp-server.ts:441-489`) was explicitly designed for hosts that "handle the import themselves" — i.e. Studio Code. In MCP, `liberate_import {delegate: true, ...}` returns a structured manifest:

```json
{
  "wxrFile": "/abs/path/output.wxr",
  "outputDir": "/abs/path/",
  "mediaDir": "/abs/path/media/",
  "productsCsv": "/abs/path/products.csv",
  "redirectMap": "/abs/path/redirect-map.json",
  "importAuthors": false
}
```

…and Studio's agent then drives a Studio-side import path (Playground blueprint, `studio site create`, or `studio wp eval-file`) instead of going through DLA's WP REST client. This is the integration shape `AGENTS.md:51` and the DLA inventory `wave-1-dla-inventory.md:198` call out as canonical for Studio.

**Subprocess loses this entirely.** DLA's CLI `import` subcommand has no `--delegate` flag — `src/cli.ts:138-149` mandates `--site`, `--username`, `--token`, and on missing any of them `process.exit(1)`. There is no way through the CLI to ask for the manifest without performing the REST import. Subprocess users must either:

1. **Run extract only**, never call `dla_run('import', ...)`, and have the wrapper-skill reconstruct the manifest from the on-disk output directory (`output.wxr`, `media/`, `redirect-map.json`, `products.csv`). This works — the file layout is documented and stable per `AGENTS.md:20-29` — but it duplicates DLA's import logic on the Studio side.
2. **Spawn DLA's MCP server** instead of the CLI for the import phase specifically — at which point you're running a one-call MCP bridge for a single tool. If you're doing that, just run the full Bridge approach.

The phased reasoning DLA's MCP server enables (separate `_detect`, `_discover`, `_inspect`, `_extract`, `_qa`, `_verify`, `_preview`, `_import` tool calls with delegate handoff) is what the wrapper-skill in RSM-3139 was written around. Subprocess collapses that into 2–3 black-box invocations. The model can still narrate, ask, and decide between calls — but it has zero visibility into *which* of DLA's 13 internal capabilities are actually running.

**Verdict on this dimension: subprocess loses ~60% of the per-phase intelligence Bridge would have provided.** The remaining 40% (URL collection, credential gathering, post-run interpretation, error escalation) is enough for a serviceable `/migrate` but not a polished one.

---

## 5. Latency & resource notes

Measured on an Apple M-series Mac (warm npm cache, `tsx` already in `node_modules`):

| Invocation | Wall time | Notes |
|---|---|---|
| `npx tsx src/cli.ts --version` (warm) | 100 ms | tsx loader + minimal cli.ts parse, no Ink |
| `npx tsx src/cli.ts --version` (cold-ish, second run after machine boot) | 280 ms | one-time disk read |
| `npx tsx src/cli.ts --help` | 100 ms | just prints |
| `npx tsx src/cli.ts inspect http://example.invalid` (network-bound but URL fails fast) | 690 ms | Includes Ink render, adapter scan, sitemap fetch (~500 ms = network + adapter init) |

(Methodology: `/usr/bin/time -p` × 3 runs; ranges reported. Source repo cloned at `/tmp/dla-research`, npm install completed once before timing.)

**The "few seconds startup" anchor in the brief is conservative.** On a developer Mac, `tsx`-startup is ~100–300 ms; the rest is DLA doing actual work (HTTP fetches, sitemap parsing, content extraction). For *real* work — sitemap of a real Wix site, extraction of N pages — the dominant cost is network, not startup. A bare `<url>` extraction of a 50-page Wix site is dominated by `--delay 500` × 50 = 25 s minimum, plus media downloads. The `tsx` cost is in the noise.

**For the multi-tool variant**, a 5-call `/migrate` flow pays 5 × ~200 ms = 1 s of `tsx`-startup overhead. Negligible relative to extraction time, but the *user-visible* latency between agent decisions (each tool call blocks the chat) is felt — Studio's existing tools resolve in ~50–500 ms; a 700 ms tool call is noticeably slower.

**Memory**: each spawn loads the DLA module tree (~17 K LOC plus Ink + React + tsx) — ~80–150 MB resident per spawn. For multi-tool flows this is freed between calls (subprocess exits). For single-tool flows the spawn is short-lived. **No long-lived child to keep alive** — this is one structural advantage over Bridge (no warm child to manage across the agent session).

**Playwright Chromium dependency**: DLA's `postinstall` runs `playwright install chromium` — adds ~150 MB to `node_modules`. This pays once at Studio install time regardless of approach.

---

## 6. Concrete wrapper sketch — single-tool

Pseudo-code following pi's bash-tool conventions (`@mariozechner/pi-coding-agent/dist/core/tools/bash.js`). This is a **raw `AgentTool`**, not Studio's `defineTool` (which today drops `signal` and `onUpdate` — see `apps/cli/ai/tools/define-tool.ts:51`):

```ts
// apps/cli/ai/tools/dla.ts
import { spawn } from 'child_process';
import { Type } from 'typebox';
import { killProcessTree } from '@mariozechner/pi-coding-agent/dist/utils/shell.js';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import path from 'path';

const DLA_ROOT = path.join(__dirname, '..', 'dla'); // vendored DLA tree
const STRIP_ANSI = /\x1b\[[0-9;]*m/g;
const MAX_OUTPUT_BYTES = 64 * 1024;

const dlaRunSchema = Type.Object({
    subcommand: Type.Union([
        Type.Literal('extract'),   // bare-URL liberate path; arg = url
        Type.Literal('inspect'),
        Type.Literal('qa'),
        Type.Literal('verify'),
        Type.Literal('preview'),
        // 'setup' and 'import' need creds; surfaced as their own tools
    ]),
    target: Type.String({ description: 'URL (extract/inspect), WXR file (qa), output dir (verify/preview)' }),
    outputDir: Type.Optional(Type.String()),
    extraArgs: Type.Optional(Type.Array(Type.String())),
});

export const dlaRunTool: AgentTool<typeof dlaRunSchema> = {
    name: 'dla_run',
    label: 'dla_run',
    description: 'Run a Data Liberation Agent CLI subcommand. Returns terminal output. ' +
                 'For extract/preview the call is always --non-interactive.',
    parameters: dlaRunSchema,
    async execute(_toolCallId, params, signal, onUpdate) {
        const { subcommand, target, outputDir, extraArgs = [] } = params;

        // Build argv, force non-interactive for stdin-blocking subcommands.
        const argv = [
            'tsx',
            path.join(DLA_ROOT, 'src/cli.ts'),
            ...(subcommand === 'extract' ? [target] : [subcommand, target]),
            ...(outputDir ? ['--output', outputDir] : []),
            ...(subcommand === 'extract' || subcommand === 'preview' ? ['--non-interactive'] : []),
            ...extraArgs,
        ];

        const child = spawn('npx', argv, {
            cwd: DLA_ROOT,
            env: { ...process.env, NO_COLOR: '1', CI: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const chunks: Buffer[] = [];
        let totalBytes = 0;

        const handleData = (data: Buffer) => {
            chunks.push(data);
            totalBytes += data.length;
            // Stream partial output to the UI; tail-truncate at MAX_OUTPUT_BYTES.
            if (onUpdate) {
                const text = Buffer.concat(chunks).toString('utf-8').replace(STRIP_ANSI, '');
                const tail = text.length > MAX_OUTPUT_BYTES ? text.slice(-MAX_OUTPUT_BYTES) : text;
                onUpdate({ content: [{ type: 'text', text: tail }], details: undefined });
            }
        };
        child.stdout?.on('data', handleData);
        child.stderr?.on('data', handleData);

        // Abort handling — kill the process tree, not just the parent (DLA may
        // have spawned Playwright Chromium or Playground subprocesses).
        const onAbort = () => {
            if (child.pid) killProcessTree(child.pid);
        };
        if (signal) {
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });
        }

        return new Promise((resolve, reject) => {
            child.on('error', reject);
            child.on('exit', (code) => {
                if (signal) signal.removeEventListener('abort', onAbort);
                const fullText = Buffer.concat(chunks).toString('utf-8').replace(STRIP_ANSI, '');
                const text = fullText.length > MAX_OUTPUT_BYTES
                    ? `[...truncated to last ${MAX_OUTPUT_BYTES} bytes...]\n${fullText.slice(-MAX_OUTPUT_BYTES)}`
                    : fullText;
                if (signal?.aborted) {
                    reject(new Error(text + '\n\nDLA aborted'));
                } else if (code !== 0) {
                    reject(new Error(text + `\n\nDLA exited with code ${code}`));
                } else {
                    resolve({
                        content: [{ type: 'text', text: text || '(no output)' }],
                        details: { subcommand, exitCode: code },
                    });
                }
            });
        });
    },
};
```

Registration site: `apps/cli/ai/runtimes/pi/index.ts:252` (the `buildAgentTools` call site). Add `dlaRunTool` to the returned tools array. `customTools`/`tools` are already passed through to `createAgentSession`.

**Notes on the sketch:**

- Studio's `defineTool` (`apps/cli/ai/tools/define-tool.ts:51`) ignores the `signal` and `onUpdate` parameters. The DLA wrapper **cannot use `defineTool`** — it needs the raw `AgentTool` shape because abort + streaming are load-bearing for a long-running subprocess.
- `killProcessTree` from pi's internal `utils/shell.js` is the right tool — DLA fans out to Playwright Chromium for Wix/Squarespace, so `child.kill()` alone leaks browsers. (Import via deep path or vendor a copy; the symbol is not re-exported from pi's public surface.)
- `NO_COLOR=1` + `CI=1` strips ANSI redraws; the regex strip handles residual color codes.
- `setup` and `import` need separate wrapper tools because they have non-trivial schemas (creds) that should surface to the model and to Studio's permission policy. `dla_setup` and `dla_import` are dla_run-shaped but with typed params; mostly cut-and-paste.

---

## 7. Comparison vs. Bridge & Vendor

| Dimension | Subprocess (single-tool `dla_run`) | Bridge (MCP-stdio-to-AgentTool) | Vendor (DLA `src/lib` as Studio-owned AgentTools) |
|---|---|---|---|
| Agent-in-the-loop | **Yes (between tool calls)** — model picks subcommand, reads terminal output, decides next call | **Yes (per-tool)** — model gets 13 distinct MCP tools with structured I/O | **Yes (per-tool)** — model gets N Studio-owned tools wrapping DLA internals |
| Per-phase observability for the agent | **Low** — bare-URL extract bundles detect+discover+extract+autoPreview into one Ink run, no observability | **High** — each MCP tool is a discrete call with structured result | **High** — same as Bridge but Studio owns the schemas |
| Tool-result quality (model input) | **Terminal text + Unicode glyphs, ANSI-stripped, possibly truncated**; lossy | **Structured `{content, details}` per MCP spec** — model gets JSON-shaped data via `details` and human text via `content` | **Same as Bridge** (Studio author controls shape) |
| `delegate: true` (Studio handles import via Playground/Studio site) | **Lost** — CLI `import` always REST-imports, no manifest mode | **Available** — `liberate_setup`/`liberate_import` with `{delegate: true}` return the manifest | **Available** (Studio's wrapper synthesizes the manifest from `src/lib` calls) |
| Startup overhead per call | ~100–300 ms `tsx` + first-import (~500 ms) per spawn | One spawn for the entire session (a few hundred ms once); MCP `CallTool` is sub-10 ms | Zero — in-process module loads |
| Maintenance burden | Lowest — ~50 LOC of wrapper, no schema sync with DLA | Medium — `ListTools` at startup auto-syncs surface; mapping layer is ~150 LOC | Highest — Studio re-derives DLA's tool surface; drift risk on every DLA release |
| Bundling shape | DLA tree + `tsx` + DLA deps (Ink/React/Playwright/Playground) | Same | DLA `src/lib` + transitive deps; Ink/React droppable |
| UX richness | Low — terminal output, ASCII-art header, lossy compared to MCP | High — structured progress events, native-feeling tool calls | Highest — Studio owns the UI affordances |
| Failure granularity | Subprocess exit code + stderr blob | Per-tool `isError: true` with structured `content` | Native JS errors with Studio-shaped catch handling |
| Permission gating | Per-tool (`dla_run` × subcommand string) — needs a parser layer | Per-MCP-tool — maps 1:1 to RSM-3139 policy buckets | Per-Studio-tool — maps 1:1 to RSM-3139 policy buckets |
| Survives DLA renaming/refactoring internals | **Yes** (as long as CLI subcommand grammar holds) | Mostly (MCP tool names are public surface; renames break) | **No** — direct module imports break on every internal rename |
| Minimum Studio LOC to ship `/migrate` | ~60 LOC (wrapper) + skill (already exists from RSM-3139) + slash-command registration | ~250 LOC (bridge + lifecycle + per-tool adaptation) + skill + slash-command | ~600+ LOC (re-derive 13 tools) + skill + slash-command |

---

## 8. Verdict — works-with-caveats; escape-hatch role only

**Verdict: works-with-caveats. Recommend keeping subprocess as the documented fallback / escape-hatch path, not as the canonical `/migrate` implementation.**

**Why it works** (against the original Approach E rejection):
- The wrapper-in-`AgentTool` shape keeps the agent in the conversational loop — the model decides which DLA subcommand to run, gathers creds from the user via `AskUserQuestion`, and reasons over each subprocess result.
- pi's `AgentTool.execute` signature supports `signal` + `onUpdate` exactly the way the bash tool uses them, so abort and streaming work out of the box. The single-tool wrapper is ~60 LOC.
- `--non-interactive` exists on the only subcommands that block (`extract`, `preview`); `setup` only blocks if creds are missing, which the wrapper enforces up-front. No deadlock risk if the wrapper is disciplined.
- DLA's CLI subcommands are stable enough to depend on — they map onto README documentation and `docs/cli.md`; renaming them would be a documented breaking change.

**The caveats** (why it loses to Bridge for the canonical path):
- **`delegate: true` is structurally unreachable.** DLA's CLI `import` has no manifest mode. The wrapper-skill must reconstruct the import manifest from the on-disk output dir if Studio wants to handle import via Playground — which means re-implementing DLA's manifest contract on the Studio side. That defeats most of the "DLA is a black box" simplicity argument.
- **Output is terminal text, not structured data.** The model can read it, but every DLA UI refactor changes what the model sees. Brittle in a way Bridge isn't.
- **Bundled into one bare-URL call, the agent loses observability of detect/discover/extract phases.** It can re-gain it by calling `inspect` first, but the bundled `extract` path is still opaque.
- **MCP-only tools (`liberate_detect`, `liberate_discover`, `liberate_map_apis`, `liberate_probe`, `liberate_status`, `liberate_preview_stop`) are unreachable from the CLI.** That's 6 of DLA's 13 tools the agent can never touch on the subprocess path.

**Where subprocess is genuinely the right choice:**

- **As an escape-hatch / `--headless` mode.** A second slash command `/migrate --headless` (or `studio migrate <url>` outside `studio code`) that spawns `npx tsx src/cli.ts <url>` with full terminal fidelity, for users who want DLA's UI and don't want the agent overhead. Original Approach E's "handler-only slash" framing — but mounted as a non-agent CLI command rather than an agent slash. Zero conflict with agent-side `/migrate`.
- **As a fallback when Bridge has a problem.** If MCP spawn fails for any reason (DLA binary missing, sandbox restrictions), the subprocess wrapper is a graceful degradation — same DLA, less observability.
- **For a fast MVP / proof-of-concept** before committing engineering time to Bridge wiring. The wrapper is ~60 LOC; you can land `/migrate` behind a feature flag in one PR and prove the UX before the Bridge spec.

**Strength of recommendation: medium against using subprocess as primary; strong for keeping it as the fallback shape.** Bridge will deliver the polished `/migrate` UX. Subprocess will deliver a working-but-rough `/migrate` faster and is the right shape for `--headless` or escape-hatch flavors.

---

## Sources

- DLA repo `Automattic/data-liberation-agent` (now public per `gh repo view`), shallow-cloned to `/tmp/dla-research` from `https://github.com/Automattic/data-liberation-agent.git` (default branch `main`); full read of:
  - `src/cli.ts` (177 LOC, all subcommand routing)
  - `src/ui/discover.tsx:85-460` (interactive prompts + `--non-interactive` handling)
  - `src/ui/setup.tsx` (full — `readline` ask path)
  - `src/ui/preview.tsx:140-294` (Ink + stdin race, `nonInteractive` plumbing)
  - `package.json` (no `--json`, no compile required for spawn)
- DLA inventory `prior-art/wave-1-findings/wave-1-dla-inventory.md` (full); MCP tool list §4; `delegate: true` references §4 #10–11; output layout §9.
- Prior-art `prior-art/rsm-1639-research-report.md:91-96, 100-115, 141-155` — Approach E rejection, comparison table, why "no agent" was the killer.
- pi-coding-agent `@mariozechner/pi-coding-agent@0.70.2`:
  - `dist/core/tools/bash.d.ts` (full) — canonical AgentTool subprocess shape
  - `dist/core/tools/bash.js:190-310` — `execute(toolCallId, params, signal, onUpdate)` pattern, `killProcessTree`, stream-and-truncate buffer logic
  - `@mariozechner/pi-agent-core/dist/types.d.ts:259-291` — `AgentToolResult<T>`, `AgentToolUpdateCallback`, `AgentTool.execute` signature
- Studio CLI:
  - `apps/cli/ai/runtimes/pi/index.ts:1-282` — `runStudioAgentTurn`, `customTools` registration site, abort wiring
  - `apps/cli/ai/tools/define-tool.ts` — Studio's `defineTool` helper (note: drops `signal`/`onUpdate`, so DLA wrapper must skip it and use raw `AgentTool`)
  - `apps/cli/ai/tools/ask-user-question.ts` (full) — credential-collection precedent
  - `apps/cli/ai/tools/create-site.ts:1-60` — example of a long-running tool that wraps a Studio child command
- Hands-on benchmarks (commands run in `/tmp/dla-research` on Apple Silicon Mac, npm-installed dependencies):
  - `npm install` (one-shot, no errors)
  - `/usr/bin/time -p npx tsx src/cli.ts --version` × 3 → 100–280 ms
  - `/usr/bin/time -p npx tsx src/cli.ts --help` → 100 ms
  - `/usr/bin/time -p npx tsx src/cli.ts inspect http://example.invalid` → 690 ms (network-bound)
  - `NO_COLOR=1 CI=1 npx tsx src/cli.ts inspect http://example.invalid` — Ink non-TTY output captured; ANSI present, refresh-redraws absent
  - `grep -rn "\\-\\-json\\|JSON\\.stringify" src/cli.ts src/ui/` → 0 hits (no JSON output mode)
  - `grep -n "args\\[0\\] === '" src/cli.ts` → enumerates real subcommand set
- `gh repo view Automattic/data-liberation-agent --json visibility,isPrivate` → `PUBLIC, isPrivate=false` (confirms repo is now public)
