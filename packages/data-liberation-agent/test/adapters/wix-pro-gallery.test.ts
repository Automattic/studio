import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isExecutionContextDestroyed,
  extractGalleryFromHtml,
  ROUTE_PIN_INIT_SCRIPT,
} from '../../src/adapters/wix/index.js';

// ---------------------------------------------------------------------------
// Pro Gallery resilience: detecting the destroyed-context error so the
// in-page evaluate can be retried (vs. propagating to the HTML fallback).
// ---------------------------------------------------------------------------

describe('isExecutionContextDestroyed', () => {
  it('matches the Playwright phrasing (the real /projects failure)', () => {
    expect(
      isExecutionContextDestroyed(
        new Error(
          'page.evaluate: Execution context was destroyed, most likely because of a navigation'
        )
      )
    ).toBe(true);
  });

  it('matches the bare CDP phrasing and string inputs', () => {
    expect(isExecutionContextDestroyed('Execution context was destroyed.')).toBe(true);
    expect(isExecutionContextDestroyed(new Error('context was destroyed'))).toBe(true);
    expect(
      isExecutionContextDestroyed(new Error('Evaluation failed because of a navigation'))
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isExecutionContextDestroyed(new Error('EXECUTION CONTEXT WAS DESTROYED'))).toBe(true);
  });

  it('does NOT match unrelated errors (so they propagate, not falsely retry)', () => {
    expect(isExecutionContextDestroyed(new Error('Timeout 30000ms exceeded'))).toBe(false);
    expect(isExecutionContextDestroyed(new Error('net::ERR_CONNECTION_REFUSED'))).toBe(false);
    expect(isExecutionContextDestroyed(new Error('TypeError: x is not a function'))).toBe(false);
    expect(isExecutionContextDestroyed(null)).toBe(false);
    expect(isExecutionContextDestroyed(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Route-pin init script shape (best-effort guard against the hydration
// navigation that destroys the context).
// ---------------------------------------------------------------------------

describe('ROUTE_PIN_INIT_SCRIPT', () => {
  it('no-ops history pushState/replaceState and is wrapped defensively', () => {
    expect(ROUTE_PIN_INIT_SCRIPT).toContain('history.pushState');
    expect(ROUTE_PIN_INIT_SCRIPT).toContain('history.replaceState');
    // Self-invoking + try/catch so a hostile page can't break our init.
    expect(ROUTE_PIN_INIT_SCRIPT).toMatch(/\(function\s*\(\)/);
    expect(ROUTE_PIN_INIT_SCRIPT).toContain('try');
  });

  it('is valid JS (parses without error)', () => {
    // Constructing a Function from it would throw on a syntax error.
    expect(() => new Function(ROUTE_PIN_INIT_SCRIPT)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Served-HTML fallback: recover gallery images + title/content from the
// plain-GET markup when the live evaluate path can't run.
// ---------------------------------------------------------------------------

describe('extractGalleryFromHtml', () => {
  const html = readFileSync(
    join(process.cwd(), 'test/fixtures/wix-pro-gallery.html'),
    'utf8'
  );

  it('recovers the gallery image URLs (img src, background, og:image, warmup tokens)', () => {
    const { mediaUrls } = extractGalleryFromHtml(html);
    expect(mediaUrls.length).toBeGreaterThanOrEqual(5);
    // Full <img> src URLs survive.
    expect(
      mediaUrls.some((u) => u.includes('53bc4c_4d3d0dc2ee424775938cea9be55827ed'))
    ).toBe(true);
    // background-image url() is captured.
    expect(
      mediaUrls.some((u) => u.includes('53bc4c_d45de85dc57342b4b1ddfaa7fed0694b'))
    ).toBe(true);
    // Bare warmup tokens are promoted to canonical CDN URLs.
    const promoted = mediaUrls.find((u) =>
      u.includes('53bc4c_1ecf24eca6ca467e9554dd2c0e10a924')
    );
    expect(promoted).toBe(
      'https://static.wixstatic.com/media/53bc4c_1ecf24eca6ca467e9554dd2c0e10a924~mv2.png'
    );
  });

  it('every recovered URL is an absolute static.wixstatic.com media URL', () => {
    const { mediaUrls } = extractGalleryFromHtml(html);
    for (const u of mediaUrls) {
      expect(u).toMatch(/^https:\/\/static\.wixstatic\.com\/media\//);
    }
  });

  it('de-dupes a resized variant and its bare token to one entry', () => {
    const { mediaUrls } = extractGalleryFromHtml(html);
    // e20b04_b22aa... appears both as a full og:image URL and would appear as
    // a token — only one entry should survive for that asset.
    const matches = mediaUrls.filter((u) =>
      u.includes('e20b04_b22aa506b78b4d26806e380b04354329')
    );
    expect(matches.length).toBe(1);
  });

  it('recovers the page title with the " | Site Name" suffix stripped', () => {
    const { title } = extractGalleryFromHtml(html);
    expect(title).toBe('GALLERY');
  });

  it('recovers a content shell from og:description + headings', () => {
    const { content } = extractGalleryFromHtml(html);
    expect(content).toContain('Showcase of Swift Lumber projects');
    expect(content).toContain('<h1>GALLERY</h1>');
  });

  it('returns empty results for markup with no gallery data (no false positives)', () => {
    const { title, content, mediaUrls } = extractGalleryFromHtml(
      '<html><head><title>Plain</title></head><body><p>hi</p></body></html>'
    );
    expect(mediaUrls).toEqual([]);
    expect(title).toBe('Plain');
    expect(content).toBe('');
  });
});
