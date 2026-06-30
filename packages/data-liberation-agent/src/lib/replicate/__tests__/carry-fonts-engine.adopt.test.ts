import { describe, expect, it } from 'vitest';
import { stripCssSourceMaps, stripUnusedCarryFontFaces } from '@automattic/blocks-engine/theme';

// Wix's carried CSS uses protocol-relative font URLs.
const USED_SRC = '//static.parastorage.com/fonts/v2/aaaa/v1/libre-baskerville.woff2';
const UNUSED_SRC = '//static.parastorage.com/fonts/v2/zzzz/v1/madefor-display.woff2';
const usedFace = `@font-face{font-family:'libre baskerville';font-style:normal;src:url(${USED_SRC}) format("woff2")}`;
const unusedFace = `@font-face{font-family:'madefor-display';src:url(${UNUSED_SRC}) format("woff2")}`;
const usageRule = `.title{font-family:'libre baskerville',serif}`;

describe('engine carry font strip helpers adopted by DLA', () => {
  it('drops unused @font-face blocks and reports kept font URLs', () => {
    const out = stripUnusedCarryFontFaces(`${usedFace}${unusedFace}${usageRule}`, usageRule);

    expect(out).toEqual({
      css: `${usedFace}${usageRule}`,
      keptUrls: [USED_SRC],
      stripped: 1,
    });
  });

  it('counts Wix var-token family references as usage', () => {
    const css = `${usedFace}:root{--font_2:normal normal bold 48px/1.2em 'libre baskerville',serif}.h{font-family:var(--font_2)}`;
    const usage = `:root{--font_2:normal normal bold 48px/1.2em 'libre baskerville',serif}.h{font-family:var(--font_2)}`;

    expect(stripUnusedCarryFontFaces(css, usage)).toEqual({
      css,
      keptUrls: [USED_SRC],
      stripped: 0,
    });
  });

  it('strips dev-only sourceMappingURL comments without changing real CSS', () => {
    const css = `.a{color:red}\n/*# sourceMappingURL=https://static.parastorage.com/x/main.css.map*/\n.b{color:blue}`;

    expect(stripCssSourceMaps(css)).toBe(`.a{color:red}\n\n.b{color:blue}`);
    expect(stripCssSourceMaps('.a{color:red}')).toBe('.a{color:red}');
  });
});
