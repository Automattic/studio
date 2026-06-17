// tools/lib/dynamic-render.mjs — deterministic frontend markup for dynamic core
// blocks so the static rendered/ preview (and the editor canvas) can show them.
//
// WordPress server-renders these blocks (their save() returns null), so the
// html-to-blocks static serializer emits only an empty block comment for them.
// That blindness is the historical reason the pipeline reached for custom
// "site-nav"/"search"/"pagination" blocks. It is a HARNESS limitation, not a
// design fact: the right output is the real core block. This module closes the
// gap by rendering the same frontend HTML WordPress would, from the block's
// attributes + inner blocks + a small preview context, so the real core block
// previews and styles correctly on both surfaces.
//
// Pure string-in/string-out (no imports) so the identical source runs in Node
// (serializer save override) and in the browser editor preview (edit override).
// The emitted class names are canonical WordPress block classes; workspace CSS
// targets them and styles both surfaces identically.

// Blocks whose frontend markup this module reproduces. navigation-link and
// navigation-submenu are rendered by their parent navigation walk, not on
// their own; the query-pagination children are rendered by the parent.
export const DYNAMIC_SHIM_BLOCKS = [
    'core/navigation',
    'core/search',
    'core/site-title',
    'core/site-logo',
    'core/post-comments-form',
    'core/query-pagination',
    'core/post-navigation-link',
    'core/post-date',
    'core/post-terms',
];

// Subset that the editor canvas does NOT render usefully on its own: these read
// site/post identity from entities that the no-data preview store lacks, so
// their real edit() shows a hidden placeholder (blank in the screenshot). The
// editor preview overrides only these with the shim; navigation, search,
// post-comments-form, query-pagination, post-navigation-link and post-date
// render correctly through their native edit() and are left alone. Every block
// here renders from attributes + preview context only (no inner blocks), so the
// editor override does not need the block store.
export const EDITOR_SHIM_BLOCKS = [
    'core/site-title',
    'core/site-logo',
    'core/post-terms',
];

export const DEFAULT_PREVIEW_CONTEXT = {
    siteTitle: 'Site Title',
    siteTagline: 'Just another site',
    siteLogoUrl: '',
    siteLogoWidth: 120,
    homeUrl: '#',
    postDate: 'January 1, 2025',
    postTerms: 'Uncategorized',
};

