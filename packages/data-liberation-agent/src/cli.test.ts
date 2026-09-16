import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('cli', () => {
  it('prints usage for --help regardless of a preceding unrecognized token, instead of crashing on a fetch', async () => {
    const result = await runCli(['capture', '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stderr).not.toContain('SsrfBlockedError');
  }, 30_000);

  it('rejects a first argument that is neither a known subcommand nor a parseable URL, naming the valid subcommands', async () => {
    const result = await runCli(['capture']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('inspect');
    expect(result.stderr).toContain('compare');
    expect(result.stderr).toContain('publish');
    expect(result.stderr).toContain('mcp');
    expect(result.stderr).not.toContain('SsrfBlockedError');
  }, 30_000);

  it('reproduces the reported repro verbatim: "capture" alone fails with guidance, not an SSRF stack trace', async () => {
    const result = await runCli(['capture']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('"capture"');
    expect(result.stderr).not.toContain('unparseable URL');
  }, 30_000);
});
