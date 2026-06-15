// tools/theme/generate/theme-files.mjs
export function styleCss({ name, slug, description = '' }, customCss = '') {
    return `/*
Theme Name: ${name}
Description: ${description}
Version: 1.0.0
Requires at least: 6.6
Requires PHP: 7.4
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html
Text Domain: ${slug}
*/

${customCss.trim()}
`;
}

export function functionsPhp({ slug, customBlocks = [] }) {
    const fn = slug.replace(/-/g, '_');
    const notice = customBlocks.length === 0 ? '' : `
add_action('admin_notices', function () {
    if (WP_Block_Type_Registry::get_instance()->is_registered('${customBlocks[0]}')) {
        return;
    }
    echo '<div class="notice notice-warning"><p>The active theme needs its companion blocks plugin (registers ${customBlocks.join(', ')}). Custom blocks will not render until it is activated.</p></div>';
});
`;
    return `<?php
defined('ABSPATH') || exit;

add_action('wp_enqueue_scripts', function () {
    wp_enqueue_style('${fn}-style', get_stylesheet_uri(), array(), wp_get_theme()->get('Version'));
});

// Templates and parts ship {{THEME_URI}} placeholders for bundled assets;
// resolve them to the absolute theme URL when blocks render.
add_filter('render_block', function ($content) {
    return str_replace('{{THEME_URI}}', get_stylesheet_directory_uri(), $content);
});

add_action('after_setup_theme', function () {
    add_editor_style('style.css');
});

// The source design's typography is authored verbatim (straight quotes,
// spaced dashes); texturizing would shift glyphs in display-size headings.
add_filter('run_wptexturize', '__return_false');
${notice}`;
}

export function buildThemeJson({ settings = {}, styles = {}, fontFamilies = [], templateParts = [], customTemplates = [] }) {
    const merged = {
        $schema: 'https://schemas.wp.org/trunk/theme.json',
        version: 3,
        settings: {
            appearanceTools: true,
            ...settings,
            typography: { ...(settings.typography || {}), fontFamilies },
        },
        styles,
        templateParts,
        customTemplates,
    };
    if (merged.templateParts.length === 0) delete merged.templateParts;
    if (merged.customTemplates.length === 0) delete merged.customTemplates;
    return merged;
}

export function templateMarkup(entries) {
    return entries.map((entry) => {
        if (entry.type === 'part') {
            const attrs = { slug: entry.slug, ...(entry.tagName ? { tagName: entry.tagName } : {}) };
            return `<!-- wp:template-part ${JSON.stringify(attrs)} /-->`;
        }
        if (entry.type === 'post-content') return '<!-- wp:post-content {"layout":{"type":"default"}} /-->';
        if (entry.type === 'raw') return entry.markup.trim();
        if (entry.type === 'blocks') return entry.markup.trim();
        if (entry.type === 'tree') throw new Error('tree entries must be serialized by the scaffold before templateMarkup');
        throw new Error(`Unknown template entry type: ${entry.type}`);
    }).join('\n') + '\n';
}

// Generic-situation defaults (spec: standing template set). Bodies are
// data-only block TREES — the scaffold serializes them through
// @wordpress/blocks so the emitted markup is canonical by construction
// (hand-written markup here is the one place save() drift could enter).
// Chrome entries get prepended by the scaffold.
const defaultShell = (innerBlocks) => ({
    blockName: 'core/group',
    attrs: {
        tagName: 'main',
        layout: { type: 'constrained' },
        style: { spacing: { padding: { top: '6rem', bottom: '6rem' } } },
    },
    innerBlocks,
});

export const DEFAULT_TEMPLATES = {
    archive: [{
        type: 'tree',
        blocks: [defaultShell([
            { blockName: 'core/query-title', attrs: { type: 'archive' }, innerBlocks: [] },
            {
                blockName: 'core/query',
                attrs: { query: { perPage: 10, postType: 'post', inherit: true } },
                innerBlocks: [
                    {
                        blockName: 'core/post-template',
                        attrs: {},
                        innerBlocks: [
                            { blockName: 'core/post-title', attrs: { isLink: true }, innerBlocks: [] },
                            { blockName: 'core/post-date', attrs: {}, innerBlocks: [] },
                            { blockName: 'core/post-excerpt', attrs: {}, innerBlocks: [] },
                        ],
                    },
                    {
                        blockName: 'core/query-pagination',
                        attrs: {},
                        innerBlocks: [
                            { blockName: 'core/query-pagination-previous', attrs: {}, innerBlocks: [] },
                            { blockName: 'core/query-pagination-numbers', attrs: {}, innerBlocks: [] },
                            { blockName: 'core/query-pagination-next', attrs: {}, innerBlocks: [] },
                        ],
                    },
                ],
            },
        ])],
    }],
    single: [{
        type: 'tree',
        blocks: [defaultShell([
            { blockName: 'core/post-title', attrs: {}, innerBlocks: [] },
            { blockName: 'core/post-date', attrs: {}, innerBlocks: [] },
            { blockName: 'core/post-content', attrs: { layout: { type: 'default' } }, innerBlocks: [] },
        ])],
    }],
    404: [{
        type: 'tree',
        blocks: [defaultShell([
            { blockName: 'core/heading', attrs: { level: 1, content: 'Page not found' }, innerBlocks: [] },
            { blockName: 'core/paragraph', attrs: { content: 'The page you are looking for does not exist.' }, innerBlocks: [] },
            { blockName: 'core/search', attrs: { label: 'Search', showLabel: false, buttonText: 'Search' }, innerBlocks: [] },
        ])],
    }],
};