function esc(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Pass author classNames / preset color classes through onto the block root so
// the agent can style via the block tree, exactly like a static block.
function rootClass(base, attrs) {
    const classes = [base];
    if (attrs && attrs.className) classes.push(String(attrs.className));
    if (attrs && attrs.textColor) classes.push('has-text-color', `has-${attrs.textColor}-color`);
    if (attrs && attrs.backgroundColor) classes.push('has-background', `has-${attrs.backgroundColor}-background-color`);
    if (attrs && attrs.fontSize) classes.push(`has-${attrs.fontSize}-font-size`);
    return classes.filter(Boolean).join(' ');
}

function navItems(innerBlocks) {
    return (innerBlocks || []).map((block) => {
        const name = block.blockName || block.name;
        const a = block.attrs || block.attributes || {};
        const label = esc(a.label || '');
        const url = esc(a.url || '#');
        if (name === 'core/navigation-submenu') {
            return `<li class="wp-block-navigation-item has-child open-on-hover-click">`
                + `<a class="wp-block-navigation-item__content" href="${url}">`
                + `<span class="wp-block-navigation-item__label">${label}</span></a>`
                + `<span class="wp-block-navigation__submenu-icon"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1.5 4L6 8l4.5-4" stroke="currentColor"></path></svg></span>`
                + `<ul class="wp-block-navigation__submenu-container wp-block-navigation-submenu">${navItems(block.innerBlocks)}</ul>`
                + `</li>`;
        }
        // core/navigation-link (and any other simple item)
        return `<li class="wp-block-navigation-item">`
            + `<a class="wp-block-navigation-item__content" href="${url}">`
            + `<span class="wp-block-navigation-item__label">${label}</span></a></li>`;
    }).join('');
}

function renderNavigation(attrs, innerBlocks) {
    const overlay = attrs && attrs.overlayMenu === 'always' ? ' is-responsive' : '';
    const orientation = attrs && attrs.orientation === 'vertical' ? ' is-vertical' : '';
    const cls = rootClass(`wp-block-navigation${orientation}`, attrs);
    const aria = attrs && attrs.ariaLabel ? ` aria-label="${esc(attrs.ariaLabel)}"` : '';
    return `<nav class="${cls}${overlay}"${aria}>`
        + `<ul class="wp-block-navigation__container wp-block-navigation">${navItems(innerBlocks)}</ul>`
        + `</nav>`;
}

function renderSearch(attrs) {
    const a = attrs || {};
    const label = a.label != null ? a.label : 'Search';
    const showLabel = !a.showLabel === false ? a.showLabel !== false : true;
    const hideLabel = a.showLabel === false;
    const placeholder = esc(a.placeholder || '');
    const buttonText = esc(a.buttonText || 'Search');
    const buttonInside = a.buttonPosition === 'button-inside';
    const noButton = a.buttonPosition === 'no-button';
    const widthClass = a.widthUnit && a.width ? ` has-custom-width` : '';
    const cls = rootClass(`wp-block-search${widthClass}`, a);
    const labelHtml = hideLabel
        ? `<label class="wp-block-search__label screen-reader-text" hidden>${esc(label)}</label>`
        : `<label class="wp-block-search__label">${esc(label)}</label>`;
    const input = `<input type="search" class="wp-block-search__input" placeholder="${placeholder}" required>`;
    const button = noButton ? '' :
        `<button type="submit" class="wp-block-search__button wp-element-button">${buttonText}</button>`;
    const wrapClass = buttonInside
        ? 'wp-block-search__inside-wrapper wp-block-search__button-inside'
        : 'wp-block-search__inside-wrapper';
    return `<form role="search" method="get" class="${cls}">`
        + labelHtml
        + `<div class="${wrapClass}">${input}${button}</div>`
        + `</form>`;
}

function renderSiteTitle(attrs, ctx) {
    const level = attrs && Number.isInteger(attrs.level) ? attrs.level : 1;
    const tag = level === 0 ? 'p' : `h${level}`;
    const cls = rootClass('wp-block-site-title', attrs);
    const home = esc(ctx.homeUrl);
    return `<${tag} class="${cls}"><a href="${home}" rel="home">${esc(ctx.siteTitle)}</a></${tag}>`;
}

function renderSiteLogo(attrs, ctx) {
    const width = (attrs && attrs.width) || ctx.siteLogoWidth || 120;
    const cls = rootClass('wp-block-site-logo', attrs);
    const home = esc(ctx.homeUrl);
    if (!ctx.siteLogoUrl) {
        // No logo configured: render the canonical empty-logo box so layout and
        // sizing still preview. Workspace CSS can target .wp-block-site-logo.
        return `<div class="${cls}"><a href="${home}" class="custom-logo-link" style="display:inline-block;width:${esc(width)}px"><span class="custom-logo" style="display:block;width:${esc(width)}px;aspect-ratio:1"></span></a></div>`;
    }
    return `<div class="${cls}"><a href="${home}" class="custom-logo-link">`
        + `<img class="custom-logo" src="${esc(ctx.siteLogoUrl)}" alt="${esc(ctx.siteTitle)}" width="${esc(width)}"></a></div>`;
}

function renderPostDate(attrs, ctx) {
    const cls = rootClass('wp-block-post-date', attrs);
    return `<div class="${cls}"><time datetime="">${esc(ctx.postDate)}</time></div>`;
}

function renderPostTerms(attrs, ctx) {
    const cls = rootClass('wp-block-post-terms', attrs);
    const prefix = attrs && attrs.prefix ? esc(attrs.prefix) : '';
    const suffix = attrs && attrs.suffix ? esc(attrs.suffix) : '';
    return `<div class="${cls}">${prefix}<a href="#">${esc(ctx.postTerms)}</a>${suffix}</div>`;
}

function renderPostNavigationLink(attrs) {
    const a = attrs || {};
    const type = a.type === 'previous' ? 'previous' : 'next';
    const cls = rootClass(`wp-block-post-navigation-link is-${type}`, a);
    const label = esc(a.label || (type === 'previous' ? 'Previous' : 'Next'));
    const arrow = a.arrow && a.arrow !== 'none'
        ? (type === 'previous' ? '<span class="wp-block-post-navigation-link__arrow-previous is-arrow-' + esc(a.arrow) + '">←</span>' : '')
        : '';
    const arrowNext = a.arrow && a.arrow !== 'none' && type === 'next'
        ? '<span class="wp-block-post-navigation-link__arrow-next is-arrow-' + esc(a.arrow) + '">→</span>' : '';
    return `<div class="${cls}">${arrow}<a href="#">${label}</a>${arrowNext}</div>`;
}

function renderQueryPaginationChild(block, ctx) {
    const name = block.blockName || block.name;
    const a = block.attrs || block.attributes || {};
    if (name === 'core/query-pagination-previous') {
        return `<a href="#" class="wp-block-query-pagination-previous">${esc(a.label || 'Previous Page')}</a>`;
    }
    if (name === 'core/query-pagination-next') {
        return `<a href="#" class="wp-block-query-pagination-next">${esc(a.label || 'Next Page')}</a>`;
    }
    if (name === 'core/query-pagination-numbers') {
        return `<div class="wp-block-query-pagination-numbers">`
            + `<span aria-current="page" class="page-numbers current">1</span>`
            + `<a class="page-numbers" href="#">2</a>`
            + `<a class="page-numbers" href="#">3</a>`
            + `<span class="page-numbers dots">…</span>`
            + `<a class="page-numbers" href="#">8</a></div>`;
    }
    return '';
}

function renderQueryPagination(attrs, innerBlocks, ctx) {
    const cls = rootClass('wp-block-query-pagination is-content-justification-space-between is-layout-flex', attrs);
    const children = (innerBlocks || []).map((b) => renderQueryPaginationChild(b, ctx)).join('');
    return `<nav class="${cls}" aria-label="Pagination">${children}</nav>`;
}

function renderCommentsForm(attrs) {
    const cls = rootClass('wp-block-post-comments-form', attrs);
    return `<div class="${cls}"><div class="comment-respond">`
        + `<h3 class="comment-reply-title">Leave a Reply</h3>`
        + `<form class="comment-form">`
        + `<p class="comment-form-comment"><label for="comment">Comment</label>`
        + `<textarea id="comment" name="comment" cols="45" rows="8" required></textarea></p>`
        + `<p class="form-submit"><input name="submit" type="submit" class="submit wp-element-button" value="Post Comment"></p>`
        + `</form></div></div>`;
}

// Returns the frontend HTML string for an allowlisted dynamic block, or null
// when the block is not shimmed (the caller keeps the normal save() output).
export function renderDynamicBlock(name, attributes, innerBlocks, context) {
    const ctx = Object.assign({}, DEFAULT_PREVIEW_CONTEXT, context || {});
    const attrs = attributes || {};
    switch (name) {
        case 'core/navigation': return renderNavigation(attrs, innerBlocks);
        case 'core/search': return renderSearch(attrs);
        case 'core/site-title': return renderSiteTitle(attrs, ctx);
        case 'core/site-logo': return renderSiteLogo(attrs, ctx);
        case 'core/post-comments-form': return renderCommentsForm(attrs);
        case 'core/query-pagination': return renderQueryPagination(attrs, innerBlocks, ctx);
        case 'core/post-navigation-link': return renderPostNavigationLink(attrs);
        case 'core/post-date': return renderPostDate(attrs, ctx);
        case 'core/post-terms': return renderPostTerms(attrs, ctx);
        default: return null;
    }
}
