//
// Smoke test for the block-fixer's core function. Runs without the HTTP
// server — just exercises fixBlocksInTemplate directly to catch
// dependency-resolution / JSDOM-globals breakage early.
//

const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;
global.Node = dom.window.Node;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.getComputedStyle = dom.window.getComputedStyle;
global.MutationObserver = dom.window.MutationObserver;
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.matchMedia = () => ({
  matches: false,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
});
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Object.defineProperty(global, 'navigator', {
  value: dom.window.navigator,
  writable: true,
  configurable: true,
});

const { fixBlocksInTemplate } = require('../lib/blockFixer.js');

test('fixBlocksInTemplate normalizes a simple paragraph block', () => {
  const input = '<!-- wp:paragraph --><p>Hello world</p><!-- /wp:paragraph -->';
  const result = fixBlocksInTemplate(input);
  assert.ok(result.html.includes('<p>Hello world</p>'));
  assert.ok(result.html.includes('<!-- wp:paragraph'));
  assert.ok(result.html.includes('<!-- /wp:paragraph -->'));
});

test('fixBlocksInTemplate flattens nested <p> inside wp:paragraph', () => {
  const input =
    '<!-- wp:paragraph --><p class="outer"><p class="inner">Nested</p></p><!-- /wp:paragraph -->';
  const result = fixBlocksInTemplate(input);
  // Should flatten to a single <p>; both classes preserved (or content recovered).
  assert.ok(result.html.includes('Nested'));
  // No nested-p remaining.
  const nestedMatch = /<p[^>]*>\s*<p[^>]*>/.exec(result.html);
  assert.strictEqual(nestedMatch, null, 'nested <p> tags should be flattened');
});

test('fixBlocksInTemplate handles heading + paragraph composition', () => {
  const input = [
    '<!-- wp:heading {"level":1} --><h1>Title</h1><!-- /wp:heading -->',
    '<!-- wp:paragraph --><p>Body text.</p><!-- /wp:paragraph -->',
  ].join('\n');
  const result = fixBlocksInTemplate(input);
  // WP canonicalizes <h1> → <h1 class="wp-block-heading">; that's the whole point.
  assert.ok(/<h1[^>]*>Title<\/h1>/.test(result.html));
  assert.ok(result.html.includes('Body text.'));
});

// --- Editor-valid carry rework regression -----------------------------------
// The carry emitter no longer rides inline style= (the fixer STRIPS it from core
// blocks); per-instance styles ride a lib-i<hash> className + a carried rule, and
// raw inline group bodies ride a core/html INNER block. These prove the fixer
// PRESERVES both shapes (the original failures: heading style stripped, group
// inline body DELETED).

test('carry: heading className (source class + lib-i) survives the fixer, no inline style', () => {
  const input =
    '<!-- wp:heading {"className":"display lib-iabc1234567"} -->\n' +
    '<h2 class="wp-block-heading display lib-iabc1234567">Scent</h2>\n' +
    '<!-- /wp:heading -->';
  const result = fixBlocksInTemplate(input);
  assert.ok(result.html.includes('Scent'));
  assert.ok(result.html.includes('display'), 'source class preserved');
  assert.ok(result.html.includes('lib-iabc1234567'), 'instance lib-i class preserved');
  assert.ok(!/style=/.test(result.html), 'no inline style attr re-introduced');
});

test('carry: paragraph className (lib-i) survives the fixer', () => {
  const input =
    '<!-- wp:paragraph {"className":"lead lib-ixyz9876543"} -->\n' +
    '<p class="lead lib-ixyz9876543">Made to order.</p>\n' +
    '<!-- /wp:paragraph -->';
  const result = fixBlocksInTemplate(input);
  assert.ok(result.html.includes('Made to order.'));
  assert.ok(result.html.includes('lead'));
  assert.ok(result.html.includes('lib-ixyz9876543'));
});

test('carry: group with a core/html inner block preserves raw inline body (no content loss)', () => {
  // The ORIGINAL failure: a core/group with raw inline content ("01 Made here")
  // had its inner DELETED by the fixer. Wrapping the inline body in core/html
  // makes it survive — the group keeps its class (.kicker layout) and the spans
  // render inline.
  const input =
    '<!-- wp:group {"tagName":"div","className":"kicker"} -->\n' +
    '<div class="wp-block-group kicker">\n' +
    '<!-- wp:html -->\n' +
    '<span class="num">01</span> Made here\n' +
    '<!-- /wp:html -->\n' +
    '</div>\n' +
    '<!-- /wp:group -->';
  const result = fixBlocksInTemplate(input);
  assert.ok(result.html.includes('kicker'), 'group class preserved');
  assert.ok(result.html.includes('<span class="num">01</span>'), 'inline span content preserved (not deleted)');
  assert.ok(result.html.includes('Made here'), 'inline text preserved');
});

