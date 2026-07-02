import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { verifyExtraction, type VerificationReport } from './verify.js';

const TMP = join(import.meta.dirname, '__test_verify__');

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
  mkdirSync(join(TMP, 'media'), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function writeMinimalWxr(content: string = '<p>Hello</p>'): void {
  const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:wp="http://wordpress.org/export/1.2/"
     xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/">
<channel>
  <title>Test</title>
  <wp:wxr_version>1.2</wp:wxr_version>
  <item>
    <title>Page One</title>
    <wp:post_type><![CDATA[page]]></wp:post_type>
    <content:encoded><![CDATA[${content}]]></content:encoded>
  </item>
</channel>
</rss>`;
  writeFileSync(join(TMP, 'output.wxr'), wxr);
}

function writeLog(lines: object[]): void {
  writeFileSync(
    join(TMP, 'extraction-log.jsonl'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  );
}

function writeRedirectMap(redirects: Array<{ from: string; to: string }>): void {
  writeFileSync(join(TMP, 'redirect-map.json'), JSON.stringify(redirects, null, 2));
}

function writeMediaStubs(stubs: Record<string, { status: string; localPath?: string }>): void {
  writeFileSync(
    join(TMP, 'media-stubs.json'),
    JSON.stringify({ version: 1, stubs }, null, 2)
  );
}

/**
 * Build a WXR where one CDN URL appears BOTH as an attachment_url (provenance)
 * and inside content (an <img src>) — the exact double-occurrence shape that the
 * old whole-WXR scan over-counted. The host is generic Squarespace CDN infra
 * (the incident platform); the path segments are synthetic, not site data.
 */
function writeWxrWithAttachmentAndContent(cdnUrl: string, includeInContent: boolean): void {
  const wxr = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
  <title>Test</title>
  <wp:wxr_version>1.2</wp:wxr_version>
  <item>
    <title>Photo</title>
    <wp:post_type>attachment</wp:post_type>
    <wp:attachment_url><![CDATA[${cdnUrl}]]></wp:attachment_url>
  </item>
  <item>
    <title>Page One</title>
    <wp:post_type>page</wp:post_type>
    <content:encoded><![CDATA[<p>Body${includeInContent ? ` <img src="${cdnUrl}" />` : ''}</p>]]></content:encoded>
  </item>
</channel>
</rss>`;
  writeFileSync(join(TMP, 'output.wxr'), wxr);
}

describe('verifyExtraction', () => {
  it('returns clean report for valid extraction', async () => {
    writeMinimalWxr();
    writeLog([
      { type: 'processed', url: 'https://example.com/', slug: 'homepage', durationMs: 500, qualityScore: 'high' },
    ]);
    writeRedirectMap([{ from: '/', to: '/homepage' }]);

    const report = await verifyExtraction(TMP);

    expect(report.outputDir).toBe(TMP);
    expect(report.wxrFound).toBe(true);
    expect(report.contentItems).toBeGreaterThan(0);
    expect(report.staleCdnUrls).toEqual([]);
    expect(report.failedUrls).toEqual([]);
    expect(report.failedMedia).toEqual([]);
    expect(report.redirectCount).toBe(1);
  });

  it('detects stale Wix CDN URLs in content', async () => {
    writeMinimalWxr('<p>Image: <img src="https://static.wixstatic.com/media/abc.jpg" /></p>');
    writeLog([
      { type: 'processed', url: 'https://example.com/', slug: 'homepage', durationMs: 500, qualityScore: 'high' },
    ]);

    const report = await verifyExtraction(TMP);
    expect(report.staleCdnUrls.length).toBe(1);
    expect(report.staleCdnUrls[0]).toContain('wixstatic.com');
  });

  it('detects stale Squarespace CDN URLs in content', async () => {
    writeMinimalWxr('<img src="https://images.squarespace-cdn.com/content/v1/abc/def.jpg" />');
    writeLog([]);

    const report = await verifyExtraction(TMP);
    expect(report.staleCdnUrls.length).toBe(1);
    expect(report.staleCdnUrls[0]).toContain('squarespace-cdn.com');
  });

  it('routes a content CDN URL WITH a success stub to downloaded-not-rewritten, NOT staleCdnUrls', async () => {
    const cdn = 'https://images.squarespace-cdn.com/content/v1/test/hero.jpg';
    writeMinimalWxr(`<p>Image: <img src="${cdn}" /></p>`);
    writeLog([]);
    writeMediaStubs({ [cdn]: { status: 'success', localPath: 'media/hero.jpg' } });

    const report = await verifyExtraction(TMP);
    expect(report.cdnInContentDownloadedNotRewritten).toEqual([cdn]);
    expect(report.cdnInContentNoLocalCopy).toEqual([]);
    expect(report.staleCdnUrls).toEqual([]);
    // Wording: the downloaded-not-rewritten item must say it's NOT a breakage risk.
    expect(report.manualAttentionItems.join('\n')).toContain('not a breakage risk');
    expect(report.manualAttentionItems.join('\n')).not.toMatch(/may break/);
  });

  it('routes a content CDN URL with NO stub to staleCdnUrls (genuine risk)', async () => {
    const cdn = 'https://images.squarespace-cdn.com/content/v1/test/orphan.jpg';
    writeMinimalWxr(`<p>Image: <img src="${cdn}" /></p>`);
    writeLog([]);
    // A success stub for a DIFFERENT url — the content url has no local copy.
    writeMediaStubs({ 'https://images.squarespace-cdn.com/content/v1/test/other.jpg': { status: 'success' } });

    const report = await verifyExtraction(TMP);
    expect(report.cdnInContentNoLocalCopy).toEqual([cdn]);
    expect(report.staleCdnUrls).toEqual([cdn]);
    expect(report.cdnInContentDownloadedNotRewritten).toEqual([]);
    expect(report.manualAttentionItems.join('\n')).toContain('may break');
  });

  it('does NOT flag a CDN URL that appears ONLY as attachment_url (not in content)', async () => {
    const cdn = 'https://images.squarespace-cdn.com/content/v1/test/provenance.jpg';
    // Same URL as attachment_url provenance, but NOT referenced in any content body.
    writeWxrWithAttachmentAndContent(cdn, /* includeInContent */ false);
    writeLog([]);
    writeMediaStubs({ [cdn]: { status: 'success', localPath: 'media/provenance.jpg' } });

    const report = await verifyExtraction(TMP);
    expect(report.staleCdnUrls).toEqual([]);
    expect(report.cdnInContentNoLocalCopy).toEqual([]);
    expect(report.cdnInContentDownloadedNotRewritten).toEqual([]);
  });

  it('a downloaded image present BOTH as attachment_url and in content is rewrite-gap, not stale', async () => {
    // The reported incident: 380 URLs each appeared twice (attachment_url +
    // content img). The whole-WXR scan flagged all 380 as "may break". With the
    // content-only scan + stub cross-ref, a downloaded copy lands in the
    // not-a-risk bucket and staleCdnUrls is empty.
    const cdn = 'https://images.squarespace-cdn.com/content/v1/test/double.jpg';
    writeWxrWithAttachmentAndContent(cdn, /* includeInContent */ true);
    writeLog([]);
    writeMediaStubs({ [cdn]: { status: 'success', localPath: 'media/double.jpg' } });

    const report = await verifyExtraction(TMP);
    expect(report.staleCdnUrls).toEqual([]);
    expect(report.cdnInContentDownloadedNotRewritten).toEqual([cdn]);
  });

  it('degrades gracefully when media-stubs.json is absent (legacy run) — content CDN url treated as stale', async () => {
    const cdn = 'https://images.squarespace-cdn.com/content/v1/test/legacy.jpg';
    writeMinimalWxr(`<p><img src="${cdn}" /></p>`);
    writeLog([]);
    // No media-stubs.json written.

    const report = await verifyExtraction(TMP);
    expect(report.staleCdnUrls).toEqual([cdn]);
    expect(report.cdnInContentNoLocalCopy).toEqual([cdn]);
    expect(report.cdnInContentDownloadedNotRewritten).toEqual([]);
  });

  it('reports failed URLs from extraction log', async () => {
    writeMinimalWxr();
    writeLog([
      { type: 'processed', url: 'https://example.com/', slug: 'homepage', durationMs: 500, qualityScore: 'high' },
      { type: 'failed', url: 'https://example.com/broken', error: 'Timeout' },
    ]);

    const report = await verifyExtraction(TMP);
    expect(report.failedUrls).toEqual([
      { url: 'https://example.com/broken', error: 'Timeout' },
    ]);
  });

  it('reports failed media downloads', async () => {
    writeMinimalWxr();
    writeLog([
      { type: 'media_failed', url: 'https://cdn.example.com/img.jpg', error: '404' },
    ]);

    const report = await verifyExtraction(TMP);
    expect(report.failedMedia).toEqual([
      { url: 'https://cdn.example.com/img.jpg', error: '404' },
    ]);
  });

  it('counts media files on disk', async () => {
    writeMinimalWxr();
    writeLog([]);
    writeFileSync(join(TMP, 'media', 'photo.jpg'), 'fake');

    const report = await verifyExtraction(TMP);
    expect(report.mediaOnDisk).toBe(1);
  });

  it('counts post_type items in the PLAIN-text WXR form (not just CDATA-wrapped)', async () => {
    // The WXR builder emits <wp:post_type>page</wp:post_type> (no CDATA); the
    // counter must match both forms or it reports 0 on real output.
    const wxr = `<?xml version="1.0"?>
<rss xmlns:wp="http://wordpress.org/export/1.2/"><channel>
  <item><wp:post_type>page</wp:post_type></item>
  <item><wp:post_type>page</wp:post_type></item>
  <item><wp:post_type>attachment</wp:post_type></item>
  <item><wp:post_type><![CDATA[post]]></wp:post_type></item>
</channel></rss>`;
    writeFileSync(join(TMP, 'output.wxr'), wxr);
    writeLog([]);
    const report = await verifyExtraction(TMP);
    expect(report.pages).toBe(2);
    expect(report.mediaAttachments).toBe(1);
    expect(report.posts).toBe(1);
  });

  it('reports missing WXR gracefully', async () => {
    writeLog([]);

    const report = await verifyExtraction(TMP);
    expect(report.wxrFound).toBe(false);
    expect(report.contentItems).toBe(0);
  });

  it('includes quality score breakdown', async () => {
    writeMinimalWxr();
    writeLog([
      { type: 'processed', url: 'https://example.com/a', slug: 'a', qualityScore: 'high' },
      { type: 'processed', url: 'https://example.com/b', slug: 'b', qualityScore: 'medium' },
      { type: 'processed', url: 'https://example.com/c', slug: 'c', qualityScore: 'low' },
    ]);

    const report = await verifyExtraction(TMP);
    expect(report.qualityScores).toEqual({ high: 1, medium: 1, low: 1 });
  });
});
