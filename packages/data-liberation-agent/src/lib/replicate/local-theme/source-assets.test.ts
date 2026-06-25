// src/lib/replicate/local-theme/source-assets.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { collectSourceAssets, rewriteHtmlImageSrcs, WP_COMPAT_CSS } from './source-assets.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');

function makeSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'assets-'));
  writeFileSync(join(dir, 'index.html'), '<html><head><link rel="stylesheet" href="styles.css"><style>.inline-rule{color:red}</style></head><body><main><section><h1>x</h1></section></main><script src="site.js"></script></body></html>');
  writeFileSync(join(dir, 'styles.css'), `@import url('https://fonts.googleapis.com/css2?family=Fraunces&display=swap');\nbody{background:#f7f2e9}\n.hero h1{font-size:4rem}`);
  writeFileSync(join(dir, 'site.js'), "document.documentElement.classList.add('js');\nconsole.log('hi');");
  return dir;
}

describe('WP_COMPAT_CSS', () => {
  it('strips the inner core/button link chrome for carried (lib-cta) buttons so the wrapper pill renders once', () => {
    expect(WP_COMPAT_CSS).toContain('.wp-block-button.lib-cta > .wp-block-button__link');
    // The reset must zero the box that would paint a second pill — INCLUDING the
    // box-shadow. A carried `.btn{box-shadow:6px 6px 0 ink}` left on the inner
    // link casts a hard offset shadow behind the label that reads as a second
    // border around the text (the double-border bug).
    const rule = WP_COMPAT_CSS.slice(WP_COMPAT_CSS.indexOf('.wp-block-button.lib-cta'));
    expect(rule).toMatch(/background:\s*transparent/);
    expect(rule).toMatch(/padding:\s*0/);
    expect(rule).toMatch(/box-shadow:\s*none/);
  });
});

