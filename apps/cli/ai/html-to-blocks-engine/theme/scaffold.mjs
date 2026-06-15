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

// The tool schema cannot fully express the nested decision shapes, so validate
// them here and fail with an actionable message (the agent retries against it)
// instead of a cryptic "Cannot read properties of undefined" deep in scaffolding.
function validateScaffoldArgs(args) {
    const problems = [];
    if (!Array.isArray(args.parts)) {
        problems.push('`parts` must be an array (use [] if the site has no shared parts).');
    } else {
        args.parts.forEach((p, i) => {
            if (!p || typeof p.slug !== 'string') problems.push(`parts[${i}]: missing string "slug".`);
            if (!p || !p.source || typeof p.source.page !== 'string' || typeof p.source.index !== 'number') {
                problems.push(`parts[${i}] (slug=${p && p.slug}): requires "source": { "page": <string>, "index": <number> } naming the page key and the top-level block index this part is lifted from. See reports/template-parts.json occurrence groups for the page name and block index.`);
            }
        });
    }
    if (!Array.isArray(args.pages)) {
        problems.push('`pages` must be an array of { page, slug, title, front?, stripIndexes?, sourceFile? }.');
    } else {
        args.pages.forEach((p, i) => {
            if (!p || typeof p.page !== 'string') problems.push(`pages[${i}]: missing string "page" (the page key, e.g. "index").`);
            if (!p || typeof p.slug !== 'string') problems.push(`pages[${i}]: missing string "slug".`);
        });
    }
    if (!args.templates || typeof args.templates !== 'object' || Array.isArray(args.templates)) {
        problems.push('`templates` must be an object mapping template name -> array of entries.');
    } else {
        for (const [t, entries] of Object.entries(args.templates)) {
            if (!Array.isArray(entries)) { problems.push(`templates.${t} must be an array of entries.`); continue; }
            entries.forEach((e, i) => {
                if (!e || (e.type !== 'part' && e.type !== 'tree' && e.type !== 'blocks')) {
                    problems.push(`templates.${t}[${i}]: entry needs "type": "part" | "tree".`);
                } else if (e.type === 'part' && typeof e.slug !== 'string') {
                    problems.push(`templates.${t}[${i}]: part entry needs string "slug" matching a parts[].slug.`);
                } else if (e.type === 'tree' && !Array.isArray(e.blocks)) {
                    problems.push(`templates.${t}[${i}]: tree entry needs a "blocks" array.`);
                }
            });
        }
    }
    if (problems.length) {
        throw new Error(
            'scaffold_block_theme argument errors:\n- ' + problems.join('\n- ') +
            '\n\nExpected shapes:\n' +
            '  parts: [{ "slug": "header", "area": "header", "source": { "page": "index", "index": 0 } }]\n' +
            '  templates: { "index": [{ "type": "part", "slug": "header" }, { "type": "tree", "blocks": [/* core blocks, e.g. post-content */] }, { "type": "part", "slug": "footer" }] }\n' +
            '  pages: [{ "page": "index", "slug": "home", "title": "Home", "front": true }]\n' +
            'Read reports/template-parts.json (occurrence groups give page + block index) to fill each part.source.'
        );
    }
}

