// A node in the island frame tree. Either a static text leaf, an element
// (with verbatim tag/attrs and recursive children), an editable text binding,
// or an editable image binding. `raw` nodes carry verbatim HTML that must never
// be touched, including comments and unsafe/interactive subtrees.
export type FrameNode =
  | { kind: 'text'; text: string }                                   // static text node (escaped on serialize)
  | { kind: 'raw'; html: string }                                    // verbatim HTML (svg/controls/scripts/comments) — never edited
  | { kind: 'element'; tag: string; attrs: Record<string, string>; children: FrameNode[] }
  | { kind: 'bindText'; id: string; tag: string; attrs: Record<string, string>; html: string }  // RichText leaf; html = inline content
  | { kind: 'bindImage'; id: string; attrs: Record<string, string> };                            // <img>; attrs include src/alt/etc.

export interface IslandBindings {
  /** The frame tree (server + JS both serialize this to HTML identically). */
  frame: FrameNode[];
  /** Count of bindable leaves (bindText + bindImage). 0 ⇒ caller leaves the island as core/html. */
  bindingCount: number;
}

import * as cheerio from 'cheerio';
import { isTag, isText } from 'domhandler';
import type { AnyNode, Element } from 'domhandler';

const INLINE_ALLOWED = new Set(['a', 'strong', 'em', 'b', 'i', 'br', 'span']);
const INTERACTIVE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'svg']);
const RAW_TAGS = new Set([...INTERACTIVE_TAGS, 'script', 'style', 'noscript']);
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

interface SourceLocation {
  startOffset: number;
  endOffset: number;
  startTag?: { endOffset: number };
  endTag?: { startOffset: number };
}

function attrsOf(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(el.attribs ?? {})) {
    attrs[key] = value;
  }
  return attrs;
}

function sourceLocation(node: AnyNode): SourceLocation | undefined {
  return (node as AnyNode & { sourceCodeLocation?: SourceLocation }).sourceCodeLocation;
}

function fallbackHtml($: cheerio.CheerioAPI, node: AnyNode): string {
  return $.html(node) ?? '';
}

function sliceNode($: cheerio.CheerioAPI, html: string, node: AnyNode): string {
  const loc = sourceLocation(node);
  if (loc) return html.slice(loc.startOffset, loc.endOffset);

  const start = node.startIndex;
  const end = node.endIndex;
  if (typeof start !== 'number' || typeof end !== 'number') return fallbackHtml($, node);
  return html.slice(start, end + 1);
}

function innerHtmlFromSource($: cheerio.CheerioAPI, html: string, el: Element): string {
  const loc = sourceLocation(el);
  if (loc?.startTag && loc.endTag) {
    return html.slice(loc.startTag.endOffset, loc.endTag.startOffset);
  }

  const first = el.children[0];
  const last = el.children[el.children.length - 1];
  if (!first || !last) return '';
  const firstLoc = sourceLocation(first);
  const lastLoc = sourceLocation(last);
  if (firstLoc && lastLoc) return html.slice(firstLoc.startOffset, lastLoc.endOffset);
  const start = first.startIndex;
  const end = last.endIndex;
  if (typeof start !== 'number' || typeof end !== 'number') return el.children.map((child) => fallbackHtml($, child)).join('');
  return html.slice(start, end + 1);
}

function tagName(el: Element): string {
  return (el.tagName || el.name || '').toLowerCase();
}

function isInlineContentNode(node: AnyNode): boolean {
  if (isText(node)) return true;
  if (!isTag(node)) return false;

  const tag = tagName(node);
  if (!INLINE_ALLOWED.has(tag)) return false;
  if (RAW_TAGS.has(tag) || tag === 'img') return false;
  return node.children.every(isInlineContentNode);
}

function hasNonWhitespaceText(node: AnyNode): boolean {
  if (isText(node)) return /\S/.test(node.data);
  if (!isTag(node)) return false;
  return node.children.some(hasNonWhitespaceText);
}

