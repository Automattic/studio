import { describe, expect, it } from 'vitest';
import { foundation, type ThemeBuildResult } from '@automattic/blocks-engine/theme';
import {
  buildDlaFunctionsPhpContent,
  engineThemeResultToHostFiles,
  refineEngineThemeForDlaLocalPages,
  translateDlaFoundationToEngine,
} from './engine-theme-adapter.js';
import type { BreakpointsAgg, PaletteAgg, TypographyAgg } from './foundation.js';

const palette: PaletteAgg = {
  version: 1,
  sampledUrls: 4,
  colors: [
    { hex: '#f7f2e9', count: 400, urls: 4 },
    { hex: '#0e2a30', count: 380, urls: 4 },
    { hex: '#e2573b', count: 120, urls: 4 },
  ],
};

const typography: TypographyAgg = {
  version: 1,
  sampledUrls: 4,
  bySelector: {
    body: [{ fontFamily: '"Work Sans", sans-serif', fontSize: '17px', fontWeight: '400', lineHeight: '28px', urls: 4 }],
    h1: [{ fontFamily: 'Fraunces, Georgia, serif', fontSize: '70px', fontWeight: '900', lineHeight: '76px', urls: 4 }],
  },
};

const breakpoints: BreakpointsAgg = { version: 1, sampledUrls: 4, minWidth: [768], maxWidth: [1024] };

function engineResult(overrides: Partial<ThemeBuildResult> = {}): ThemeBuildResult {
  return {
    outDir: '/tmp/dla-engine-theme',
    model: {
      styleCss: '/* theme */\n',
      themeJson: { version: 3, settings: { appearanceTools: true } },
      templates: {
        'front-page.html': '<!-- wp:group --><main></main><!-- /wp:group -->',
        page: '<!-- wp:post-content /-->',
      },
      parts: {
        'header.html': '<!-- wp:site-title /-->',
        footer: '<!-- wp:paragraph --><p>Footer</p><!-- /wp:paragraph -->',
      },
      patterns: {
        hero: '<!-- wp:paragraph --><p>Hero</p><!-- /wp:paragraph -->',
      },
      assets: [
        { relPath: 'assets/logo.png', bytes: new Uint8Array([1, 2, 3]) },
        { relPath: 'assets/css/theme.css', bytes: new Uint8Array([4, 5, 6]) },
      ],
    },
    written: [
      'style.css',
      'theme.json',
      'templates/front-page.html',
      'templates/page.html',
      'parts/header.html',
      'parts/footer.html',
      'patterns/hero.html',
      'assets/logo.png',
      'assets/css/theme.css',
    ],
    tallies: {},
    warnings: [],
    diagnostics: { regionAudit: [] },
    ...overrides,
  };
}

describe('translateDlaFoundationToEngine', () => {
  it('maps DLA captured aggregates into engine foundation tokens', () => {
    const translated = translateDlaFoundationToEngine({ palette, typography, breakpoints });

    expect(translated.tokens.palette).toEqual([
      { name: 'Surface Base', color: '#f7f2e9' },
      { name: 'Surface Inverse', color: '#0e2a30' },
      { name: 'Text Default', color: '#0e2a30' },
      { name: 'Text Inverse', color: '#f7f2e9' },
      { name: 'Accent Primary', color: '#e2573b' },
    ]);
    expect(translated.tokens.typography).toEqual({
      body: '"Work Sans", sans-serif',
      display: 'Fraunces, Georgia, serif',
    });
    expect(translated.tokens.breakpoints).toEqual({ md: '768px', lg: '1024px', xl: '1280px' });
  });

  it('uses extractCssColors-compatible CSS sources to preserve a CSS-only accent', () => {
    const translated = translateDlaFoundationToEngine({
      palette: {
        version: 1,
        sampledUrls: 1,
        colors: [
          { hex: '#f7f2e9', count: 2, urls: 1 },
          { hex: '#0e2a30', count: 1, urls: 1 },
        ],
      },
      typography: { version: 1, sampledUrls: 1, bySelector: {} },
      breakpoints: { version: 1, sampledUrls: 1, minWidth: [], maxWidth: [] },
      cssSources: ['.button{background:#e2573b}.dead{color:#f7f2e9}'],
    });

    expect(translated.tokens.palette.find((entry) => entry.name === 'Accent Primary')?.color).toBe('#e2573b');
  });

  it('emits aggregates that the engine foundation stage can coerce', () => {
    const translated = translateDlaFoundationToEngine({ palette, typography, breakpoints });
    const tokens = foundation({ root: '/tmp/site', pages: [] }, translated.foundationAggregates);

    expect(tokens).toEqual(translated.tokens);
  });
});

