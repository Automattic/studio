import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';

// Force a known platform so ctx.findAdapter resolves to our fake adapter and no
// network detection runs.
vi.mock('../../lib/detect-platform/index.js', () => ({
  detect: vi.fn(async () => ({ platform: 'fake', confidence: 'high', signals: [] })),
}));

// detectFeatures is dynamically imported inside the handler — stub it so the test
// doesn't depend on real feature heuristics.
vi.mock('../../lib/features/detect-features.js', () => ({
  detectFeatures: vi.fn(() => ['fake-feature']),
}));

import { discoverHandler } from './discover.js';
import type { HandlerContext, ToolResult } from '../handler-types.js';
import type { PlatformAdapter } from '../../types.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(FIXTURE_TMP, 'disc-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SITE = 'https://example.com';

/** Inventory with a large url list plus the summary fields callers depend on. */
function makeInventory(urlCount: number) {
  return {
    siteMeta: { title: 'Example', tagline: 'A site', language: 'en-US' },
    counts: { pages: urlCount, posts: 0, products: 0 },
    navigation: [{ label: 'Home', url: SITE }],
    urls: Array.from({ length: urlCount }, (_, i) => ({ url: `${SITE}/page-${i}`, type: 'page' })),
  };
}

function makeAdapter(urlCount: number): PlatformAdapter {
  return {
    platform: 'fake',
    discover: async () => makeInventory(urlCount),
    extract: async () => {},
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

describe('discoverHandler — compact result', () => {
  it('caps a >50-entry urls array, adds urlsTruncated, and preserves counts/navigation/platformFeatures', async () => {
    const res = await discoverHandler({ url: SITE, outputDir: dir }, makeCtx(makeAdapter(120)));
    const out = parse(res);

    // Large array capped to 50 with a visible total marker.
    expect(Array.isArray(out.urls)).toBe(true);
    expect((out.urls as unknown[]).length).toBe(50);
    expect(out.urlsTruncated).toBe(120);

    // Summary / structure fields preserved verbatim.
    expect(out.counts).toEqual({ pages: 120, posts: 0, products: 0 });
    expect(out.navigation).toEqual([{ label: 'Home', url: SITE }]);
    expect(out.siteMeta).toEqual({ title: 'Example', tagline: 'A site', language: 'en-US' });
    expect(out.platformFeatures).toEqual(['fake-feature']);

    // Full result recoverable from the sidecar (outputDir was provided).
    expect(out.fullResultPath).toBe(join(dir, '.discover.json'));
    expect(existsSync(join(dir, '.discover.json'))).toBe(true);
    const full = JSON.parse(readFileSync(join(dir, '.discover.json'), 'utf8'));
    expect((full.urls as unknown[]).length).toBe(120);
  });

  it('leaves a small urls array untouched (no truncation marker, no sidecar)', async () => {
    const res = await discoverHandler({ url: SITE, outputDir: dir }, makeCtx(makeAdapter(3)));
    const out = parse(res);
    expect((out.urls as unknown[]).length).toBe(3);
    expect(out.urlsTruncated).toBeUndefined();
    expect(out.fullResultPath).toBeUndefined();
    expect(existsSync(join(dir, '.discover.json'))).toBe(false);
  });

  it('caps inline with NO sidecar when no outputDir is provided', async () => {
    const res = await discoverHandler({ url: SITE }, makeCtx(makeAdapter(120)));
    const out = parse(res);
    expect((out.urls as unknown[]).length).toBe(50);
    expect(out.urlsTruncated).toBe(120);
    expect(out.fullResultPath).toBeUndefined();
  });
});
