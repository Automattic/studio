//
// Smoke test for the rawHandler HTML→blocks op. Runs without the HTTP server —
// exercises convertHtmlToBlocks directly to catch dependency / JSDOM-globals
// breakage and to lock the preprocess (layout-unwrap, table-figure unwrap,
// native spacer-emit) behavior. Fictional content only.
//
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'Element', 'HTMLElement', 'getComputedStyle', 'MutationObserver']) global[k] = dom.window[k];
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });

const { convertHtmlToBlocks } = require('../lib/rawConvert.js');

test('heading + paragraph + table → native blocks, zero wp:html', () => {
  const html = '<main><div class="wp-block-group"><h2 class="wp-block-heading">Widget Catalog</h2>' +
    '<p>Three fictional widgets for testing.</p>' +
    '<figure class="wp-block-table"><table><thead><tr><th>Name</th><th>Use</th></tr></thead>' +
    '<tbody><tr><td>Sprocket</td><td>spins</td></tr></tbody></table></figure></div></main>';
  const { html: out, wpHtmlResidue } = convertHtmlToBlocks(html);
  assert.equal(wpHtmlResidue, 0, 'no wp:html residue');
  assert.match(out, /<!-- wp:heading/, 'heading is native');
  assert.match(out, /<!-- wp:paragraph/, 'paragraph is native');
  assert.match(out, /<!-- wp:table/, 'table is native (figure wrapper unwrapped)');
  assert.match(out, /Sprocket/, 'table cell content preserved');
});

test('spacer div → native wp:spacer with source height', () => {
  const html = '<div class="wp-block-spacer" style="height:48px"></div><p>After.</p>';
  const { html: out, wpHtmlResidue } = convertHtmlToBlocks(html);
  assert.equal(wpHtmlResidue, 0, 'spacer did not fall to wp:html');
  assert.match(out, /<!-- wp:spacer \{"height":"48px"\}/, 'native spacer at source height');
});

test('strips post-meta dynamic-block chrome so content converts native (no wp:html residue)', () => {
  // A poem post whose captured content carries WP post-meta chrome (title/date/
  // author/terms/nav) interleaved with the poem. The meta is template-level and
  // rawHandler can't convert it; it must be stripped so the poem goes native.
  const html =
    '<main><h1 class="wp-block-post-title">A Quiet Honor</h1>' +
    '<div class="wp-block-template-part"><div class="wp-block-post-date"><time datetime="2024-11-11">Nov 11, 2024</time></div></div>' +
    '<div class="wp-block-post-author-name"><a class="wp-block-post-author-name__link" href="/author/poet">Poet</a></div>' +
    '<p>They leave without fanfare, packing pieces of themselves.</p>' +
    '<div class="wp-block-post-terms"><span class="wp-block-post-terms__prefix">Tags: </span><a href="/tag/x" rel="tag">Sentimental</a></div>' +
    '<a class="wp-block-post-navigation-link" href="/prev"><span class="wp-block-post-navigation-link__arrow-previous">←</span>Previous</a></main>';
  const { html: out, wpHtmlResidue } = convertHtmlToBlocks(html);
  assert.equal(wpHtmlResidue, 0, 'post-meta chrome stripped → no wp:html residue');
  assert.match(out, /<!-- wp:paragraph -->[\s\S]*They leave without fanfare/, 'poem body converted native');
  assert.doesNotMatch(out, /wp-block-post-date|wp-block-post-terms|wp-block-post-navigation|wp-block-post-author/, 'meta chrome removed');
});

test('empty / whitespace input is safe', () => {
  assert.deepEqual(convertHtmlToBlocks(''), { html: '', wpHtmlResidue: 0 });
});