describe('engine theme host integration', () => {
  it('builds DLA functions.php content from existing theme-files logic', () => {
    const functionsPhp = buildDlaFunctionsPhpContent({
      siteTitle: 'Acme',
      themeSlug: 'acme-local',
      carrySourceAssets: { css: 'body{}', js: 'console.log("x")' },
      instanceStylesCss: '.lib-iabc{font-size:2rem}',
      bodyDataByPath: { '/': { page: 'home' } },
    });

    expect(functionsPhp).toContain('acme-local-style');
    expect(functionsPhp).toContain('assets/css/source.css');
    expect(functionsPhp).toContain('assets/js/source.js');
    expect(functionsPhp).toContain("documentElement.classList.add('js')");
    expect(functionsPhp).toContain('wp_body_open');
  });

  it('maps engine templates, parts, patterns, and DLA functions.php to ReplicaFiles', () => {
    const functionsPhp = buildDlaFunctionsPhpContent({ siteTitle: 'Acme', themeSlug: 'acme-local' });
    const hostFiles = engineThemeResultToHostFiles(engineResult(), { functionsPhp });
    const byPath = new Map(hostFiles.themeFiles.map((file) => [file.relativePath, file.content]));

    expect(byPath.get('style.css')).toContain('theme');
    expect(JSON.parse(byPath.get('theme.json') ?? '{}')).toEqual({ version: 3, settings: { appearanceTools: true } });
    expect(byPath.get('templates/front-page.html')).toContain('<main>');
    expect(byPath.get('templates/page.html')).toContain('wp:post-content');
    expect(byPath.get('parts/header.html')).toContain('wp:site-title');
    expect(byPath.get('parts/footer.html')).toContain('Footer');
    expect(byPath.get('patterns/hero.html')).toContain('Hero');
    expect(byPath.get('functions.php')).toContain('acme_local_setup');
  });

  it('keeps engine assets host-writeable through assetSourceDir without inlining binary ReplicaFiles', () => {
    const hostFiles = engineThemeResultToHostFiles(engineResult(), {
      functionsPhp: buildDlaFunctionsPhpContent({ siteTitle: 'Acme', themeSlug: 'acme-local' }),
    });

    expect(hostFiles.assetSourceDir).toBe('/tmp/dla-engine-theme');
    expect(hostFiles.assetFiles).toEqual(['assets/css/theme.css', 'assets/logo.png']);
    expect(hostFiles.themeFiles.map((file) => file.relativePath)).not.toContain('assets/logo.png');
    expect(hostFiles.writtenThemeFiles).toContain('functions.php');
  });

  it('refines visible templates with mainWrapperClass on the main group and mainClass on post-content', async () => {
    const refined = await refineEngineThemeForDlaLocalPages(engineResult().model, {
      siteTitle: 'Acme',
      themeSlug: 'acme-local',
      mainClass: 'content',
      mainWrapperClass: 'main-area',
    });

    expect(refined.templates['front-page.html']).toContain('<!-- wp:group {"tagName":"main","className":"main-area"} -->');
    expect(refined.templates['front-page.html']).toContain('<main class="wp-block-group main-area">');
    expect(refined.templates['front-page.html']).toContain('<!-- wp:post-content {"className":"content"} /-->');
  });
});