function isBindableTextElement(el: Element): boolean {
  if (!el.children.every(isInlineContentNode)) return false;
  return el.children.some(hasNonWhitespaceText);
}

interface AnalyzeState {
  nextId: number;
  bindingCount: number;
}

function nextBindingId(state: AnalyzeState): string {
  const id = `b${state.nextId}`;
  state.nextId += 1;
  state.bindingCount += 1;
  return id;
}

function analyzeNode($: cheerio.CheerioAPI, html: string, node: AnyNode, state: AnalyzeState): FrameNode | null {
  if (isText(node)) {
    return { kind: 'text', text: node.data };
  }

  if (node.type === 'comment') {
    return { kind: 'raw', html: sliceNode($, html, node) };
  }

  if (!isTag(node)) return null;

  const tag = tagName(node);
  if (RAW_TAGS.has(tag)) {
    return { kind: 'raw', html: sliceNode($, html, node) };
  }

  const attrs = attrsOf(node);
  if (tag === 'img') {
    return { kind: 'bindImage', id: nextBindingId(state), attrs };
  }

  if (isBindableTextElement(node)) {
    return {
      kind: 'bindText',
      id: nextBindingId(state),
      tag,
      attrs,
      html: innerHtmlFromSource($, html, node),
    };
  }

  const children = node.children
    .map((child) => analyzeNode($, html, child, state))
    .filter((child): child is FrameNode => child !== null);
  return { kind: 'element', tag, attrs, children };
}

export function analyzeIsland(html: string): IslandBindings {
  const $ = cheerio.load(
    html,
    { sourceCodeLocationInfo: true },
    false,
  );
  const state: AnalyzeState = { nextId: 0, bindingCount: 0 };
  const frame = $.root()
    .contents()
    .get()
    .map((node) => analyzeNode($, html, node, state))
    .filter((node): node is FrameNode => node !== null);
  return { frame, bindingCount: state.bindingCount };
}

const ANALYZE_FRAME_JS_SOURCE = String.raw`function analyzeHtmlToFrame(html) {
  var INLINE_ALLOWED = new Set(['a', 'strong', 'em', 'b', 'i', 'br', 'span']);
  var RAW_TAGS = new Set(['button', 'input', 'select', 'textarea', 'svg', 'script', 'style', 'noscript']);

  function arrayFrom(list) {
    return Array.prototype.slice.call(list || []);
  }

  function attrsOf(el) {
    var attrs = {};
    arrayFrom(el.attributes).forEach(function (attr) {
      attrs[attr.name] = attr.value;
    });
    return attrs;
  }

  function tagName(el) {
    return String(el.tagName || el.nodeName || '').toLowerCase();
  }

  function childNodesOf(node) {
    return arrayFrom(node.childNodes);
  }

  function isTextNode(node) {
    return node.nodeType === 3;
  }

  function isElementNode(node) {
    return node.nodeType === 1;
  }

  function rawHtmlFor(node) {
    if (node.nodeType === 8) return '<!--' + (node.nodeValue || '') + '-->';
    return node.outerHTML || '';
  }

  function isInlineContentNode(node) {
    if (isTextNode(node)) return true;
    if (!isElementNode(node)) return false;

    var tag = tagName(node);
    if (!INLINE_ALLOWED.has(tag)) return false;
    if (RAW_TAGS.has(tag) || tag === 'img') return false;
    return childNodesOf(node).every(isInlineContentNode);
  }

  function hasNonWhitespaceText(node) {
    if (isTextNode(node)) return /\S/.test(node.nodeValue || '');
    if (!isElementNode(node)) return false;
    return childNodesOf(node).some(hasNonWhitespaceText);
  }

  function isBindableTextElement(el) {
    var children = childNodesOf(el);
    if (!children.every(isInlineContentNode)) return false;
    return children.some(hasNonWhitespaceText);
  }

  function nextBindingId(state) {
    var id = 'b' + state.nextId;
    state.nextId += 1;
    state.bindingCount += 1;
    return id;
  }

  function analyzeNode(node, state) {
    if (isTextNode(node)) {
      return { kind: 'text', text: node.nodeValue || '' };
    }

    if (node.nodeType === 8) {
      return { kind: 'raw', html: rawHtmlFor(node) };
    }

    if (!isElementNode(node)) return null;

    var tag = tagName(node);
    if (RAW_TAGS.has(tag)) {
      return { kind: 'raw', html: rawHtmlFor(node) };
    }

    var attrs = attrsOf(node);
    if (tag === 'img') {
      return { kind: 'bindImage', id: nextBindingId(state), attrs: attrs };
    }

    if (isBindableTextElement(node)) {
      return {
        kind: 'bindText',
        id: nextBindingId(state),
        tag: tag,
        attrs: attrs,
        html: node.innerHTML || '',
      };
    }

    var children = childNodesOf(node)
      .map(function (child) {
        return analyzeNode(child, state);
      })
      .filter(function (child) {
        return child !== null;
      });
    return { kind: 'element', tag: tag, attrs: attrs, children: children };
  }

  var doc = new DOMParser().parseFromString('<body>' + String(html == null ? '' : html) + '</body>', 'text/html');
  var state = { nextId: 0, bindingCount: 0 };
  var frame = childNodesOf(doc.body || doc)
    .map(function (node) {
      return analyzeNode(node, state);
    })
    .filter(function (node) {
      return node !== null;
    });
  return { frame: frame, bindingCount: state.bindingCount };
}`;

