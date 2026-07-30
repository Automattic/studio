import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { resolveAgent, argvForAgent, invokeAgent, isNoAgent, NO_AGENT } from './agent-invoker.js';

function makeFakeChild(): {
  emitter: EventEmitter & { stdout?: EventEmitter; stderr?: EventEmitter; kill: (sig?: string) => boolean };
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const emitter = new EventEmitter() as EventEmitter & {
    stdout?: EventEmitter;
    stderr?: EventEmitter;
    kill: (sig?: string) => boolean;
  };
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.kill = vi.fn().mockReturnValue(true);
  return { emitter, stdout, stderr };
}

describe('resolveAgent', () => {
  it('prefers explicit agent', () => {
    expect(resolveAgent({ agent: 'codex', env: { DLA_AGENT_CLI: 'gemini' } })).toBe('codex');
  });

  it('falls back to env', () => {
    expect(resolveAgent({ env: { DLA_AGENT_CLI: 'gemini' } })).toBe('gemini');
  });

  it('returns null when neither set (caller can prompt)', () => {
    expect(resolveAgent({ env: {} })).toBeNull();
  });

  it('treats whitespace-only env as unset', () => {
    expect(resolveAgent({ env: { DLA_AGENT_CLI: '   ' } })).toBeNull();
  });

  it('returns NO_AGENT when env is "none" / "off" / "skip"', () => {
    expect(resolveAgent({ env: { DLA_AGENT_CLI: 'none' } })).toBe(NO_AGENT);
    expect(resolveAgent({ env: { DLA_AGENT_CLI: 'off' } })).toBe(NO_AGENT);
    expect(resolveAgent({ env: { DLA_AGENT_CLI: 'skip' } })).toBe(NO_AGENT);
  });

  it('isNoAgent detects the sentinel', () => {
    expect(isNoAgent(NO_AGENT)).toBe(true);
    expect(isNoAgent('claude')).toBe(false);
    expect(isNoAgent(null)).toBe(false);
  });
});

describe('argvForAgent', () => {
  it('claude → bypassPermissions then -p with prompt last', () => {
    expect(argvForAgent('claude', 'hi')).toEqual([
      '--permission-mode',
      'bypassPermissions',
      '-p',
      'hi',
    ]);
  });
  it('claude with mcpConfigPath puts --mcp-config FIRST so it does not eat the prompt', () => {
    // Variadic --mcp-config <configs...> consumes everything until the
    // next flag — so it must precede --permission-mode (which terminates
    // its value list), and the prompt must come after -p (positional).
    expect(argvForAgent('claude', 'hi', { mcpConfigPath: '/abs/.mcp.json' })).toEqual([
      '--mcp-config',
      '/abs/.mcp.json',
      '--permission-mode',
      'bypassPermissions',
      '-p',
      'hi',
    ]);
  });
  it('claude with pluginDir adds --plugin-dir before --mcp-config (also variadic)', () => {
    expect(
      argvForAgent('claude', 'hi', {
        mcpConfigPath: '/abs/.mcp.json',
        pluginDir: '/abs/project',
      }),
    ).toEqual([
      '--plugin-dir',
      '/abs/project',
      '--mcp-config',
      '/abs/.mcp.json',
      '--permission-mode',
      'bypassPermissions',
      '-p',
      'hi',
    ]);
  });
  it('claude with model includes --model before permission mode', () => {
    expect(argvForAgent('claude', 'hi', { model: 'opus' })).toEqual([
      '--model',
      'opus',
      '--permission-mode',
      'bypassPermissions',
      '-p',
      'hi',
    ]);
  });
  it('codex → exec <prompt>', () => {
    expect(argvForAgent('codex', 'hi')).toEqual(['exec', 'hi']);
  });
  it('gemini → -p <prompt>', () => {
    expect(argvForAgent('gemini', 'hi')).toEqual(['-p', 'hi']);
  });
  it('unknown → pass prompt through as a single arg', () => {
    expect(argvForAgent('myagent', 'hi')).toEqual(['hi']);
  });
});

