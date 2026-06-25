import { describe, it, expect } from 'vitest';
import { appendGalleryMobileGrid, GALLERY_MOBILE_GRID_CSS } from './gallery-mobile-grid.js';

const LOCAL_A = 'http://localhost:9999/wp-content/uploads/2020/01/abcd12_1111111111111111111111111111-mv2.png';
const LOCAL_B = 'http://localhost:9999/wp-content/uploads/2020/01/abcd12_2222222222222222222222222222-mv2.png';
const MOBILE_A = 'https://static.example.test/media/abcd12_1111111111111111111111111111~mv2.png/v1/fill/w_350,h_281/x~mv2.png';
const ID_A = 'abcd12_1111111111111111111111111111';

/** Build a pro-gallery widget like the carried Wix DOM: an OUTER div.pro-gallery
 *  wrapping an inner `pro-gallery inline-styles` wrapper that holds the items. */
function widget(imgs: string[]): string {
  const items = imgs
    .map(
      (src, i) =>
        `<div class="gallery-item-container"><div data-hook="image-item"><picture>` +
        `<img data-hook="gallery-item-image-img" data-idx="${i}" src="${src}" alt="photo ${i}"/></picture></div></div>`,
    )
    .join('');
  return (
    `<section><div class="pro-gallery"><div class="pro-gallery inline-styles ltr">` +
    `<div class="pro-gallery-margin-container">${items}</div></div></div></section>`
  );
}

describe('appendGalleryMobileGrid', () => {
  it('appends one mobile grid with an <img> per gallery image', () => {
    const out = appendGalleryMobileGrid(widget([LOCAL_A, LOCAL_B]), {});
    expect(out).toContain('class="lib-carry-gallery-mobile"');
    const grids = out.match(/lib-carry-gallery-mobile/g) || [];
    expect(grids.length).toBe(1);
    // two images carried into the grid
    const gridHtml = out.slice(out.indexOf('lib-carry-gallery-mobile'));
    expect((gridHtml.match(/<img/g) || []).length).toBe(2);
  });

  it('uses the captured mobile-crop URL when the media-id is mapped, else the local src', () => {
    const out = appendGalleryMobileGrid(widget([LOCAL_A, LOCAL_B]), { [ID_A]: MOBILE_A });
    const gridHtml = out.slice(out.indexOf('class="lib-carry-gallery-mobile"'));
    expect(gridHtml).toContain(MOBILE_A); // A → mobile crop
    expect(gridHtml).toContain(LOCAL_B); // B → no mapping, local desktop src
  });

  it('places the grid as a sibling immediately AFTER the widget (CSS :has(+) toggles it)', () => {
    const out = appendGalleryMobileGrid(widget([LOCAL_A]), {});
    expect(out.indexOf('lib-carry-gallery-mobile')).toBeGreaterThan(out.indexOf('class="pro-gallery"'));
    // the widget's closing precedes the grid's opening
    expect(/<\/div><div class="lib-carry-gallery-mobile">/.test(out)).toBe(true);
  });

  it('only emits ONE grid even though the widget has a nested .pro-gallery token', () => {
    const out = appendGalleryMobileGrid(widget([LOCAL_A, LOCAL_B]), {});
    expect((out.match(/lib-carry-gallery-mobile/g) || []).length).toBe(1);
  });

  it('is idempotent — does not append a second grid on re-run', () => {
    const once = appendGalleryMobileGrid(widget([LOCAL_A]), {});
    const twice = appendGalleryMobileGrid(once, {});
    expect(twice).toBe(once);
    expect((twice.match(/lib-carry-gallery-mobile/g) || []).length).toBe(1);
  });

  it('is a no-op for HTML with no pro-gallery', () => {
    const html = '<section><p>no gallery here</p></section>';
    expect(appendGalleryMobileGrid(html, {})).toBe(html);
  });

  it('is a no-op for a pro-gallery with no extractable images', () => {
    const html = '<div class="pro-gallery"><div class="pro-gallery-margin-container"></div></div>';
    expect(appendGalleryMobileGrid(html, {})).toBe(html);
  });

  it('escapes quotes in alt text', () => {
    const html =
      '<div class="pro-gallery"><img data-hook="gallery-item-image-img" src="' +
      LOCAL_A +
      '" alt=\'a "quoted" caption\'/></div>';
    const out = appendGalleryMobileGrid(html, {});
    const gridHtml = out.slice(out.indexOf('class="lib-carry-gallery-mobile"'));
    expect(gridHtml).toContain('&quot;quoted&quot;');
  });
});

describe('GALLERY_MOBILE_GRID_CSS', () => {
  it('hides the grid by default and toggles widget↔grid at the mobile breakpoint', () => {
    expect(GALLERY_MOBILE_GRID_CSS).toContain('.lib-carry-gallery-mobile{display:none}');
    expect(GALLERY_MOBILE_GRID_CSS).toContain('@media screen and (max-width:750px)');
    expect(GALLERY_MOBILE_GRID_CSS).toContain('div.pro-gallery:has(+ .lib-carry-gallery-mobile){display:none!important}');
    expect(GALLERY_MOBILE_GRID_CSS).toContain('display:grid!important');
    expect(GALLERY_MOBILE_GRID_CSS).toContain('aspect-ratio:350/281');
  });
});
