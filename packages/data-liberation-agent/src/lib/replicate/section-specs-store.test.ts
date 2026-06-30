import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SectionSpecsStore, SECTION_SPECS_SCHEMA } from './section-specs-store.js';
import type { SectionSpec } from './section-extract.js';

const TMP_ROOT = join(process.cwd(), '.tmp-test', 'section-specs-store');
mkdirSync(TMP_ROOT, { recursive: true });

// Minimal valid spec — fictional content only (no source-site data).
function spec(partial: Partial<SectionSpec> = {}): SectionSpec {
  return {
    sectionIndex: 0,
    interactionModel: 'static',
    top: 0,
    height: 400,
    headings: ['Welcome'],
    bodyText: [],
    buttonLabels: [],
    images: [],
    icons: [],
    backgroundBrightness: 255,
    backgroundColor: 'rgb(255, 255, 255)',
    gradient: null,
    gradientSource: null,
    motionProfile: { motionClass: 'none', signals: [], animatedElements: 0 },
    dividerAbove: null,
    dividerBelow: null,
    layout: { containerWidth: 1200, padding: '0', childLayout: 'stack', columnCount: 1, gap: '0' },
    ...partial,
  } as SectionSpec;
}

describe('SectionSpecsStore', () => {
  it('round-trips specs for a URL (set → get returns the same sections)', () => {
    const dir = mkdtempSync(join(TMP_ROOT, 'out-'));
    try {
      const store = SectionSpecsStore.load(dir);
      const url = 'https://example.com/about';
      const sections = [spec({ headings: ['About'], fullBleed: true } as Partial<SectionSpec>), spec()];
      expect(store.get(url)).toBeNull(); // nothing yet
      store.set(url, sections, []);
      expect(store.has(url)).toBe(true);
      const got = store.get(url);
      expect(got).not.toBeNull();
      expect(got!.length).toBe(2);
      expect((got![0] as SectionSpec).headings).toEqual(['About']);
      expect((got![0] as { fullBleed?: boolean }).fullBleed).toBe(true);
      // File lives next to html/screenshots under sections/<slug>.json.
      expect(existsSync(join(dir, 'sections', 'about.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('schema is at v8+ (forms[] capture) so pre-forms caches invalidate', () => {
    // v8 added SectionSpec.forms[] — a v7 cache lacks them and would silently
    // drop every captured form, so the constant must never regress below 8.
    expect(SECTION_SPECS_SCHEMA).toBeGreaterThanOrEqual(8);
  });

  it('returns null (cache miss) when the file was written under an older schema', () => {
    const dir = mkdtempSync(join(TMP_ROOT, 'out-'));
    try {
      const store = SectionSpecsStore.load(dir);
      const url = 'https://example.com/contact';
      mkdirSync(join(dir, 'sections'), { recursive: true });
      writeFileSync(
        store.pathFor(url),
        JSON.stringify({ schema: SECTION_SPECS_SCHEMA - 1, sourceUrl: url, capturedAt: 'x', viewport: { width: 1440, height: 900 }, sections: [spec()] }),
      );
      expect(store.get(url)).toBeNull(); // stale schema → re-extract
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null on a slug collision (different sourceUrl recorded in the file)', () => {
    const dir = mkdtempSync(join(TMP_ROOT, 'out-'));
    try {
      const store = SectionSpecsStore.load(dir);
      // slugify ignores the query string, so these two URLs share slug "page".
      const a = 'https://example.com/page?v=1';
      const b = 'https://example.com/page?v=2';
      expect(store.pathFor(a)).toBe(store.pathFor(b));
      store.set(a, [spec({ headings: ['Page A'] })], []);
      expect(store.get(a)).not.toBeNull(); // exact URL hits
      expect(store.get(b)).toBeNull(); // collision → miss, not wrong-page specs
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null on a corrupt file rather than throwing', () => {
    const dir = mkdtempSync(join(TMP_ROOT, 'out-'));
    try {
      const store = SectionSpecsStore.load(dir);
      const url = 'https://example.com/broken';
      mkdirSync(join(dir, 'sections'), { recursive: true });
      writeFileSync(store.pathFor(url), '{ not valid json');
      expect(store.get(url)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes atomically — leaves no .tmp file behind', () => {
    const dir = mkdtempSync(join(TMP_ROOT, 'out-'));
    try {
      const store = SectionSpecsStore.load(dir);
      store.set('https://example.com/home', [spec()], []);
      const files = readdirSync(join(dir, 'sections'));
      expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
      expect(files).toContain('home.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records the capture viewport (default desktop 1440×900)', () => {
    const dir = mkdtempSync(join(TMP_ROOT, 'out-'));
    try {
      const store = SectionSpecsStore.load(dir);
      const url = 'https://example.com/vp';
      store.set(url, [spec()], []);
      const f = JSON.parse(readFileSync(store.pathFor(url), 'utf8'));
      expect(f.viewport).toEqual({ width: 1440, height: 900 });
      expect(f.schema).toBe(SECTION_SPECS_SCHEMA);
      expect(f.sourceUrl).toBe(url);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('round-trips sections + landmarks and invalidates an older schema', () => {
    const dir = mkdtempSync(join(TMP_ROOT, 'out-'));
    const store = SectionSpecsStore.load(dir);
    const landmarks = [{ role: 'nav', tag: 'nav', selector: 'nav.site-nav', textLength: 40, mediaCount: 0 }];
    store.set('https://example.test/', [], landmarks as never);
    expect(store.getLandmarks('https://example.test/')).toEqual(landmarks);
    // schema mismatch → miss
    const p = store.pathFor('https://example.test/');
    const raw = JSON.parse(readFileSync(p, 'utf8')); raw.schema = 6;
    writeFileSync(p, JSON.stringify(raw));
    expect(store.getLandmarks('https://example.test/')).toBeNull();
  });
});
