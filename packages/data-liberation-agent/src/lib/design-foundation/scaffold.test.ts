import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { scaffoldDesignFoundation, BREAKPOINT_TIERS } from './scaffold.js';
import { PartialDesignFoundationSchema } from './schema.js';

// cwd-local tmp dir per the CLAUDE.md guidance (validateOutputDir rejects
// paths outside process.cwd()).
const TMP_ROOT = join(process.cwd(), '.tmp-test', 'design-foundation-scaffold');

function setupOutputDir(name: string): string {
  const dir = join(TMP_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'screenshots'), { recursive: true });
  mkdirSync(join(dir, 'html'), { recursive: true });
  return dir;
}

function writeStandardInputs(dir: string, overrides: Record<string, unknown> = {}) {
  const palette = (overrides.palette as unknown) ?? {
    version: 1,
    sampledUrls: 100,
    colors: [
      { hex: '#ffffff', count: 500, urls: 100 }, // lightest, high urls
      { hex: '#111111', count: 400, urls: 95 }, // darkest, high urls
      { hex: '#0066cc', count: 200, urls: 40 }, // medium-ish, lower urls
    ],
  };
  const typography = (overrides.typography as unknown) ?? {
    version: 1,
    sampledUrls: 100,
    bySelector: {
      body: [
        { fontFamily: 'Inter, sans-serif', fontSize: '16px', fontWeight: '400', lineHeight: '24px', urls: 100 },
      ],
      h1: [
        { fontFamily: 'Reckless, serif', fontSize: '48px', fontWeight: '700', lineHeight: '56px', urls: 40 },
      ],
    },
  };
  const breakpoints = (overrides.breakpoints as unknown) ?? {
    version: 1,
    sampledUrls: 100,
    minWidth: [480, 768, 1024, 1280],
    maxWidth: [],
  };
  const manifest = (overrides.manifest as unknown) ?? {
    version: 1,
    entries: {
      'https://example.com/': { slug: 'homepage' },
    },
  };

  writeFileSync(join(dir, 'palette.json'), JSON.stringify(palette));
  writeFileSync(join(dir, 'typography.json'), JSON.stringify(typography));
  writeFileSync(join(dir, 'breakpoints.json'), JSON.stringify(breakpoints));
  writeFileSync(join(dir, 'screenshots', 'manifest.json'), JSON.stringify(manifest));
}

describe('scaffoldDesignFoundation — input validation', () => {
  beforeEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it('rejects outputDir containing `..` via validateOutputDir', () => {
    expect(() =>
      // relative path — normalize keeps the leading '..' (join would collapse it)
      scaffoldDesignFoundation('../escape', { origin: 'https://example.com' }),
    ).toThrow(/traversal|outside/i);
  });

  it('throws with helpful message when SP1 files are missing', () => {
    const dir = setupOutputDir('missing');
    expect(() =>
      scaffoldDesignFoundation(dir, { origin: 'https://example.com' }),
    ).toThrow(/palette\.json|Run SP1/);
  });

  it('throws when SP1 files are malformed JSON', () => {
    const dir = setupOutputDir('malformed');
    writeFileSync(join(dir, 'palette.json'), 'not json');
    writeFileSync(join(dir, 'typography.json'), '{}');
    writeFileSync(join(dir, 'breakpoints.json'), '{}');
    writeFileSync(join(dir, 'screenshots', 'manifest.json'), '{}');
    expect(() =>
      scaffoldDesignFoundation(dir, { origin: 'https://example.com' }),
    ).toThrow(/malformed JSON/);
  });
});

describe('scaffoldDesignFoundation — deterministic rules', () => {
  beforeEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it('picks text.default as darkest palette entry above urls threshold', () => {
    const dir = setupOutputDir('text-default');
    writeStandardInputs(dir);
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    expect(f.color!.text!.default).toMatchObject({ value: '#111111' });
  });

  it('picks surface.base as lightest palette entry above urls threshold', () => {
    const dir = setupOutputDir('surface-base');
    writeStandardInputs(dir);
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    expect(f.color!.surface!.base).toMatchObject({ value: '#ffffff' });
  });

  it('falls back to null when no dark color meets threshold', () => {
    const dir = setupOutputDir('no-dark');
    writeStandardInputs(dir, {
      palette: {
        version: 1,
        sampledUrls: 100,
        colors: [{ hex: '#ffffff', count: 500, urls: 100 }],
      },
    });
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    expect(f.color!.text!.default).toBeNull();
  });

  it('emits skillTodos for every empty slot', () => {
    const dir = setupOutputDir('todos');
    writeStandardInputs(dir);
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    expect(f.skillTodos).toContain('color.accent.primary');
    expect(f.skillTodos).toContain('color.text.muted');
    expect(f.skillTodos).toContain('typography.families.display');
    // Filled slots must NOT be in skillTodos.
    expect(f.skillTodos).not.toContain('color.text.default');
    expect(f.skillTodos).not.toContain('color.surface.base');
    expect(f.skillTodos).not.toContain('typography.families.body');
  });
});