export function scaffoldBlockTheme(args) {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    const { slug, name, tokenMap = {}, mediaMap = {} } = args;
    const themeDir = path.join(workspaceRoot, 'theme', slug);
    const files = [];

    validateScaffoldArgs(args);
    // tokenMap.custom drives CSS custom-property renames; default it so a
    // tokenMap without `custom` cannot crash rewriteCssVars (Object.entries).
    const customRenames = tokenMap.custom || {};
    ensureBlocksRegistered(workspaceRoot);
    const pages = new Map(loadPageTrees(workspaceRoot).map((p) => [p.page, p.tree]));
    const linkMap = buildLinkMap(args.pages, workspaceRoot);

    const transformTree = (blocks) => blocks
        .map((b) => rewriteTreePresets(b, tokenMap))
        .map((b) => deepMapStrings(b, (s) => rewriteCssVars(rewriteMediaUrls(rewriteLinks(s, linkMap), mediaMap, '{{THEME_URI}}'), customRenames)));

    // parts
    for (const part of args.parts) {
        const tree = pages.get(part.source.page);
        if (!tree || !Array.isArray(tree.blocks)) throw new Error(`Part ${part.slug}: source.page "${part.source.page}" is not a known page. Known page keys: ${[...pages.keys()].join(', ')}.`);
        const block = tree.blocks[part.source.index];
        if (!block) throw new Error(`Part ${part.slug}: no block at index ${part.source.index} on page "${part.source.page}" (it has ${tree.blocks.length} top-level blocks; valid indexes 0..${tree.blocks.length - 1}).`);
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
        if (!tree || !Array.isArray(tree.blocks)) throw new Error(`pages[].page "${page.page}" is not a known page. Known page keys: ${[...pages.keys()].join(', ')}.`);
        const strip = new Set(page.stripIndexes || []);
        const blocks = tree.blocks.filter((_, i) => !strip.has(i));
        return { ...page, markup: serializeBlocks(transformTree(blocks), {}) };
    });

    // theme.json / style.css / functions.php
    const themeJson = buildThemeJson({
        settings: args.themeSettings,
        styles: deepMapStrings(args.themeStyles || {}, (s) => rewriteCssVars(s, customRenames)),
        fontFamilies: args.fontFamilies || [],
        // theme.json schema: templateParts items allow only name/title/area (name = parts/<name>.html).
        templateParts: args.parts.map(({ slug: s, area }) => ({ name: s, area })),
        customTemplates: Object.keys(args.templates).filter((t) => !['index', 'archive', 'single', '404'].includes(t) && !t.startsWith('page-') && !t.startsWith('front-page'))
            .map((t) => ({ name: t, title: t, postTypes: ['page'] })),
    });
    writeJson(path.join(themeDir, 'theme.json'), themeJson);
    const css = rewriteMediaUrls(rewriteCssVars(args.customCss || '', customRenames), mediaMap, '..');
    writeFile(path.join(themeDir, 'style.css'), styleCss({ name, slug, description: args.description }, css));
    const blocksResult = writeBlocksPlugin({
        workspaceRoot, slug, themeName: name,
        outDir: path.join(workspaceRoot, 'theme-plugin', `${slug}-blocks`),
        transformCss: (blockCss) => rewriteCssVars(blockCss, customRenames),
    });
    writeFile(path.join(themeDir, 'functions.php'), functionsPhp({ slug, customBlocks: blocksResult.blocks }));
    files.push('theme.json', 'style.css', 'functions.php');

    // media copy (tolerant): resolve the source from the workspace root, fall
    // back to mockup/<from> (import_provided_markup stages assets under mockup/),
    // and skip-and-record a missing asset rather than aborting the whole theme.
    const skippedMedia = [];
    for (const [from, to] of Object.entries(mediaMap)) {
        let src = path.join(workspaceRoot, from);
        if (!fs.existsSync(src) && fs.existsSync(path.join(workspaceRoot, 'mockup', from))) {
            src = path.join(workspaceRoot, 'mockup', from);
        }
        if (!fs.existsSync(src)) { skippedMedia.push(from); continue; }
        const dest = path.join(themeDir, to);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        files.push(to);
    }

    const contentResult = writeContentPlugin({ slug, themeName: name, outDir: path.join(workspaceRoot, 'theme-plugin', `${slug}-content`), pages: contentPages });
    return {
        themeDir, files,
        blocksPlugin: blocksResult.blocks.length ? `theme-plugin/${slug}-blocks` : null,
        contentPlugin: `theme-plugin/${slug}-content`,
        pages: contentPages.map(({ markup, ...p }) => p),
        skippedMedia,
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
