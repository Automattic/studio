import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Boots the MCP server EXACTLY as production does — `tsx src/mcp-server.ts` in a
// child process, with cwd = repo root — and asserts it links and serves its tools.
//
// Why a subprocess and not an in-process import: the failure mode this guards
// against is a barrel re-exporting a TYPE with value `export {}` syntax (e.g.
// `export { DetectionResult } from './detect-platform.js'`). That crashes Node's
// native ESM linker at boot (which is how `tsx` runs the server) with
// "does not provide an export named ...". It is invisible to `tsc` (even with
// noEmitOnError) and silently erased by vitest's own esbuild transform — so a
// same-process `import('./mcp-server.js')` would NOT reproduce it. Only a real
// `tsx` launch links the barrel graph the way production does. Regression guard
// for the four barrels fixed alongside this test (detect-platform, woo-csv,
// resume-state, wxr) and any future barrel that makes the same mistake.
//
// Self-locating via import.meta.url so a worktree copy boots its own server from
// its own path (no shared cwd state, no cross-copy collision).

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, 'mcp-server.ts');
const repoRoot = join(here, '..');

interface Tool {
  name: string;
}

describe('mcp-server boots under tsx/native-ESM', () => {
  it('links the barrel graph and serves the tool list', async () => {
    const child = spawn('npx', ['tsx', serverEntry], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const send = (msg: unknown) => child.stdin.write(`${JSON.stringify(msg)}\n`);
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'boot-smoke', version: '0' },
      },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    try {
      const tools = await new Promise<Tool[]>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timed out waiting for tools/list\nstderr:\n${stderr}`)),
          60_000,
        );
        child.stdout.on('data', (d) => {
          stdout += d.toString();
          for (const line of stdout.split('\n')) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.id === 2 && msg.result?.tools) {
                clearTimeout(timer);
                resolve(msg.result.tools as Tool[]);
              }
            } catch {
              // partial line — wait for the rest
            }
          }
        });
        child.on('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`server exited (code ${code}) before tools/list\nstderr:\n${stderr}`));
        });
      });

      // No ESM-linker crash leaked to stderr (the original boot failure).
      expect(stderr).not.toMatch(/SyntaxError|does not provide an export/);
      // Tools actually registered — a real list, with stable core tools present.
      const names = tools.map((t) => t.name);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain('liberate_paths');
      expect(names).toContain('liberate_detect');
      expect(names).toContain('liberate_extract');
    } finally {
      child.stdin.end();
      child.kill();
    }
  }, 70_000);
});
