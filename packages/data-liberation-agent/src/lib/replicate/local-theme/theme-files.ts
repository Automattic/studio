// src/lib/replicate/local-theme/theme-files.ts
//
// Assemble the local-site block theme: run the REUSED buildThemeScaffold with
// a minimal default design foundation (stage 1b has no Playwright token
// capture — tokens arrive in a later stage), then post-process the file list:
// swap in the local chrome parts and add no-title page templates. Sidecar
// content carries its own <h1>, so page templates render post-content only
// (a post-title block would duplicate the hero heading).
//
// DesignFoundation is a lib-local non-exported interface in theme-scaffold.ts;
// the plain object below is structurally compatible (all fields are optional)
// so TypeScript accepts it without a cast.
//
import { buildThemeScaffold } from '../theme-scaffold.js';
import type { ReplicaFile } from '../../preview/types.js';
import type { LocalFontFace } from '../font-capture.js';
import { escapeHtml } from '../normalize/emit-blocks.js';
import { JETPACK_FORM_PARITY_CSS } from './jetpack-form-parity-contract.js';
import type { InteriorChromeTemplate } from './interior-chrome.js';

/** Minimal foundation — all DesignFoundation fields are optional; this sets
 *  just enough for buildThemeScaffold to emit a valid theme.json palette/font
 *  entry without choking on undefined reads. */
const DEFAULT_LOCAL_FOUNDATION = {
  color: {
    surface: { base: { value: '#ffffff' } },
    text: { default: { value: '#111111' } },
    accent: { primary: { value: '#0066cc' } },
  },
  typography: { families: { body: { value: 'system-ui, sans-serif' } } },
};

export interface CarrySourceAssets {
  /** Compat layer + adapted source CSS (from collectSourceAssets). Empty string = no CSS carry. */
  css: string;
  /** Source JS concatenated (from collectSourceAssets). Empty string = no JS carry. */
  js: string;
}

export interface AssembleLocalThemeOpts {
  siteTitle: string;
  themeSlug: string;
  headerPart: string;
  footerPart: string;
  /** Captured design foundation (from buildLocalFoundation). Defaults to the minimal foundation. */
  foundation?: Parameters<typeof buildThemeScaffold>[0]['foundation'];
  /** Self-hosted fonts captured from the source site — emitted as @font-face + theme.json fontFamilies. */
  capturedFonts?: LocalFontFace[];
  /** Stage 1d: carry the source site's CSS/JS into the theme. When set and css is
   * non-empty, theme.json `styles` is stripped (source CSS is the design authority;
   * settings stay for editor pickers). Each asset file is written only when non-empty. */
  carrySourceAssets?: CarrySourceAssets;
  /** Per-instance lib-i<hash> rules (from ingest's instance-styles.css, merged
   * with chrome rules) for inline styles carried as classes. Written to
   * assets/css/instance-styles.css and loaded on BOTH the frontend and the
   * editor canvas. Empty/absent → no file, no enqueue. Only meaningful when
   * carrySourceAssets carries CSS. */
  instanceStylesCss?: string;
  /** Jetpack form parity rules derived from carried source CSS. Written and
   * enqueued only when non-empty, after source/instance CSS and before the
   * deterministic parity patch. */
  jetpackFormParityCss?: string;
  /** Source body data-* attributes per permalink pathname (keys WITHOUT the
   * data- prefix). Replayed by a wp_body_open shim before any deferred script
   * runs — JS-rendered sites key behavior off them (body[data-page] active
   * nav). Emitted only inside the carry block (the attrs matter to carried
   * source JS). */
  bodyDataByPath?: Record<string, Record<string, string>>;
  /** Source <main> element class (e.g. a "page-sections" class). Applied to the
   * page templates' core/post-content so source body-layout rules that key off
   * it (notably a `> * + *` blockGap between page sections) keep matching. */
  mainClass?: string;
  /** Page-scoped chrome parts/templates for rails that are absent from home. */
  interiorChromeTemplates?: InteriorChromeTemplate[];
}

/** No-title page template: header part → post-content → footer part.
 *  Sidecar markup already contains its own <h1>, so wp:post-title is omitted
 *  to avoid duplicating the hero heading. Used for both page-local and
 *  front-page templates. Layout is default (flow) — constrained would inject
 *  a contentSize max-width onto children that fights the carried source
 *  main{max-width} rule (stage 1d parity); the source CSS owns layout. */
