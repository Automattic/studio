// src/lib/replicate/local-data/inject-query-loops.test.ts
import { describe, it, expect } from 'vitest';
import { parse } from '@wordpress/block-serialization-default-parser';
import { injectQueryLoops } from './inject-query-loops.js';
import type { MountSpec } from './types.js';

// The exact emitted shape of an empty JS-mount div (from a real composed sidecar).
const MOUNT_GROUP = `<!-- wp:group  {"anchor":"newestGrid","tagName":"div","className":"obj-grid obj-grid\\u002d\\u002d4"} -->
<div id="newestGrid" class="wp-block-group obj-grid obj-grid--4"></div>
<!-- /wp:group -->`;

const PAGE = `<!-- wp:heading {"className":"h-md"} -->
<h2 class="wp-block-heading h-md">The newest arrivals</h2>
<!-- /wp:heading -->
${MOUNT_GROUP}`;

const NEWEST: MountSpec = {
  selector: '#newestGrid',
  sourceCall: "mountGrid('#newestGrid', newestObjets(4))",
  query: { postType: 'objet', perPage: 4, orderBy: 'date', order: 'DESC' },
  wrapperClass: 'obj-grid obj-grid--4',
};

describe('injectQueryLoops', () => {
  it('replaces the empty anchor-group with a query loop', () => {
    const r = injectQueryLoops(PAGE, [NEWEST]);
    expect(r.injected).toEqual(['newestGrid']);
    expect(r.missing).toEqual([]);
    // empty mount group is gone; query loop present
    expect(r.markup).not.toContain('<div id="newestGrid" class="wp-block-group');
    expect(r.markup).toContain('<!-- wp:query');
    expect(r.markup).toContain('<!-- wp:dla/data-card /-->');
    // surrounding content preserved
    expect(r.markup).toContain('The newest arrivals');
  });

  it('produces parseable block markup after injection', () => {
    const r = injectQueryLoops(PAGE, [NEWEST]);
    const named = parse(r.markup).filter((b) => b.blockName);
    expect(named.map((b) => b.blockName)).toEqual(['core/heading', 'core/query']);
  });

  it('returns the li-flatten css for injected loops', () => {
    const r = injectQueryLoops(PAGE, [NEWEST]);
    expect(r.css).toBe('#newestGrid .wp-block-post-template > li{display:contents}');
  });

  it('reports a mount whose id is absent as missing, leaving markup unchanged', () => {
    const absent: MountSpec = { ...NEWEST, selector: '#shopGrid' };
    const r = injectQueryLoops(PAGE, [absent]);
    expect(r.injected).toEqual([]);
    expect(r.missing).toEqual(['shopGrid']);
    expect(r.markup).toBe(PAGE);
  });

  it('does not swallow a non-empty group that happens to share the id', () => {
    const nonEmpty = PAGE.replace(
      '<div id="newestGrid" class="wp-block-group obj-grid obj-grid--4"></div>',
      '<div id="newestGrid" class="wp-block-group"><!-- wp:paragraph --><p>hi</p><!-- /wp:paragraph --></div>',
    );
    const r = injectQueryLoops(nonEmpty, [NEWEST]);
    expect(r.injected).toEqual([]);
    expect(r.missing).toEqual(['newestGrid']);
  });

  it('assigns distinct queryIds across multiple mounts on one page', () => {
    const shopGroup = MOUNT_GROUP.replace(/newestGrid/g, 'shopGrid');
    const twoMounts = `${PAGE}\n${shopGroup}`;
    const shop: MountSpec = { ...NEWEST, selector: '#shopGrid', wrapperClass: 'obj-grid obj-grid--4' };
    const r = injectQueryLoops(twoMounts, [NEWEST, shop]);
    expect(r.injected).toEqual(['newestGrid', 'shopGrid']);
    expect(r.markup).toContain('"queryId":0');
    expect(r.markup).toContain('"queryId":1');
  });
});
