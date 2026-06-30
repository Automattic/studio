// @vitest-environment jsdom

import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeFrameJsSource, analyzeIsland, serializeFrame } from './island-bindings.js';
import type { FrameNode, IslandBindings } from './island-bindings.js';

const nodeRequire = createRequire(import.meta.url);
const { JSDOM } = nodeRequire('jsdom') as {
  JSDOM: new (html?: string, options?: { runScripts?: 'outside-only' }) => { window: Window & { eval(source: string): unknown } };
};

type AnalyzeHtmlToFrame = (html: string) => IslandBindings;

interface Fixture {
  name: string;
  html: string;
}

const fixtures: Fixture[] = [
  {
    name: 'icon and text card',
    html:
      '<article class="feature-card"><svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<path d="M1 8h14"/></svg><p>Choose <strong>cleanly</strong></p></article>',
  },
  {
    name: 'figure image',
    html: '<figure data-card="image"><img src="/media/maple.jpg" alt="Maple room"><figcaption>Maple <em>room</em></figcaption></figure>',
  },
  {
    name: 'inline nesting',
    html: '<p>Read <a href="/guide"><span>the <em>field guide</em></span></a> today</p>',
  },
  {
    name: 'raw script and style',
    html:
      '<section><style>.feature-card > p { color: red; }</style>' +
      '<script>window.__fictionalCard = "<section>";</script><p>Visible copy</p></section>',
  },
  {
    name: 'HTML comment',
    html: '<div><!-- editorial slot: do not bind --><p>Commented copy</p></div>',
  },
  {
    name: 'plain text node',
    html: 'Loose plain text node &amp; entity',
  },
];

type DomShape =
  | { kind: 'text'; text: string }
  | { kind: 'comment'; text: string }
  | { kind: 'element'; tag: string; attrs: [string, string][]; children: DomShape[] }
  | { kind: 'other'; type: number; text: string };

type ComparableFrameNode =
  | { kind: 'text'; text: string }
  | { kind: 'raw'; htmlDom: DomShape[] }
  | { kind: 'element'; tag: string; attrs: [string, string][]; children: ComparableFrameNode[] }
  | { kind: 'bindText'; id: string; tag: string; attrs: [string, string][]; htmlDom: DomShape[] }
  | { kind: 'bindImage'; id: string; attrs: [string, string][] };

function attrsShape(attrs: Record<string, string>): [string, string][] {
  return Object.entries(attrs).sort(([left], [right]) => left.localeCompare(right));
}

function domNodeShape(node: ChildNode): DomShape {
  if (node.nodeType === 1) {
    const element = node as Element;
    return {
      kind: 'element',
      tag: element.tagName.toLowerCase(),
      attrs: Array.from(element.attributes)
        .map((attr) => [attr.name, attr.value] as [string, string])
        .sort(([left], [right]) => left.localeCompare(right)),
      children: Array.from(element.childNodes).map(domNodeShape),
    };
  }

  if (node.nodeType === 3) {
    return { kind: 'text', text: node.textContent ?? '' };
  }

  if (node.nodeType === 8) {
    return { kind: 'comment', text: node.textContent ?? '' };
  }

  return { kind: 'other', type: node.nodeType, text: node.textContent ?? '' };
}

function domFragmentShape(html: string): DomShape[] {
  const dom = new JSDOM('<!doctype html>');
  const template = dom.window.document.createElement('template');
  template.innerHTML = html;
  const shape = Array.from(template.content.childNodes).map(domNodeShape);
  dom.window.close();
  return shape;
}

function kindTree(frame: FrameNode[]): unknown[] {
  return frame.map((node) => {
    if (node.kind === 'element') return { kind: node.kind, children: kindTree(node.children) };
    return { kind: node.kind };
  });
}

function bindingIds(frame: FrameNode[]): string[] {
  return frame.flatMap((node) => {
    if (node.kind === 'element') return bindingIds(node.children);
    if (node.kind === 'bindText' || node.kind === 'bindImage') return [node.id];
    return [];
  });
}

function comparableFrame(frame: FrameNode[]): ComparableFrameNode[] {
  return frame.map((node) => {
    if (node.kind === 'text') return { kind: node.kind, text: node.text };
    if (node.kind === 'raw') return { kind: node.kind, htmlDom: domFragmentShape(node.html) };
    if (node.kind === 'bindImage') return { kind: node.kind, id: node.id, attrs: attrsShape(node.attrs) };
    if (node.kind === 'bindText') {
      return {
        kind: node.kind,
        id: node.id,
        tag: node.tag,
        attrs: attrsShape(node.attrs),
        htmlDom: domFragmentShape(node.html),
      };
    }

    return {
      kind: node.kind,
      tag: node.tag,
      attrs: attrsShape(node.attrs),
      children: comparableFrame(node.children),
    };
  });
}

function comparableIsland(island: IslandBindings): { bindingCount: number; frame: ComparableFrameNode[] } {
  return {
    bindingCount: island.bindingCount,
    frame: comparableFrame(island.frame),
  };
}

describe('analyzeFrameJsSource', () => {
  let browserDom: { window: Window & { eval(source: string): unknown; close(): void } };
  let analyzeHtmlToFrame: AnalyzeHtmlToFrame;

  beforeAll(() => {
    browserDom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' }) as typeof browserDom;
    analyzeHtmlToFrame = browserDom.window.eval(`(${analyzeFrameJsSource()})`) as AnalyzeHtmlToFrame;
  });

  afterAll(() => {
    browserDom?.window.close();
  });

  it.each(fixtures)('matches server frame analysis for $name', ({ html }) => {
    const serverIsland = analyzeIsland(html);
    const browserIsland = analyzeHtmlToFrame(html);

    expect(browserIsland.bindingCount).toBe(serverIsland.bindingCount);
    expect(kindTree(browserIsland.frame)).toEqual(kindTree(serverIsland.frame));
    expect(bindingIds(browserIsland.frame)).toEqual(bindingIds(serverIsland.frame));
    expect(comparableFrame(browserIsland.frame)).toEqual(comparableFrame(serverIsland.frame));
  });

  it.each(fixtures)('round-trips serialized browser frames for $name', ({ html }) => {
    const browserIsland = analyzeHtmlToFrame(html);
    const serialized = serializeFrame(browserIsland.frame);
    const reanalyzed = analyzeHtmlToFrame(serialized);

    expect(comparableIsland(reanalyzed)).toEqual(comparableIsland(browserIsland));
    expect(domFragmentShape(serialized)).toEqual(domFragmentShape(html));
  });
});
