// tools/content/standins.mjs — stand-in marking, audit, and hydration.
//
// Some design regions are genuinely data-driven: an object grid is a query over
// a CPT, a journal index is a query over posts, a comment thread is core/comments.
// html-to-blocks cannot render those from real data (there is no data yet), and
// the visual gate needs to SEE them to style them. So the agent builds them as
// static stand-ins — a real core-block composition (group + image + heading +
// paragraph) seeded with representative content — and marks them. The mark rides
// in the block's own `metadata.standin` (a WordPress-supported attribute that
// serializes and round-trips), so it travels with the block and never pollutes
// layout.
//
// Two marks:
//   - container: { for: "core/query", postType, taxonomy?, query?, role? }
//       The container's FIRST inner block is the item template.
//   - field (inside the template): { for: "core/post-title" | "core/post-featured-image"
//       | "core/post-terms" | "core/post-excerpt" | "core/post-date", taxonomy?, isLink? }
//   - comments: { for: "core/comments", role? }
//
// audit_standins lists every mark (so the content modeler and the skill gate can
// see what is still static). hydrate_standins swaps each marked region into the
// real dynamic core blocks AFTER the html-to-blocks visual gate has passed,
// preserving className/style so the lifted theme CSS still applies. The result
// feeds blocks-to-theme, whose playground gate renders it against the seeded site.

const FIELD_TARGETS = new Set([
    'core/post-title',
    'core/post-featured-image',
    'core/post-terms',
    'core/post-excerpt',
    'core/post-date',
]);

export function getStandin(block) {
    return block && block.attrs && block.attrs.metadata && block.attrs.metadata.standin || null;
}

function walk(blocks, path, visit) {
    (blocks || []).forEach((block, index) => {
        const here = path.concat(index);
        visit(block, here);
        walk(block.innerBlocks, here, visit);
    });
}

// Flat inventory of every stand-in mark across the given pages.
export function auditStandins(pages) {
    const standins = [];
    for (const { page, tree } of pages) {
        walk(tree.blocks, [], (block, path) => {
            const mark = getStandin(block);
            if (!mark || !mark.for) return;
            const kind = mark.for === 'core/query' ? 'query'
                : mark.for === 'core/comments' ? 'comments'
                : FIELD_TARGETS.has(mark.for) ? 'field' : 'other';
            standins.push({
                page,
                path,
                kind,
                for: mark.for,
                postType: mark.postType || null,
                taxonomy: mark.taxonomy || null,
                role: mark.role || null,
                blockName: block.blockName || block.name || null,
            });
        });
    }
    return standins;
}

// Validate marks against a content model: every query stand-in's postType must
// exist (post is always valid); taxonomy marks must reference a real taxonomy.
export function checkStandins(standins, model) {
    const postTypes = new Set(['post', 'page', ...(model?.postTypes || []).map((t) => t.slug)]);
    const taxonomies = new Set([
        'category', 'post_tag',
        ...(model?.taxonomies || []).map((t) => t.slug),
    ]);
    const errors = [];
    for (const s of standins) {
        if (s.kind === 'query' && s.postType && !postTypes.has(s.postType)) {
            errors.push(`Query stand-in on ${s.page} [${s.path.join('.')}] references unknown postType "${s.postType}".`);
        }
        if (s.taxonomy && !taxonomies.has(s.taxonomy)) {
            errors.push(`Stand-in on ${s.page} [${s.path.join('.')}] references unknown taxonomy "${s.taxonomy}".`);
        }
    }
    return errors;
}

// Carry the styling-relevant attributes from a stand-in block onto its dynamic
// replacement so the theme CSS lifted from the stand-in still targets it.
function passthrough(attrs) {
    const out = {};
    for (const key of ['className', 'style', 'align', 'layout', 'textColor', 'backgroundColor', 'fontSize', 'fontFamily']) {
        if (attrs && attrs[key] !== undefined) out[key] = attrs[key];
    }
    return out;
}

function fieldBlock(mark, original) {
    const attrs = passthrough(original.attrs || {});
    switch (mark.for) {
        case 'core/post-title':
            return { blockName: 'core/post-title', attrs: { isLink: mark.isLink !== false, ...attrs }, innerBlocks: [] };
        case 'core/post-featured-image':
            return { blockName: 'core/post-featured-image', attrs: { isLink: mark.isLink !== false, ...attrs }, innerBlocks: [] };
        case 'core/post-terms':
            return { blockName: 'core/post-terms', attrs: { term: mark.taxonomy || 'category', ...attrs }, innerBlocks: [] };
        case 'core/post-excerpt':
            return { blockName: 'core/post-excerpt', attrs: { ...attrs }, innerBlocks: [] };
        case 'core/post-date':
            return { blockName: 'core/post-date', attrs: { ...attrs }, innerBlocks: [] };
        default:
            return null;
    }
}

