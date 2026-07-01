import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { WxrBuilder } from '../src/lib/wxr/index.js';
import { runQa } from '../src/lib/qa/qa-runner.js';

function buildWxr(
  pages: Array<{ title: string; slug: string; content: string; sourceUrl?: string }>,
): string {
  const builder = new WxrBuilder({ title: 'Test', url: 'https://example.com' });
  for (const p of pages) {
    builder.addPage(p);
  }
  const dir = mkdtempSync(join(tmpdir(), 'qa-test-'));
  const wxrPath = join(dir, 'export.wxr');
  builder.serialize(wxrPath);
  return wxrPath;
}

function mockFetchOk(html: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(html),
  });
}

function mockFetchFail(message: string) {
  return vi.fn().mockRejectedValue(new Error(message));
}

describe('runQa', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports pass for matching content', async () => {
    const html = '<h1>Hello</h1><p>World of testing</p>';
    vi.stubGlobal('fetch', mockFetchOk(html));

    const wxrPath = buildWxr([
      { title: 'Test Page', slug: 'test', content: html, sourceUrl: 'https://origin.com/test' },
    ]);

    const result = await runQa({ wxrFile: wxrPath });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].grade).toBe('pass');
    expect(result.pages[0].slug).toBe('test');
    expect(result.summary.pass).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('reports fail for missing content', async () => {
    const originHtml =
      '<h1>Title</h1><p>Origin text with many words that differ completely from target</p>' +
      '<img src="https://cdn.example.com/photo.jpg" alt="Photo">' +
      '<a href="https://example.com/link">Link</a>';
    const wxrContent = '<p>Totally different sparse content</p>';

    vi.stubGlobal('fetch', mockFetchOk(originHtml));

    const wxrPath = buildWxr([
      { title: 'Test', slug: 'missing', content: wxrContent, sourceUrl: 'https://origin.com/page' },
    ]);

    const result = await runQa({ wxrFile: wxrPath });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].grade).toBe('fail');
    expect(result.summary.fail).toBe(1);
  });

  it('skips pages without sourceUrl', async () => {
    vi.stubGlobal('fetch', mockFetchOk('<p>Hello</p>'));

    const wxrPath = buildWxr([
      { title: 'Has URL', slug: 'has-url', content: '<p>Hi</p>', sourceUrl: 'https://origin.com/a' },
      { title: 'No URL', slug: 'no-url', content: '<p>Hi</p>' },
    ]);

    const result = await runQa({ wxrFile: wxrPath });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].slug).toBe('has-url');
    expect(result.skipped).toBe(1);
  });

  it('handles fetch failure gracefully', async () => {
    vi.stubGlobal('fetch', mockFetchFail('Network error'));

    const wxrPath = buildWxr([
      { title: 'Test', slug: 'err', content: '<p>Hi</p>', sourceUrl: 'https://origin.com/fail' },
    ]);

    const result = await runQa({ wxrFile: wxrPath });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].grade).toBe('error');
    expect(result.pages[0].error).toBe('Network error');
    expect(result.summary.error).toBe(1);
  });

  it('patches WXR to fix missing image alt text', async () => {
    // WXR content: image without alt text, missing a link that origin has
    const wxrContent =
      '<h1>Gallery</h1><p>Photos below</p><img src="https://cdn.example.com/photo.jpg">';
    // Origin: same image WITH alt text, plus extra links to push grade to warn/fail
    const originHtml =
      '<h1>Gallery</h1><p>Photos below</p>' +
      '<img src="https://cdn.example.com/photo.jpg" alt="Sunset over the lake">' +
      '<a href="https://example.com/one">One</a>' +
      '<a href="https://example.com/two">Two</a>' +
      '<a href="https://example.com/three">Three</a>' +
      '<a href="https://example.com/four">Four</a>' +
      '<a href="https://example.com/five">Five</a>' +
      '<a href="https://example.com/six">Six</a>';

    vi.stubGlobal('fetch', mockFetchOk(originHtml));

    const wxrPath = buildWxr([
      {
        title: 'Gallery',
        slug: 'gallery',
        content: wxrContent,
        sourceUrl: 'https://origin.com/gallery',
      },
    ]);

    const result = await runQa({ wxrFile: wxrPath, fix: true });

    expect(result.summary.fixed).toBe(1);
    expect(result.pages[0].fixed).toContain('added alt text to photo.jpg');

    // Re-read the WXR and verify the image now has alt text
    const { readWxr } = await import('../src/lib/wxr/index.js');
    const patched = readWxr(wxrPath);
    const page = patched.items.find(
      (i) => i.type === 'page' && i.slug === 'gallery',
    ) as { content: string };
    expect(page.content).toContain('alt="Sunset over the lake"');
  });

  it('writes qa-log.jsonl alongside the WXR', async () => {
    const html = '<h1>Hello</h1><p>World</p>';
    vi.stubGlobal('fetch', mockFetchOk(html));

    const wxrPath = buildWxr([
      { title: 'Test', slug: 'logged', content: html, sourceUrl: 'https://origin.com/log' },
    ]);

    await runQa({ wxrFile: wxrPath });

    const logPath = join(dirname(wxrPath), 'qa-log.jsonl');
    expect(existsSync(logPath)).toBe(true);

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.slug).toBe('logged');
    expect(entry.grade).toBe('pass');
  });
});
