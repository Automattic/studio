// src/lib/replicate/local-data/card-render-php.test.ts
//
// Two layers:
//  1) Hermetic string assertions on the generated mu-plugin (always run).
//  2) Execution parity: render the same items through the generated PHP and the
//     TS mirror and assert the DOMs match — skipped when `php` is unavailable so
//     the suite stays green on machines without it.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'cheerio';
import { buildDataCardPlugin, dataCardPluginFilename } from './card-render-php.js';
import { renderCard, type CardRenderContext } from './card-render.js';
import { DATA_MODEL_SCHEMA, type DataCard, type DataItem, type DataModel, type DataTaxonomy } from './types.js';

const TAX: DataTaxonomy = {
  slug: 'widget_cat',
  label: 'Kinds',
  hierarchical: true,
  terms: [
    { slug: 'round', label: 'Round Things' },
    { slug: 'flat', label: 'Flat Things' },
  ],
};

const CARD: DataCard = {
  maps: { TONE: { round: 'tone-a', flat: 'tone-b' } },
  template: `<article class="card" data-dla-attr="data-cat:cat.slug,data-id:id">
    <div class="card__media">
      <div class="ph" data-dla-class="map.TONE.cat.slug"><span class="tag" data-dla-text="gallery.0.caption"></span></div>
      <span class="badge" data-dla-if="meta.status=='reserved'">Reserved</span>
      <span class="badge" data-dla-if="meta.status=='sold'">Sold</span>
    </div>
    <div class="card__cat" data-dla-text="cat.label"></div>
    <h3 class="card__title" data-dla-text="title"></h3>
    <div class="card__row">
      <span class="price" data-dla-if="meta.status!='sold'">$<span data-dla-text="meta.price"></span></span>
      <span class="price" data-dla-if="meta.status=='sold'"><span class="sold">$<span data-dla-text="meta.price"></span></span></span>
      <button class="more" data-dla-attr="data-more:id">More</button>
    </div>
  </article>`,
  variants: {
    row: `<article class="card-row" data-dla-attr="data-id:id">
      <h4 class="card-row__title" data-dla-text="title"></h4>
      <span class="card-row__price" data-dla-text="meta.price"></span>
    </article>`,
  },
};

const MODEL: DataModel = {
  cpt: { slug: 'widget', singular: 'Widget', plural: 'Widgets', public: true, supports: ['title', 'editor'] },
  taxonomy: TAX,
  fields: [
    { key: 'price', type: 'integer' },
    { key: 'status', type: 'string' },
  ],
  items: [],
  mounts: [],
  card: CARD,
  schema: DATA_MODEL_SCHEMA,
};

const ITEMS: DataItem[] = [
  { id: 'gizmo-7', title: 'The Gizmo', terms: ['round'], meta: { price: 42, status: 'available' }, gallery: [{ caption: 'front view' }] },
  { id: 'slab-2', title: 'A Slab', terms: ['flat'], meta: { price: 99, status: 'sold' }, gallery: [{ caption: 'top' }] },
  { id: 'orb-1', title: 'Quiet Orb', terms: ['round'], meta: { price: 5, status: 'reserved' }, gallery: [] },
];

const ctx = (item: DataItem): CardRenderContext => ({ card: CARD, taxonomy: TAX, item });

/** Canonicalize HTML so entity/whitespace/attr-order noise doesn't fail parity. */
function canon(html: string): string {
  const $ = load(html, null, false);
  return $.html().replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
}

function canonCard(html: string): string {
  const $ = load(html, null, false);
  $('script.dla-item').remove();
  return $.html().replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
}