test('fixBlocksInTemplate preserves comment attrs through invalid-block recovery (variation hoist)', () => {
  // A "hoisted" block: the comment attrs carry a style-variation className
  // (is-style-lib-*) while the inner HTML still has the pre-hoist inline
  // style + style-derived classes. The block is INVALID vs save(); recovery
  // must keep the comment attrs verbatim (like WP editor recovery), not
  // re-derive className from the stale HTML.
  const input =
    '<!-- wp:heading {"className":"is-style-lib-heading-typography","textColor":"text-default","fontFamily":"body"} -->\n' +
    '<h2 class="has-text-default-color has-text-color has-body-font-family" style="font-size:36px">Sample Heading</h2>\n' +
    '<!-- /wp:heading -->';
  const result = fixBlocksInTemplate(input);

  // Comment attrs survive.
  const commentMatch = /<!-- wp:heading (\{[^\n]*\}) -->/.exec(result.html);
  assert.ok(commentMatch, 'heading block comment with attrs is present');
  const attrs = JSON.parse(commentMatch[1]);
  assert.strictEqual(attrs.className, 'is-style-lib-heading-typography');
  assert.strictEqual(attrs.textColor, 'text-default');
  assert.strictEqual(attrs.fontFamily, 'body');

  // Inner HTML is regenerated: is-style class lands in the element class
  // list, content is preserved, and the pre-hoist inline style residue is gone.
  const h2Match = /<h2([^>]*)>Sample Heading<\/h2>/.exec(result.html);
  assert.ok(h2Match, 'heading element with content is present');
  assert.ok(
    /class="[^"]*\bis-style-lib-heading-typography\b[^"]*"/.test(h2Match[1]),
    'is-style class is in the element class list',
  );
  assert.ok(!/style="/.test(h2Match[1]), 'no inline style residue');
});

test('fixBlocksInTemplate preserves comment attrs on invalid nested blocks', () => {
  const input =
    '<!-- wp:group {"layout":{"type":"constrained"}} -->\n' +
    '<div class="wp-block-group">\n' +
    '<!-- wp:paragraph {"className":"is-style-lib-paragraph-typography"} -->\n' +
    '<p style="line-height:1.8">Nested body text.</p>\n' +
    '<!-- /wp:paragraph -->\n' +
    '</div>\n' +
    '<!-- /wp:group -->';
  const result = fixBlocksInTemplate(input);
  assert.ok(
    result.html.includes('"className":"is-style-lib-paragraph-typography"'),
    'nested comment className survives',
  );
  assert.ok(
    /<p[^>]*\bis-style-lib-paragraph-typography\b[^>]*>Nested body text\.<\/p>/.test(
      result.html,
    ),
    'nested element carries the is-style class',
  );
  assert.ok(
    !/<p[^>]*style="/.test(result.html),
    'nested inline style residue removed',
  );
});

test('fixBlocksInTemplate passes jetpack/contact-form (unknown block) through grammar-identical', () => {
  // jetpack/* blocks are NOT in the fixer's registry (registerCoreBlocks only).
  // Unknown blocks MUST pass through grammar-preserved: same block names, same
  // comment attrs, same inner content — the forms emission (form-blocks.ts)
  // depends on this (post_content runs through fix() before install).
  // The submit is a core/button in canonical save form (the current Jetpack
  // form-editor grammar — form-blocks.ts emits exactly this shape so the
  // fixer round-trip is a no-op on it).
  const submitButton =
    '<!-- wp:button {"tagName":"button","type":"submit","lock":{"remove":true},"className":"form-button-submit is-submit","metadata":{"name":"Submit button"}} -->\n' +
    '<div class="wp-block-button form-button-submit is-submit"><button type="submit" class="wp-block-button__link wp-element-button">Send Message</button></div>\n' +
    '<!-- /wp:button -->';
  const input =
    '<!-- wp:jetpack/contact-form {"style":{"spacing":{"padding":{"top":"16px","right":"16px","bottom":"16px","left":"16px"}}}} -->\n' +
    '<div class="wp-block-jetpack-contact-form">\n' +
    '<!-- wp:jetpack/field-name {"label":"Full name","required":true,"width":50} /-->\n' +
    '<!-- wp:jetpack/field-email {"label":"Email address","required":true,"width":50} /-->\n' +
    submitButton + '\n' +
    '</div>\n' +
    '<!-- /wp:jetpack/contact-form -->';
  const result = fixBlocksInTemplate(input);

  // Grammar-identical: every block delimiter + its attrs survive verbatim.
  assert.ok(
    result.html.includes('<!-- wp:jetpack/contact-form {"style":{"spacing":{"padding":{"top":"16px","right":"16px","bottom":"16px","left":"16px"}}}} -->'),
    'wrapper comment + attrs preserved',
  );
  assert.ok(result.html.includes('<!-- /wp:jetpack/contact-form -->'), 'wrapper close preserved');
  assert.ok(
    result.html.includes('<!-- wp:jetpack/field-name {"label":"Full name","required":true,"width":50} /-->'),
    'field-name self-closing block + attrs preserved',
  );
  assert.ok(
    result.html.includes('<!-- wp:jetpack/field-email {"label":"Email address","required":true,"width":50} /-->'),
    'field-email self-closing block + attrs preserved',
  );
  // The core/button submit round-trips byte-identically (it is canonical
  // save markup, and core/button IS in the fixer registry) — the captured
  // label and the type/className wiring Contact_Form keys off must survive.
  assert.ok(result.html.includes(submitButton), 'core/button submit round-trips byte-identical');
  assert.ok(result.html.includes('<div class="wp-block-jetpack-contact-form">'), 'inner container preserved');
  // Nothing reinterpreted the unknown blocks into other shapes.
  assert.ok(!result.html.includes('jetpack/button'), 'no jetpack/button (connection-gated, renders empty unconnected)');
  assert.ok(!result.html.includes('wp:columns'), 'no wp:columns substitution');
});

test('fixBlocksInTemplate returns input unchanged on parse error', () => {
  const input = '<!-- wp:bogus-block-name-that-does-not-exist --><div>oops</div>';
  const result = fixBlocksInTemplate(input);
  // Either passes through or returns a freeform-html block; mustn't crash.
  assert.ok(typeof result.html === 'string');
  assert.ok(result.html.length > 0);
});
