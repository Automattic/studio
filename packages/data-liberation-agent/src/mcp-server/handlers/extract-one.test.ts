import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';

// Avoid the network call in extractOneHandler's platform detection and force a
// known platform so ctx.findAdapter resolves to our fake adapter.
vi.mock('../../lib/detect-platform/index.js', () => ({
  detect: vi.fn(async () => ({ platform: 'fake', confidence: 'high', signals: [] })),
}));

import { extractOneHandler } from './extract-one.js';
import { WxrBuilder } from '../../lib/wxr/index.js';
import { readWxr } from '../../lib/wxr/index.js';
import type { HandlerContext, ToolResult } from '../handler-types.js';
import type { PlatformAdapter } from '../../types.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

function tmp(): string {
  return mkdtempSync(join(FIXTURE_TMP, 'eo-'));
}

const SITE = 'https://example.com';

/** A fake adapter that "extracts" the target URL by appending one page. */
function makeAdapter(): PlatformAdapter {
  return {
    platform: 'fake',
    discover: async () => ({
      siteMeta: { title: 'Example', tagline: '', language: 'en-US' },
      urls: [{ url: `${SITE}/new`, type: 'page' }],
      navigation: [],
    }),
    extract: async (_inventory: unknown, wxr: WxrBuilder) => {
      wxr.addPage({ title: 'New Page', slug: 'new', content: '<p>new</p>', sourceUrl: `${SITE}/new` });
    },
  } as unknown as PlatformAdapter;
}

function makeCtx(adapter: PlatformAdapter): HandlerContext {
  return {
    adapters: [adapter],
    findAdapter: () => adapter,
    textResult: (data: unknown): ToolResult => ({
      content: [{ type: 'text', text: JSON.stringify(data) }],
    }),
    errorResult: (message: string): ToolResult => ({
      content: [{ type: 'text', text: message }],
      isError: true,
    }),
    server: {} as never,
  };
}

describe('extractOneHandler', () => {
  it('preserves prior WXR items when appending a single URL', async () => {
    const dir = tmp();
    const wxrPath = join(dir, 'output.wxr');

    // Pre-seed the output dir with a WXR holding three already-extracted pages,
    // as a prior full extraction would have produced.
    const seed = new WxrBuilder({ title: 'Example', url: SITE, language: 'en-US' });
    seed.addPage({ title: 'Home', slug: 'home', content: '<p>home</p>', sourceUrl: SITE });
    seed.addPage({ title: 'About', slug: 'about', content: '<p>about</p>', sourceUrl: `${SITE}/about` });
    seed.addPage({ title: 'Contact', slug: 'contact', content: '<p>c</p>', sourceUrl: `${SITE}/contact` });
    seed.serialize(wxrPath);

    const result = await extractOneHandler({ url: `${SITE}/new`, outputDir: dir }, makeCtx(makeAdapter()));
    expect(result.isError).toBeFalsy();

    // The single-URL extract must ADD to the WXR, not replace it: 3 prior + 1 new.
    const after = readWxr(wxrPath);
    const pages = after.items.filter((i) => i.type === 'page');
    expect(pages.map((p) => p.slug).sort()).toEqual(['about', 'contact', 'home', 'new']);
    expect(pages).toHaveLength(4);
  });
});
