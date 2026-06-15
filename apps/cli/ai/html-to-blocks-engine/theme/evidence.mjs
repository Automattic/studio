// tools/theme/evidence.mjs
import path from 'node:path';
import fs from 'node:fs';
import { readJson, readIfExists, writeJson, resolvePath, findFiles } from '../lib/workspace.mjs';

export function parseCss(css) {
    const out = [];
    const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
    let i = 0;
    walk(null);
    return out;

    function walk(media) {
        while (i < src.length) {
            while (i < src.length && /\s/.test(src[i])) i += 1;
            if (i >= src.length) return;
            if (src[i] === '}') { // closing of @media (stray "}" at top level is skipped)
                i += 1;
                if (media !== null) return;
                continue;
            }
            const open = src.indexOf('{', i);
            if (open === -1) { i = src.length; return; }
            const semi = src.indexOf(';', i);
            if (semi !== -1 && semi < open) { // blockless at-statement: @import, @charset, @layer a, b;
                i = semi + 1;
                continue;
            }
            const head = src.slice(i, open).trim();
            if (head.startsWith('@media')) {
                i = open + 1;
                walk(head.replace(/^@media/, '').trim());
                continue;
            }
            if (head.startsWith('@')) { // @keyframes, @font-face, @supports: skip block (keyframes nest)
                i = skipBlock(open);
                if (head.startsWith('@keyframes')) out.push({ selector: head, media, declarations: [], atRule: 'keyframes' });
                continue;
            }
            const close = src.indexOf('}', open);
            const body = src.slice(open + 1, close);
            out.push({
                selector: head, media,
                declarations: body.split(';').map((d) => d.trim()).filter(Boolean)
                    .map((d) => { const k = d.indexOf(':'); return [d.slice(0, k).trim(), d.slice(k + 1).trim()]; }),
            });
            i = close + 1;
        }
    }
    function skipBlock(open) {
        let depth = 1, j = open + 1;
        while (j < src.length && depth > 0) { if (src[j] === '{') depth += 1; if (src[j] === '}') depth -= 1; j += 1; }
        return j;
    }
}

const BUCKETS = [
    ['pseudo', (r) => /::|:before|:after/.test(r.selector)],
    ['media-query', (r) => r.media !== null],
    ['interaction', (r) => /:hover|:focus|:active|:checked/.test(r.selector) || r.declarations.some(([p]) => p === 'transition' || p === 'animation' || p === 'animation-play-state') || r.atRule === 'keyframes'],
    ['position', (r) => r.declarations.some(([p, v]) => p === 'position' && /fixed|absolute|sticky/.test(v))],
    ['blend', (r) => r.declarations.some(([p]) => p === 'mix-blend-mode' || p === 'filter' || p === 'backdrop-filter')],
    ['grid', (r) => r.declarations.some(([p, v]) => (p === 'display' && /grid/.test(v)) || p.startsWith('grid-'))],
];
export function classifyRule(rule) {
    return BUCKETS.filter(([, fn]) => fn(rule)).map(([name]) => name);
}

