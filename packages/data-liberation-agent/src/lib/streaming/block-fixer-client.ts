//
// Block-fixer client
// ===================
// Spawns the persistent block-fixer subprocess (scripts/block-fixer/
// fix-server.js), waits for /health to flip green, and exposes a `fix()`
// call that POSTs composed block markup for normalization. Used by the
// streaming watch runner to canonicalize agent / heuristic output before
// `wp_insert_post` so imported posts pass WordPress's block validator.
//
// Why a subprocess (not in-process):
//   `@wordpress/blocks` pulls in React 18; this repo hoists React 19
//   from Ink. They cannot share a process. Telex solved the same problem
//   the same way — see scripts/block-fixer/fix-server.js for the server
//   side. We bind to 127.0.0.1 (no network surface) and parent the
//   process to our CLI run so it dies with us.
//
// Failure mode:
//   If the server can't start, can't be reached, or returns non-200,
//   `fix()` returns the input unchanged with `changed: false`. The runner
//   will install the un-normalized markup; that's the same behavior we
//   had before the fixer existed.
//

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as http from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FixResult {
  html: string;
  changed: boolean;
  fixedIssues: string[];
}

export interface RawConvertResult {
  /** Native block markup, or null on passthrough (server unavailable / parse error). */
  html: string | null;
  /** Count of residual `wp:html` blocks; Infinity on passthrough/error. */
  wpHtmlResidue: number;
}

export interface BlockFixerStartOpts {
  /** Override server port. Default 3201 (telex uses 3200 — pick another so both can coexist). */
  port?: number;
  /** Override worker count. Default min(cores, 4) inside the server. */
  workers?: number;
  /** Health-check timeout in ms. Default 30s. */
  healthTimeoutMs?: number;
  /** Optional logger for lifecycle events; defaults to no-op. */
  log?: (msg: string) => void;
}

/** True when the source sidecar's key deps resolve from its directory —
 * i.e. we're in a checkout with node_modules, not a bare plugin install. */
function sidecarDepsResolvable(sidecarDir: string): boolean {
  try {
    const req = createRequire(join(sidecarDir, 'package.json'));
    req.resolve('@wordpress/block-library/package.json');
    req.resolve('jsdom/package.json');
    return true;
  } catch {
    return false;
  }
}

const DEFAULT_PORT = 3201;
const DEFAULT_HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_INTERVAL_MS = 500;
const FIX_REQUEST_TIMEOUT_MS = 10_000;
const STOP_GRACE_MS = 10_000;

export class BlockFixerClient {
  private child: ChildProcess | null = null;
  private port: number = DEFAULT_PORT;
  private ready = false;
  private startPromise: Promise<void> | null = null;
  private log: (msg: string) => void;

  constructor(log?: (msg: string) => void) {
    this.log = log ?? (() => {});
  }

  /**
   * True once /health flipped green — fix()/rawConvert() will reach the
   * server instead of falling back to identity passthrough. Callers whose
   * edits REQUIRE canonicalization (e.g. comment-attr-only rewrites that
   * desync from emitter inner HTML) must check this before editing.
   */
  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Spawn the fix-server subprocess and wait for /health.
   * Idempotent — repeated calls return the same in-flight promise.
   * Resolves on success; rejects only if the subprocess can't be
   * located (`scripts/block-fixer/fix-server.js` missing). Health-poll
   * timeouts are non-fatal — the client just stays "not ready" and
   * `fix()` falls back to passthrough.
   */
  async start(opts: BlockFixerStartOpts = {}): Promise<void> {
    if (this.ready) return;
    if (this.startPromise) return this.startPromise;

    this.port = opts.port ?? DEFAULT_PORT;
    if (opts.log) this.log = opts.log;

    this.startPromise = this.startInner(opts);
    return this.startPromise;
  }

