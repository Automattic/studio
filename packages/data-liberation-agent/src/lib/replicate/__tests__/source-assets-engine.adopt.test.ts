import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  collectSourceAssets,
  rewriteHtmlImageSrcs,
  WP_COMPAT_CSS,
} from '@automattic/blocks-engine/theme';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');

const WP_COMPAT_CSS_GOLDEN = `/* wp-compat: neutralize WP wrapper interference for carried source CSS */
/* NOTE deliberately NO .wp-block-template-part{display:contents} here: our
   parts use tagName header/footer, so the wrapper IS the semantic element —
   display:contents would destroy the box that source header{}/footer{} rules
   lay out (class specificity beats the element selector regardless of order).
   NOTE also deliberately NO blanket child-margin zeroing: the source relies on
   browser-default element margins (p, h1-h6, ul) — zeroing layout children
   collapsed the source's vertical rhythm. Blocks render as the same semantic
   elements, so the defaults already match. */
:where(body) { margin: 0; }
/* WP renders site-title as a <p> (default margins the source brand <a> never
   had) and wraps tables in a margined <figure>. Zero-spec so source rules win.
   The table figure is emitted CLASSLESS (block-library's .wp-block-table
   td/th rules would out-rank source element rules), so target it via :has. */
:where(.wp-block-site-title) { margin: 0; }
:where(figure:has(> table)) { margin: 0; }
/* Structural transparency for core/navigation: the source styles nav > a
   directly, while WP renders nav > ul > li > a. Collapsing the list boxes
   makes the anchors direct flex items of <nav>, so the source nav rules
   (display/gap/wrap/justify) drive the exact same geometry. Class-level
   specificity is required — block-library sets display:flex on these at
   (0,1,0)+ and a zero-spec :where loses (probe: anchors stayed inside the
   ul, justify-content flex-start left-packed the rows). Safe: source
   stylesheets never target wp-* classes. */
nav.wp-block-navigation ul, nav.wp-block-navigation li { display: contents; }
/* WP sets .wp-block-post-content{display:flow-root}, which BLOCKS the
   margin collapse the source layout relies on (last section margin-bottom
   collapsing with the footer margin-top — walrus probe: footer sat 88px
   lower). Class-level specificity is required to beat WP's own class rule;
   safe because no source stylesheet targets a wp-* class. */
.wp-block-post-content { display: block; }
/* core/button renders TWO boxes: the source button class lands on the
   .wp-block-button WRAPPER (core/button stores className there; the fixer
   strips it off the inner link), so the carried .btn/.btn-* rules style the
   wrapper pill — while the inner .wp-block-button__link still carries BOTH WP's
   default button chrome (fill bg + padding + radius) AND the carried source
   button class the emitter writes onto the link (a .btn box-shadow of 6px 6px 0
   ink casts a hard offset shadow behind the label — the double-border bug). Strip the
   inner link's whole box (incl. box-shadow) so the carried wrapper style renders
   once. The lib-cta marker (emit-blocks) scopes this to carried
   buttons so genuine native core/button blocks keep their chrome; class-level
   specificity beats WP's :where()/global-styles button defaults, and source
   stylesheets never target wp-* classes. */
.wp-block-button.lib-cta > .wp-block-button__link {
  background: transparent;
  border: 0;
  box-shadow: none;
  padding: 0;
  border-radius: inherit;
  color: inherit;
  text-decoration: none;
}
`;