describe('invokeAgent', () => {
  it('captures stdout, stderr, exit code', async () => {
    const { emitter, stdout, stderr } = makeFakeChild();
    const spawnMock = vi.fn().mockReturnValue(emitter);

    const promise = invokeAgent({
      agent: 'claude',
      prompt: 'tell me a joke',
      _spawn: spawnMock as unknown as typeof import('node:child_process').spawn,
    });

    stdout.emit('data', Buffer.from('hello'));
    stderr.emit('data', Buffer.from('warn'));
    setImmediate(() => emitter.emit('exit', 0));

    const result = await promise;
    expect(result.agent).toBe('claude');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('warn');
    expect(result.timedOut).toBe(false);
    // The argv depends on whether a project-root .mcp.json was discovered
    // — we run inside the data-liberation-agent repo, so it will be. Just
    // assert the structural shape rather than pinning the exact path.
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [calledAgent, calledArgv, calledOpts] = spawnMock.mock.calls[0];
    expect(calledAgent).toBe('claude');
    expect(calledArgv).toContain('--permission-mode');
    expect(calledArgv).toContain('bypassPermissions');
    expect(calledArgv).toContain('--model');
    expect(calledArgv).toContain('opus');
    expect(calledArgv).toContain('-p');
    // Prompt must be the very last argv so --mcp-config's variadic value
    // list can't eat it as another config path.
    expect(calledArgv[calledArgv.length - 1]).toBe('tell me a joke');
    // -p must come immediately before the prompt (so prompt is the
    // positional tail, not absorbed by another flag).
    expect(calledArgv[calledArgv.length - 2]).toBe('-p');
    expect(calledOpts).toEqual(expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }));
    expect(calledOpts.env).toBeTypeOf('object');
  });

  it('uses explicit model override instead of default Claude Opus', async () => {
    const { emitter } = makeFakeChild();
    const spawnMock = vi.fn().mockReturnValue(emitter);

    const promise = invokeAgent({
      agent: 'claude',
      prompt: 'model override',
      model: 'claude-sonnet-test',
      _spawn: spawnMock as unknown as typeof import('node:child_process').spawn,
    });

    setImmediate(() => emitter.emit('exit', 0));
    await promise;

    const [, calledArgv] = spawnMock.mock.calls[0];
    expect(calledArgv).toContain('--model');
    expect(calledArgv).toContain('claude-sonnet-test');
    expect(calledArgv).not.toContain('opus');
  });

  it('streams stdout chunks while the process is still running', async () => {
    const { emitter, stdout } = makeFakeChild();
    const spawnMock = vi.fn().mockReturnValue(emitter);
    const chunks: string[] = [];

    const promise = invokeAgent({
      agent: 'claude',
      prompt: 'stream',
      onStdout: (text) => chunks.push(text),
      _spawn: spawnMock as unknown as typeof import('node:child_process').spawn,
    });

    stdout.emit('data', Buffer.from('first\n'));
    expect(chunks).toEqual(['first\n']);
    stdout.emit('data', Buffer.from('second\n'));
    setImmediate(() => emitter.emit('exit', 0));

    const result = await promise;
    expect(chunks).toEqual(['first\n', 'second\n']);
    expect(result.stdout).toBe('first\nsecond\n');
  });

  it('times out and kills process after timeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const { emitter } = makeFakeChild();
      const spawnMock = vi.fn().mockReturnValue(emitter);

      const promise = invokeAgent({
        agent: 'claude',
        prompt: 'slow',
        timeoutMs: 100,
        _spawn: spawnMock as unknown as typeof import('node:child_process').spawn,
      });

      vi.advanceTimersByTime(150);
      // Killer fires; emit exit so promise resolves
      setImmediate(() => emitter.emit('exit', null));
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.timedOut).toBe(true);
      expect((emitter.kill as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns immediately without spawning when agent is NO_AGENT', async () => {
    const spawnMock = vi.fn();
    const result = await invokeAgent({
      agent: NO_AGENT,
      prompt: 'this should not be sent',
      _spawn: spawnMock as unknown as typeof import('node:child_process').spawn,
    });
    expect(result.agent).toBe(NO_AGENT);
    expect(result.exitCode).toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('reports spawn failure with exit code -1', async () => {
    const failingSpawn = vi.fn().mockImplementation(() => {
      throw new Error('ENOENT: claude not found');
    });
    const result = await invokeAgent({
      agent: 'claude',
      prompt: 'x',
      _spawn: failingSpawn as unknown as typeof import('node:child_process').spawn,
    });
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain('ENOENT');
  });
});
