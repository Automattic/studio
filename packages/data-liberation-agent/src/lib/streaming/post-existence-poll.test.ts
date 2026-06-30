import { describe, it, expect, vi } from 'vitest';
import { pollForPost, type PollRunner } from './post-existence-poll.js';

function makeRunner(responses: Array<{ stdout: string } | Error>): PollRunner & { calls: number } {
  let i = 0;
  const fn: PollRunner & { calls: number } = (async (_cmd: string, _args: string[]) => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    fn.calls = i;
    if (r instanceof Error) throw r;
    return r;
  }) as PollRunner & { calls: number };
  fn.calls = 0;
  return fn;
}

describe('pollForPost', () => {
  it('returns found:true with postId on first successful attempt', async () => {
    const runner = makeRunner([{ stdout: '[123]' }]);
    const sleep = vi.fn();
    const result = await pollForPost({
      siteUrl: 'http://localhost:9400',
      sourceUrl: 'https://example.com/about',
      studioSitePath: '/tmp/site',
      runner,
      sleep,
    });
    expect(result).toEqual({ found: true, postId: 123, attempts: 1 });
    expect(runner.calls).toBe(1);
    // No sleep before the first attempt and no sleep after success.
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries when first attempt returns empty array, succeeds on attempt 2', async () => {
    const runner = makeRunner([{ stdout: '[]' }, { stdout: '[42]' }]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await pollForPost({
      siteUrl: 'http://localhost:9400',
      sourceUrl: 'https://example.com/about',
      studioSitePath: '/tmp/site',
      runner,
      sleep,
      backoffMs: [10, 20, 30],
    });
    expect(result.found).toBe(true);
    expect(result.postId).toBe(42);
    expect(result.attempts).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
  });

  it('exhausts all 3 retries and returns found:false', async () => {
    const runner = makeRunner([
      { stdout: '[]' },
      { stdout: '[]' },
      { stdout: '[]' },
    ]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await pollForPost({
      siteUrl: 'http://localhost:9400',
      sourceUrl: 'https://example.com/about',
      studioSitePath: '/tmp/site',
      runner,
      sleep,
      backoffMs: [10, 20, 30],
    });
    expect(result).toEqual({ found: false, postId: null, attempts: 3 });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it('uses the documented default 500/2000/5000 backoff when none is overridden', async () => {
    const runner = makeRunner([
      { stdout: '[]' },
      { stdout: '[]' },
      { stdout: '[]' },
    ]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await pollForPost({
      siteUrl: 'http://localhost:9400',
      sourceUrl: 'https://example.com/about',
      studioSitePath: '/tmp/site',
      runner,
      sleep,
    });
    expect(result.attempts).toBe(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 500);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
  });

  it('treats runner errors as "not found" for that attempt and continues', async () => {
    const runner = makeRunner([new Error('studio not running'), { stdout: '[7]' }]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await pollForPost({
      siteUrl: 'http://localhost:9400',
      sourceUrl: 'https://example.com/about',
      studioSitePath: '/tmp/site',
      runner,
      sleep,
      backoffMs: [1, 1, 1],
    });
    expect(result.found).toBe(true);
    expect(result.postId).toBe(7);
    expect(result.attempts).toBe(2);
  });

  it('parses stdout that has noise before the JSON array', async () => {
    const runner = makeRunner([{ stdout: 'Some warning line\n[99]\n' }]);
    const result = await pollForPost({
      siteUrl: 'http://localhost:9400',
      sourceUrl: 'https://example.com/foo',
      studioSitePath: '/tmp/site',
      runner,
      sleep: vi.fn(),
    });
    expect(result.found).toBe(true);
    expect(result.postId).toBe(99);
  });

});