function phpAvailable(): boolean {
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('buildDataCardPlugin (string)', () => {
  it('registers the dynamic block with postId context + render callback', () => {
    const code = buildDataCardPlugin(MODEL);
    expect(code).toContain("register_block_type( 'dla/data-card'");
    expect(code).toContain("'uses_context'    => array( 'postId' )");
    expect(code).toContain("'render_callback' => 'dla_card_block_render_widget'");
  });

  it('bakes the template (nowdoc), maps, term labels and field list', () => {
    const code = buildDataCardPlugin(MODEL);
    expect(code).toContain("DLA_CARD_TEMPLATE_widget");
    expect(code).toContain('function dla_card_variants_widget()');
    expect(code).toContain("'row' =>");
    expect(code).toContain("'TONE' => array(");
    expect(code).toContain("'round' => 'tone-a'");
    expect(code).toContain("'round' => 'Round Things'"); // term label
    expect(code).toContain("'price',"); // field key in build-item loop
  });

  it('enqueues an editor ServerSideRender registration', () => {
    const code = buildDataCardPlugin(MODEL);
    expect(code).toContain('enqueue_block_editor_assets');
    expect(code).toContain('wp.serverSideRender');
    expect(code).toContain('blocks.registerBlockType('); // baked editor JS (quotes escaped)
    expect(code).toContain("attributes: { variant: { type: \\'string\\', default: \\'\\' } }");
  });

  it('registers the variant attribute for SSR', () => {
    const code = buildDataCardPlugin(MODEL);
    expect(code).toContain("'attributes'      => array(");
    expect(code).toContain("'variant' => array( 'type' => 'string', 'default' => '' )");
  });

  it('throws without a card spec', () => {
    expect(() => buildDataCardPlugin({ ...MODEL, card: undefined })).toThrow(/card is required/);
  });

  it('derives a conventional filename', () => {
    expect(dataCardPluginFilename(MODEL)).toBe('dla-data-widget-card.php');
  });
});

describe.skipIf(!phpAvailable())('card render parity (PHP vs TS)', () => {
  it('PHP render matches the TS mirror for base, row variant, and unknown fallback', () => {
    const dir = mkdtempSync(join(process.cwd(), '.tmp-test', 'cardphp-'));
    try {
      const pluginPath = join(dir, 'plugin.php');
      writeFileSync(pluginPath, buildDataCardPlugin(MODEL));
      const harness = join(dir, 'harness.php');
      writeFileSync(
        harness,
        `<?php
define('ABSPATH', '/tmp/');
function add_action() {}
function register_block_type() {}
function wp_register_script() {}
function wp_enqueue_script() {}
function wp_add_inline_script() {}
function is_wp_error( $value ) { return false; }
function get_post_meta( $post_id, $key, $single = true ) {
    global $item;
    if ( '_dla_item_id' === $key ) { return $item['id']; }
    if ( '_dla_gallery' === $key ) { return $item['gallery']; }
    return isset( $item['meta'][ $key ] ) ? $item['meta'][ $key ] : '';
}
function wp_get_post_terms( $post_id, $taxonomy, $args = array() ) {
    global $item;
    return $item['terms'];
}
function get_the_title( $post_id ) { global $item; return $item['title']; }
function get_post_field( $field, $post_id ) { global $item; return isset( $item['content'] ) ? $item['content'] : ''; }
function get_the_ID() { return 1; }
function get_permalink( $post_id ) { return 'https://example.test/?p=' . (int) $post_id; }
function get_term_link( $term, $tax ) { return 'https://example.test/cat/' . $term . '/'; }
function esc_attr( $value ) { return htmlspecialchars( (string) $value, ENT_QUOTES ); }
function wp_json_encode( $value ) { return json_encode( $value ); }
require $argv[1];
$item = json_decode( $argv[2], true );
$variant = $argv[3];
$block = (object) array( 'context' => array( 'postId' => 1 ) );
echo dla_card_block_render_widget( array( 'variant' => $variant ), '', $block );
`,
      );
      for (const item of ITEMS) {
        for (const variant of ['', 'row', 'missing']) {
          const phpOut = execFileSync('php', [harness, pluginPath, JSON.stringify(item), variant], {
            encoding: 'utf8',
          });
          const tsOut = renderCard(ctx(item), variant);
          expect(canonCard(phpOut), `parity for ${item.id} variant ${variant || '(base)'}`).toBe(canon(tsOut));
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
