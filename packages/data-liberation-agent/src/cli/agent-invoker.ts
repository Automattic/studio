//
// Agent CLI invoker
// =================
// When the watch loop hits a "judgment moment" (new archetype, foundation
// drift, page ready for compose), it shells out to a Claude / Codex / Gemini
// CLI to run the appropriate skill in a separate subprocess. The CLI
// runtime selection is pluggable so users can swap their preferred agent.
//
// Selection precedence:
//   1. opts.agent  (explicit override — used by --agent flag)
//   2. DLA_AGENT_CLI environment variable
//   3. caller's interactive prompt (TUI; not handled here — caller resolves first)
//   4. hard fallback "claude"
//
// MCP wiring (claude only, currently):
// The spawned subprocess MUST have access to the data-liberation MCP server
// — otherwise prompts that say "call liberate_block_compose" silently fail
// because the tool doesn't exist in the agent's environment. We achieve
// that by:
//   1. Resolving the project root (where .mcp.json lives).
//   2. Setting CLAUDE_PLUGIN_ROOT in the spawned env so .mcp.json's
//      `${CLAUDE_PLUGIN_ROOT}` placeholders expand correctly.
//   3. Passing --mcp-config <abs path> so claude loads our server even if
//      auto-discovery is disabled or cwd is wrong.
//   4. Passing --permission-mode bypassPermissions so claude doesn't try
//      to prompt on stdin (which we have closed) for tool-use approval.
//
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AgentName = 'claude' | 'codex' | 'gemini' | string;

/** Sentinel returned by resolveAgent when the user has explicitly opted out
 * of agent invocation. The watch loop treats this as "skip all agent-required
 * actions"; deterministic per-URL work still runs. */
export const NO_AGENT = '__none__' as const;
export type AgentSelection = AgentName | typeof NO_AGENT;

export interface AgentInvokeOpts {
  /** Agent CLI to invoke. Pass NO_AGENT to skip; resolves env if undefined; falls back to "claude". */
  agent?: AgentSelection;
  /** Prompt to send to the agent (passed as -p / exec / -p depending on agent). */
  prompt: string;
  /** Per-invocation timeout (ms). Default 60_000. */
  timeoutMs?: number;
  /** Working directory for the subprocess. Default: process.cwd(). */
  cwd?: string;
  /**
   * Optional model override. Claude defaults to Opus when omitted. Other
   * CLIs ignore this unless argvForAgent wires their model flag.
   */
  model?: string;
  /** Test injection: replacement spawn function. */
  _spawn?: typeof spawn;
  /** Optional streaming hook for stdout chunks before process exit. */
  onStdout?: (text: string) => void;
}

