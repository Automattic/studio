// src/lib/replicate/local-theme/theme-files.test.ts
import { describe, it, expect } from 'vitest';
import { assembleLocalTheme } from './theme-files.js';
import { lintThemeJson } from '../theme-json-lint.js';
import { JETPACK_FORM_PARITY_CSS } from './jetpack-form-parity-contract.js';

const HEADER = '<!-- wp:site-title {"level":0} /-->';
const FOOTER = '<!-- wp:paragraph -->\n<p>foot</p>\n<!-- /wp:paragraph -->';

describe('assembleLocalTheme', () => {
  const files = assembleLocalTheme({ siteTitle: 'Acme Co', themeSlug: 'acme-local', headerPart: HEADER, footerPart: FOOTER });

  it('keeps the scaffold base files (style.css, theme.json, functions.php)', () => {
    const paths = files.map((f) => f.relativePath);
    expect(paths).toContain('style.css');
    expect(paths).toContain('theme.json');
    expect(paths).toContain('functions.php');
  });

  it('replaces the chrome parts with the local ones', () => {
    expect(files.find((f) => f.relativePath === 'parts/header.html')?.content).toBe(HEADER);
    expect(files.find((f) => f.relativePath === 'parts/footer.html')?.content).toBe(FOOTER);
  });

  it('adds no-title page-local and front-page templates (post-content, no post-title)', () => {
    for (const t of ['templates/page-local.html', 'templates/front-page.html']) {
      const content = files.find((f) => f.relativePath === t)?.content ?? '';
      expect(content).toContain('wp:template-part {"slug":"header"');
      expect(content).toContain('<!-- wp:post-content');
      expect(content).not.toContain('wp:post-title');
      expect(content).toContain('wp:template-part {"slug":"footer"');
    }
  });

  it('carries the source <main> class onto post-content (body blockGap rules survive)', () => {
    const withMain = assembleLocalTheme({ siteTitle: 'Acme', themeSlug: 'acme-local', headerPart: HEADER, footerPart: FOOTER, mainClass: 'page-sections' });
    for (const t of ['templates/page-local.html', 'templates/front-page.html']) {
      const content = withMain.find((f) => f.relativePath === t)?.content ?? '';
      expect(content).toContain('<!-- wp:post-content {"className":"page-sections"} /-->');
    }
    // default (no mainClass): bare post-content, unchanged
    const t = files.find((f) => f.relativePath === 'templates/front-page.html')?.content ?? '';
    expect(t).toContain('<!-- wp:post-content /-->');
    expect(t).not.toContain('className');
  });

  it('registers page-local in theme.json customTemplates and stays lint-clean', () => {
    const tj = files.find((f) => f.relativePath === 'theme.json');
    const themeJson = JSON.parse(tj?.content ?? '{}') as {
      customTemplates?: Array<{ name: string }>;
    };
    expect(themeJson.customTemplates?.some((t) => t.name === 'page-local')).toBe(true);
    // Lint lock: the customTemplates rewrite must not break the activation-gate
    // invariants (version 3, $schema, spacingScale traps).
    expect(lintThemeJson(JSON.parse(tj?.content ?? '{}')).ok).toBe(true);
  });

  it('adds page-scoped interior chrome templates without changing home templates', () => {
    const withInterior = assembleLocalTheme({
      siteTitle: 'Acme',
      themeSlug: 'acme-local',
      headerPart: HEADER,
      footerPart: FOOTER,
      interiorChromeTemplates: [
        {
          templateName: 'page-local-intro-chrome',
          templateTitle: 'Local Page Chrome (Intro)',
          partSlug: 'interior-chrome-intro',
          partMarkup: '<aside id="sidebar" class="sidebar"><nav class="sidebar-nav">Intro</nav></aside>',
        },
      ],
    });
    const themeJson = JSON.parse(withInterior.find((f) => f.relativePath === 'theme.json')?.content ?? '{}') as {
      customTemplates?: Array<{ name: string; title: string; postTypes?: string[] }>;
    };
    expect(themeJson.customTemplates).toContainEqual({
      name: 'page-local-intro-chrome',
      title: 'Local Page Chrome (Intro)',
      postTypes: ['page'],
    });
    expect(withInterior.find((f) => f.relativePath === 'parts/interior-chrome-intro.html')?.content).toContain('sidebar-nav');
    const interiorTemplate = withInterior.find((f) => f.relativePath === 'templates/page-local-intro-chrome.html')?.content ?? '';
    expect(interiorTemplate).toContain('wp:template-part {"slug":"interior-chrome-intro","tagName":"aside"}');
    expect(interiorTemplate).toContain('<!-- wp:post-content /-->');
    expect(withInterior.find((f) => f.relativePath === 'templates/page-local.html')?.content).not.toContain('interior-chrome-intro');
    expect(withInterior.find((f) => f.relativePath === 'templates/front-page.html')?.content).not.toContain('interior-chrome-intro');
    expect(lintThemeJson(JSON.parse(withInterior.find((f) => f.relativePath === 'theme.json')?.content ?? '{}')).ok).toBe(true);
  });

  it('wraps interior chrome rail and main in the source layout wrapper without changing home templates', () => {
    const withInterior = assembleLocalTheme({
      siteTitle: 'Acme',
      themeSlug: 'acme-local',
      headerPart: HEADER,
      footerPart: FOOTER,
      interiorChromeTemplates: [
        {
          templateName: 'page-local-docs-chrome',
          templateTitle: 'Local Page Chrome (Docs)',
          partSlug: 'interior-chrome-docs',
          partMarkup: '<aside class="sidebar"><nav>Docs</nav></aside>',
          layoutWrapperTag: 'div',
          layoutWrapperClasses: ['docs-grid'],
          layoutWrapperRailPosition: 'beforeMain',
        },
      ],
    });

    const interiorTemplate = withInterior.find((f) => f.relativePath === 'templates/page-local-docs-chrome.html')?.content ?? '';
    const headerIndex = interiorTemplate.indexOf('wp:template-part {"slug":"header","tagName":"header"}');
    const wrapperIndex = interiorTemplate.indexOf('<!-- wp:group {"tagName":"div","className":"docs-grid"} -->');
    const sidebarIndex = interiorTemplate.indexOf('wp:template-part {"slug":"interior-chrome-docs","tagName":"aside"}');
    const mainIndex = interiorTemplate.indexOf('<!-- wp:group {"tagName":"main"} -->');
    const wrapperCloseIndex = interiorTemplate.lastIndexOf('<!-- /wp:group -->');
    const footerIndex = interiorTemplate.indexOf('wp:template-part {"slug":"footer","tagName":"footer"}');

    expect([headerIndex, wrapperIndex, sidebarIndex, mainIndex, wrapperCloseIndex, footerIndex].every((idx) => idx >= 0)).toBe(true);
    expect(headerIndex).toBeLessThan(wrapperIndex);
    expect(wrapperIndex).toBeLessThan(sidebarIndex);
    expect(sidebarIndex).toBeLessThan(mainIndex);
    expect(mainIndex).toBeLessThan(wrapperCloseIndex);
    expect(wrapperCloseIndex).toBeLessThan(footerIndex);
    expect(interiorTemplate).toContain('<div class="wp-block-group docs-grid">');
    expect(interiorTemplate).toContain('</div>');
    expect(withInterior.find((f) => f.relativePath === 'templates/page-local.html')?.content).not.toContain('docs-grid');
    expect(withInterior.find((f) => f.relativePath === 'templates/front-page.html')?.content).not.toContain('docs-grid');
  });

  it('preserves source rail position inside the interior layout wrapper', () => {
    const withInterior = assembleLocalTheme({
      siteTitle: 'Acme',
      themeSlug: 'acme-local',
      headerPart: HEADER,
      footerPart: FOOTER,
      interiorChromeTemplates: [
        {
          templateName: 'page-local-reference-chrome',
          templateTitle: 'Local Page Chrome (Reference)',
          partSlug: 'interior-chrome-reference',
          partMarkup: '<aside class="sidebar"><nav>Reference</nav></aside>',
          layoutWrapperTag: 'div',
          layoutWrapperClasses: ['reference-grid'],
          layoutWrapperRailPosition: 'afterMain',
        },
      ],
    });

    const interiorTemplate = withInterior.find((f) => f.relativePath === 'templates/page-local-reference-chrome.html')?.content ?? '';
    const wrapperIndex = interiorTemplate.indexOf('<!-- wp:group {"tagName":"div","className":"reference-grid"} -->');
    const mainIndex = interiorTemplate.indexOf('<!-- wp:group {"tagName":"main"} -->');
    const sidebarIndex = interiorTemplate.indexOf('wp:template-part {"slug":"interior-chrome-reference","tagName":"aside"}');
    const wrapperCloseIndex = interiorTemplate.lastIndexOf('<!-- /wp:group -->');

    expect([wrapperIndex, mainIndex, sidebarIndex, wrapperCloseIndex].every((idx) => idx >= 0)).toBe(true);
    expect(wrapperIndex).toBeLessThan(mainIndex);
    expect(mainIndex).toBeLessThan(sidebarIndex);
    expect(sidebarIndex).toBeLessThan(wrapperCloseIndex);
  });

  it('produces unique relativePaths (no duplicates from the swap)', () => {
    const paths = files.map((f) => f.relativePath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('front-page.html is byte-identical to page-local.html (single no-title shape)', () => {
    expect(files.find((f) => f.relativePath === 'templates/front-page.html')?.content).toBe(
      files.find((f) => f.relativePath === 'templates/page-local.html')?.content,
    );
  });

  it('passes a provided foundation + fonts to the scaffold', () => {
    const files = assembleLocalTheme({
      siteTitle: 'Acme Co',
      themeSlug: 'acme-local',
      headerPart: HEADER,
      footerPart: FOOTER,
      foundation: {
        color: {
          surface: { base: { value: '#f7f2e9' }, inverse: { value: '#0e2a30' } },
          text: { default: { value: '#0e2a30' }, inverse: { value: '#f7f2e9' } },
          accent: { primary: { value: '#e2573b' } },
        },
        typography: { families: { body: { value: '"Work Sans", sans-serif' }, display: { value: 'Fraunces, serif' } } },
        components: { button: { background: '#e2573b', text: '#f7f2e9', radius: '999px' } },
      },
      capturedFonts: [
        { family: 'Fraunces', src: 'https://x/f.woff2', format: 'woff2', weight: '900', style: 'normal', localPath: 'assets/fonts/Fraunces-900.woff2' },
      ],
    });
    const themeJson = JSON.parse(files.find((f) => f.relativePath === 'theme.json')?.content ?? '{}') as {
      settings?: { color?: { palette?: Array<{ slug: string; color: string }> }; typography?: { fontFamilies?: Array<{ slug: string }> } };
      styles?: { blocks?: Record<string, unknown> };
    };
    const palette = themeJson.settings?.color?.palette ?? [];
    expect(palette.find((p) => p.slug === 'accent-primary')?.color).toBe('#e2573b');
    expect(palette.find((p) => p.slug === 'surface-base')?.color).toBe('#f7f2e9');
    const styleCss = files.find((f) => f.relativePath === 'style.css')?.content ?? '';
    expect(styleCss).toContain('@font-face');
    expect(styleCss).toContain('Fraunces-900.woff2');
  });

  it('still defaults to the minimal foundation when none provided', () => {
    const files = assembleLocalTheme({ siteTitle: 'Acme Co', themeSlug: 'acme-local', headerPart: HEADER, footerPart: FOOTER });
    const themeJson = JSON.parse(files.find((f) => f.relativePath === 'theme.json')?.content ?? '{}') as {
      settings?: { color?: { palette?: Array<{ slug: string; color: string }> } };
    };
    // Default-foundation accent must flow through — locks the fallback path live.
    expect(themeJson.settings?.color?.palette?.find((p) => p.slug === 'accent-primary')?.color).toBe('#0066cc');
  });

  it('carry mode adds source assets, strips theme.json styles, and enqueues last', () => {
    const carryFiles = assembleLocalTheme({
      siteTitle: 'Acme Co',
      themeSlug: 'acme-local',
      headerPart: HEADER,
      footerPart: FOOTER,
      carrySourceAssets: { css: '/* compat */ body{background:#fff}', js: "console.log('x')" },
    });
    const paths = carryFiles.map((f) => f.relativePath);
    expect(paths).toContain('assets/css/source.css');
    expect(paths).toContain('assets/js/source.js');
    expect(carryFiles.find((f) => f.relativePath === 'assets/css/source.css')?.content).toContain('background:#fff');
    const themeJson = JSON.parse(carryFiles.find((f) => f.relativePath === 'theme.json')?.content ?? '{}') as {
      styles?: unknown;
      settings?: unknown;
    };
    expect(themeJson.styles).toBeUndefined(); // interference stripped
    expect(themeJson.settings).toBeDefined(); // editor UX kept
    // Lint lock: stripped theme.json must still pass activation-gate invariants.
    expect(lintThemeJson(JSON.parse(carryFiles.find((f) => f.relativePath === 'theme.json')?.content ?? '{}')).ok).toBe(true);
    const fns = carryFiles.find((f) => f.relativePath === 'functions.php')?.content ?? '';
    expect(fns).toContain('assets/css/source.css');
    expect(fns).toContain('assets/js/source.js');
    expect(fns).toContain("documentElement.classList.add('js')"); // html.js gate snippet
    // Carry enqueue must appear AFTER the theme style (priority 20, dependency on theme handle).
    expect(fns.indexOf('source.css')).toBeGreaterThan(fns.indexOf('get_stylesheet_uri'));
    // Dependency array must reference the correct theme style handle.
    expect(fns).toContain("array( 'acme-local-style' )");
  });

  it('without carry mode, no source assets and styles kept (existing behavior)', () => {
    const noCarryFiles = assembleLocalTheme({
      siteTitle: 'Acme Co',
      themeSlug: 'acme-local',
      headerPart: HEADER,
      footerPart: FOOTER,
    });
    expect(noCarryFiles.some((f) => f.relativePath === 'assets/css/source.css')).toBe(false);
    const themeJson = JSON.parse(
      noCarryFiles.find((f) => f.relativePath === 'theme.json')?.content ?? '{}',
    ) as { styles?: unknown };
    expect(themeJson.styles).toBeDefined();
  });

  it('js-only carry: adds source.js, does not add source.css, does not strip theme.json styles', () => {
    // css: '' → css is empty → skip css file, keep theme.json styles intact
    const jsOnlyFiles = assembleLocalTheme({
      siteTitle: 'Acme Co',
      themeSlug: 'acme-local',
      headerPart: HEADER,
      footerPart: FOOTER,
      carrySourceAssets: { css: '', js: "console.log('x')" },
    });
    expect(jsOnlyFiles.some((f) => f.relativePath === 'assets/css/source.css')).toBe(false);
    expect(jsOnlyFiles.some((f) => f.relativePath === 'assets/js/source.js')).toBe(true);
    const themeJson = JSON.parse(
      jsOnlyFiles.find((f) => f.relativePath === 'theme.json')?.content ?? '{}',
    ) as { styles?: unknown };
    expect(themeJson.styles).toBeDefined(); // styles kept — no css carry
    // Symmetric lock: JS IS carried here, so the html.js gate must be present.
    const fns = jsOnlyFiles.find((f) => f.relativePath === 'functions.php')?.content ?? '';
    expect(fns).toContain("classList.add('js')");
  });

  it('carry mode enqueues parity-patch.css after the source style (mtime-guarded)', () => {
    const files = assembleLocalTheme({ siteTitle: 'A', themeSlug: 'a-local', headerPart: HEADER, footerPart: FOOTER, carrySourceAssets: { css: 'body{}', js: '' } });
    const fns = files.find((f) => f.relativePath === 'functions.php')?.content ?? '';
    expect(fns).toContain('assets/css/parity-patch.css');
    expect(fns).toContain("array( 'a-local-source' )"); // dep: after source css
    expect(fns.indexOf('parity-patch')).toBeGreaterThan(fns.indexOf('source.css'));
  });

  it('patch enqueue dep falls back to the theme style handle when source.css is absent (js-only carry)', () => {
    const files = assembleLocalTheme({ siteTitle: 'A', themeSlug: 'a-local', headerPart: HEADER, footerPart: FOOTER, carrySourceAssets: { css: '', js: 'x()' } });
    const fns = files.find((f) => f.relativePath === 'functions.php')?.content ?? '';
    // Patch enqueue still present without css carry…
    expect(fns).toContain("'a-local-parity-patch'");
    // …and the dep is decided at runtime via if/elseif/else: instance-styles
    // when present, else source.css, else the always-registered theme style
    // handle. A hardcoded -source dep would be UNREGISTERED in js-only carry and
    // WP would silently drop the patch — the repair loop could never converge.
    expect(fns).toContain("$deps = array( 'a-local-instance' );"); // when instance-styles exist
    expect(fns).toContain("$deps = array( 'a-local-source' );"); // elseif source.css exists
    expect(fns).toContain("$deps = array( 'a-local-style' );"); // else: always-registered theme style
    expect(fns).toMatch(/parity-patch\.css' \), \$deps,/);
  });

  it('enqueue guards tolerate realpath-cache stat lies (@filemtime, no page-output warnings)', () => {
    // PHP's realpath cache keeps file_exists() TRUE for up to 120s after a
    // deletion while filemtime() stat-fails — the bare call printed a PHP
    // warning INTO the served page. The truthful guard is one suppressed
    // stat: @filemtime + false !== check, reused for the enqueue version.
    const files = assembleLocalTheme({ siteTitle: 'A', themeSlug: 'a-local', headerPart: HEADER, footerPart: FOOTER, carrySourceAssets: { css: 'body{}', js: 'x()' } });
    const fns = files.find((f) => f.relativePath === 'functions.php')?.content ?? '';
    expect(fns).toContain('$css_mtime = @filemtime( $css );');
    expect(fns).toContain('if ( false !== $css_mtime ) {');
    expect(fns).toContain('$js_mtime = @filemtime( $js );');
    expect(fns).toContain('if ( false !== $js_mtime ) {');
    expect(fns).toContain('$patch_mtime = @filemtime( $patch );');
    expect(fns).toContain('if ( false !== $patch_mtime ) {');
    expect(fns).toContain('(string) $css_mtime');
    expect(fns).toContain('(string) $js_mtime');
    expect(fns).toContain('(string) $patch_mtime');
    // The lying guard forms must be gone from the carry block. (Locks use the
    // carry block's spaced style — the scaffold base legitimately keeps its own
    // unspaced file_exists($style_path)/filemtime($gs_path) calls.)
    expect(fns).not.toContain('if ( file_exists( $css ) )');
    expect(fns).not.toContain('if ( file_exists( $js ) )');
    expect(fns).not.toContain('if ( file_exists( $patch ) )');
    expect(fns).not.toContain('(string) filemtime( $');
  });

  it('css-only carry: no js file and NO html.js gate (gated CSS must not hide content)', () => {
    // js: '' → no source script ships, so nothing would ever reveal sections
    // that reveal-gated source CSS hides behind html.js. Emitting the gate
    // anyway would permanently blank above-fold content.
    const cssOnlyFiles = assembleLocalTheme({
      siteTitle: 'Acme Co',
      themeSlug: 'acme-local',
      headerPart: HEADER,
      footerPart: FOOTER,
      carrySourceAssets: { css: '.html.js .s{opacity:0}', js: '' },
    });
    expect(cssOnlyFiles.some((f) => f.relativePath === 'assets/js/source.js')).toBe(false);
    expect(cssOnlyFiles.some((f) => f.relativePath === 'assets/css/source.css')).toBe(true);
    const fns = cssOnlyFiles.find((f) => f.relativePath === 'functions.php')?.content ?? '';
    expect(fns).not.toContain("classList.add('js')");
    // The CSS enqueue itself still lands.
    expect(fns).toContain('assets/css/source.css');
  });
});

describe('instance-styles carry (per-instance lib-i rules)', () => {
  const HEADER = '<!-- wp:template-part {"slug":"header"} /-->';
  const FOOTER = '<!-- wp:template-part {"slug":"footer"} /-->';

  it('writes assets/css/instance-styles.css and enqueues it after source.css (cascade order)', () => {
    const files = assembleLocalTheme({
      siteTitle: 'A',
      themeSlug: 'a-local',
      headerPart: HEADER,
      footerPart: FOOTER,
      carrySourceAssets: { css: 'body{}', js: '' },
      instanceStylesCss: '.lib-iabc123{font-size:clamp(3rem,9vw,6.5rem)}',
    });
    const asset = files.find((f) => f.relativePath === 'assets/css/instance-styles.css');
    expect(asset?.content).toContain('.lib-iabc123{font-size:clamp(3rem,9vw,6.5rem)}');
    const fns = files.find((f) => f.relativePath === 'functions.php')?.content ?? '';
    expect(fns).toContain("'a-local-instance'");
    expect(fns).toContain('assets/css/instance-styles.css');
    // Cascade order: instance after source, parity after instance.
    expect(fns.indexOf('instance-styles.css')).toBeGreaterThan(fns.indexOf('source.css'));
    expect(fns.indexOf('parity-patch.css')).toBeGreaterThan(fns.indexOf('instance-styles.css'));
    // Instance dep: after source.css.
    expect(fns).toContain("$inst_deps = false !== $css_mtime ? array( 'a-local-source' )");
  });

  it('add_editor_style loads the carried frontend CSS into the editor canvas (source+instance+parity)', () => {
    const files = assembleLocalTheme({
      siteTitle: 'A',
      themeSlug: 'a-local',
      headerPart: HEADER,
      footerPart: FOOTER,
      carrySourceAssets: { css: 'body{}', js: '' },
      instanceStylesCss: '.lib-iabc123{max-width:46ch}',
    });
    const fns = files.find((f) => f.relativePath === 'functions.php')?.content ?? '';
    expect(fns).toContain('add_editor_style');
    expect(fns).toContain("add_theme_support( 'editor-styles' )");
    expect(fns).toContain(
      "'assets/css/source.css', 'assets/css/instance-styles.css', 'assets/css/parity-patch.css', 'assets/css/editor-reveal-reset.css'",
    );
    // Guarded so an absent asset is skipped, not fatal.
    expect(fns).toContain('if ( file_exists( get_theme_file_path( $rel ) ) )');
    // The editor reveal-reset ships as a theme file and forces carried
    // scroll-reveal blocks visible in the editor canvas...
    const reset = files.find((f) => f.relativePath === 'assets/css/editor-reveal-reset.css');
    expect(reset?.content).toContain('opacity: 1 !important');
    expect(reset?.content).toContain('.reveal');
    // ...but it is EDITOR-ONLY: never wp_enqueue_style'd on the front end (so the
    // live reveal animation is untouched). The frontend enqueue block precedes
    // the after_setup_theme (editor) block in functions.php.
    const frontendEnqueues = fns.slice(0, fns.indexOf("add_action( 'after_setup_theme'"));
    expect(frontendEnqueues).not.toContain('editor-reveal-reset');
  });

  it('no instanceStylesCss → no asset file, but add_editor_style still loads source.css', () => {
    const files = assembleLocalTheme({
      siteTitle: 'A',
      themeSlug: 'a-local',
      headerPart: HEADER,
      footerPart: FOOTER,
      carrySourceAssets: { css: 'body{}', js: '' },
    });
    expect(files.some((f) => f.relativePath === 'assets/css/instance-styles.css')).toBe(false);
    const fns = files.find((f) => f.relativePath === 'functions.php')?.content ?? '';
    expect(fns).toContain('add_editor_style'); // editor parity is unconditional in carry
  });

  it('instance-styles is not written without a CSS carry (rules refine the source sheet)', () => {
    const files = assembleLocalTheme({
      siteTitle: 'A',
      themeSlug: 'a-local',
      headerPart: HEADER,
      footerPart: FOOTER,
      carrySourceAssets: { css: '', js: 'x()' },
      instanceStylesCss: '.lib-iabc123{max-width:46ch}',
    });
    expect(files.some((f) => f.relativePath === 'assets/css/instance-styles.css')).toBe(false);
  });
});

describe('Jetpack form parity CSS carry', () => {
  it('writes the contract asset and loads it after source/instance styles but before parity-patch', () => {
    const files = assembleLocalTheme({
      siteTitle: 'A',
      themeSlug: 'a-local',
      headerPart: HEADER,
      footerPart: FOOTER,
      carrySourceAssets: { css: 'body{}', js: '' },
      instanceStylesCss: '.lib-iabc123{max-width:46ch}',
      jetpackFormParityCss: '.wp-block-jetpack-contact-form{gap:1rem}',
    });
    expect(files.find((f) => f.relativePath === JETPACK_FORM_PARITY_CSS.themeRelativePath)?.content).toBe(
      '.wp-block-jetpack-contact-form{gap:1rem}\n',
    );

    const fns = files.find((f) => f.relativePath === 'functions.php')?.content ?? '';
    const sourceIdx = fns.indexOf("wp_enqueue_style( 'a-local-source'");
    const instanceIdx = fns.indexOf("wp_enqueue_style( 'a-local-instance'");
    const jetpackIdx = fns.indexOf("wp_enqueue_style( 'a-local-jetpack-form-parity'");
    const patchIdx = fns.indexOf("wp_enqueue_style( 'a-local-parity-patch'");
    expect([sourceIdx, instanceIdx, jetpackIdx, patchIdx].every((idx) => idx >= 0)).toBe(true);
    expect(sourceIdx).toBeLessThan(instanceIdx);
    expect(instanceIdx).toBeLessThan(jetpackIdx);
    expect(jetpackIdx).toBeLessThan(patchIdx);
    expect(fns).toContain("$jetpack_deps = array( 'a-local-instance' );");
    expect(fns).toContain("$deps = array( 'a-local-jetpack-form-parity' );");
    expect(fns).toContain(
      "'assets/css/source.css', 'assets/css/instance-styles.css', 'assets/css/jetpack-form-parity.css', 'assets/css/parity-patch.css'",
    );
  });

  it('does not write or enqueue Jetpack form parity CSS when the stylesheet is empty', () => {
    const files = assembleLocalTheme({
      siteTitle: 'A',
      themeSlug: 'a-local',
      headerPart: HEADER,
      footerPart: FOOTER,
      carrySourceAssets: { css: 'body{}', js: '' },
      jetpackFormParityCss: '   ',
    });
    expect(files.some((f) => f.relativePath === JETPACK_FORM_PARITY_CSS.themeRelativePath)).toBe(false);
    const fns = files.find((f) => f.relativePath === 'functions.php')?.content ?? '';
    expect(fns).not.toContain('jetpack-form-parity');
  });
});

describe('body-data replay shim (JS-rendered sites)', () => {
  it('emits a wp_body_open script replaying data-* attrs by pathname', () => {
    const files = assembleLocalTheme({
      siteTitle: 'T',
      themeSlug: 't',
      headerPart: 'H',
      footerPart: 'F',
      carrySourceAssets: { css: 'body{}', js: 'x();' },
      bodyDataByPath: { '/': { page: 'home' }, '/shop/': { page: 'shop' } },
    });
    const fn = files.find((f) => f.relativePath === 'functions.php')!.content;
    expect(fn).toContain('wp_body_open');
    expect(fn).toContain('"/shop/":{"page":"shop"}');
    expect(fn).toContain('setAttribute');
    // </script>-safe: the JSON is < -escaped so a value can never close the tag.
    expect(fn).not.toContain('</script></script>');
  });

  it('no shim without bodyDataByPath (regression)', () => {
    const files = assembleLocalTheme({
      siteTitle: 'T',
      themeSlug: 't',
      headerPart: 'H',
      footerPart: 'F',
      carrySourceAssets: { css: 'body{}', js: 'x();' },
    });
    expect(files.find((f) => f.relativePath === 'functions.php')!.content).not.toContain('wp_body_open');
  });
});
