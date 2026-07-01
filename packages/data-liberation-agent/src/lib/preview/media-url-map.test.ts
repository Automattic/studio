import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMediaUrlMap, rewriteWxrAttachmentUrls } from './media-url-map.js';

describe('buildMediaUrlMap', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dla-map-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns empty map when extraction-log.jsonl is missing', () => {
    expect(buildMediaUrlMap(dir).size).toBe(0);
  });

  it('extracts url → basename(localPath) from media_downloaded events', () => {
    writeFileSync(join(dir, 'extraction-log.jsonl'), [
      JSON.stringify({ type: 'media_downloaded', url: 'https://cdn.example.com/a.jpg', localPath: '/abs/media/a.jpg', error: null }),
      JSON.stringify({ type: 'processed', url: 'https://example.com/post', slug: 'post', durationMs: 100 }),
      JSON.stringify({ type: 'media_downloaded', url: 'https://cdn.example.com/collides.jpg', localPath: '/abs/media/collides-2.jpg', error: null }),
    ].join('\n'));
    const m = buildMediaUrlMap(dir);
    expect(m.get('https://cdn.example.com/a.jpg')).toBe('a.jpg');
    expect(m.get('https://cdn.example.com/collides.jpg')).toBe('collides-2.jpg');
    expect(m.size).toBe(2);
  });

  it('skips entries with errors or missing localPath', () => {
    writeFileSync(join(dir, 'extraction-log.jsonl'),
      JSON.stringify({ type: 'media_downloaded', url: 'https://cdn/broken.jpg', localPath: null, error: '404' }) + '\n' +
      JSON.stringify({ type: 'media_downloaded', url: 'https://cdn/errored.jpg', localPath: '/abs/media/errored.jpg', error: 'timeout' })
    );
    expect(buildMediaUrlMap(dir).size).toBe(0);
  });
});

describe('rewriteWxrAttachmentUrls', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dla-rewrite-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('replaces only URLs present in the map', () => {
    const wxrPath = join(dir, 'test.wxr');
    writeFileSync(wxrPath,
      '<rss><channel>\n' +
      '<item><wp:attachment_url><![CDATA[https://cdn/a.jpg]]></wp:attachment_url></item>\n' +
      '<item><wp:attachment_url><![CDATA[https://cdn/unknown.jpg]]></wp:attachment_url></item>\n' +
      '</channel></rss>'
    );
    const map = new Map([['https://cdn/a.jpg', 'a.jpg']]);
    const n = rewriteWxrAttachmentUrls(wxrPath, map, 'http://localhost:8881/wp-content/uploads/liberation');
    expect(n).toBe(1);
    const out = readFileSync(wxrPath, 'utf8');
    expect(out).toContain('<![CDATA[http://localhost:8881/wp-content/uploads/liberation/a.jpg]]>');
    expect(out).toContain('<![CDATA[https://cdn/unknown.jpg]]>');
  });

  it('no-ops when the map is empty', () => {
    const wxrPath = join(dir, 'test.wxr');
    const xml = '<item><wp:attachment_url><![CDATA[https://cdn/a.jpg]]></wp:attachment_url></item>';
    writeFileSync(wxrPath, xml);
    expect(rewriteWxrAttachmentUrls(wxrPath, new Map(), 'http://localhost:8881/x')).toBe(0);
    expect(readFileSync(wxrPath, 'utf8')).toBe(xml);
  });

  it('preserves HTML-entity-encoded ampersands in URL keys', () => {
    const wxrPath = join(dir, 'test.wxr');
    writeFileSync(wxrPath,
      '<item><wp:attachment_url><![CDATA[https://cdn/file.jpg?v=1&amp;w=820]]></wp:attachment_url></item>'
    );
    const map = new Map([['https://cdn/file.jpg?v=1&amp;w=820', 'file.jpg']]);
    const n = rewriteWxrAttachmentUrls(wxrPath, map, 'http://localhost:8881/x');
    expect(n).toBe(1);
    expect(readFileSync(wxrPath, 'utf8')).toContain('http://localhost:8881/x/file.jpg');
  });
});