describe('scaffoldDesignFoundation — breakpoints', () => {
  beforeEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it('maps raw breakpoints to named tiers via BREAKPOINT_TIERS nearest-neighbor', () => {
    const dir = setupOutputDir('bp-exact');
    writeStandardInputs(dir);
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    expect(f.breakpoints).toMatchObject({
      sm: '480px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
    });
  });

  it('handles raw breakpoint widths that fall between tiers (e.g. 900 → lg)', () => {
    const dir = setupOutputDir('bp-between');
    writeStandardInputs(dir, {
      breakpoints: { version: 1, sampledUrls: 100, minWidth: [900], maxWidth: [] },
    });
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    // 900 is closer to 1024 (delta 124) than 768 (delta 132) — bucket to `lg`.
    expect(f.breakpoints!.lg).toBe('900px');
    expect(f.breakpoints!.md).toBeUndefined();
  });

  it('BREAKPOINT_TIERS constant is stable and exported', () => {
    expect(BREAKPOINT_TIERS.map((t) => t[1])).toEqual(['sm', 'md', 'lg', 'xl']);
  });
});

describe('scaffoldDesignFoundation — gradients', () => {
  beforeEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it('extracts linear-gradient() declarations from HTML via regex', () => {
    const dir = setupOutputDir('gradients');
    writeStandardInputs(dir);
    writeFileSync(
      join(dir, 'html', 'homepage.html'),
      '<style>.a{background: linear-gradient(to bottom, #000, #333);}</style>',
    );
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    const gradients = Object.values(f.gradient!);
    expect(gradients.length).toBeGreaterThan(0);
    expect(gradients[0]!.css).toContain('linear-gradient');
  });

  it('deduplicates identical gradient CSS strings', () => {
    const dir = setupOutputDir('grad-dedupe');
    writeStandardInputs(dir);
    const grad = 'linear-gradient(to bottom, #000, #333)';
    writeFileSync(join(dir, 'html', 'a.html'), `<style>.a{background:${grad};}.b{background:${grad};}</style>`);
    writeFileSync(join(dir, 'html', 'b.html'), `<style>.c{background:${grad};}</style>`);
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    const entries = Object.values(f.gradient!);
    expect(entries.length).toBe(1);
    expect(entries[0]!.evidence[0]).toMatch(/3 occurrences/);
  });

  it('ranks gradients by occurrence count (desc)', () => {
    const dir = setupOutputDir('grad-rank');
    writeStandardInputs(dir);
    const a = 'linear-gradient(to bottom, #000, #333)';
    const b = 'linear-gradient(to left, #fff, #ccc)';
    writeFileSync(join(dir, 'html', 'a.html'), `<style>.x{background:${a};}.y{background:${a};}.z{background:${a};}</style>`);
    writeFileSync(join(dir, 'html', 'b.html'), `<style>.q{background:${b};}</style>`);
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    const keys = Object.keys(f.gradient!);
    expect(keys[0]).toBe('primary');
    expect(f.gradient!.primary!.css).toBe(a);
    expect(f.gradient!.secondary!.css).toBe(b);
  });

  it('aborts regex scan after 500ms on pathological HTML (ReDoS guard)', () => {
    const dir = setupOutputDir('redos');
    writeStandardInputs(dir);
    // Pathological input: long matches with many gradient expressions; bounded
    // regex should cap each match and timeout loop should exit within 500ms.
    const many = 'linear-gradient(to bottom, ' + '#'.repeat(10) + ', #000)';
    const html = '<style>' + Array(5000).fill(`.x{background:${many};}`).join('') + '</style>';
    writeFileSync(join(dir, 'html', 'big.html'), html);
    const start = Date.now();
    expect(() =>
      scaffoldDesignFoundation(dir, { origin: 'https://example.com' }),
    ).not.toThrow();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2500); // generous upper bound
  });
});