describe('collectSourceAssets', () => {
  it('concatenates css (linked + inline) with google imports stripped and compat layer prepended', () => {
    const dir = makeSite();
    try {
      const assets = collectSourceAssets(dir, [{ relPath: 'index.html', html: '' }]);
      expect(assets.css.startsWith(WP_COMPAT_CSS)).toBe(true);
      expect(assets.css).toContain('body{background:#f7f2e9}');
      expect(assets.css).toContain('.hero h1{font-size:4rem}');
      expect(assets.css).toContain('.inline-rule{color:red}');
      expect(assets.css).not.toContain('fonts.googleapis.com'); // self-hosted already
      expect(assets.cssFiles).toEqual(['styles.css']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('concatenates js files in document order', () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const dir = mkdtempSync(join(FIXTURE_TMP, 'assets-jsorder-'));
    // zeta.js linked BEFORE alpha.js — document order must beat alphabetical.
    writeFileSync(join(dir, 'index.html'), '<html><body><p>x</p><script src="zeta.js"></script><script src="alpha.js"></script></body></html>');
    writeFileSync(join(dir, 'zeta.js'), "document.documentElement.classList.add('js');");
    writeFileSync(join(dir, 'alpha.js'), "console.log('second');");
    try {
      const assets = collectSourceAssets(dir, [{ relPath: 'index.html', html: '' }]);
      expect(assets.jsFiles).toEqual(['zeta.js', 'alpha.js']);
      expect(assets.js).toContain("classList.add('js')");
      expect(assets.js.indexOf("classList.add('js')")).toBeLessThan(assets.js.indexOf("console.log('second')"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves linked css document order over alphabetical (cascade winner)', () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const dir = mkdtempSync(join(FIXTURE_TMP, 'assets-cssorder-'));
    // theme.css linked BEFORE overrides.css — alphabetical reads would invert
    // the cascade and make theme.css the winner.
    writeFileSync(join(dir, 'index.html'), '<html><head><link rel="stylesheet" href="theme.css"><link rel="stylesheet" href="overrides.css"></head><body><p>x</p></body></html>');
    writeFileSync(join(dir, 'theme.css'), 'body{color:blue}');
    writeFileSync(join(dir, 'overrides.css'), 'body{color:red}');
    try {
      const assets = collectSourceAssets(dir, [{ relPath: 'index.html', html: '' }]);
      expect(assets.cssFiles).toEqual(['theme.css', 'overrides.css']);
      expect(assets.css.indexOf('color:blue')).toBeLessThan(assets.css.indexOf('color:red')); // exact tokens: compat comments legitimately contain prose like 'rendered'
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('discovers linked assets in subdirectories', () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const dir = mkdtempSync(join(FIXTURE_TMP, 'assets-subdir-'));
    mkdirSync(join(dir, 'css'), { recursive: true });
    mkdirSync(join(dir, 'js'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<html><head><link rel="stylesheet" href="css/site.css"></head><body><p>x</p><script src="js/app.js"></script></body></html>');
    writeFileSync(join(dir, 'css', 'site.css'), '.hero{color:teal}');
    writeFileSync(join(dir, 'js', 'app.js'), "console.log('app');");
    try {
      const assets = collectSourceAssets(dir, [{ relPath: 'index.html', html: '' }]);
      expect(assets.cssFiles).toEqual(['css/site.css']);
      expect(assets.jsFiles).toEqual(['js/app.js']);
      expect(assets.css).toContain('.hero{color:teal}');
      expect(assets.js).toContain("console.log('app')");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty strings for a site with no css/js', () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const dir = mkdtempSync(join(FIXTURE_TMP, 'assets-empty-'));
    writeFileSync(join(dir, 'index.html'), '<html><body><main><p>x</p></main></body></html>');
    try {
      const assets = collectSourceAssets(dir, [{ relPath: 'index.html', html: '' }]);
      expect(assets.css).toBe(WP_COMPAT_CSS); // compat layer always present
      expect(assets.js).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('collectSourceAssets: CSS url() image localization', () => {
  it('rewrites relative image url()s and lists the assets to carry (resolved per source file dir)', () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const dir = mkdtempSync(join(FIXTURE_TMP, 'sa-img-'));
    mkdirSync(join(dir, 'assets', 'img'), { recursive: true });
    // The css lives in assets/, so url(img/plate.jpg) resolves to assets/img/plate.jpg.
    writeFileSync(join(dir, 'index.html'), '<html><head><link rel="stylesheet" href="assets/site.css"></head><body><p>x</p></body></html>');
    writeFileSync(
      join(dir, 'assets', 'site.css'),
      `.ph{ background:url(img/plate.jpg) center/cover; }\n` +
        `@font-face{ src:url(../fonts/x.woff2); }\n` +
        `.noise{ background:url("data:image/svg+xml,%3Csvg%3E"); }\n` +
        `.cdn{ background:url(https://cdn.example.com/y.png); }`,
    );
    writeFileSync(join(dir, 'assets', 'img', 'plate.jpg'), 'JPEGBYTES');
    try {
      const assets = collectSourceAssets(dir, [{ relPath: 'index.html', html: '' }]);
      // Image rewritten to sit next to the carried css (assets/css/source.css → media/).
      expect(assets.css).toContain('url(media/plate.jpg)');
      expect(assets.css).not.toContain('url(img/plate.jpg)');
      // Fonts, data URIs, and remote URLs are untouched.
      expect(assets.css).toContain('url(../fonts/x.woff2)');
      expect(assets.css).toContain('data:image/svg+xml');
      expect(assets.css).toContain('https://cdn.example.com/y.png');
      // The asset copy list points at the real source file and the theme dest.
      expect(assets.mediaAssets).toEqual([
        { srcAbs: join(dir, 'assets', 'img', 'plate.jpg'), themeRel: 'assets/css/media/plate.jpg' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves a missing image url() untouched and carries nothing for it', () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const dir = mkdtempSync(join(FIXTURE_TMP, 'sa-img-missing-'));
    writeFileSync(join(dir, 'index.html'), '<html><head><link rel="stylesheet" href="site.css"></head><body><p>x</p></body></html>');
    writeFileSync(join(dir, 'site.css'), '.ph{ background:url(img/gone.jpg); }');
    try {
      const assets = collectSourceAssets(dir, [{ relPath: 'index.html', html: '' }]);
      expect(assets.css).toContain('url(img/gone.jpg)'); // can't localize → leave as authored
      expect(assets.mediaAssets).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dedupes one source image referenced from multiple rules to a single carried asset', () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const dir = mkdtempSync(join(FIXTURE_TMP, 'sa-img-dedup-'));
    mkdirSync(join(dir, 'img'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<html><head><link rel="stylesheet" href="site.css"></head><body><p>x</p></body></html>');
    writeFileSync(join(dir, 'site.css'), '.a{ background:url(img/p.jpg); }\n.b{ background:url(img/p.jpg); }');
    writeFileSync(join(dir, 'img', 'p.jpg'), 'BYTES');
    try {
      const assets = collectSourceAssets(dir, [{ relPath: 'index.html', html: '' }]);
      expect(assets.mediaAssets).toHaveLength(1);
      expect((assets.css.match(/url\(media\/p\.jpg\)/g) ?? [])).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('collectSourceAssets: inline scripts (JS-rendered sites)', () => {
  it('carries inline script bodies wrapped in per-chunk try/catch IIFEs, after linked js', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'sa-inline-'));
    try {
      writeFileSync(join(dir, 'app.js'), 'window.app = true;');
      const html = `<html><body><script src="app.js"></script><script>mountGrid('#grid', items(4));</script></body></html>`;
      writeFileSync(join(dir, 'index.html'), html);
      const out = collectSourceAssets(dir, [{ relPath: 'index.html', html }]);
      expect(out.js).toContain('window.app = true;');
      expect(out.js).toContain("mountGrid('#grid', items(4));");
      // Per-chunk isolation: a page-scoped mount call missing its target on
      // another page must not break the rest of the carried bundle.
      expect(out.js).toContain('try {');
      expect(out.js).toContain('} catch');
      // Linked js precedes inline mounts (document order within the page).
      expect(out.js.indexOf('window.app')).toBeLessThan(out.js.indexOf('mountGrid'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dedupes identical inline scripts across pages and skips src-bearing tags', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'sa-inline2-'));
    try {
      writeFileSync(join(dir, 'lib.js'), 'lib();');
      const inline = `<script>initChrome();</script>`;
      const a = `<html><body><script src="lib.js"></script>${inline}</body></html>`;
      const b = `<html><body><script src="lib.js"></script>${inline}<script>pageOnly();</script></body></html>`;
      writeFileSync(join(dir, 'a.html'), a);
      writeFileSync(join(dir, 'b.html'), b);
      const out = collectSourceAssets(dir, [
        { relPath: 'a.html', html: a },
        { relPath: 'b.html', html: b },
      ]);
      expect((out.js.match(/initChrome\(\);/g) ?? []).length).toBe(1);
      expect(out.js).toContain('pageOnly();');
      expect((out.js.match(/lib\(\);/g) ?? []).length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('collectSourceAssets: unlinked fallback gating (stale-revision pollution)', () => {
  it('skips unlinked top-level css/js when LINKED assets exist (reports them)', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'sa-stale-'));
    try {
      mkdirSync(join(dir, 'assets'), { recursive: true });
      writeFileSync(join(dir, 'assets', 'site.css'), '.display{color:#1c2733}');
      writeFileSync(join(dir, 'style.css'), '.display{color:#f3ecdd}'); // stale variant
      writeFileSync(join(dir, 'assets', 'site.js'), 'live();');
      writeFileSync(join(dir, 'old.js'), 'stale();');
      const html = `<html><head><link rel="stylesheet" href="assets/site.css"></head><body><script src="assets/site.js"></script></body></html>`;
      writeFileSync(join(dir, 'index.html'), html);
      const out = collectSourceAssets(dir, [{ relPath: 'index.html', html }]);
      expect(out.css).toContain('#1c2733');
      expect(out.css).not.toContain('#f3ecdd');
      expect(out.js).toContain('live();');
      expect(out.js).not.toContain('stale();');
      expect(out.skippedUnlinked).toEqual(['old.js', 'style.css']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still falls back to unlinked assets when NO linked ones exist (regression)', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'sa-nofall-'));
    try {
      writeFileSync(join(dir, 'style.css'), 'body{margin:0}');
      writeFileSync(join(dir, 'app.js'), 'boot();');
      const html = `<html><body><p>hi</p></body></html>`;
      writeFileSync(join(dir, 'index.html'), html);
      const out = collectSourceAssets(dir, [{ relPath: 'index.html', html }]);
      expect(out.css).toContain('margin:0');
      expect(out.js).toContain('boot();');
      expect(out.skippedUnlinked).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('collectSourceAssets: non-JS <script> blocks (bundle-poisoning guard)', () => {
  it('does NOT carry application/ld+json into the JS bundle, keeping it parseable', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'sa-ldjson-'));
    try {
      writeFileSync(join(dir, 'app.js'), "document.querySelectorAll('.reveal');");
      const html =
        '<html><head>' +
        '<script type="application/ld+json">{ "@context": "https://schema.org", "@type": "HairSalon" }</script>' +
        '</head><body><p>x</p>' +
        '<script src="app.js"></script>' +
        '<script>initReveal();</script>' +
        '</body></html>';
      writeFileSync(join(dir, 'index.html'), html);
      const out = collectSourceAssets(dir, [{ relPath: 'index.html', html }]);
      // JSON-LD must NOT leak into the bundle (concatenated it is a syntax error
      // that kills every carried behavior — the live regression we are guarding).
      expect(out.js).not.toContain('@context');
      expect(out.js).not.toContain('schema.org');
      // Real JS (linked + classic inline) still carried.
      expect(out.js).toContain("document.querySelectorAll('.reveal')");
      expect(out.js).toContain('initReveal();');
      // The whole bundle parses as JS.
      expect(() => new Function(out.js)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips importmap/application/json but carries module + classic inline JS', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'sa-types-'));
    try {
      const html =
        '<html><body>' +
        '<script type="importmap">{ "imports": {} }</script>' +
        '<script type="application/json">{ "k": 1 }</script>' +
        '<script type="module">globalThis.mod = 1;</script>' +
        '<script type="text/javascript">classic();</script>' +
        '</body></html>';
      writeFileSync(join(dir, 'index.html'), html);
      const out = collectSourceAssets(dir, [{ relPath: 'index.html', html }]);
      expect(out.js).toContain('globalThis.mod = 1;');
      expect(out.js).toContain('classic();');
      expect(out.js).not.toContain('"imports"');
      expect(out.js).not.toContain('"k": 1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('collectSourceAssets: HTML <img> asset carry', () => {
  it('harvests local <img src> files into imgAssets + per-page rewrites; skips remote/data/missing/data-src', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'sa-htmlimg-'));
    try {
      mkdirSync(join(dir, 'assets'), { recursive: true });
      writeFileSync(join(dir, 'assets', 'logo.svg'), '<svg/>');
      const html =
        '<html><body>' +
        '<img src="assets/logo.svg" alt="logo">' +
        '<img data-src="assets/logo.svg" src="assets/logo.svg">' + // dedup; data-src ignored
        '<img src="https://cdn.example.com/x.png">' + // remote → skip
        '<img src="data:image/svg+xml,%3Csvg%3E">' + // data → skip
        '<img src="assets/missing.svg">' + // missing → skip
        '</body></html>';
      writeFileSync(join(dir, 'index.html'), html);
      const out = collectSourceAssets(dir, [{ relPath: 'index.html', html }]);
      expect(out.imgAssets).toEqual([
        { srcAbs: join(dir, 'assets', 'logo.svg'), themeRel: 'assets/img/logo.svg' },
      ]);
      expect(out.imgRewritesByPage['index.html']).toEqual([
        { ref: 'assets/logo.svg', themeRel: 'assets/img/logo.svg' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rewriteHtmlImageSrcs repoints carried refs at the theme URL (both quote styles)', () => {
    const refs = [{ ref: 'assets/logo.svg', themeRel: 'assets/img/logo.svg' }];
    const html = '<img src="assets/logo.svg"><img src=\'assets/logo.svg\'>';
    expect(rewriteHtmlImageSrcs(html, refs, 'my-theme')).toBe(
      '<img src="/wp-content/themes/my-theme/assets/img/logo.svg">' +
        '<img src=\'/wp-content/themes/my-theme/assets/img/logo.svg\'>',
    );
  });
});
