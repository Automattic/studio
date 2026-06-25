// Tests for T12 flag plumbing: --html-first and --include-scripts.
//
// These tests exercise the same parsing logic that cli.ts uses in the
// default-extract (else) branch, and verify that WatchOpts accepts both
// new fields and that ScreenshotResult now carries headLinks + siteJsText.
import { describe, it, expect } from 'vitest';
import type { WatchOpts } from './watch-runner.js';
import type { ScreenshotResult } from '../lib/screenshot/types.js';

// ---------------------------------------------------------------------------
// Helper: replicate cli.ts arg parsing for the flags under test.
// ---------------------------------------------------------------------------
function parseExtractFlags(args: string[]): {
  captureDesign: boolean;
  includeScripts: boolean;
} {
  // html-first is the DEFAULT; --no-html-first opts out to the legacy recompose path.
  const captureDesign = !args.includes('--no-html-first');
  const includeScripts = args.includes('--include-scripts');
  return { captureDesign, includeScripts };
}

// ---------------------------------------------------------------------------
// CLI flag → WatchOpts plumbing
// ---------------------------------------------------------------------------
describe('CLI flag parsing: html-first default + --include-scripts', () => {
  it('defaults to html-first (captureDesign: true) with no flags', () => {
    const { captureDesign, includeScripts } = parseExtractFlags([
      'https://example.com',
    ]);
    expect(captureDesign).toBe(true);
    expect(includeScripts).toBe(false);
  });

  it('--no-html-first opts out → captureDesign: false', () => {
    const { captureDesign } = parseExtractFlags([
      'https://example.com',
      '--no-html-first',
    ]);
    expect(captureDesign).toBe(false);
  });

  it('--include-scripts → includeScripts: true (html-first still the default)', () => {
    const { captureDesign, includeScripts } = parseExtractFlags([
      'https://example.com',
      '--include-scripts',
    ]);
    expect(captureDesign).toBe(true);
    expect(includeScripts).toBe(true);
  });

  it('--no-html-first + --include-scripts → captureDesign false, includeScripts true (JS is then a no-op)', () => {
    const { captureDesign, includeScripts } = parseExtractFlags([
      'https://example.com',
      '--no-html-first',
      '--include-scripts',
    ]);
    expect(captureDesign).toBe(false);
    expect(includeScripts).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Type-level verification: WatchOpts accepts captureDesign + includeScripts
// (TypeScript will catch mismatches at compile time)
// ---------------------------------------------------------------------------
describe('WatchOpts type: captureDesign and includeScripts fields', () => {
  it('WatchOpts accepts captureDesign=true and includeScripts=true', () => {
    // This is a compile-time type check expressed as a runtime no-op.
    // If the fields are missing from WatchOpts the TypeScript build fails.
    const opts: Partial<WatchOpts> = {
      captureDesign: true,
      includeScripts: true,
    };
    expect(opts.captureDesign).toBe(true);
    expect(opts.includeScripts).toBe(true);
  });

  it('WatchOpts captureDesign and includeScripts default to undefined (optional)', () => {
    const opts: Partial<WatchOpts> = {};
    expect(opts.captureDesign).toBeUndefined();
    expect(opts.includeScripts).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Type-level verification: ScreenshotResult now carries headLinks + siteJsText
// ---------------------------------------------------------------------------
describe('ScreenshotResult type: headLinks and siteJsText fields', () => {
  it('ScreenshotResult accepts headLinks and siteJsText', () => {
    const result: ScreenshotResult = {
      captured: 3,
      skipped: 0,
      failed: 0,
      browserRestarts: 0,
      durationMs: 500,
      manifestPath: '/tmp/manifest.json',
      siteCssPath: '/tmp/site.css',
      cssMediaUrls: ['https://fonts.gstatic.com/a.woff2'],
      headLinks: ['https://fonts.googleapis.com/css?family=Inter'],
      siteJsText: 'console.log("hello");',
    };
    expect(result.headLinks).toHaveLength(1);
    expect(result.siteJsText).toBe('console.log("hello");');
  });

  it('ScreenshotResult headLinks and siteJsText are optional', () => {
    const result: ScreenshotResult = {
      captured: 0,
      skipped: 0,
      failed: 0,
      browserRestarts: 0,
      durationMs: 0,
      manifestPath: '/tmp/manifest.json',
    };
    expect(result.headLinks).toBeUndefined();
    expect(result.siteJsText).toBeUndefined();
  });
});
