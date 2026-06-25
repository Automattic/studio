import { describe, it, expect } from 'vitest';
import { ensurePlugin } from './ensure-plugin.js';
import type { ExecFn } from './ensure-plugin.js';

// Builds a mock exec that matches expected arg arrays to canned responses
// (resolve = success, reject = non-zero exit). Records every call for assertion.
function makeMockExec(responses: Map<string, () => Promise<string>>): {
  exec: ExecFn;
  calls: string[][];
} {
  const calls: string[][] = [];
  const exec: ExecFn = async (_sitePath: string, args: string[]) => {
    calls.push([...args]);
    const key = args.join('\0');
    const handler = responses.get(key);
    if (!handler) throw new Error(`Unexpected exec args: ${args.join(' ')}`);
    return handler();
  };
  return { exec, calls };
}

function ok(args: string[]): [string, () => Promise<string>] {
  return [args.join('\0'), () => Promise.resolve('')];
}
function fail(args: string[], msg = 'wp-cli error'): [string, () => Promise<string>] {
  return [args.join('\0'), () => Promise.reject(new Error(msg))];
}

describe('ensurePlugin', () => {
  const sitePath = '/tmp/fake-site';
  const slug = 'safe-svg';

  it('installed AND active → no install/activate calls, {ok:true, action:"none"}', async () => {
    const { exec, calls } = makeMockExec(
      new Map([
        ok(['plugin', 'is-installed', slug]),
        ok(['plugin', 'is-active', slug]),
      ]),
    );
    const result = await ensurePlugin(sitePath, slug, exec);
    expect(result).toEqual({ ok: true, action: 'none' });
    expect(calls).toEqual([
      ['plugin', 'is-installed', slug],
      ['plugin', 'is-active', slug],
    ]);
  });

  it('installed but inactive → activate only, {ok:true, action:"activated"}', async () => {
    const { exec, calls } = makeMockExec(
      new Map([
        ok(['plugin', 'is-installed', slug]),
        fail(['plugin', 'is-active', slug], 'Plugin not active'),
        ok(['plugin', 'activate', slug]),
      ]),
    );
    const result = await ensurePlugin(sitePath, slug, exec);
    expect(result).toEqual({ ok: true, action: 'activated' });
    expect(calls).toEqual([
      ['plugin', 'is-installed', slug],
      ['plugin', 'is-active', slug],
      ['plugin', 'activate', slug],
    ]);
  });

  it('not installed → install --activate once, {ok:true, action:"installed"}', async () => {
    const { exec, calls } = makeMockExec(
      new Map([
        fail(['plugin', 'is-installed', slug], 'Plugin not found'),
        ok(['plugin', 'install', slug, '--activate']),
      ]),
    );
    const result = await ensurePlugin(sitePath, slug, exec);
    expect(result).toEqual({ ok: true, action: 'installed' });
    expect(calls).toEqual([
      ['plugin', 'is-installed', slug],
      ['plugin', 'install', slug, '--activate'],
    ]);
  });

  it('exec throws / install fails → {ok:false, error}, never throws', async () => {
    const { exec } = makeMockExec(
      new Map([
        fail(['plugin', 'is-installed', slug], 'Plugin not found'),
        fail(['plugin', 'install', slug, '--activate'], 'Network timeout'),
      ]),
    );
    const result = await ensurePlugin(sitePath, slug, exec);
    expect(result).toMatchObject({ ok: false, error: 'Network timeout' });
  });

  it('double-call idempotence: second call hits installed+active path', async () => {
    // Simulates the real state change: after install, the plugin IS installed+active.
    let installed = false;
    const exec: ExecFn = async (_sitePath: string, args: string[]) => {
      const key = args.join(' ');
      if (key === `plugin is-installed ${slug}`) {
        if (!installed) throw new Error('not installed');
        return '';
      }
      if (key === `plugin install ${slug} --activate`) {
        installed = true;
        return '';
      }
      if (key === `plugin is-active ${slug}`) {
        if (installed) return '';
        throw new Error('not active');
      }
      throw new Error(`Unexpected: ${key}`);
    };

    const first = await ensurePlugin(sitePath, slug, exec);
    expect(first).toEqual({ ok: true, action: 'installed' });

    const second = await ensurePlugin(sitePath, slug, exec);
    expect(second).toEqual({ ok: true, action: 'none' });
  });
});