function noTitleTemplate(mainClass?: string, interiorChrome?: InteriorChromeTemplate): string {
  // Carry the source <main> class onto the post-content wrapper: source body
  // layout rules key off it (e.g. a `.<main-class> > * + * { margin-top }`
  // blockGap between page sections). The sections render as post-content's
  // DIRECT children, so the class must sit on post-content (not the <main>
  // group, whose only child is post-content) for the child-combinator to match.
  const postContent = mainClass
    ? `<!-- wp:post-content {"className":${JSON.stringify(mainClass)}} /-->`
    : `<!-- wp:post-content /-->`;
  const sidebarPart = interiorChrome?.partSlug
    ? `<!-- wp:template-part {"slug":${JSON.stringify(interiorChrome.partSlug)},"tagName":"aside"} /-->\n\n`
    : '';
  const mainGroup =
    `<!-- wp:group {"tagName":"main"} -->\n` +
    `<main class="wp-block-group">\n` +
    `${postContent}\n` +
    `</main>\n` +
    `<!-- /wp:group -->\n\n`;
  const headerPart = `<!-- wp:template-part {"slug":"header","tagName":"header"} /-->\n\n`;
  const footerPart = `<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->\n`;
  const wrapperTag = interiorChrome?.layoutWrapperTag?.trim();
  if (interiorChrome && sidebarPart && wrapperTag) {
    const wrapperClasses = (interiorChrome.layoutWrapperClasses ?? []).filter(Boolean).join(' ').trim();
    const wrapperAttrs = wrapperClasses ? { tagName: wrapperTag, className: wrapperClasses } : { tagName: wrapperTag };
    const wrapperClassAttr = ['wp-block-group', wrapperClasses].filter(Boolean).join(' ');
    const wrappedContent =
      interiorChrome.layoutWrapperRailPosition === 'afterMain'
        ? mainGroup + sidebarPart
        : sidebarPart + mainGroup;
    const wrapperClassValue = escapeHtml(wrapperClassAttr);
    return (
      headerPart +
      `<!-- wp:group ${JSON.stringify(wrapperAttrs)} -->\n` +
      `<${wrapperTag} class="${wrapperClassValue}">\n` +
      wrappedContent +
      `</${wrapperTag}>\n` +
      `<!-- /wp:group -->\n\n` +
      footerPart
    );
  }
  return (
    headerPart +
    sidebarPart +
    mainGroup +
    `<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->\n`
  );
}

/** functions.php block appended in carry mode — enqueue source assets after
 * the theme stylesheet + global styles, and add the html.js gate the source
 * reveal scripts expect. Priority 20 ensures it lands AFTER the default
 * wp_enqueue_scripts (10) and global styles injected by the block editor.
 *
 * The html.js gate is emitted ONLY when source JS is actually carried
 * (emitHtmlJsGate): reveal-gated source CSS hides sections behind html.js
 * and relies on a source script (observer) to reveal them — adding the class
 * with no script present would leave that content permanently hidden. */