function makeSite(): { dir: string; pages: Array<{ relPath: string; html: string }> } {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'source-assets-adopt-'));
  mkdirSync(join(dir, 'assets', 'css'), { recursive: true });
  mkdirSync(join(dir, 'assets', 'img'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });

  const indexHtml =
    '<html><head>' +
    '<link rel="stylesheet" href="assets/css/site.css">' +
    '<style>.inline{background:url("/assets/img/logo.png")}</style>' +
    '</head><body>' +
    '<main><img src="assets/img/logo.png"><img src=\'assets/img/card.jpg\'></main>' +
    '<script src="scripts/app.js"></script>' +
    '<script type="application/ld+json">{"skip":true}</script>' +
    '<script>bootInline();</script>' +
    '</body></html>';
  writeFileSync(join(dir, 'index.html'), indexHtml);
  writeFileSync(
    join(dir, 'assets', 'css', 'site.css'),
    "@import url('https://fonts.googleapis.com/css2?family=Inter&display=swap');\n" +
      '.hero{background:url("../img/logo.png")}\n' +
      '.card{background:url("../img/card.jpg")}\n' +
      '.font{src:url("../fonts/inter.woff2")}',
  );
  writeFileSync(join(dir, 'scripts', 'app.js'), 'window.app = true;');
  writeFileSync(join(dir, 'assets', 'img', 'logo.png'), 'logo');
  writeFileSync(join(dir, 'assets', 'img', 'card.jpg'), 'card');

  return { dir, pages: [{ relPath: 'index.html', html: indexHtml }] };
}

describe('blocks-engine source assets adoption', () => {
  it('keeps the DLA WP compatibility CSS byte-for-byte', () => {
    expect(WP_COMPAT_CSS).toBe(WP_COMPAT_CSS_GOLDEN);
  });

  it('collects source CSS, JS, CSS images, and HTML images with DLA golden output', () => {
    const { dir, pages } = makeSite();
    try {
      const assets = collectSourceAssets(dir, pages);

      expect(assets.css.startsWith(WP_COMPAT_CSS_GOLDEN)).toBe(true);
      expect(assets.css).toContain('.hero{background:url(media/logo.png)}');
      expect(assets.css).toContain('.card{background:url(media/card.jpg)}');
      expect(assets.css).toContain('.inline{background:url(media/logo.png)}');
      expect(assets.css).toContain('.font{src:url("../fonts/inter.woff2")}');
      expect(assets.css).not.toContain('fonts.googleapis.com');
      expect(assets.cssFiles).toEqual(['assets/css/site.css']);
      expect(assets.jsFiles).toEqual(['scripts/app.js']);
      expect(assets.js).toContain('window.app = true;');
      expect(assets.js).toContain('bootInline();');
      expect(assets.js).not.toContain('"skip":true');
      expect(assets.skippedUnlinked).toEqual([]);
      expect(assets.mediaAssets).toEqual([
        { srcAbs: join(dir, 'assets', 'img', 'logo.png'), themeRel: 'assets/css/media/logo.png' },
        { srcAbs: join(dir, 'assets', 'img', 'card.jpg'), themeRel: 'assets/css/media/card.jpg' },
      ]);
      expect(assets.imgAssets).toEqual([
        { srcAbs: join(dir, 'assets', 'img', 'logo.png'), themeRel: 'assets/img/logo.png' },
        { srcAbs: join(dir, 'assets', 'img', 'card.jpg'), themeRel: 'assets/img/card.jpg' },
      ]);
      expect(assets.imgRewritesByPage['index.html']).toEqual([
        { ref: 'assets/img/logo.png', themeRel: 'assets/img/logo.png' },
        { ref: 'assets/img/card.jpg', themeRel: 'assets/img/card.jpg' },
      ]);
      expect(readFileSync(join(dir, 'assets', 'img', 'logo.png'), 'utf8')).toBe('logo');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rewrites carried HTML image refs to the theme URL in both quote styles', () => {
    expect(
      rewriteHtmlImageSrcs(
        '<img src="assets/img/logo.png"><img src=\'assets/img/card.jpg\'><img src="https://cdn.test/x.png">',
        [
          { ref: 'assets/img/logo.png', themeRel: 'assets/img/logo.png' },
          { ref: 'assets/img/card.jpg', themeRel: 'assets/img/card.jpg' },
        ],
        'dla-theme',
      ),
    ).toBe(
      '<img src="/wp-content/themes/dla-theme/assets/img/logo.png">' +
        '<img src=\'/wp-content/themes/dla-theme/assets/img/card.jpg\'>' +
        '<img src="https://cdn.test/x.png">',
    );
  });
});
