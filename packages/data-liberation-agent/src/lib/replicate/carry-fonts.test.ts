import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localizeCarryFonts } from './carry-fonts.js';

function tmp(): string {
  const root = join(process.cwd(), '.tmp-test');
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, 'carryfonts-'));
}
const dirs: string[] = [];
function themeDir(): string { const d = tmp(); dirs.push(d); return d; }
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// Wix's two font CDNs; parastorage refs are protocol-relative (//).
const USED_SRC = "//static.parastorage.com/fonts/v2/aaaa/v1/libre-baskerville.woff2";
const UNUSED_SRC = "//static.parastorage.com/fonts/v2/zzzz/v1/madefor-display.woff2";
const usedFace = `@font-face{font-family:'libre baskerville';font-style:normal;src:url(${USED_SRC}) format("woff2")}`;
const unusedFace = `@font-face{font-family:'madefor-display';src:url(${UNUSED_SRC}) format("woff2")}`;
// A rule that APPLIES libre baskerville (so it's "used"); madefor-display is never applied.
const usageRule = `.title{font-family:'libre baskerville',serif}`;

const okFetch = (async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('FONT').buffer })) as unknown as typeof fetch;

describe('localizeCarryFonts', () => {
  it('strips sourceMappingURL comments from CSS so no CDN URL survives even with no fonts', async () => {
    const root = themeDir();
    const files = [{ path: 'assets/css/site.css', content: `.a{color:red}/*# sourceMappingURL=https://static.parastorage.com/x.css.map*/` }];
    const res = await localizeCarryFonts(root, files, { fetchImpl: okFetch });
    expect(res.files[0].content).not.toContain('parastorage.com');
  });

  it('strips unused faces and downloads only the used fonts (incl. protocol-relative //), rewriting to ../fonts', async () => {
    const root = themeDir();
    const files = [{ path: 'assets/css/page-projects.css', content: `${usedFace}${unusedFace}${usageRule}` }];
    const res = await localizeCarryFonts(root, files, { fetchImpl: okFetch });

    expect(res.fontFacesStripped).toBe(1);
    expect(res.downloaded).toBe(1); // only the used font fetched
    expect(res.failed).toEqual([]);
    const css = res.files[0].content;
    expect(css).not.toContain('static.parastorage.com'); // no CDN left
    expect(css).not.toContain('madefor-display');         // unused face gone
    expect(css).toMatch(/url\(["']?\.\.\/fonts\/[^)"']+\.woff2["']?\)/); // used rewritten to ../fonts
    // the font binary was written under assets/fonts/
    const wrote = existsSync(join(root, 'assets/fonts')) && require('node:fs').readdirSync(join(root, 'assets/fonts')).length === 1;
    expect(wrote).toBe(true);
  });

  it('copies a localhost-uploads font (leaked into the media pipeline) from wpRoot instead of fetching loopback', async () => {
    const root = themeDir();
    const wpRoot = themeDir();
    // simulate the installed font in uploads
    const upl = join(wpRoot, 'wp-content/uploads/2026/06');
    mkdirSync(upl, { recursive: true });
    writeFileSync(join(upl, 'file.woff2'), Buffer.from('LOCALFONT'));
    const localUrl = 'http://localhost:8883/wp-content/uploads/2026/06/file.woff2';
    const face = `@font-face{font-family:'wfont_x';src:url("${localUrl}") format("woff2")}`;
    const files = [{ path: 'assets/css/site.css', content: `${face}.h{font-family:'wfont_x'}` }];

    const res = await localizeCarryFonts(root, files, { fetchImpl: okFetch, wpRoot });
    expect(res.downloaded).toBe(1);
    expect(res.failed).toEqual([]);
    expect(res.files[0].content).not.toContain('localhost:8883');
    expect(res.files[0].content).toMatch(/\.\.\/fonts\//);
  });
});