describe('scaffoldDesignFoundation — output shape', () => {
  beforeEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it('returns PartialDesignFoundation matching PartialDesignFoundationSchema', () => {
    const dir = setupOutputDir('shape');
    writeStandardInputs(dir);
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    const parse = PartialDesignFoundationSchema.safeParse(f);
    if (!parse.success) {
      console.error(JSON.stringify(parse.error.issues, null, 2));
    }
    expect(parse.success).toBe(true);
  });

  it('computes deterministic inputsDigest (stable across runs)', () => {
    const dir = setupOutputDir('digest');
    writeStandardInputs(dir);
    const a = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    const b = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    expect(a.inputsDigest).toEqual(b.inputsDigest);
    expect(a.inputsDigest!.palette).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('typography.families.body populated deterministically from SP1', () => {
    const dir = setupOutputDir('typo-body');
    writeStandardInputs(dir);
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    expect(f.typography!.families!.body).toMatchObject({
      value: 'Inter, sans-serif',
    });
    expect(f.typography!.families!.display).toBeNull();
  });
});

describe('scaffoldDesignFoundation — :root CSS variable tokens', () => {
  beforeEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  function writeCssVariables(dir: string, variables: unknown[], sampledUrls = 100) {
    writeFileSync(
      join(dir, 'css-variables.json'),
      JSON.stringify({ version: 1, sampledUrls, variables }),
    );
  }

  it('overrides matched color roles with named :root tokens; ignores non-color tokens', () => {
    const dir = setupOutputDir('cssvars');
    writeStandardInputs(dir);
    writeCssVariables(dir, [
      { name: '--brand-primary', value: '#1d6f42', isColor: true, urls: 90 },
      { name: '--page-background', value: '#fafafa', isColor: true, urls: 80 },
      { name: '--radius-base', value: '8px', isColor: false, urls: 50 },
    ]);
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    // accent.primary (pixel left it null) is filled by the named token.
    expect(f.color?.accent?.primary?.value).toBe('#1d6f42');
    expect(f.color?.accent?.primary?.evidence?.[0]).toMatch(/css-var --brand-primary/);
    // surface.base overrides the pixel-lightest (#ffffff) with the named token.
    expect(f.color?.surface?.base?.value).toBe('#fafafa');
    // No text token → text.default stays the pixel-darkest.
    expect(f.color?.text?.default?.value).toBe('#111111');
    // Result still satisfies the schema.
    expect(() => PartialDesignFoundationSchema.parse(f)).not.toThrow();
  });

  it('falls back to pixel-derived roles when no css-variables.json exists', () => {
    const dir = setupOutputDir('nocssvars');
    writeStandardInputs(dir);
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    expect(f.color?.accent?.primary).toBeNull();
    expect(f.color?.surface?.base?.value).toBe('#ffffff');
  });

  it('picks the higher-urls token when two match the same role (deterministic, order-independent)', () => {
    const dir = setupOutputDir('tiebreak');
    writeStandardInputs(dir);
    // Provided out of urls order on purpose — the scaffold must rank by urls desc.
    writeCssVariables(dir, [
      { name: '--accent', value: '#aa0000', isColor: true, urls: 30 },
      { name: '--primary', value: '#00aa00', isColor: true, urls: 70 },
    ]);
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    expect(f.color?.accent?.primary?.value).toBe('#00aa00');
  });

  it('records a cssVariables digest in inputsDigest', () => {
    const dir = setupOutputDir('digest');
    writeStandardInputs(dir);
    writeCssVariables(dir, []);
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    expect(f.inputsDigest?.cssVariables).toMatch(/^sha256:/);
  });

  it('does NOT let a single-page css-var override the palette surface/text extremes (Wix cross-origin case)', () => {
    // Wix serves stylesheets cross-origin, so the aggregator can read only the
    // one same-origin page → sampledUrls:1 and every token carries urls:1. The
    // only :root tokens captured are component-internal (button/fill SECONDARY),
    // NOT real page bg/text tokens. With no cross-page frequency signal, these
    // must NOT clobber the palette's lightness-extreme surface (#ffffff) / text
    // (#000000) — the recurring color-pollution failure mode.
    const dir = setupOutputDir('cssvar-degenerate');
    writeStandardInputs(dir, {
      palette: {
        version: 1,
        sampledUrls: 1,
        colors: [
          { hex: '#ffffff', count: 9, urls: 1 },
          { hex: '#000000', count: 2, urls: 1 },
          { hex: '#5b7c88', count: 1, urls: 1 },
        ],
      },
    });
    writeCssVariables(
      dir,
      [
        { name: '--wst-color-fill-background-secondary', value: 'rgb(240,237,237)', isColor: true, urls: 1 },
        { name: '--wst-button-color-text-secondary', value: 'rgb(137,157,163)', isColor: true, urls: 1 },
        { name: '--wst-button-color-border-primary', value: 'rgb(137,157,163)', isColor: true, urls: 1 },
      ],
      1, // sampledUrls=1 — degenerate, no cross-page authority
    );
    const f = scaffoldDesignFoundation(dir, { origin: 'https://example.com' });
    // Palette extremes survive — protected from the 1-page component tokens.
    expect(f.color?.surface?.base?.value).toBe('#ffffff');
    expect(f.color?.text?.default?.value).toBe('#000000');
    // accent.primary has no palette competition (always null from pixels), so a
    // token still FILLS it — fill is allowed, only OVERRIDE is gated.
    expect(f.color?.accent?.primary?.value).toBe('rgb(137,157,163)');
  });
});
