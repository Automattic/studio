// tools/theme/fonts.mjs
import fs from 'node:fs';
import path from 'node:path';
import { slug } from '../lib/workspace.mjs';

const WOFF2_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export function extractGoogleFontsImport(css) {
    const m = css.match(/@import\s+url\(\s*['"]?(https:\/\/fonts\.googleapis\.com\/css2[^'")]+)/);
    return m ? m[1] : null;
}

export function parseFontFaces(css2) {
    const faces = [];
    for (const block of css2.match(/@font-face\s*{[^}]*}/g) || []) {
        const get = (re) => (block.match(re) || [])[1] || null;
        faces.push({
            fontFamily: get(/font-family:\s*'([^']+)'/),
            fontStyle: get(/font-style:\s*([a-z]+)/) || 'normal',
            fontWeight: get(/font-weight:\s*([0-9 ]+)/) || '400',
            unicodeRange: get(/unicode-range:\s*([^;]+);/),
            url: get(/src:\s*url\(([^)]+\.woff2)\)/),
        });
    }
    return faces.filter((f) => f.fontFamily && f.url);
}

export async function fetchThemeFonts({ importUrl, sourceCss, targetDir, fetchImpl = fetch }) {
    const url = importUrl || extractGoogleFontsImport(sourceCss || '');
    if (!url) throw new Error('No Google Fonts @import found; pass importUrl explicitly or skip font bundling.');
    let css2;
    try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': WOFF2_UA } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        css2 = await res.text();
    } catch (error) {
        throw new Error(`Font fetch failed (offline?). Fidelity requires bundled fonts; the run is blocked. Cause: ${error.message}`);
    }
    const faces = parseFontFaces(css2);
    fs.mkdirSync(targetDir, { recursive: true });
    const families = new Map();
    const counters = new Map();
    for (const face of faces) {
        const famSlug = slug(face.fontFamily);
        const base = `${famSlug}-${face.fontWeight.replace(/\s+/g, '-')}-${face.fontStyle}`;
        const n = counters.get(base) || 0;
        counters.set(base, n + 1);
        const fileName = `${base}-${n}.woff2`;
        const res = await fetchImpl(face.url, { headers: { 'User-Agent': WOFF2_UA } });
        if (!res.ok) throw new Error(`Font file fetch failed: ${face.url} (HTTP ${res.status})`);
        fs.writeFileSync(path.join(targetDir, fileName), Buffer.from(await res.arrayBuffer()));
        const fam = families.get(face.fontFamily) || { name: face.fontFamily, slug: famSlug, fontFamily: `'${face.fontFamily}'`, fontFace: [] };
        fam.fontFace.push({
            fontFamily: face.fontFamily,
            fontStyle: face.fontStyle,
            fontWeight: face.fontWeight,
            ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
            src: [`file:./assets/fonts/${fileName}`],
        });
        families.set(face.fontFamily, fam);
    }
    return { importUrl: url, fontFamilies: [...families.values()] };
}