function carryEnqueueBlock(
  themeSlug: string,
  emitHtmlJsGate: boolean,
  bodyDataByPath?: Record<string, Record<string, string>>,
  includeJetpackFormParity = false,
): string {
  const htmlJsBlock = emitHtmlJsGate
    ? `
// Source reveal scripts gate on html.js (no-JS visitors keep content visible).
add_action( 'wp_head', function () {
    echo "<script>document.documentElement.classList.add('js');</script>";
}, 0 );
`
    : '';
  // Replay the SOURCE body data-* attributes (keys stored bare) by pathname,
  // at wp_body_open — before any deferred script runs — so carried source JS
  // that keys off body[data-*] (active-nav, page modes) behaves identically.
  // JSON is <-escaped so no value can close the script tag.
  const bodyDataBlock =
    bodyDataByPath && Object.keys(bodyDataByPath).length > 0
      ? `
// JS-rendered source: replay body data-* attributes per pathname.
add_action( 'wp_body_open', function () {
    echo '<script>(function(){var m=${JSON.stringify(bodyDataByPath).replace(/</g, '\\u003c').replace(/'/g, "\\'")};var d=m[location.pathname];if(d){for(var k in d){document.body.setAttribute("data-"+k,d[k]);}}})();</script>';
} );
`
      : '';
  const jetpackPath = JETPACK_FORM_PARITY_CSS.themeRelativePath;
  const jetpackHandle = `${themeSlug}-${JETPACK_FORM_PARITY_CSS.frontendHandleSuffix}`;
  const jetpackEnqueueBlock = includeJetpackFormParity
    ? `
    $jetpack_form = get_theme_file_path( '${jetpackPath}' );
    $jetpack_form_mtime = @filemtime( $jetpack_form );
    if ( false !== $jetpack_form_mtime ) {
        if ( false !== $inst_mtime ) {
            $jetpack_deps = array( '${themeSlug}-instance' );
        } elseif ( false !== $css_mtime ) {
            $jetpack_deps = array( '${themeSlug}-source' );
        } else {
            $jetpack_deps = array( '${themeSlug}-style' );
        }
        wp_enqueue_style( '${jetpackHandle}', get_theme_file_uri( '${jetpackPath}' ), $jetpack_deps, (string) $jetpack_form_mtime );
    }
`
    : '';
  const patchDepsBlock = includeJetpackFormParity
    ? `        if ( false !== $jetpack_form_mtime ) {
            $deps = array( '${jetpackHandle}' );
        } elseif ( false !== $inst_mtime ) {
            $deps = array( '${themeSlug}-instance' );
        } elseif ( false !== $css_mtime ) {
            $deps = array( '${themeSlug}-source' );
        } else {
            $deps = array( '${themeSlug}-style' );
        }`
    : `        if ( false !== $inst_mtime ) {
            $deps = array( '${themeSlug}-instance' );
        } elseif ( false !== $css_mtime ) {
            $deps = array( '${themeSlug}-source' );
        } else {
            $deps = array( '${themeSlug}-style' );
        }`;
  const editorStylePaths = [
    'assets/css/source.css',
    'assets/css/instance-styles.css',
    ...(includeJetpackFormParity ? [JETPACK_FORM_PARITY_CSS.editorStylePath] : []),
    'assets/css/parity-patch.css',
    // LAST so it wins: force carried scroll-reveal initial-hidden states visible
    // in the editor canvas (which can't run the reveal JS). Editor-only.
    'assets/css/editor-reveal-reset.css',
  ];
  const cascadeComment = includeJetpackFormParity
    ? `// wins) → jetpack-form-parity.css (form-specific carried CSS bridge) →
// parity-patch.css (final deterministic fixes).`
    : `// wins) → parity-patch.css (final deterministic fixes).`;
  return `
// Stage 1d carry: the source site's own CSS/JS, adapted for the block DOM.
// Enqueued at priority 20 so it lands AFTER global styles + theme style.
// Guards are @filemtime (not file_exists): PHP's realpath cache keeps
// file_exists() TRUE for up to 120s after a deletion while the stat fails,
// and the bare filemtime() printed a warning INTO the served page. One
// suppressed stat is the truthful existence check AND the enqueue version.
//
// Cascade order is load-bearing: theme style → source.css → instance-styles.css
// (per-instance lib-i rules override class defaults; equal specificity, later
${cascadeComment}
add_action( 'wp_enqueue_scripts', function () {
    $css = get_theme_file_path( 'assets/css/source.css' );
    $css_mtime = @filemtime( $css );
    if ( false !== $css_mtime ) {
        wp_enqueue_style( '${themeSlug}-source', get_theme_file_uri( 'assets/css/source.css' ), array( '${themeSlug}-style' ), (string) $css_mtime );
    }
    $js = get_theme_file_path( 'assets/js/source.js' );
    $js_mtime = @filemtime( $js );
    if ( false !== $js_mtime ) {
        wp_enqueue_script( '${themeSlug}-source', get_theme_file_uri( 'assets/js/source.js' ), array(), (string) $js_mtime, true );
    }
    $inst = get_theme_file_path( 'assets/css/instance-styles.css' );
    $inst_mtime = @filemtime( $inst );
    if ( false !== $inst_mtime ) {
        $inst_deps = false !== $css_mtime ? array( '${themeSlug}-source' ) : array( '${themeSlug}-style' );
        wp_enqueue_style( '${themeSlug}-instance', get_theme_file_uri( 'assets/css/instance-styles.css' ), $inst_deps, (string) $inst_mtime );
    }
${jetpackEnqueueBlock}
    $patch = get_theme_file_path( 'assets/css/parity-patch.css' );
    $patch_mtime = @filemtime( $patch );
    if ( false !== $patch_mtime ) {
${patchDepsBlock}
        wp_enqueue_style( '${themeSlug}-parity-patch', get_theme_file_uri( 'assets/css/parity-patch.css' ), $deps, (string) $patch_mtime );
    }
}, 20 );
// Editor parity: load the SAME carried frontend CSS into the block-editor
// canvas iframe so blocks render styled in the editor (matching the frontend),
// not as unstyled defaults. add_editor_style takes theme-relative paths in
// cascade order; file_exists guards keep it safe when an asset is absent.
add_action( 'after_setup_theme', function () {
    add_theme_support( 'editor-styles' );
    foreach ( array( ${editorStylePaths.map((p) => `'${p}'`).join(', ')} ) as $rel ) {
        if ( file_exists( get_theme_file_path( $rel ) ) ) {
            add_editor_style( $rel );
        }
    }
} );
${htmlJsBlock}${bodyDataBlock}`;
}

