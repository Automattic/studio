import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { blockComposeHandler } from './block-compose.js';
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

function readResult(r: ToolResult): { isError?: boolean; data?: Record<string, unknown>; text?: string } {
  if (r.isError) return { isError: true, text: r.content[0]?.text };
  return {
    data: (r as { structured?: Record<string, unknown> }).structured ?? undefined,
    text: r.content[0]?.text,
  };
}

const VALID_BLOCKS = '<!-- wp:paragraph --><p>About us at example.</p><!-- /wp:paragraph -->';

describe('blockComposeHandler', () => {
  it('rejects calls missing required args', async () => {
    const result = await blockComposeHandler({}, makeCtx());
    expect(result.isError).toBe(true);
  });

  it('rejects malformed block markup (mismatched close)', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'compose-'));
    const result = await blockComposeHandler(
      {
        outputDir: dir,
        url: 'https://example.com/about',
        slug: 'about',
        blocks: '<!-- wp:paragraph --><p>Hi</p><!-- /wp:heading -->',
      },
      makeCtx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('roundtrip');
  });

  it('rejects empty markup', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'compose-'));
    const result = await blockComposeHandler(
      {
        outputDir: dir,
        url: 'https://example.com/x',
        slug: 'x',
        blocks: '   ',
      },
      makeCtx(),
    );
    expect(result.isError).toBe(true);
  });

  it('rejects Custom HTML blocks even when the text is source-grounded', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'compose-'));
    const result = await blockComposeHandler(
      {
        outputDir: dir,
        url: 'https://example.com/about',
        slug: 'about',
        blocks: '<!-- wp:html --><div>About us at example.</div><!-- /wp:html -->',
        sourceHtml: '<html><body><p>About us at example.</p></body></html>',
      },
      makeCtx(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Custom HTML');
    expect(existsSync(join(dir, 'composed', 'about.blocks.html'))).toBe(false);
  });

  it('writes the sidecar at <outputDir>/composed/<slug>.blocks.html on valid input', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'compose-'));
    const result = await blockComposeHandler(
      {
        outputDir: dir,
        url: 'https://example.com/about',
        slug: 'about',
        blocks: VALID_BLOCKS,
        // sourceHtml omitted — output-verify falls back to manifest, which doesn't exist → skipped
      },
      makeCtx(),
    );
    expect(result.isError).toBeUndefined();
    const sidecar = join(dir, 'composed', 'about.blocks.html');
    expect(existsSync(sidecar)).toBe(true);
    expect(readFileSync(sidecar, 'utf8')).toBe(VALID_BLOCKS);
    const parsed = readResult(result);
    expect(parsed.data?.composedPath).toBe(sidecar);
    expect(parsed.data?.blocksCount).toBe(1);
  });

  it('appends a block-transform-log entry on success', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'compose-'));
    await blockComposeHandler(
      {
        outputDir: dir,
        url: 'https://example.com/about',
        slug: 'about',
        blocks: VALID_BLOCKS,
      },
      makeCtx(),
    );
    const log = readFileSync(join(dir, 'block-transform-log.jsonl'), 'utf8');
    const lines = log.trim().split('\n');
    // header + 1 entry
    expect(lines.length).toBe(2);
    const entry = JSON.parse(lines[1]);
    expect(entry.url).toBe('https://example.com/about');
    expect(entry.slug).toBe('about');
    expect(entry.blocksCount).toBe(1);
    expect(entry.composedBy).toBe('compose-page-blocks@v1.0');
  });

  it('verifies output against sourceHtml — rejects markup with hallucinated text', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'compose-'));
    const sourceHtml = '<html><body><p>Welcome to our site</p></body></html>';
    const blocksWithHallucination =
      '<!-- wp:paragraph --><p>This text is totally not in the source HTML at all.</p><!-- /wp:paragraph -->';
    const result = await blockComposeHandler(
      {
        outputDir: dir,
        url: 'https://example.com/x',
        slug: 'x',
        blocks: blocksWithHallucination,
        sourceHtml,
      },
      makeCtx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('verification failed');
    // No sidecar written when validation fails.
    expect(existsSync(join(dir, 'composed', 'x.blocks.html'))).toBe(false);
  });

  it('reads sourceHtml from screenshot manifest when not passed explicitly', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'compose-'));
    // Stage a manifest pointing at an html file with text matching VALID_BLOCKS.
    const screenshotsDir = join(dir, 'screenshots');
    const htmlDir = join(dir, 'html');
    mkdirSync(screenshotsDir, { recursive: true });
    mkdirSync(htmlDir, { recursive: true });
    writeFileSync(
      join(htmlDir, 'about.html'),
      '<html><body><p>About us at example.</p></body></html>',
      'utf8',
    );
    writeFileSync(
      join(screenshotsDir, 'manifest.json'),
      JSON.stringify({
        entries: {
          'https://example.com/about': { html: 'html/about.html' },
        },
      }),
      'utf8',
    );
    const result = await blockComposeHandler(
      {
        outputDir: dir,
        url: 'https://example.com/about',
        slug: 'about',
        blocks: VALID_BLOCKS,
      },
      makeCtx(),
    );
    expect(result.isError).toBeUndefined();
  });

  it('idempotent — second call with identical input is skipped (no double-write)', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'compose-'));
    const args = {
      outputDir: dir,
      url: 'https://example.com/about',
      slug: 'about',
      blocks: VALID_BLOCKS,
    };
    const first = await blockComposeHandler(args, makeCtx());
    expect(first.isError).toBeUndefined();
    const log1 = readFileSync(join(dir, 'block-transform-log.jsonl'), 'utf8');

    const second = await blockComposeHandler(args, makeCtx());
    expect(second.isError).toBeUndefined();
    const parsed = readResult(second);
    expect(parsed.data?.skipped).toBe(true);

    const log2 = readFileSync(join(dir, 'block-transform-log.jsonl'), 'utf8');
    // Log unchanged on idempotent skip.
    expect(log2).toBe(log1);
  });

  it('re-composing different markup for same URL writes a new sidecar and logs again', async () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'compose-'));
    const sourceHtml = '<html><body><p>About us at example.</p><p>Second pass content here.</p></body></html>';
    const v1 = VALID_BLOCKS;
    const v2 = '<!-- wp:paragraph --><p>Second pass content here.</p><!-- /wp:paragraph -->';
    await blockComposeHandler(
      { outputDir: dir, url: 'https://example.com/about', slug: 'about', blocks: v1, sourceHtml },
      makeCtx(),
    );
    await blockComposeHandler(
      { outputDir: dir, url: 'https://example.com/about', slug: 'about', blocks: v2, sourceHtml },
      makeCtx(),
    );
    const sidecar = readFileSync(join(dir, 'composed', 'about.blocks.html'), 'utf8');
    expect(sidecar).toBe(v2);
    // Two entries in the log (header + 2).
    const log = readFileSync(join(dir, 'block-transform-log.jsonl'), 'utf8').trim().split('\n');
    expect(log.length).toBe(3);
  });
});
