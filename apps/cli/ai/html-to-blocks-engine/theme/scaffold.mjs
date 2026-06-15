// tools/theme/scaffold.mjs
import fs from 'node:fs';
import path from 'node:path';
import { resolvePath, writeFile, writeJson } from '../lib/workspace.mjs';
import { ensureBlocksRegistered, serializeBlocks } from '../lib/wp-serialize.mjs';
import { loadPageTrees } from './evidence.mjs';
import { rewriteTreePresets, rewriteCssVars, rewriteLinks, rewriteMediaUrls } from './rewrites.mjs';
import { styleCss, functionsPhp, buildThemeJson, templateMarkup, DEFAULT_TEMPLATES } from './generate/theme-files.mjs';
import { writeBlocksPlugin } from './generate/blocks-plugin.mjs';
import { writeContentPlugin } from './generate/content-plugin.mjs';

export function scaffoldBlockTheme(args) {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    const { slug, name, tokenMap, mediaMap = {} } = args;
    const themeDir = path.join(workspaceRoot, 'theme', slug);
    const files = [];

    ensureBlocksRegistered(workspaceRoot);
    const pages = new Map(loadPageTrees(workspaceRoot).map((p) => [p.page, p.tree]));
    const linkMap = buildLinkMap(args.pages, workspaceRoot);

    const transformTree = (blocks) => blocks
        .map((b) => rewriteTreePresets(b, tokenMap))
        .map((b) => deepMapStrings(b, (s) => rewriteCssVars(rewriteMediaUrls(rewriteLinks(s, linkMap), mediaMap, '{{THEME_URI}}'), tokenMap.custom)));

    // parts
    for (const part of args.parts) {
        const tree = pages.get(part.source.page);
        if (!tree) throw new Error(`Part ${part.slug}: unknown source page ${part.source.page}`);
        const block = tree.blocks[part.source.index];
        if (!block) throw new Error(`Part ${part.slug}: no block at index ${part.source.index} on ${part.source.page}`);
        // Parts keep {{THEME_URI}} placeholders: relative URLs would resolve
        // against the page URL, not the theme dir. functions.php replaces the
        // placeholder with get_stylesheet_directory_uri() at render time.
        const markup = serializeBlocks(transformTree([block]), {});
        writeFile(path.join(themeDir, `parts/${part.slug}.html`), markup);
        files.push(`parts/${part.slug}.html`);
    }

    // templates: agent-specified + standing defaults using index chrome
    const templates = { ...args.templates };
    const chrome = (args.templates.index || []).filter((e) => e.type === 'part');
    const chromeTop = chrome.slice(0, Math.ceil(chrome.length / 2));
    const chromeBottom = chrome.slice(Math.ceil(chrome.length / 2));
    for (const [tplName, body] of Object.entries(DEFAULT_TEMPLATES)) {
        templates[tplName] ??= [...chromeTop, ...body, ...chromeBottom];
    }
    for (const [tplName, entries] of Object.entries(templates)) {
        // tree entries (the generic defaults, or agent-authored bodies) are
        // serialized through @wordpress/blocks so the markup is canonical
        const resolved = entries.map((entry) => entry.type === 'tree'
            ? { type: 'blocks', markup: serializeBlocks(entry.blocks, {}) }
            : entry);
        writeFile(path.join(themeDir, `templates/${tplName}.html`), templateMarkup(resolved));
        files.push(`templates/${tplName}.html`);
    }

    // per-page content payload
    const contentPages = args.pages.map((page) => {
        const tree = pages.get(page.page);
        const strip = new Set(page.stripIndexes || []);
        const blocks = tree.blocks.filter((_, i) => !strip.has(i));
        return { ...page, markup: serializeBlocks(transformTree(blocks), {}) };
    });

    // theme.json / style.css / functions.php
    const themeJson = buildThemeJson({
        settings: args.themeSettings,
        styles: deepMapStrings(args.themeStyles || {}, (s) => rewriteCssVars(s, tokenMap.custom)),
        fontFamilies: args.fontFamilies || [],
        // theme.json schema: templateParts items allow only name/title/area (name = parts/<name>.html).
        templateParts: args.parts.map(({ slug: s, area }) => ({ name: s, area })),
        customTemplates: Object.keys(args.templates).filter((t) => !['index', 'archive', 'single', '404'].includes(t) && !t.startsWith('page-') && !t.startsWith('front-page'))
            .map((t) => ({ name: t, title: t, postTypes: ['page'] })),
    });
    writeJson(path.join(themeDir, 'theme.json'), themeJson);
    const css = rewriteMediaUrls(rewriteCssVars(args.customCss || '', tokenMap.custom), mediaMap, '..');
    writeFile(path.join(themeDir, 'style.css'), styleCss({ name, slug, description: args.description }, css));
    const blocksResult = writeBlocksPlugin({
        workspaceRoot, slug, themeName: name,
        outDir: path.join(workspaceRoot, 'theme-plugin', `${slug}-blocks`),
        transformCss: (blockCss) => rewriteCssVars(blockCss, tokenMap.custom),
    });
    writeFile(path.join(themeDir, 'functions.php'), functionsPhp({ slug, customBlocks: blocksResult.blocks }));
    files.push('theme.json', 'style.css', 'functions.php');

    // media copy
    for (const [from, to] of Object.entries(mediaMap)) {
        const dest = path.join(themeDir, to);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(workspaceRoot, from), dest);
        files.push(to);
    }

    const contentResult = writeContentPlugin({ slug, themeName: name, outDir: path.join(workspaceRoot, 'theme-plugin', `${slug}-content`), pages: contentPages });
    return {
        themeDir, files,
        blocksPlugin: blocksResult.blocks.length ? `theme-plugin/${slug}-blocks` : null,
        contentPlugin: `theme-plugin/${slug}-content`,
        pages: contentPages.map(({ markup, ...p }) => p),
        next: 'Run validate_block_theme, then playground_render.',
    };
}

function buildLinkMap(pages, workspaceRoot) {
    // map each source page's mockup filename to its permalink path
    const map = {};
    for (const page of pages) {
        const file = page.sourceFile || `${page.page}.html`;
        map[file] = page.front ? '/' : `/${page.slug}/`;
    }
    return map;
}

export function deepMapStrings(value, fn) {
    if (typeof value === 'string') return fn(value);
    if (Array.isArray(value)) return value.map((v) => deepMapStrings(v, fn));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepMapStrings(v, fn)]));
    return value;
}