export interface AgentInvokeResult {
  agent: AgentSelection;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True when the subprocess exceeded timeoutMs and was killed. */
  timedOut: boolean;
  /** Wall-clock duration in ms. */
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const FALLBACK_AGENT: AgentName = 'claude';
const DEFAULT_CLAUDE_MODEL = 'opus';

/**
 * Resolve which agent CLI to use given an explicit option + the env. Caller
 * still has to wire in interactive prompting if both are absent.
 *
 * Returns NO_AGENT when the user has explicitly opted out (`--no-agent` flag,
 * or `DLA_AGENT_CLI=none|off|skip`). Returns null when no preference is set
 * yet, leaving the TUI to prompt.
 */
export function resolveAgent(opts: { agent?: AgentSelection; env?: Record<string, string | undefined> }): AgentSelection | null {
  if (opts.agent) return opts.agent;
  const env = opts.env ?? process.env;
  const fromEnv = env.DLA_AGENT_CLI?.trim();
  if (!fromEnv) return null;
  if (fromEnv === 'none' || fromEnv === 'off' || fromEnv === 'skip') return NO_AGENT;
  return fromEnv;
}

/** True when the resolved selection is the no-agent sentinel. */
export function isNoAgent(selection: AgentSelection | null): boolean {
  return selection === NO_AGENT;
}

/**
 * Map an agent name to its "fast / cheap" model — the analog to
 * Haiku for claude. The streaming compose path could in principle use
 * a smaller model since it's mostly schema translation (HTML → block
 * markup), but we tested Haiku 4.5 against Sonnet 4.6 on real
 * compose work and the quality drop was real and visible — vision-
 * grounded layout decisions, block-type choices, and token-slug
 * usage all measurably worse on the smaller model.
 *
 * This returns an explicit fast-model override only when requested via env.
 * Otherwise callers pass no per-task override and invokeAgent supplies the
 * default model for the selected agent (Opus for Claude). The plumbing remains
 * in place because:
 *   1. The optimization is opt-in via `DLA_FAST_MODEL_<AGENT>` env
 *      for users who'd accept the quality drop in exchange for
 *      speed (e.g. CI smoke tests, large bulk runs).
 *   2. When the heuristic-blocks library expands to handle most
 *      page shapes deterministically, the agent fallback ONLY runs
 *      on visually-distinctive pages where Sonnet quality is
 *      essential anyway — a fast-model override there would be
 *      strictly worse.
 *
 * Examples:
 *   DLA_FAST_MODEL_CLAUDE=claude-haiku-4-5-20251001 pnpm liberate ...
 *   DLA_FAST_MODEL_CODEX=gpt-4o-mini codex-driven run
 */
export function composeModelFor(agent: AgentSelection): string | null {
  if (isNoAgent(agent)) return null;
  const envOverride = process.env[`DLA_FAST_MODEL_${agent.toUpperCase()}`];
  if (envOverride && envOverride.trim()) return envOverride.trim();
  return null;
}

function defaultModelFor(agent: AgentSelection): string | null {
  if (agent === 'claude') return DEFAULT_CLAUDE_MODEL;
  return null;
}

/**
 * Walk up from this module's file location until we find the dir containing
 * `.mcp.json`. That's the project root. Cached because it never changes
 * within a process. Returns null if no .mcp.json is found in any ancestor —
 * the caller falls back to bare-spawn behavior in that case.
 */
let cachedProjectRoot: string | null | undefined = undefined;
function findProjectRootWithMcpConfig(): string | null {
  if (cachedProjectRoot !== undefined) return cachedProjectRoot;
  let dir: string;
  try {
    dir = dirname(fileURLToPath(import.meta.url));
  } catch {
    cachedProjectRoot = null;
    return null;
  }
  // Walk up to filesystem root.
  while (true) {
    if (existsSync(resolve(dir, '.mcp.json'))) {
      cachedProjectRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedProjectRoot = null;
  return null;
}

/**
 * Build the argv for a given agent CLI. Each CLI has its own convention for
 * passing a prompt non-interactively. When a project root with `.mcp.json`
 * is detected, claude additionally gets `--mcp-config`, `--plugin-dir`
 * (so it discovers the project's skills like `replicate`,
 * `design-foundations`, `compose-page-blocks`), and
 * `--permission-mode bypassPermissions` so MCP tools work in `-p` mode
 * with closed stdin.
 */
export function argvForAgent(
  agent: AgentName,
  prompt: string,
  opts: { mcpConfigPath?: string | null; pluginDir?: string | null; model?: string | null } = {},
): string[] {
  switch (agent) {
    case 'claude': {
      // claude -p <prompt>  — non-interactive single-prompt mode.
      //
      // Argv ordering matters: `--mcp-config` and `--plugin-dir` both
      // accept *variadic* `<...>` value lists that consume every
      // subsequent argv until the next flag. If the prompt comes after
      // either, it gets parsed as another path and claude errors with
      // "ENAMETOOLONG: name too long". So we put both first, terminate
      // them with `--permission-mode`, then `-p` (boolean flag), then
      // the prompt as the tail positional. Anything new added here
      // goes BEFORE `-p`.
      //
      // plugin-dir: load the project's `.claude-plugin/plugin.json` so
      // the agent can discover project-local skills (`replicate`,
      // `design-foundations`, `compose-page-blocks`). Without this,
      // `claude -p` only sees the user's globally-installed skills and
      // the prompts that say "invoke the replicate skill" silently
      // do nothing because the skill isn't visible.
      //
      // mcp-config: explicitly load the project's .mcp.json so the
      // data-liberation MCP server is available regardless of cwd.
      //
      // bypassPermissions: agent path is fully autonomous; we have no
      // stdin to answer prompts on. Without this, every tool-use request
      // hangs until our timeout fires.
      const argv: string[] = [];
      if (opts.pluginDir) {
        argv.push('--plugin-dir', opts.pluginDir);
      }
      if (opts.mcpConfigPath) {
        argv.push('--mcp-config', opts.mcpConfigPath);
      }
      if (opts.model) {
        // --model takes a single value, terminated by the next flag. Place
        // it after the variadic flags above so it doesn't get eaten.
        argv.push('--model', opts.model);
      }
      argv.push('--permission-mode', 'bypassPermissions');
      argv.push('-p', prompt);
      return argv;
    }
    case 'codex': {
      // codex's `-m, --model <MODEL>` is a global flag (precedes the
      // exec subcommand). MCP wiring for codex is not implemented yet
      // — surface as opt-in via DLA_AGENT_CLI when we have a stable
      // codex MCP convention.
      const argv: string[] = [];
      if (opts.model) {
        argv.push('--model', opts.model);
      }
      argv.push('exec', prompt);
      return argv;
    }
    case 'gemini':
      // gemini -p <prompt>. Gemini CLI accepts `-m <model>` similarly;
      // wire when we add a "fast model" mapping for it.
      return ['-p', prompt];
    default:
      // Generic: pass the prompt as a single argv. Users can override by
      // setting DLA_AGENT_CLI to a wrapper script that re-shapes args.
      return [prompt];
  }
}

/**
 * Run the agent with the given prompt. Returns the captured stdout/stderr +
 * exit code. Times out after timeoutMs and kills the process; the caller can
 * detect timeout via result.timedOut.
 *
 * Skip mode: when opts.agent is NO_AGENT, returns immediately with
 * `{exitCode: 0, stdout: '', stderr: '', timedOut: false}` and a synthetic
 * agent name `__none__`. Callers should check `result.agent === NO_AGENT`
 * to know the call was a no-op.
 */
export function invokeAgent(opts: AgentInvokeOpts): Promise<AgentInvokeResult> {
  const resolved = opts.agent ?? resolveAgent({}) ?? FALLBACK_AGENT;

  if (resolved === NO_AGENT) {
    return Promise.resolve({
      agent: NO_AGENT,
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: 0,
    });
  }

  const agent: AgentName = resolved;
  const projectRoot = findProjectRootWithMcpConfig();
  const mcpConfigPath = projectRoot ? resolve(projectRoot, '.mcp.json') : null;
  // Pass --plugin-dir only when a real plugin manifest is present —
  // otherwise claude --plugin-dir errors out.
  const pluginDir =
    projectRoot && existsSync(resolve(projectRoot, '.claude-plugin', 'plugin.json'))
      ? projectRoot
      : null;
  const argv = argvForAgent(agent, opts.prompt, {
    mcpConfigPath,
    pluginDir,
    model: opts.model ?? defaultModelFor(agent),
  });
  const spawnFn = opts._spawn ?? spawn;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();

  // CLAUDE_PLUGIN_ROOT is referenced by .mcp.json's args/cwd substitution;
  // export it so the spawned MCP server (`npx tsx ${CLAUDE_PLUGIN_ROOT}/src/mcp-server.ts`)
  // can find its own source. cwd defaults to the project root for the same
  // reason — relative imports inside the MCP server resolve correctly.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(projectRoot ? { CLAUDE_PLUGIN_ROOT: projectRoot } : {}),
  };
  const childCwd = opts.cwd ?? projectRoot ?? undefined;

  return new Promise<AgentInvokeResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn(agent, argv, {
        cwd: childCwd,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({
        agent,
        exitCode: -1,
        stdout: '',
        stderr: `spawn failed: ${(err as Error).message}`,
        timedOut: false,
        durationMs: Date.now() - start,
      });
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (b: Buffer) => {
      stdoutChunks.push(b);
      opts.onStdout?.(b.toString('utf8'));
    });
    child.stderr?.on('data', (b: Buffer) => stderrChunks.push(b));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({
        agent,
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        durationMs: Date.now() - start,
      });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        agent,
        exitCode: -1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: `${Buffer.concat(stderrChunks).toString('utf8')}\nerror: ${err.message}`,
        timedOut,
        durationMs: Date.now() - start,
      });
    });
  });
}