  private async startInner(opts: BlockFixerStartOpts): Promise<void> {
    // Resolve the sidecar relative to this file (src/lib/streaming/ → package
    // root; the bundle build rewrites import.meta.url back to this source
    // path, so the derivation holds inside the committed bundles too).
    // The sidecar's deps live in a nested install (never hoisted — React-18
    // isolation from Ink's React 19) that a plugin install doesn't ship;
    // restore it from the committed package-lock.json on first use.
    const here = fileURLToPath(import.meta.url);
    const repoRoot = join(here, '..', '..', '..', '..');
    const serverPath = join(repoRoot, 'scripts', 'block-fixer', 'fix-server.js');
    const sidecarDir = dirname(serverPath);

    if (!existsSync(serverPath)) {
      this.log(`[block-fixer] server script missing at ${serverPath} — fix() will passthrough`);
      return;
    }
    if (!sidecarDepsResolvable(sidecarDir) && !this.installSidecarDeps(sidecarDir)) {
      return;
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      BLOCK_FIXER_PORT: String(this.port),
      BLOCK_FIXER_HOST: '127.0.0.1',
    };
    if (opts.workers !== undefined) {
      env.BLOCK_FIXER_WORKERS = String(opts.workers);
    }

    this.child = spawn(process.execPath, [serverPath], {
      cwd: dirname(serverPath),
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: false,
    });
    this.child.stderr?.on('data', (chunk: Buffer) => {
      // Server logs to stderr; surface them through our logger so users
      // see worker boot lines / fixer warnings in watch.log alongside
      // everything else. JSDOM's "Could not parse CSS stylesheet" noise
      // gets filtered to keep the log focused.
      const text = chunk.toString('utf8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === 'Could not parse CSS stylesheet') continue;
        this.log(trimmed);
      }
    });
    this.child.on('exit', (code, signal) => {
      this.ready = false;
      this.log(`[block-fixer] subprocess exited (code=${code}, signal=${signal})`);
    });
    this.child.on('error', (err) => {
      this.log(`[block-fixer] subprocess error: ${err.message}`);
    });

    // Poll /health up to healthTimeoutMs. On timeout, leave ready=false;
    // fix() will fall through to passthrough.
    const deadline = Date.now() + (opts.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS);
    while (Date.now() < deadline) {
      if (await this.healthOk()) {
        this.ready = true;
        this.log(`[block-fixer] ready on 127.0.0.1:${this.port}`);
        return;
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
    }
    this.log(`[block-fixer] /health did not respond within timeout — fix() will passthrough`);
  }

  /**
   * One-time restore of the sidecar's nested node_modules from its committed
   * package-lock.json (integrity-pinned; lifecycle scripts not needed, so
   * --ignore-scripts). Returns true when the deps resolve afterwards; on any
   * failure logs and returns false so fix() falls back to passthrough.
   */
  private installSidecarDeps(sidecarDir: string): boolean {
    this.log(`[block-fixer] sidecar deps missing — running npm ci in ${sidecarDir}`);
    const result = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: sidecarDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 300_000,
      shell: process.platform === 'win32',
    });
    if (result.status !== 0 || !sidecarDepsResolvable(sidecarDir)) {
      const detail = (result.stderr || result.error?.message || '').trim().split('\n').slice(-3).join(' ');
      this.log(
        `[block-fixer] npm ci failed (${detail || 'unknown error'}) — fix() will passthrough. ` +
          `Retry manually: cd "${sidecarDir}" && npm ci`,
      );
      return false;
    }
    this.log('[block-fixer] sidecar deps installed');
    return true;
  }

  /**
   * SIGTERM the subprocess and wait up to STOP_GRACE_MS for it to exit.
   * Force-kills if it hangs. Idempotent.
   */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.child = null;
      this.ready = false;
      return;
    }
    this.ready = false;

    return new Promise<void>((resolve) => {
      const onExit = (): void => {
        clearTimeout(killTimer);
        this.child = null;
        resolve();
      };
      child.once('exit', onExit);

      try {
        child.kill('SIGTERM');
      } catch {
        // already dead
      }

      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // dead
        }
      }, STOP_GRACE_MS);
      killTimer.unref();
    });
  }

  /**
   * Submit one or more block markup strings for normalization. Returns
   * one result per input (preserving order). On any error, returns the
   * inputs unchanged.
   */
  async fix(items: string[]): Promise<FixResult[]> {
    if (items.length === 0) return [];
    if (!this.ready) {
      return items.map((html) => ({ html, changed: false, fixedIssues: [] }));
    }

    try {
      const body = JSON.stringify({ items });
      const res = await this.postJson('/fix', body);
      if (res.status !== 200) {
        this.log(`[block-fixer] /fix returned ${res.status}: ${res.body.slice(0, 200)}`);
        return items.map((html) => ({ html, changed: false, fixedIssues: [] }));
      }
      const decoded = JSON.parse(res.body) as { results?: FixResult[] };
      if (!Array.isArray(decoded.results) || decoded.results.length !== items.length) {
        this.log(`[block-fixer] /fix returned malformed body — falling back to passthrough`);
        return items.map((html) => ({ html, changed: false, fixedIssues: [] }));
      }
      return decoded.results;
    } catch (err) {
      this.log(`[block-fixer] /fix request failed: ${(err as Error).message}`);
      return items.map((html) => ({ html, changed: false, fixedIssues: [] }));
    }
  }

  /**
   * Convert raw section HTML into native block markup via the sidecar `/raw`
   * op (rawHandler). Returns one result per input, in order. On any failure
   * (not ready, non-200, malformed, timeout) returns a passthrough sentinel
   * per item so the caller falls back to the structured render.
   */
  async rawConvert(items: string[]): Promise<RawConvertResult[]> {
    if (items.length === 0) return [];
    const sentinel = (): RawConvertResult => ({ html: null, wpHtmlResidue: Infinity });
    if (!this.ready) return items.map(sentinel);
    try {
      const res = await this.postJson('/raw', JSON.stringify({ items }));
      if (res.status !== 200) {
        this.log(`[block-fixer] /raw returned ${res.status}: ${res.body.slice(0, 200)}`);
        return items.map(sentinel);
      }
      const decoded = JSON.parse(res.body) as { results?: RawConvertResult[] };
      if (!Array.isArray(decoded.results) || decoded.results.length !== items.length) {
        this.log(`[block-fixer] /raw returned malformed body — passthrough`);
        return items.map(sentinel);
      }
      return decoded.results;
    } catch (err) {
      this.log(`[block-fixer] /raw request failed: ${(err as Error).message}`);
      return items.map(sentinel);
    }
  }

  private async healthOk(): Promise<boolean> {
    try {
      const res = await this.getJson('/health');
      return res.status === 200;
    } catch {
      return false;
    }
  }

  private getJson(path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: this.port,
          method: 'GET',
          path,
          timeout: 2_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('health request timed out'));
      });
      req.end();
    });
  }

  private postJson(path: string, body: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const buf = Buffer.from(body, 'utf8');
      const req = http.request(
        {
          host: '127.0.0.1',
          port: this.port,
          method: 'POST',
          path,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': buf.length,
          },
          timeout: FIX_REQUEST_TIMEOUT_MS,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('fix request timed out'));
      });
      req.write(buf);
      req.end();
    });
  }
}
