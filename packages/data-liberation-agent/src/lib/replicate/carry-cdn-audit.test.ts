import { describe, it, expect } from 'vitest';
import { findExternalAssetRefs } from './carry-cdn-audit.js';

describe('findExternalAssetRefs', () => {
  it('flags external <img src>, <source srcset> (incl protocol-relative //), and CSS url()', () => {
    const html =
      '<img src="https://static.wixstatic.com/media/a~mv2.png/v1/fill/w_10/x.png">' +
      '<picture><source srcset="//static.parastorage.com/fonts/x.woff2 1x"></picture>';
    const css = '.h{background:url("https://siteassets.parastorage.com/bg.jpg")}';
    const out = findExternalAssetRefs([html, css]);
    expect(out.refs).toHaveLength(3);
    expect(out.byHost['static.wixstatic.com']).toBe(1);
    expect(out.byHost['static.parastorage.com']).toBe(1);
    expect(out.byHost['siteassets.parastorage.com']).toBe(1);
  });

  it('ignores local (localhost, /wp-content, relative) and data: refs', () => {
    const html =
      '<img src="http://localhost:8883/wp-content/uploads/2026/06/x.png">' +
      '<img src="/wp-content/uploads/x.png">' +
      '<img src="../fonts/x.woff2">' +
      '<img src="data:image/png;base64,AAAA">';
    const css = '.a{background:url(../img/y.png)}.b{src:url("/wp-content/themes/t/assets/fonts/z.woff2")}';
    expect(findExternalAssetRefs([html, css]).refs).toEqual([]);
  });

  it('does NOT flag <iframe src> embeds or <a href> links (assets only)', () => {
    const html =
      '<iframe src="https://www.youtube.com/embed/abc"></iframe>' +
      '<a href="https://support.wix.com/en/article/x">help</a>';
    expect(findExternalAssetRefs([html]).refs).toEqual([]);
  });

  it('dedups identical refs and returns samples', () => {
    const u = 'https://static.wixstatic.com/media/dup.png';
    const out = findExternalAssetRefs([`<img src="${u}"><img src="${u}">`]);
    expect(out.refs).toHaveLength(1);
    expect(out.samples[0]).toContain('wixstatic.com');
  });
});
