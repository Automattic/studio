import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { blockTransformApplyHandler } from './block-transform-apply.js';
import { appendTransform } from '../../lib/streaming/block-transform-log.js';
import type { HandlerContext, ToolResult } from '../handler-types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

function makeCtx(): HandlerContext {
  return {
    adapters: [],
    findAdapter: () => null,
    textResult: (data: unknown): ToolResult => ({
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structured: data,
    }),
    errorResult: (message: string): ToolResult => ({
      content: [{ type: 'text', text: message }],
      isError: true,
    }),
    server: {} as unknown as Server,
  };
}

function readResult(r: ToolResult): { isError?: boolean; data?: unknown; text?: string } {
  if (r.isError) return { isError: true, text: r.content[0]?.text };
  // Structured payload is on `structured` (set by makeCtx textResult above).
  return { data: (r as { structured?: unknown }).structured ?? null, text: r.content[0]?.text };
}

describe('blockTransformApplyHandler — validation and idempotency', () => {
  it('rejects calls missing required args', async () => {
    const ctx = makeCtx();
    const result = await blockTransformApplyHandler({}, ctx);
    expect(result.isError).toBe(true);
  });

  it('rejects malformed block markup that does not roundtrip (mismatched close)', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'apply-'));
    const ctx = makeCtx();
    const result = await blockTransformApplyHandler(
      {
        outputDir: dir,
        url: 'https://example.com/x',
        blocks: '<!-- wp:paragraph --><p>Hi</p><!-- /wp:heading -->',
      },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('roundtrip');
  });

  it('rejects markup with unclosed blocks', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'apply-'));
    const ctx = makeCtx();
    const result = await blockTransformApplyHandler(
      {
        outputDir: dir,
        url: 'https://example.com/x',
        blocks: '<!-- wp:paragraph --><p>Hi</p>',
      },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('unclosed');
  });

  it('rejects when output verification finds hallucinated text', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'apply-'));
    // Fake a manifest pointing to a source HTML file
    const htmlDir = join(dir, 'html');
    mkdirSync(htmlDir, { recursive: true });
    writeFileSync(join(htmlDir, 'about.html'), '<article><p>Foo Industries</p></article>');
    const screenshotsDir = join(dir, 'screenshots');
    mkdirSync(screenshotsDir, { recursive: true });
    writeFileSync(
      join(screenshotsDir, 'manifest.json'),
      JSON.stringify({
        entries: { 'https://example.com/about': { html: 'html/about.html' } },
      }),
    );
    const ctx = makeCtx();
    const result = await blockTransformApplyHandler(
      {
        outputDir: dir,
        url: 'https://example.com/about',
        blocks:
          '<!-- wp:paragraph --><p>Bar Inc</p><!-- /wp:paragraph -->',
        target: { kind: 'studio', studioSitePath: '/tmp/site' },
      },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('verification');
    expect(result.content[0].text).toContain('Bar Inc');
  });

  it('skips re-application when sourceHash + outputHash unchanged (idempotency)', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'apply-'));
    // Fake an existing log entry that matches the source + blocks we're about to send.
    // Source HTML for the URL:
    const htmlDir = join(dir, 'html');
    mkdirSync(htmlDir, { recursive: true });
    writeFileSync(join(htmlDir, 'about.html'), '<article><p>Hello world content</p></article>');
    mkdirSync(join(dir, 'screenshots'), { recursive: true });
    writeFileSync(
      join(dir, 'screenshots', 'manifest.json'),
      JSON.stringify({
        entries: { 'https://example.com/about': { html: 'html/about.html' } },
      }),
    );

    const blocks = '<!-- wp:paragraph -->\n<p>Hello world content</p>\n<!-- /wp:paragraph -->';

    // Compute the hashes the handler will compute and pre-seed the log.
    const { createHash } = await import('node:crypto');
    const sourceHtml = '<article><p>Hello world content</p></article>';
    const sourceHash = createHash('sha256').update(sourceHtml).digest('hex');
    const outputHash = createHash('sha256').update(blocks).digest('hex');
    appendTransform(dir, {
      url: 'https://example.com/about',
      slug: 'about',
      blocksCount: 1,
      transformedAt: '2026-04-29T00:00:00.000Z',
      source: 'heuristic',
      warnings: [],
      composedBy: 'compose-page-blocks@v1.0',
      sourceHash,
      outputHash,
    });

    const ctx = makeCtx();
    const result = await blockTransformApplyHandler(
      {
        outputDir: dir,
        url: 'https://example.com/about',
        blocks,
        target: { kind: 'studio', studioSitePath: '/tmp/site' },
      },
      ctx,
    );
    // Skip path: NOT an error, and tells caller skipped:true with reason.
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('skipped');
    expect(result.content[0].text).toContain('identical');
  });

  it('errors when studio target is selected without a studioSitePath', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'apply-'));
    const ctx = makeCtx();
    const result = await blockTransformApplyHandler(
      {
        outputDir: dir,
        url: 'https://example.com/x',
        blocks: '<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->',
        target: { kind: 'studio' },
      },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('studioSitePath');
  });
});