/** Editor-only CSS: the block-editor canvas renders blocks statically and never
 * runs the source's scroll-reveal JS, so any carried animate-in initial-hidden
 * state (opacity:0 + a JS-toggled class) would leave blocks invisible and
 * uneditable. Force the common reveal/fade/animate patterns visible. Added via
 * add_editor_style ONLY (never enqueued on the front end), so the live reveal
 * animation is untouched. `!important` beats the carried (non-important) rules. */
export const EDITOR_REVEAL_RESET_CSS = `/* editor-reveal-reset.css — add_editor_style ONLY; never a front-end style. */
.reveal,
[class*="reveal"],
[class*="fade-in"],
[class*="fadein"],
[class*="animate"],
[class*="aos-"],
[data-aos] {
  opacity: 1 !important;
  transform: none !important;
  visibility: visible !important;
  animation: none !important;
  transition: none !important;
}
`;

export function assembleLocalTheme(opts: AssembleLocalThemeOpts): ReplicaFile[] {
  // NOTE: buildThemeScaffold's footerBgToken/footerTextToken opts are NOT
  // passed here — they only style the scaffold's OWN parts/footer.html, which
  // we unconditionally swap with opts.footerPart below. Footer band styling
  // belongs in buildFooterPart (chrome-parts.ts bgToken/textToken).
  const base = buildThemeScaffold({
    foundation: opts.foundation ?? DEFAULT_LOCAL_FOUNDATION,
    themeSlug: opts.themeSlug,
    siteTitle: opts.siteTitle,
    capturedFonts: opts.capturedFonts,
  });

  // Swap scaffold-generated chrome parts with the locally-built versions.
  const swapped = base.map((f) => {
    if (f.relativePath === 'parts/header.html') return { ...f, content: opts.headerPart };
    if (f.relativePath === 'parts/footer.html') return { ...f, content: opts.footerPart };
    return f;
  });

  // Register page-local as a selectable custom template so _wp_page_template
  // assignment resolves (template files alone don't appear in the dropdown).
  const withTemplates = swapped.map((f) => {
    if (f.relativePath !== 'theme.json') return f;
    const parsed = JSON.parse(f.content) as Record<string, unknown> & {
      customTemplates?: Array<{ name: string; title: string; postTypes?: string[] }>;
    };
    const customTemplates = [
      ...(parsed.customTemplates ?? []),
      { name: 'page-local', title: 'Local Page (no title)', postTypes: ['page'] },
      ...(opts.interiorChromeTemplates ?? []).map((t) => ({
        name: t.templateName,
        title: t.templateTitle,
        postTypes: ['page'],
      })),
    ];
    // Trailing newline matches the scaffold's theme.json emit convention.
    return { ...f, content: JSON.stringify({ ...parsed, customTemplates }, null, 2) + '\n' };
  });

  const template = noTitleTemplate(opts.mainClass);
  // page-local: the selectable per-page template assigned via _wp_page_template.
  withTemplates.push({ relativePath: 'templates/page-local.html', content: template });
  for (const interior of opts.interiorChromeTemplates ?? []) {
    withTemplates.push({ relativePath: `parts/${interior.partSlug}.html`, content: interior.partMarkup });
    withTemplates.push({
      relativePath: `templates/${interior.templateName}.html`,
      content: noTitleTemplate(opts.mainClass, interior),
    });
  }
  // front-page.html: WP serves this at the site root when static front page is set;
  // same shape ensures the home page also uses the no-title layout.
  // buildThemeScaffold does NOT emit front-page.html with a minimal call (only
  // emitted when reconstructedPages has isHome: true — which this call omits),
  // so no duplicate path is introduced.
  withTemplates.push({ relativePath: 'templates/front-page.html', content: template });

  const jetpackFormParityCss = (opts.jetpackFormParityCss ?? '').trim();
  const hasJetpackFormParityCss = jetpackFormParityCss.length > 0;

  // Stage 1d carry: wire source CSS/JS into the theme so the class-preserving
  // block DOM renders under the designer's own stylesheet. Jetpack form parity
  // CSS rides the same cascade block when present.
  if (opts.carrySourceAssets || hasJetpackFormParityCss) {
    const { css, js } = opts.carrySourceAssets ?? { css: '', js: '' };
    const hasCSS = css.trim().length > 0;
    const hasJS = js.trim().length > 0;

    // 1. Strip theme.json styles — source CSS is the design authority. Strip
    //    ONLY when CSS is non-empty: if only JS is carried the token-based
    //    styles remain the layout layer. Trailing newline preserved (convention).
    if (hasCSS) {
      const idx = withTemplates.findIndex((f) => f.relativePath === 'theme.json');
      if (idx >= 0) {
        const parsed = JSON.parse(withTemplates[idx].content) as Record<string, unknown> & {
          settings?: Record<string, unknown> & { spacing?: Record<string, unknown> };
        };
        delete parsed.styles;
        // blockGap:null disables WP's layout-support emission wholesale —
        // the injected :where(.is-layout-flow) child margin-zeroing + uniform
        // gap rules override the UA-default margins the source rhythm relies
        // on (probe: replica h1 margin-bottom forced to 0). Layout supports
        // apply flow by DEFAULT even with no layout attr, so this is the only
        // reliable off switch.
        parsed.settings = { ...(parsed.settings ?? {}), spacing: { ...(parsed.settings?.spacing ?? {}), blockGap: null } };
        withTemplates[idx] = { ...withTemplates[idx], content: JSON.stringify(parsed, null, 2) + '\n' };
      }
    }

    // 2. Emit asset files — each file only when its content is non-empty.
    if (hasCSS) {
      withTemplates.push({ relativePath: 'assets/css/source.css', content: css });
      // Editor-only reveal reset (add_editor_style list above; NOT enqueued on
      // the front end), so blocks hidden by carried scroll-reveal CSS stay
      // visible + editable in the block editor while the live animation runs.
      withTemplates.push({ relativePath: 'assets/css/editor-reveal-reset.css', content: EDITOR_REVEAL_RESET_CSS });
    }
    if (hasJS) {
      withTemplates.push({ relativePath: 'assets/js/source.js', content: js });
    }
    if (hasJetpackFormParityCss) {
      withTemplates.push({ relativePath: JETPACK_FORM_PARITY_CSS.themeRelativePath, content: jetpackFormParityCss + '\n' });
    }
    // Per-instance lib-i rules ride a sibling asset (loaded after source.css on
    // both the frontend and the editor canvas). Only when CSS is carried — the
    // rules are meaningless without the source stylesheet they refine.
    const instanceCss = (opts.instanceStylesCss ?? '').trim();
    if (hasCSS && instanceCss.length > 0) {
      withTemplates.push({ relativePath: 'assets/css/instance-styles.css', content: instanceCss + '\n' });
    }

    // 3. Append the enqueue block to functions.php (@filemtime guards make
    //    it safe even when only one of the two assets is non-empty). The
    //    html.js gate ships only alongside actual source JS (hasJS).
    const fIdx = withTemplates.findIndex((f) => f.relativePath === 'functions.php');
    if (fIdx >= 0) {
      withTemplates[fIdx] = {
        ...withTemplates[fIdx],
        content:
          withTemplates[fIdx].content +
          carryEnqueueBlock(
            opts.themeSlug,
            hasJS,
            opts.carrySourceAssets ? opts.bodyDataByPath : undefined,
            hasJetpackFormParityCss,
          ),
      };
    }
  }

  return withTemplates;
}
