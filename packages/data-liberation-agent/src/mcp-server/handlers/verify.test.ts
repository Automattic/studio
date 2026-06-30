import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';

import { verifyHandler } from './verify.js';
import type { HandlerContext, ToolResult } from '../handler-types.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(FIXTURE_TMP, 'verify-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeCtx(): HandlerContext {
  return {
    adapters: [],
    findAdapter: () => null,
    textResult: (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }] }),
    errorResult: (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true }),
    server: {} as never,
  };
}

function parse(res: ToolResult): Record<string, unknown> {
  return JSON.parse(res.content[0].text);
}

/**
 * Write a WXR whose single page body references `n` distinct CDN URLs in content.
 * Host is generic Squarespace CDN infra (a real incident platform); paths are
 * synthetic. With no media-stubs.json present these all land in staleCdnUrls.
 */
function writeWxrWithNContentCdnUrls(n: number): string[] {
  const urls = Array.from(
    { length: n },
    (_, i) => `https://images.squarespace-cdn.com/content/v1/test/img-${i}.jpg`,
  );
  const imgs = urls.map((u) => `<img src="${u}" />`).join('');
  const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
  <title>Test</title>
  <wp:wxr_version>1.2</wp:wxr_version>
  <item>
    <title>Gallery</title>
    <wp:post_type>page</wp:post_type>
    <content:encoded><![CDATA[<p>${imgs}</p>]]></content:encoded>
  </item>
</channel>
</rss>`;
  writeFileSync(join(dir, 'output.wxr'), wxr);
  return urls;
}

describe('verifyHandler — compact result', () => {
  it('caps the stale-CDN buckets, adds Truncated markers, preserves counts, and writes the sidecar', async () => {
    writeWxrWithNContentCdnUrls(120);
    writeFileSync(join(dir, 'extraction-log.jsonl'), '');

    const res = await verifyHandler({ outputDir: dir }, makeCtx());
    const out = parse(res);

    // The huge bucket arrays are capped to 50 with visible totals.
    expect((out.staleCdnUrls as unknown[]).length).toBe(50);
    expect(out.staleCdnUrlsTruncated).toBe(120);
    expect((out.cdnInContentNoLocalCopy as unknown[]).length).toBe(50);
    expect(out.cdnInContentNoLocalCopyTruncated).toBe(120);

    // Scalars / counts preserved verbatim (callers depend on these).
    expect(out.outputDir).toBe(dir);
    expect(out.wxrFound).toBe(true);
    expect(out.pages).toBe(1);
    expect(out.qualityScores).toEqual({ high: 0, medium: 0, low: 0 });
    // manualAttentionItems is small — preserved untouched, still says "may break".
    expect(Array.isArray(out.manualAttentionItems)).toBe(true);
    expect((out.manualAttentionItems as string[]).join('\n')).toContain('may break');

    // Full report recoverable from <outputDir>/.verify.json with all 120 urls.
    expect(out.fullResultPath).toBe(join(dir, '.verify.json'));
    expect(existsSync(join(dir, '.verify.json'))).toBe(true);
    const full = JSON.parse(readFileSync(join(dir, '.verify.json'), 'utf8'));
    expect((full.staleCdnUrls as unknown[]).length).toBe(120);
  });

  it('returns small reports inline with no truncation markers or sidecar', async () => {
    writeWxrWithNContentCdnUrls(2);
    writeFileSync(join(dir, 'extraction-log.jsonl'), '');

    const res = await verifyHandler({ outputDir: dir }, makeCtx());
    const out = parse(res);
    expect((out.staleCdnUrls as unknown[]).length).toBe(2);
    expect(out.staleCdnUrlsTruncated).toBeUndefined();
    expect(out.fullResultPath).toBeUndefined();
    expect(existsSync(join(dir, '.verify.json'))).toBe(false);
  });
});