export function analyzeFrameJsSource(): string {
  return ANALYZE_FRAME_JS_SOURCE;
}

const SERIALIZE_FRAME_JS_SOURCE = String.raw`function serializeFrameShared(frame) {
  var VOID_TAGS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ]);

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function serializeAttrs(attrs) {
    return Object.keys(attrs || {})
      .map(function (key) {
        return ' ' + key + '="' + escapeHtml(attrs[key]) + '"';
      })
      .join('');
  }

  function serializeNodes(nodes) {
    return (nodes || [])
      .map(function (node) {
        if (node.kind === 'text') return escapeHtml(node.text || '');
        if (node.kind === 'raw') return node.html || '';
        if (node.kind === 'bindImage') return '<img' + serializeAttrs(node.attrs) + '/>';
        if (node.kind === 'bindText') {
          return '<' + node.tag + serializeAttrs(node.attrs) + '>' + (node.html || '') + '</' + node.tag + '>';
        }

        var attrs = serializeAttrs(node.attrs);
        if (VOID_TAGS.has(node.tag)) return '<' + node.tag + attrs + '/>';
        return '<' + node.tag + attrs + '>' + serializeNodes(node.children) + '</' + node.tag + '>';
      })
      .join('');
  }

  return serializeNodes(frame);
}`;

const serializeFrameShared = (0, eval)(`(${SERIALIZE_FRAME_JS_SOURCE})`) as (frame: FrameNode[]) => string;

export function serializeFrameJsSource(): string {
  return SERIALIZE_FRAME_JS_SOURCE;
}

export function serializeFrame(frame: FrameNode[]): string {
  return serializeFrameShared(frame);
}

function attrJsonValue(value: unknown): string {
  return JSON.stringify(value).replace(/--/g, '\\u002d\\u002d');
}

export function emitEditableBlock(
  island: IslandBindings,
  metadata?: Record<string, unknown>,
): string {
  // Preserve the source island's block `metadata` (notably `metadata.name`, the editor
  // List View / block label the carry path sets via `<!-- wp:html {"metadata":{"name"…}} -->`).
  // `metadata` is editor-only (not part of save() output), so it doesn't affect validation.
  const attrs: Record<string, unknown> = { frame: island.frame };
  if (metadata && Object.keys(metadata).length > 0) attrs.metadata = metadata;
  return (
    `<!-- wp:dla/editable-html ${attrJsonValue(attrs)} -->\n` +
    `${serializeFrame(island.frame)}\n` +
    '<!-- /wp:dla/editable-html -->'
  );
}