// Replace field-marked blocks inside an item template with their core/post-*
// equivalents (depth-first; non-field blocks are kept as static decoration).
function hydrateTemplate(block) {
    const mark = getStandin(block);
    if (mark && FIELD_TARGETS.has(mark.for)) {
        const replaced = fieldBlock(mark, block);
        if (replaced) return replaced;
    }
    return {
        ...block,
        attrs: stripStandin(block.attrs),
        innerBlocks: (block.innerBlocks || []).map(hydrateTemplate),
    };
}

function stripStandin(attrs) {
    if (!attrs || !attrs.metadata) return attrs;
    const { standin, ...metadata } = attrs.metadata;
    const next = { ...attrs };
    if (Object.keys(metadata).length) next.metadata = metadata;
    else delete next.metadata;
    return next;
}

// Deterministic positive integer queryId from page + path (core/query needs one).
function queryId(page, path) {
    let h = 0;
    const key = `${page}:${path.join('.')}`;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return h % 100000;
}

function buildQueryBlock(container, page, path) {
    const mark = getStandin(container);
    const items = container.innerBlocks || [];
    if (!items.length) throw new Error(`Query stand-in on ${page} [${path.join('.')}] has no item template.`);
    const template = hydrateTemplate(items[0]);
    const q = mark.query || {};
    const query = {
        perPage: q.perPage ?? 6,
        pages: q.pages ?? 0,
        offset: q.offset ?? 0,
        postType: mark.postType || 'post',
        order: q.order || 'desc',
        orderBy: q.orderBy || 'date',
        author: '',
        search: '',
        exclude: [],
        sticky: q.sticky || '',
        inherit: q.inherit ?? false,
        ...(mark.taxonomy && q.terms ? { taxQuery: { [mark.taxonomy]: q.terms } } : {}),
    };
    const postTemplate = {
        blockName: 'core/post-template',
        attrs: passthrough(container.attrs || {}),
        innerBlocks: [template],
    };
    return {
        blockName: 'core/query',
        attrs: {
            queryId: queryId(page, path),
            query,
            ...(container.attrs && container.attrs.align ? { align: container.attrs.align } : {}),
            ...(mark.queryClassName ? { className: mark.queryClassName } : {}),
        },
        innerBlocks: [postTemplate],
    };
}

function commentsBlock(container) {
    return {
        blockName: 'core/comments',
        attrs: passthrough(container.attrs || {}),
        innerBlocks: [
            { blockName: 'core/comments-title', attrs: {}, innerBlocks: [] },
            { blockName: 'core/comment-template', attrs: {}, innerBlocks: [
                { blockName: 'core/comment-author-name', attrs: {}, innerBlocks: [] },
                { blockName: 'core/comment-date', attrs: {}, innerBlocks: [] },
                { blockName: 'core/comment-content', attrs: {}, innerBlocks: [] },
                { blockName: 'core/comment-reply-link', attrs: {}, innerBlocks: [] },
            ] },
            { blockName: 'core/comments-pagination', attrs: {}, innerBlocks: [
                { blockName: 'core/comments-pagination-previous', attrs: {}, innerBlocks: [] },
                { blockName: 'core/comments-pagination-next', attrs: {}, innerBlocks: [] },
            ] },
            { blockName: 'core/post-comments-form', attrs: {}, innerBlocks: [] },
        ],
    };
}

function hydrateBlocks(blocks, page, path, swaps) {
    return (blocks || []).map((block, index) => {
        const here = path.concat(index);
        const mark = getStandin(block);
        if (mark && mark.for === 'core/query') {
            swaps.push({ page, path: here, for: 'core/query', postType: mark.postType || 'post' });
            return buildQueryBlock(block, page, here);
        }
        if (mark && mark.for === 'core/comments') {
            swaps.push({ page, path: here, for: 'core/comments' });
            return commentsBlock(block);
        }
        return {
            ...block,
            attrs: stripStandin(block.attrs),
            innerBlocks: hydrateBlocks(block.innerBlocks, page, here, swaps),
        };
    });
}

// Returns hydrated copies of each page tree plus the list of swaps performed.
export function hydrateStandins(pages) {
    const swaps = [];
    const trees = pages.map(({ page, tree }) => ({
        page,
        tree: { ...tree, blocks: hydrateBlocks(tree.blocks, page, [], swaps) },
    }));
    return { trees, swaps };
}
