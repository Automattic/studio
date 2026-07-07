import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';

// Avoid the network call in extractHandler's platform detection and force a
// known platform so ctx.findAdapter resolves to our fake adapter.
vi.mock('../../lib/detect-platform/index.js', () => ({
  detect: vi.fn(async () => ({ platform: 'fake', confidence: 'high', signals: [] })),
}));

import { extractHandler } from './extract.js';
import { WxrBuilder } from '../../lib/wxr/index.js';
import { ExtractionLog } from '../../lib/resume-state/index.js';
import type { HandlerContext, ToolResult } from '../handler-types.js';
import type { PlatformAdapter } from '../../types.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(FIXTURE_TMP, 'extract-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SITE = 'https://example.com';

/**
 * Fake adapter: emits one page (so the WXR serializes) and logs `failCount`
 * failed URLs so the handler's `failures` array is large enough to be capped.
 */
function makeAdapter(failCount: number): PlatformAdapter {
  return {
    platform: 'fake',
    discover: async () => ({ siteMeta: { title: 'Example', tagline: '', language: 'en-US' }, urls: [], navigation: [] }),
    extract: async (
      _inventory: unknown,
      wxr: WxrBuilder,
      _opts: unknown,
      ctx: { log: ExtractionLog },
    ) => {
      wxr.addPage({ title: 'Home', slug: 'home', content: '<p>home</p>', sourceUrl: SITE });
      for (let i = 0; i < failCount; i++) {
        ctx.log.logFailed({ url: `${SITE}/broken-${i}`, error: 'Timeout' });
      }
    },
  } as unknown as PlatformAdapter;
}

function makeCtx(adapter: PlatformAdapter): HandlerContext {
  return {
    adapters: [adapter],
    findAdapter: () => adapter,
    textResult: (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }] }),
    errorResult: (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true }),
    server: {} as never,
  };
}

function parse(res: ToolResult): Record<string, unknown> {
  return JSON.parse(res.content[0].text);
}

describe('extractHandler — compact result', () => {
  it('caps the failures array, adds failuresTruncated, preserves summary/wxrValidation/wxrPath, writes sidecar', async () => {
    const res = await extractHandler(
      { url: SITE, outputDir: dir, contentStatus: 'draft' },
      makeCtx(makeAdapter(120)),
    );
    const out = parse(res);

    // failures capped to 50 with a visible total; summary.failedUrls keeps the
    // true count (callers depend on the count, not the truncated array).
    expect((out.failures as unknown[]).length).toBe(50);
    expect(out.failuresTruncated).toBe(120);
    const summary = out.summary as Record<string, unknown>;
    expect(summary.failedUrls).toBe(120);
    expect(summary.pagesExtracted).toBe(1);
    expect(summary.qualityScores).toEqual({ high: 0, medium: 0, low: 0 });

    // Validation + path preserved verbatim.
    expect(out.wxrValidation).toBeDefined();
    expect(out.wxrPath).toBe(join(dir, 'output.wxr'));
    expect(out.outputDir).toBe(dir);

    // Full result recoverable; sidecar holds all 120 failures.
    expect(out.fullResultPath).toBe(join(dir, '.extract-result.json'));
    expect(existsSync(join(dir, '.extract-result.json'))).toBe(true);
    const full = JSON.parse(readFileSync(join(dir, '.extract-result.json'), 'utf8'));
    expect((full.failures as unknown[]).length).toBe(120);
  });

  it('returns a small result inline with no truncation marker or sidecar', async () => {
    const res = await extractHandler(
      { url: SITE, outputDir: dir, contentStatus: 'draft' },
      makeCtx(makeAdapter(2)),
    );
    const out = parse(res);
    expect((out.failures as unknown[]).length).toBe(2);
    expect(out.failuresTruncated).toBeUndefined();
    expect(out.fullResultPath).toBeUndefined();
    expect(existsSync(join(dir, '.extract-result.json'))).toBe(false);
  });
});