export function loadPageTrees(workspaceRoot) {
    const pagesDir = path.join(workspaceRoot, 'wordpress/pages');
    if (fs.existsSync(pagesDir)) {
        return fs.readdirSync(pagesDir).filter((f) => f.endsWith('.block-tree.json')).sort()
            .map((f) => ({ page: f.replace(/\.block-tree\.json$/, ''), tree: readJson(path.join(pagesDir, f)) }));
    }
    return [{ page: 'index', tree: readJson(path.join(workspaceRoot, 'wordpress/block-tree.json')) }];
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

export function analyzeThemeEvidence(args) {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    const pages = loadPageTrees(workspaceRoot);
    const acc = { colors: new Map(), fontSizes: new Map(), spacing: new Map(), fontFamilies: new Map() };
    const supportUsage = {};

    // 1. tree scan
    for (const { page, tree } of pages) {
        walkBlocks(tree.blocks, [], (block, blockPath) => {
            const style = block.attrs?.style || {};
            for (const p of stylePaths(style)) {
                const key = `${p.path}`;
                supportUsage[block.blockName] ??= {};
                supportUsage[block.blockName][key] = (supportUsage[block.blockName][key] || 0) + 1;
                const ref = { kind: 'attr', page, blockName: block.blockName, path: `${blockPath.join('.')}:${p.path}` };
                if (p.path.startsWith('color.')) record(acc.colors, String(p.value).toLowerCase(), ref);
                else if (p.path.startsWith('typography.fontSize')) record(acc.fontSizes, p.value, ref);
                else if (p.path.startsWith('spacing.')) record(acc.spacing, p.value, ref);
            }
        });
    }

    // 2. css scan
    const cssFiles = [path.join(workspaceRoot, 'wordpress/style.css'),
        ...findFiles(path.join(workspaceRoot, 'wordpress/blocks'), 'style.css')];
    const customProperties = {};
    const cssRules = [];
    for (const file of cssFiles) {
        const css = readIfExists(file);
        if (!css) continue;
        const rel = path.relative(workspaceRoot, file);
        for (const rule of parseCss(css)) {
            cssRules.push({ file: rel, selector: rule.selector, media: rule.media, buckets: classifyRule(rule), declarationCount: rule.declarations.length });
            for (const [prop, value] of rule.declarations) {
                const ref = { kind: 'css', file: rel, selector: rule.selector, prop };
                if (prop.startsWith('--')) customProperties[prop] = { value, definedIn: rel, refs: [] };
                for (const m of value.match(COLOR_RE) || []) record(acc.colors, m.toLowerCase(), ref);
                if (prop === 'font-family') record(acc.fontFamilies, value, ref);
                if (prop === 'font-size') record(acc.fontSizes, value, ref);
                if (/^(padding|margin|gap|row-gap|column-gap)/.test(prop)) record(acc.spacing, value, ref);
                for (const m of value.match(/var\((--[a-z0-9-]+)/gi) || []) {
                    const name = m.slice(4);
                    (customProperties[name] ??= { value: null, definedIn: null, refs: [] }).refs.push(ref);
                }
            }
        }
    }

    // 3. name colors after custom properties that hold them
    const report = {
        generatedAt: new Date().toISOString(),
        pages: pages.map((p) => p.page),
        customProperties,
        colors: finalize(acc.colors, (entry) => ({
            names: Object.entries(customProperties).filter(([, v]) => (v.value || '').toLowerCase() === entry.value).map(([k]) => k),
        })),
        fontFamilies: finalize(acc.fontFamilies),
        fontSizes: finalize(acc.fontSizes),
        spacing: finalize(acc.spacing),
        supportUsage,
        cssRules,
        summary: {
            liftableRules: cssRules.filter((r) => r.buckets.length === 0).length,
            unliftableRules: cssRules.filter((r) => r.buckets.length > 0).length,
        },
    };
    if (args.write !== false) writeJson(path.join(workspaceRoot, 'reports/theme-evidence.json'), report);
    return report;
}

function record(map, value, ref) {
    const v = String(value).trim();
    const entry = map.get(v) || { value: v, count: 0, attrRefs: [], cssRefs: [] };
    entry.count += 1;
    (ref.kind === 'attr' ? entry.attrRefs : entry.cssRefs).push(ref);
    map.set(v, entry);
}
function finalize(map, extra = () => ({})) {
    return [...map.values()].sort((a, b) => b.count - a.count).map((e) => ({ ...e, ...extra(e) }));
}
export function walkBlocks(blocks, blockPath, fn) {
    (blocks || []).forEach((block, index) => {
        const p = [...blockPath, index];
        fn(block, p);
        walkBlocks(block.innerBlocks, p, fn);
    });
}
export function stylePaths(style, prefix = '', out = []) {
    for (const [key, value] of Object.entries(style || {})) {
        const p = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object') stylePaths(value, p, out);
        else out.push({ path: p, value });
    }
    return out;
}
